'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { usePipeline } from '@/lib/pipelineContext';
import { Spinner } from '@/components/ui/Loader';
import {
  EnvelopeIcon, InboxArrowDownIcon, FolderOpenIcon2, ServerStackIcon,
  CheckCircleIcon, XCircleIcon,
} from '@/components/ui/Icons';

/* The four pipeline stages, run sequentially against the real backend. */
const STAGE_DEFS = [
  { key: 'sync',     label: 'Sync Emails',        Icon: EnvelopeIcon,       start: 'Connecting to mailbox via the configured source…' },
  { key: 'classify', label: 'Classify',           Icon: InboxArrowDownIcon, start: 'Scoring & labelling every email…' },
  { key: 'extract',  label: 'Extract Trade Data', Icon: FolderOpenIcon2,    start: 'Parsing trades from bodies & attachments…' },
  { key: 'match',    label: 'Compare & Match',    Icon: ServerStackIcon,    start: 'Reconciling against the golden source…' },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toLocaleTimeString('en-GB', { hour12: false });
const MIN_STAGE_MS = 1100;   // keep each stage visible even when the call is instant

export default function RunConsole({ workflow, source = 'local', onClose }) {
  const router = useRouter();
  const { setSynced, setClassified, setMatch, setActiveStep } = usePipeline();

  const [stages, setStages] = useState(() => STAGE_DEFS.map((s) => ({ ...s, state: 'pending', detail: '' })));
  const [phase, setPhase] = useState('running'); // running | done | error
  const startedRef = useRef(false);

  const setStage = (i, patch) => setStages((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const log = () => {};   // run details now live on the stage rows; no separate log feed

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function stageRun(i, fn) {
    setStage(i, { state: 'running' });
    log(STAGE_DEFS[i].start, 'run');
    const [res] = await Promise.all([fn(), wait(MIN_STAGE_MS)]);
    return res;
  }

  async function run() {
    try {
      log(`Starting workflow “${workflow?.name ?? 'FX Trade Settlement'}” · source: ${source}`, 'run');

      // ── 1) Sync ─────────────────────────────────────────────
      const sync = await stageRun(0, () => api.fetchEmails(source));
      const emails = sync.emails ?? [];
      const withAtt = emails.filter((e) => (e.attachment_count ?? 0) > 0).length;
      setSynced?.(emails, new Date().toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
      }));
      log(`Synced ${sync.count} emails · ${withAtt} with attachments`, 'success');
      setStage(0, { state: 'done', detail: `${sync.count} emails · ${withAtt} with attachments` });
      await wait(300);

      // ── 2) Classify ─────────────────────────────────────────
      const runRes = await stageRun(1, () => api.runPipeline(source));
      const ce = Array.isArray(runRes.classified_emails) ? runRes.classified_emails : [];
      const rel = ce.filter((e) => e.label === 'RELEVANT' && e.skip_reason !== 'duplicate').length;
      const amb = ce.filter((e) => e.label === 'AMBIGUOUS').length;
      const irr = ce.filter((e) => e.label === 'IRRELEVANT').length;
      const dup = ce.filter((e) => e.skip_reason === 'duplicate').length;
      setClassified?.(ce, runRes.stats ?? {});
      log(`Classified ${ce.length} emails → ${rel} relevant · ${amb} ambiguous · ${irr} irrelevant · ${dup} duplicate`, 'success');
      setStage(1, { state: 'done', detail: `${rel} relevant · ${amb} ambiguous · ${irr} irrelevant · ${dup} duplicate` });
      await wait(300);

      // ── 3) Extract + 4) Compare & Match (one server call powers both) ──
      const match = await stageRun(2, () => api.matchTrades());
      const total = match.count ?? 0;
      log(`Extracted ${total} trades from relevant emails (body + attachments)`, 'success');
      setStage(2, { state: 'done', detail: `${total} trades extracted` });
      await wait(300);

      setStage(3, { state: 'running' });
      log(STAGE_DEFS[3].start, 'run');
      const golden = match.golden_source ?? {};
      log(`Golden source ${golden.available ? 'connected' : 'unavailable'} · ${golden.records ?? 0} records`,
        golden.available ? 'info' : 'error');
      await wait(MIN_STAGE_MS);
      const sum = match.summary ?? {};
      const byStatus = sum.by_status ?? {};
      const matched = byStatus.MATCHED ?? 0;
      const enriched = byStatus.ENRICHED ?? 0;
      const breaks = (byStatus.BREAK ?? 0) + (byStatus.NEAR_MATCH ?? 0);
      const filled = sum.fields_filled ?? 0;
      log(`Matched ${matched} · ${enriched} enriched · ${breaks} break(s) · ${filled} fields populated from golden source`, 'success');

      // Cache results into the pipeline so "View results" lands fully populated.
      const relevantCases = ce.filter((e) => e.label === 'RELEVANT');
      const datasetKey = relevantCases.map((e) => e.message_id ?? e.trade_id ?? '').join('|');
      setMatch?.(match, datasetKey);
      setActiveStep?.(3);
      setStage(3, { state: 'done', detail: `${matched} matched · ${breaks} break(s) · ${filled} fields filled` });

      log('✓ Workflow complete — Sync → Classify → Extract → Compare & Match', 'success');
      setPhase('done');
    } catch (e) {
      log(`✗ ${e.message || 'Run failed'}`, 'error');
      setStages((prev) => prev.map((s) => (s.state === 'running' ? { ...s, state: 'error' } : s)));
      setPhase('error');
    }
  }

  const doneCount = stages.filter((s) => s.state === 'done').length;
  const pct = Math.round((doneCount / stages.length) * 100);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-neutral-900/50 backdrop-blur-sm"
        onClick={phase !== 'running' ? onClose : undefined}
      />
      <div className="relative z-10 w-full max-w-2xl bg-white rounded-2xl shadow-card-lg border border-neutral-200 flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 flex items-center gap-3" style={{ background: 'linear-gradient(90deg,#112244,#1a3260)' }}>
          <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
            {phase === 'running' ? <Spinner size="sm" />
              : phase === 'done' ? <CheckCircleIcon className="w-5 h-5 text-emerald-300" />
              : <XCircleIcon className="w-5 h-5 text-red-300" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">
              {phase === 'running' ? 'Running workflow' : phase === 'done' ? 'Workflow complete' : 'Workflow failed'}
              {' · '}{workflow?.name ?? 'FX Trade Settlement'}
            </p>
            <p className="text-[11px] text-white/60">Sync → Classify → Extract → Compare &amp; Match</p>
          </div>
          {phase !== 'running' && (
            <button onClick={onClose} className="ml-auto w-7 h-7 rounded flex items-center justify-center text-white/70 hover:bg-white/10 transition-colors">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
            </button>
          )}
        </div>

        {/* Progress bar (determinate fill + shimmer while running) */}
        <div className="h-1 bg-neutral-150 relative overflow-hidden flex-shrink-0">
          <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${pct}%` }} />
          {phase === 'running' && <div className="absolute inset-0 skeleton-shimmer opacity-40" />}
        </div>

        {/* Stage stepper */}
        <div className="px-6 py-5 space-y-3.5">
          {stages.map((s) => (
            <div key={s.key} className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border transition-colors ${
                s.state === 'done' ? 'bg-emerald-500 border-emerald-500'
                  : s.state === 'running' ? 'border-brand-400 bg-brand-50'
                  : s.state === 'error' ? 'bg-red-500 border-red-500'
                  : 'border-neutral-200 bg-white'}`}>
                {s.state === 'done' ? <CheckCircleIcon className="w-5 h-5 text-white" />
                  : s.state === 'running' ? <Spinner size="sm" />
                  : s.state === 'error' ? <XCircleIcon className="w-5 h-5 text-white" />
                  : <s.Icon className="w-4 h-4 text-neutral-300" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-medium ${
                    s.state === 'pending' ? 'text-neutral-400'
                      : s.state === 'running' ? 'text-brand-700'
                      : s.state === 'error' ? 'text-red-600' : 'text-neutral-800'}`}>
                    {s.label}
                  </p>
                  {s.state === 'running' && (
                    <span className="flex gap-0.5">
                      {[0, 1, 2].map((j) => (
                        <span key={j} className="w-1 h-1 rounded-full bg-brand-400"
                          style={{ animation: `dotBounce 1.2s ease-in-out ${j * 0.2}s infinite` }} />
                      ))}
                    </span>
                  )}
                </div>
                {s.detail && <p className="text-[11px] text-neutral-500 mt-0.5">{s.detail}</p>}
              </div>
              {s.state === 'done' && <span className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide">Done</span>}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-neutral-150 flex items-center justify-between flex-shrink-0">
          <p className="text-[11px] text-neutral-400">
            {phase === 'running' ? 'Running the full pipeline…'
              : phase === 'done' ? 'All stages completed successfully.'
              : 'A stage failed — see the log above.'}
          </p>
          <div className="flex gap-2">
            {phase === 'done' && (
              <button
                onClick={() => { router.push('/pipeline'); onClose?.(); }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-md transition-colors"
              >
                View results
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd" /></svg>
              </button>
            )}
            <button
              onClick={onClose}
              disabled={phase === 'running'}
              className="px-4 py-2 text-xs font-medium text-neutral-600 bg-white border border-neutral-200 rounded-md hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {phase === 'running' ? 'Please wait…' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
