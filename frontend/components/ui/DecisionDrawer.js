'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Badge from '@/components/ui/Badge';
import ConfidenceBar from '@/components/ui/ConfidenceBar';
import {
  TagIcon, DocumentTextIcon, KeyIcon, NoSymbolIcon, InformationCircleIcon,
} from '@/components/ui/Icons';

/* ── score parsing ─────────────────────────────────────────── */

function parseSignals(email) {
  const matched_asset   = email.matched_asset   ?? [];
  const matched_subject = email.matched_subject ?? [];
  const trade_id        = email.trade_id;

  const assetScore   = matched_asset.length   > 0 ? 0.5 : 0;
  const subjectScore = matched_subject.length > 0 ? 0.3 : 0;
  const tradeScore   = trade_id               ? 0.2 : 0;
  const rawScore     = assetScore + subjectScore + tradeScore;
  const finalScore   = Math.min(rawScore, 0.95);

  // Try to parse from reason string if matched arrays are empty
  let assetKws   = matched_asset;
  let subjectKws = matched_subject;
  if (!assetKws.length && email.reason) {
    const m = email.reason.match(/asset\[([^\]]*)\]/);
    if (m) assetKws = m[1].split(/,\s*/).map(s => s.replace(/['"]/g, '').trim()).filter(Boolean);
  }
  if (!subjectKws.length && email.reason) {
    const m = email.reason.match(/subject\[([^\]]*)\]/);
    if (m) subjectKws = m[1].split(/,\s*/).map(s => s.replace(/['"]/g, '').trim()).filter(Boolean);
  }

  const isNegative = /negative keyword/i.test(email.reason ?? '');

  return { assetScore, subjectScore, tradeScore, rawScore, finalScore, assetKws, subjectKws, isNegative };
}

/* ── sub-components ────────────────────────────────────────── */

function ScoreRow({ label, weight, score, keywords, note, icon }) {
  const hit = score > 0;
  return (
    <div className={`rounded-lg border p-3 ${hit ? 'bg-white border-neutral-200' : 'bg-neutral-50 border-neutral-200 opacity-60'}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">{icon}</span>
          <span className="text-xs font-semibold text-neutral-700">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded ${
            hit ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 text-neutral-400'
          }`}>
            {hit ? `+${score.toFixed(1)}` : '+0.0'}
          </span>
          <span className="text-[10px] text-neutral-400 font-medium">
            max +{weight.toFixed(1)}
          </span>
        </div>
      </div>

      {keywords && keywords.length > 0 ? (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {keywords.map((kw, i) => (
            <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 border border-blue-200 text-blue-800">
              {kw}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-neutral-400 italic mt-0.5">
          {note ?? 'No matches found'}
        </p>
      )}
    </div>
  );
}

function ScoreSummary({ signals, email }) {
  const { assetScore, subjectScore, tradeScore, rawScore, finalScore } = signals;
  const capped = rawScore > 0.95;

  const decisionColor =
    email.label === 'RELEVANT'  ? 'from-emerald-50 to-white border-emerald-200' :
    email.label === 'AMBIGUOUS' ? 'from-amber-50 to-white border-amber-200'     :
                                  'from-red-50 to-white border-red-200';
  const scoreColor =
    email.label === 'RELEVANT'  ? 'text-emerald-700' :
    email.label === 'AMBIGUOUS' ? 'text-amber-700'   : 'text-red-600';

  return (
    <div className={`rounded-lg border bg-gradient-to-b ${decisionColor} p-3`}>
      <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">Score Calculation</p>

      <div className="space-y-1 text-xs font-mono mb-2">
        <div className="flex justify-between text-neutral-600">
          <span>Asset keywords</span>
          <span className={assetScore > 0 ? 'text-emerald-600 font-bold' : 'text-neutral-400'}>
            {assetScore > 0 ? `+${assetScore.toFixed(1)}` : '+0.0'}
          </span>
        </div>
        <div className="flex justify-between text-neutral-600">
          <span>Subject signals</span>
          <span className={subjectScore > 0 ? 'text-emerald-600 font-bold' : 'text-neutral-400'}>
            {subjectScore > 0 ? `+${subjectScore.toFixed(1)}` : '+0.0'}
          </span>
        </div>
        <div className="flex justify-between text-neutral-600">
          <span>Trade ID</span>
          <span className={tradeScore > 0 ? 'text-emerald-600 font-bold' : 'text-neutral-400'}>
            {tradeScore > 0 ? `+${tradeScore.toFixed(1)}` : '+0.0'}
          </span>
        </div>
        <div className="h-px bg-neutral-200 my-1" />
        <div className="flex justify-between font-bold text-neutral-800">
          <span>Raw score</span>
          <span>{rawScore.toFixed(2)}</span>
        </div>
        {capped && (
          <div className="flex justify-between text-neutral-400 text-[10px]">
            <span>Capped at 0.95</span>
            <span>→ {finalScore.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Score bar */}
      <div className="flex items-center gap-2 my-2">
        <div className="flex-1 h-2 bg-neutral-200 rounded-full relative overflow-visible">
          {/* Threshold markers */}
          <div className="absolute top-0 bottom-0 left-[30%] w-px bg-amber-400 z-10" title="Ambiguous threshold (0.30)" />
          <div className="absolute top-0 bottom-0 left-[70%] w-px bg-emerald-500 z-10" title="Relevant threshold (0.70)" />
          {/* Score fill */}
          <div
            className={`h-full rounded-full transition-all ${
              email.label === 'RELEVANT' ? 'bg-emerald-500' :
              email.label === 'AMBIGUOUS' ? 'bg-amber-400' : 'bg-red-400'
            }`}
            style={{ width: `${Math.min(finalScore * 100, 100)}%` }}
          />
        </div>
        <span className={`text-sm font-bold font-mono ${scoreColor}`}>{(finalScore * 100).toFixed(0)}%</span>
      </div>

      {/* Threshold legend */}
      <div className="flex items-center gap-3 text-[10px] text-neutral-500 mb-2">
        <span className="flex items-center gap-1"><span className="w-2 h-px bg-red-400 inline-block" />  &lt;30% IRRELEVANT</span>
        <span className="flex items-center gap-1"><span className="w-2 h-px bg-amber-400 inline-block" /> 30–69% AMBIGUOUS</span>
        <span className="flex items-center gap-1"><span className="w-2 h-px bg-emerald-500 inline-block" /> ≥70% RELEVANT</span>
      </div>

      {/* Decision */}
      <div className={`flex items-center gap-2 pt-2 border-t border-neutral-200`}>
        <Badge variant={(email.label ?? 'pending').toLowerCase()} dot>
          {email.label ?? 'Unknown'}
        </Badge>
        <span className={`text-xs font-semibold ${scoreColor}`}>
          {email.label === 'RELEVANT'  ? `Score ${(finalScore * 100).toFixed(0)}% ≥ 70% threshold` :
           email.label === 'AMBIGUOUS' ? `Score ${(finalScore * 100).toFixed(0)}% between 30–70%` :
                                         `Score ${(finalScore * 100).toFixed(0)}% < 30% threshold`}
        </span>
      </div>
    </div>
  );
}

/* ── main drawer ───────────────────────────────────────────── */

export default function DecisionDrawer({ email, onClose }) {
  const open = !!email;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const handler = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const signals = email ? parseSignals(email) : null;

  function fmt(dateStr) {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      if (isNaN(d)) return dateStr;
      return d.toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return dateStr; }
  }

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className={`drawer-backdrop fixed inset-0 z-40 bg-neutral-900/25 backdrop-blur-[2px] ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`drawer-slide fixed top-0 right-0 bottom-0 z-50 h-screen w-full max-w-lg bg-white border-l border-neutral-200 shadow-2xl flex flex-col ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {!email ? null : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between px-5 py-4 border-b border-neutral-200 flex-shrink-0">
              <div className="flex-1 min-w-0 pr-4">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <Badge variant={(email.label ?? 'pending').toLowerCase()} dot>
                    {email.label ?? 'Unknown'}
                  </Badge>
                  {email.trade_id && (
                    <span className="font-mono text-xs font-semibold text-brand-700 bg-brand-50 px-2 py-0.5 rounded border border-brand-200">
                      {email.trade_id}
                    </span>
                  )}
                  {email.approximate && (
                    <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                      Subject-only scoring
                    </span>
                  )}
                </div>
                <p className="text-sm font-semibold text-neutral-900 leading-snug line-clamp-2">
                  {email.subject ?? '(no subject)'}
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-7 h-7 rounded flex items-center justify-center hover:bg-neutral-100 text-neutral-500 flex-shrink-0 transition-colors"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 scrollbar-thin">

              {/* Email metadata */}
              <div>
                <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Email</p>
                <div className="space-y-1.5 text-xs">
                  <MetaRow label="From"     value={email.sender}             />
                  <MetaRow label="Received" value={fmt(email.received_at)}   />
                  <MetaRow label="Asset"    value={email.asset_class ?? '—'} />
                  {(email.attachment_count ?? 0) > 0 && (
                    <MetaRow label="Attachments" value={`${email.attachment_count} file(s)`} />
                  )}
                  {email.skip_reason && email.skip_reason !== 'already_processed' && (
                    <MetaRow label="Pipeline" value={`Skipped · ${email.skip_reason.replace(/_/g, ' ')}`} warn />
                  )}
                </div>
              </div>

              {/* Score summary card */}
              <div>
                <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Scoring</p>
                <ScoreSummary signals={signals} email={email} />
              </div>

              {/* Signal breakdown */}
              <div>
                <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Signal Breakdown</p>
                <div className="space-y-2">

                  {/* Negative keyword hard-stop */}
                  {signals.isNegative && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 flex items-center justify-center text-red-600">
                          <NoSymbolIcon className="w-4 h-4" />
                        </span>
                        <span className="text-xs font-semibold text-red-700">Negative keyword — hard stop</span>
                      </div>
                      <p className="text-[11px] text-red-600 mt-1">
                        A negative keyword was detected with no asset keyword present. Score hard-set to IRRELEVANT (0.9 confidence).
                      </p>
                    </div>
                  )}

                  <ScoreRow
                    icon={<TagIcon className="w-4 h-4" />}
                    label="Asset Keywords"
                    weight={0.5}
                    score={signals.assetScore}
                    keywords={signals.assetKws}
                    note="No asset keywords matched"
                  />

                  <ScoreRow
                    icon={<DocumentTextIcon className="w-4 h-4" />}
                    label="Subject Signals"
                    weight={0.3}
                    score={signals.subjectScore}
                    keywords={signals.subjectKws}
                    note="No subject signals matched"
                  />

                  <ScoreRow
                    icon={<KeyIcon className="w-4 h-4" />}
                    label="Trade ID"
                    weight={0.2}
                    score={signals.tradeScore}
                    keywords={email.trade_id ? [email.trade_id] : []}
                    note="No trade ID pattern found"
                  />
                </div>
              </div>

              {/* Raw reason */}
              <div>
                <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Raw Classifier Reason</p>
                <div className="bg-neutral-900 rounded-lg px-3 py-2.5 font-mono text-[11px] text-emerald-400 leading-relaxed break-all">
                  {email.reason || '—'}
                </div>
              </div>

            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-neutral-200 flex-shrink-0">
              <p className="text-[10px] text-neutral-400 font-mono break-all">
                msg: {email.message_id ?? '—'}
              </p>
            </div>
          </>
        )}
      </div>
    </>,
    document.body,
  );
}

function MetaRow({ label, value, warn = false }) {
  return (
    <div className="flex gap-2">
      <span className="text-neutral-400 w-20 flex-shrink-0 text-[11px] pt-px">{label}</span>
      <span className={`break-all leading-snug ${warn ? 'text-amber-700 font-medium' : 'text-neutral-700'}`}>{value ?? '—'}</span>
    </div>
  );
}
