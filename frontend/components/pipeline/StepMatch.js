'use client';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import { usePipeline } from '@/lib/pipelineContext';
import { CardHeader } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import StatCard from '@/components/ui/StatCard';
import EmptyState from '@/components/ui/EmptyState';
import ConfidenceBar from '@/components/ui/ConfidenceBar';
import { ProcessLoader, useStagedLoader } from '@/components/ui/Loader';
import {
  CheckCircleIcon, ServerStackIcon, XCircleIcon, ArrowPathIcon,
  DocumentIcon, MagnifyingGlassIcon, LinkIcon,
} from '@/components/ui/Icons';

const MATCH_STEPS = [
  'Loading extracted register',
  'Connecting to golden source',
  'Matching by trade ID',
  'Populating missing fields',
  'Scoring field agreement',
];

/* ─── status styling ───────────────────────────────────────── */
const STATUS = {
  MATCHED:    { label: 'Matched',     pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  ENRICHED:   { label: 'Enriched',    pill: 'bg-brand-50 text-brand-700 border-brand-200',       dot: 'bg-brand-500' },
  NEAR_MATCH: { label: 'Near-match',  pill: 'bg-amber-50 text-amber-700 border-amber-200',        dot: 'bg-amber-500' },
  BREAK:      { label: 'Break',       pill: 'bg-red-50 text-red-700 border-red-200',              dot: 'bg-red-500' },
  UNMATCHED:  { label: 'Unmatched',   pill: 'bg-neutral-100 text-neutral-500 border-neutral-200', dot: 'bg-neutral-400' },
};
const FILTER_TABS = ['ALL', 'MATCHED', 'ENRICHED', 'NEAR_MATCH', 'BREAK', 'UNMATCHED'];

function StatusBadge({ status }) {
  const s = STATUS[status] ?? STATUS.UNMATCHED;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold border whitespace-nowrap ${s.pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

/* canonical field → friendly label */
const LABELS = {
  trade_id: 'Trade ID', uti: 'UTI', trade_date: 'Trade Date', counterparty: 'Counterparty',
  counterparty_code: 'Counterparty Code', currency_pair: 'Currency Pair', base_currency: 'Base Ccy',
  quote_currency: 'Quote Ccy', option_type: 'Option Type', exercise_style: 'Exercise Style',
  buy_sell: 'Buy / Sell', notional_amount: 'Notional Amount', notional_currency: 'Notional Ccy',
  strike_rate: 'Strike Rate', expiry_date: 'Expiry Date', settlement_date: 'Settlement Date',
  premium_amount: 'Premium', premium_currency: 'Premium Ccy', premium_settle_date: 'Premium Settle',
  delta: 'Delta', implied_vol: 'Implied Vol', settlement_status: 'Sett. Status',
  portfolio: 'Portfolio', trader: 'Trader', book: 'Book',
};
const labelize = (f) => LABELS[f] ?? f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function fmtNum(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v.toLocaleString('en-US');
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n.toLocaleString('en-US') : v;
}
function val(v) {
  return v === null || v === undefined || v === '' ? null : v;
}

/* ─── detail drawer ────────────────────────────────────────── */
function MatchDrawer({ trade, goldenPath, onClose }) {
  const open = !!trade;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const fn = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);
  if (!mounted) return null;

  const m = trade?.match ?? {};
  const st = STATUS[m.status] ?? STATUS.UNMATCHED;
  const filled = m.filled_fields ?? [];
  const diffs = m.diffs ?? [];

  const CORE = ['trade_id', 'uti', 'trade_date', 'counterparty', 'currency_pair', 'buy_sell',
    'notional_amount', 'notional_currency', 'strike_rate', 'expiry_date', 'settlement_date',
    'option_type', 'premium_amount', 'settlement_status', 'trader', 'book'];

  return createPortal(
    <>
      <div className={`drawer-backdrop fixed inset-0 z-40 bg-neutral-900/25 backdrop-blur-[2px] ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={onClose} />
      <div className={`drawer-slide fixed top-0 right-0 bottom-0 z-50 h-screen w-full max-w-lg bg-white border-l border-neutral-200 shadow-2xl flex flex-col ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        {!trade ? null : (
          <>
            {/* Header */}
            <div className="px-5 py-4 border-b border-neutral-200 flex-shrink-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <StatusBadge status={m.status} />
                    <span className="font-mono text-xs font-semibold text-brand-600 bg-brand-50 px-2 py-0.5 rounded border border-brand-200">
                      {trade.trade_id ?? '—'}
                    </span>
                    {val(trade.currency_pair) && (
                      <span className="text-xs font-semibold text-neutral-700 bg-neutral-100 px-2 py-0.5 rounded border border-neutral-200 font-mono">
                        {trade.currency_pair}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-500">
                    Confidence <span className="font-semibold text-neutral-700">{Math.round((m.confidence ?? 0) * 100)}%</span>
                    {' · '}{m.agreed_fields ?? 0}/{m.compared_fields ?? 0} fields agree
                    {' · '}{filled.length} populated
                  </p>
                </div>
                <button onClick={onClose} className="w-7 h-7 rounded flex items-center justify-center hover:bg-neutral-100 text-neutral-500 flex-shrink-0 transition-colors">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 scrollbar-thin">
              {/* Completed trade */}
              <div>
                <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-3">Completed Trade Record</p>
                <div className="grid grid-cols-2 gap-2.5">
                  {CORE.map((f) => {
                    const isFilled = filled.includes(f);
                    const v = ['notional_amount', 'premium_amount'].includes(f) ? fmtNum(trade[f]) : val(trade[f]);
                    return (
                      <div key={f} className={`px-3 py-2.5 rounded-lg border text-xs ${isFilled ? 'bg-brand-50/60 border-brand-200' : 'bg-neutral-50 border-neutral-150'}`}>
                        <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-0.5 flex items-center gap-1">
                          {labelize(f)}
                          {isFilled && <span className="text-brand-500 normal-case font-bold tracking-normal">· filled</span>}
                        </p>
                        <p className={`font-medium truncate ${isFilled ? 'text-brand-700' : 'text-neutral-700'} ${['trade_id', 'uti', 'currency_pair', 'strike_rate', 'notional_amount'].includes(f) ? 'font-mono text-[11px]' : ''}`}>
                          {v ?? <span className="text-neutral-300 font-normal italic">—</span>}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Populated from golden */}
              {filled.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">
                    Populated from golden source ({filled.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {filled.map((f) => (
                      <span key={f} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-brand-50 text-brand-700 border border-brand-200">
                        {labelize(f)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Field comparison */}
              {diffs.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">
                    Field comparison vs golden ({m.agreed_fields}/{m.compared_fields} agree)
                  </p>
                  <div className="rounded-lg border border-neutral-150 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-neutral-50 border-b border-neutral-150 text-[10px] text-neutral-400 uppercase tracking-wide">
                          <th className="px-3 py-2 text-left font-semibold">Field</th>
                          <th className="px-3 py-2 text-left font-semibold">Email</th>
                          <th className="px-3 py-2 text-left font-semibold">Golden</th>
                          <th className="px-3 py-2 text-center font-semibold"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {diffs.map((d) => (
                          <tr key={d.field} className={d.agree ? '' : 'bg-red-50/40'}>
                            <td className="px-3 py-2 text-neutral-600 font-medium whitespace-nowrap">{labelize(d.field)}</td>
                            <td className="px-3 py-2 text-neutral-700 font-mono text-[10px] max-w-[120px] truncate" title={String(d.extracted)}>{fmtNum(d.extracted) ?? String(d.extracted)}</td>
                            <td className="px-3 py-2 text-neutral-700 font-mono text-[10px] max-w-[120px] truncate" title={String(d.golden)}>{fmtNum(d.golden) ?? String(d.golden)}</td>
                            <td className="px-3 py-2 text-center">
                              {d.agree
                                ? <CheckCircleIcon className="w-4 h-4 text-emerald-500 inline" />
                                : <XCircleIcon className="w-4 h-4 text-red-500 inline" />}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Golden source */}
              <div>
                <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Golden Source</p>
                <div className="flex items-center gap-3 px-3 py-2 bg-neutral-50 border border-neutral-150 rounded-lg text-xs">
                  <span className="w-7 h-7 rounded-lg bg-neutral-100 flex items-center justify-center text-neutral-400 flex-shrink-0">
                    <ServerStackIcon className="w-4 h-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-neutral-800 truncate">{goldenPath?.split('/').pop() ?? '—'}</p>
                    <p className="text-neutral-400 text-[10px]">
                      {m.golden_found ? `Matched on ${trade.trade_id}` : 'No golden record for this trade id'}
                      {' · source: '}{trade.source ?? '—'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-neutral-150 flex-shrink-0">
              <p className="text-[10px] text-neutral-300 font-mono break-all">{trade.source_message_id ?? trade.source_file ?? trade.trade_id}</p>
            </div>
          </>
        )}
      </div>
    </>,
    document.body,
  );
}

/* ─── main ─────────────────────────────────────────────────── */
export default function StepMatch({ enabled, datasetKey }) {
  const { matchData, matchKey, setMatch } = usePipeline();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState(null);
  const loader = useStagedLoader(MATCH_STEPS, 440);

  const cached = matchKey && matchKey === datasetKey ? matchData : null;

  async function run() {
    setLoading(true);
    setError(null);
    setDrawer(null);
    loader.start();
    const started = Date.now();
    try {
      const data = await api.matchTrades();
      const minMs = MATCH_STEPS.length * 440 + 200;
      const elapsed = Date.now() - started;
      if (elapsed < minMs) await new Promise((r) => setTimeout(r, minMs - elapsed));
      setMatch(data, datasetKey);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      loader.reset();
    }
  }

  // Auto-run on first entry for a dataset (mirrors the Extract step UX).
  useEffect(() => {
    if (enabled && !cached && !loading && !error) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, datasetKey]);

  const trades = cached?.trades ?? [];
  const summary = cached?.summary ?? null;
  const golden = cached?.golden_source ?? null;

  const byStatus = (st) => trades.filter((t) => t.match?.status === st).length;
  const filtered = trades.filter((t) => {
    const matchLabel = filter === 'ALL' || t.match?.status === filter;
    const q = search.toLowerCase();
    const matchSearch = !search
      || (t.trade_id ?? '').toLowerCase().includes(q)
      || (t.counterparty ?? '').toLowerCase().includes(q)
      || (t.currency_pair ?? '').toLowerCase().includes(q);
    return matchLabel && matchSearch;
  });

  const breaks = summary ? (summary.by_status?.BREAK ?? 0) + (summary.by_status?.NEAR_MATCH ?? 0) : 0;

  return (
    <>
      <MatchDrawer trade={drawer} goldenPath={golden?.path} onClose={() => setDrawer(null)} />

      <div className="space-y-4">
        {/* Stats */}
        {summary && !loading && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatCard label="Matched"       value={summary.by_status?.MATCHED ?? 0}  icon={<CheckCircleIcon />}  color="green"   />
            <StatCard label="Enriched"      value={summary.by_status?.ENRICHED ?? 0} icon={<ServerStackIcon />}  color="blue"    />
            <StatCard label="Breaks"        value={breaks}                            icon={<XCircleIcon />}      color="red"     />
            <StatCard label="Fields Filled" value={summary.fields_filled ?? 0}        icon={<DocumentIcon />}     color="neutral" />
            <StatCard label="Avg Confidence" value={`${Math.round((summary.avg_confidence ?? 0) * 100)}%`} icon={<ArrowPathIcon />} color="amber" />
          </div>
        )}

        <div className="bg-white border border-neutral-200 rounded-lg shadow-card">
          <div className="p-5 pb-0">
            <CardHeader
              title="Compare & Match"
              description="Each extracted trade is matched by trade ID against the golden source — missing fields are populated and the fields the email carried are compared (agree / break) with a confidence score."
              actions={
                cached && !loading && (
                  <Button variant="ghost" size="sm" onClick={run} icon={<ArrowPathIcon className="w-3.5 h-3.5" />}>Re-run</Button>
                )
              }
            />
          </div>

          {/* Golden-source banner */}
          {golden && !loading && (
            <div className="px-5 pb-3">
              <div className="flex items-center gap-2 text-xs text-neutral-500 bg-neutral-50 border border-neutral-150 rounded-lg px-3 py-2">
                <LinkIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
                <span>
                  Golden source{' '}
                  <span className={golden.available ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>
                    {golden.available ? 'connected' : 'unavailable'}
                  </span>
                  {' · '}<span className="font-mono text-neutral-600">{golden.path?.split('/').pop()}</span>
                  {' · '}{golden.records} records
                  {cached?.match_fields && <> · comparing <span className="text-neutral-600">{cached.match_fields.length}</span> fields</>}
                </span>
              </div>
            </div>
          )}

          {!enabled && (
            <div className="px-5 pb-5">
              <div className="flex items-center gap-2.5 p-3 bg-neutral-50 border border-neutral-150 rounded-lg text-neutral-500 text-xs">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-neutral-400 flex-shrink-0">
                  <path fillRule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clipRule="evenodd" />
                </svg>
                Classify emails first to generate trades to match.
              </div>
            </div>
          )}

          {error && <div className="px-5 pb-5"><div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">{error}</div></div>}

          {loading && <div className="pb-4"><ProcessLoader steps={MATCH_STEPS} currentStep={loader.step} title="Reconciling against golden source…" /></div>}

          {cached && !loading && (
            <>
              {/* Filters + search */}
              <div className="px-5 pb-3 flex items-center gap-1 flex-wrap">
                {FILTER_TABS.map((f) => {
                  const count = f === 'ALL' ? trades.length : byStatus(f);
                  const active = filter === f;
                  const s = STATUS[f];
                  return (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                        active ? 'bg-brand-600 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                      }`}
                    >
                      {s && !active && <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />}
                      {f === 'ALL' ? 'All' : s.label} ({count})
                    </button>
                  );
                })}
                <div className="ml-auto relative">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400">
                    <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clipRule="evenodd" />
                  </svg>
                  <input
                    type="text" placeholder="Search trade ID, counterparty, pair…"
                    value={search} onChange={(e) => setSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs border border-neutral-200 rounded-md bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white w-56"
                  />
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="px-5 pb-5">
                  <EmptyState icon={<MagnifyingGlassIcon className="w-6 h-6" />} title="No trades match this filter" description="Try a different status or search term." />
                </div>
              ) : (
                <div className="overflow-x-auto border-t border-neutral-150">
                  <table className="w-full text-xs data-table">
                    <thead>
                      <tr className="bg-neutral-50 border-b border-neutral-150">
                        {['Trade ID', 'Counterparty', 'Currency Pair', 'Notional', 'Sett. Date', 'Source', 'Status', 'Confidence', 'Filled', ''].map((h) => (
                          <th key={h} className="px-3 py-2.5 text-left text-[11px] font-semibold text-neutral-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {filtered.map((t) => {
                        const m = t.match ?? {};
                        const isBreak = m.status === 'BREAK' || m.status === 'NEAR_MATCH';
                        return (
                          <tr key={t.source_message_id ?? t.trade_id}
                            onClick={() => setDrawer(t)}
                            title="Click to view the match detail"
                            className={`cursor-pointer transition-colors ${drawer?.trade_id === t.trade_id ? 'bg-brand-50' : isBreak ? 'bg-red-50/30 hover:bg-red-50/60' : 'hover:bg-[#f5f8ff]'}`}
                          >
                            <td className="px-3 py-2.5 font-mono text-brand-600 font-semibold whitespace-nowrap">{t.trade_id ?? '—'}</td>
                            <td className="px-3 py-2.5 text-neutral-700 max-w-[160px] truncate whitespace-nowrap" title={t.counterparty}>{val(t.counterparty) ?? <span className="text-neutral-300">—</span>}</td>
                            <td className="px-3 py-2.5 font-mono text-neutral-700 whitespace-nowrap">{val(t.currency_pair) ?? <span className="text-neutral-300">—</span>}</td>
                            <td className="px-3 py-2.5 font-mono text-neutral-800 whitespace-nowrap">{fmtNum(t.notional_amount) ?? <span className="text-neutral-300">—</span>}</td>
                            <td className="px-3 py-2.5 font-mono text-[11px] text-neutral-600 whitespace-nowrap">{val(t.settlement_date) ?? <span className="text-neutral-300">—</span>}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              <span className="text-[10px] text-neutral-500">{t.source ?? '—'}</span>
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap"><StatusBadge status={m.status} /></td>
                            <td className="px-3 py-2.5 w-28"><ConfidenceBar value={m.confidence ?? 0} /></td>
                            <td className="px-3 py-2.5 text-center">
                              {m.filled_count > 0
                                ? <span className="inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-brand-50 text-brand-700 border border-brand-200">{m.filled_count}</span>
                                : <span className="text-neutral-300">—</span>}
                            </td>
                            <td className="px-3 py-2.5">
                              <span className="flex items-center gap-1 text-brand-500 hover:text-brand-700 whitespace-nowrap font-medium">
                                <span className="text-[10px]">View</span>
                                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 flex-shrink-0">
                                  <path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd" />
                                </svg>
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="px-4 py-2.5 border-t border-neutral-100">
                    <p className="text-xs text-neutral-400">
                      {filtered.length} of {trades.length} trade{trades.length !== 1 ? 's' : ''} · {summary.fields_filled} fields populated from the golden source · click any row for the match detail
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
