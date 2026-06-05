'use client';
import { Fragment, useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardHeader } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import StatCard from '@/components/ui/StatCard';
import Badge from '@/components/ui/Badge';
import ConfidenceBar from '@/components/ui/ConfidenceBar';
import EmptyState from '@/components/ui/EmptyState';
import LogDrawer from '@/components/ui/LogDrawer';
import DecisionDrawer from '@/components/ui/DecisionDrawer';
import { ProcessLoader, useStagedLoader } from '@/components/ui/Loader';
import {
  InboxArrowDownIcon, CheckCircleIcon, ExclamationTriangleIcon,
  XCircleIcon, ArrowPathIcon, BoltIcon,
} from '@/components/ui/Icons';

const SHORTLIST_STEPS = [
  'Loading email corpus',
  'Initialising rule classifier',
  'Scoring asset & subject signals',
  'Evaluating trade ID patterns',
  'Storing relevant cases',
  'Building classification index',
];

/* ─── helpers ───────────────────────────────────────────────── */

function buildRunLogs(stats, emails) {
  const t = () => new Date().toLocaleTimeString('en-GB', { hour12: false });
  const logs = [];
  logs.push({ level: 'info',    time: t(), message: 'Pipeline run started' });
  logs.push({ level: 'info',    time: t(), message: `Fetched ${stats.read ?? 0} email(s) from source` });
  if ((stats.relevant ?? 0) > 0)
    logs.push({ level: 'success', time: t(), message: `${stats.relevant} email(s) RELEVANT → stored as cases` });
  if ((stats.ambiguous ?? 0) > 0)
    logs.push({ level: 'warn',    time: t(), message: `${stats.ambiguous} email(s) AMBIGUOUS → flagged for manual review` });
  if ((stats.irrelevant ?? 0) > 0)
    logs.push({ level: 'info',    time: t(), message: `${stats.irrelevant} email(s) IRRELEVANT → discarded` });
  if ((stats.duplicate ?? 0) > 0)
    logs.push({ level: 'warn',    time: t(), message: `${stats.duplicate} duplicate trade ID(s) skipped` });

  for (const e of (emails ?? [])) {
    const pct  = e.confidence != null ? Math.round(e.confidence * 100) : '?';
    const skip = e.skip_reason ? ` [${e.skip_reason}]` : '';
    logs.push({
      level:   e.label === 'RELEVANT' ? 'success' : e.label === 'AMBIGUOUS' ? 'warn' : 'info',
      time:    t(),
      message: `[${e.label ?? '?'}${skip}] ${e.trade_id ?? e.message_id?.slice(0, 16) ?? '?'} · ${pct}% · ${e.subject?.slice(0, 55) ?? '(no subject)'}`,
    });
  }
  logs.push({ level: 'success', time: t(), message: 'Pipeline run complete' });
  return logs;
}

const FILTER_TABS = ['ALL', 'RELEVANT', 'AMBIGUOUS', 'IRRELEVANT'];
const DOT = { RELEVANT: 'bg-emerald-500', AMBIGUOUS: 'bg-amber-500', IRRELEVANT: 'bg-red-500' };

/* ─── component ─────────────────────────────────────────────── */

export default function StepShortlist({
  source, enabled, syncedEmails = [], onShortlisted,
  initialClassified = null, initialStats = null,
}) {
  const [loading,       setLoading]       = useState(false);
  const [stats,         setStats]         = useState(initialStats);
  const [emails,        setEmails]        = useState(initialClassified);  // seeded from restored session
  const [error,         setError]         = useState(null);
  const [logs,          setLogs]          = useState(
    () => (initialClassified ? buildRunLogs(initialStats ?? {}, initialClassified) : []),
  );
  const [logsOpen,      setLogsOpen]      = useState(false);
  const [filter,        setFilter]        = useState('ALL');
  const [search,        setSearch]        = useState('');
  const [drawerEmail,   setDrawerEmail]   = useState(null);

  const loader = useStagedLoader(SHORTLIST_STEPS, 460);

  async function handleRun() {
    setLoading(true);
    setError(null);
    setDrawerEmail(null);
    loader.start();
    try {
      const [runResult] = await Promise.all([
        api.runPipeline(source),
        new Promise(r => setTimeout(r, SHORTLIST_STEPS.length * 460 + 300)),
      ]);
      const run = runResult ?? {};
      const runStats = run.stats ?? {};
      setStats(runStats);

      /* classified_emails is present only when the backend has my changes.
         Check for undefined (key absent) vs [] (present but empty, which is
         legitimate when there were no emails to process). */
      const hasClassifiedKey = Array.isArray(run.classified_emails);
      let classified         = hasClassifiedKey ? run.classified_emails : [];

      if (!hasClassifiedKey && syncedEmails.length > 0) {
        /* Fallback: old backend without classified_emails support.
           Classify each synced email individually using subject+empty body.
           Results are marked approximate so the drawer can note it. */
        const results = await Promise.all(
          syncedEmails.map(async (em) => {
            try {
              const r = await api.classify(em.subject ?? '', '');
              return {
                message_id:       em.message_id,
                subject:          em.subject,
                sender:           em.sender,
                received_at:      em.received_at,
                attachment_count: em.attachment_count ?? 0,
                label:            r.label,
                confidence:       r.confidence,
                reason:           r.reason,
                trade_id:         r.trade_id,
                asset_class:      r.asset_class,
                matched_asset:    r.matched_asset   ?? [],
                matched_subject:  r.matched_subject ?? [],
                skip_reason:      null,
                approximate:      true,
              };
            } catch {
              return {
                message_id:       em.message_id,
                subject:          em.subject,
                sender:           em.sender,
                received_at:      em.received_at,
                attachment_count: em.attachment_count ?? 0,
                label:            'AMBIGUOUS',
                confidence:       0,
                reason:           'Classification unavailable',
                trade_id:         null,
                asset_class:      'Unknown',
                matched_asset:    [],
                matched_subject:  [],
                skip_reason:      null,
                approximate:      true,
              };
            }
          }),
        );
        classified = results;
      }

      setEmails(classified);
      setLogs(buildRunLogs(runStats, classified));

      /* Hand the FULL classified list + stats up to the pipeline context so it
         persists across navigation; the page derives the relevant subset for
         Step 3 itself. */
      onShortlisted?.(classified, runStats);
    } catch (e) {
      setError(e.message);
    } finally {
      loader.reset();
      setLoading(false);
    }
  }

  /* Derive counts directly from the classified emails array so stat cards
     always match the table — run.stats only counts newly stored emails and
     is 0 for already-processed re-runs. */
  /* "relevant" = classified RELEVANT and NOT a duplicate trade-ID skip.
     already_processed emails ARE stored in the DB so they count.
     This aligns the Step-2 card with the Step-3 stored-cases count. */
  const derivedStats = emails ? {
    read:              emails.length,
    relevant:          emails.filter((e) => e.label === 'RELEVANT' && e.skip_reason !== 'duplicate').length,
    ambiguous:         emails.filter((e) => e.label === 'AMBIGUOUS').length,
    irrelevant:        emails.filter((e) => e.label === 'IRRELEVANT').length,
    duplicate:         emails.filter((e) => e.skip_reason === 'duplicate').length,
    already_processed: emails.filter((e) => e.skip_reason === 'already_processed').length,
  } : stats;

  const byLabel   = (lbl) => (emails ?? []).filter((e) => e.label === lbl).length;
  const filtered  = (emails ?? []).filter((e) => {
    const matchLabel  = filter === 'ALL' || e.label === filter;
    const matchSearch = !search ||
      e.trade_id?.toLowerCase().includes(search.toLowerCase()) ||
      e.subject?.toLowerCase().includes(search.toLowerCase()) ||
      e.sender?.toLowerCase().includes(search.toLowerCase());
    return matchLabel && matchSearch;
  });

  return (
    <>
      {/* Terminal run log drawer (left/modal) */}
      <LogDrawer
        open={logsOpen}
        onClose={() => setLogsOpen(false)}
        title="Classify · Run Logs"
        logs={logs}
      />

      {/* Decision drawer (right slide-over) */}
      <DecisionDrawer
        email={drawerEmail}
        onClose={() => setDrawerEmail(null)}
      />

      <div className="space-y-4">
        {/* Stats row */}
        {derivedStats && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatCard label="Total Read"        value={derivedStats.read              ?? 0} icon={<InboxArrowDownIcon />}      color="blue"    />
            <StatCard label="Relevant"          value={derivedStats.relevant          ?? 0} icon={<CheckCircleIcon />}         color="green"   />
            <StatCard label="Ambiguous"         value={derivedStats.ambiguous         ?? 0} icon={<ExclamationTriangleIcon />} color="amber"   />
            <StatCard label="Irrelevant"        value={derivedStats.irrelevant        ?? 0} icon={<XCircleIcon />}             color="red"     />
            <StatCard label="Duplicates"        value={derivedStats.duplicate ?? 0} icon={<ArrowPathIcon />} color="neutral" />
          </div>
        )}

        <Card>
          <CardHeader
            title="Classify Emails"
            description="Rule-based classifier scores each email: asset keywords (+0.5), subject signals (+0.3), trade ID presence (+0.2). Click any row to open the decision breakdown."
            actions={
              <div className="flex items-center gap-2">
                {emails && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setLogsOpen(true)}
                    icon={
                      <svg viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Zm0 5.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
                      </svg>
                    }
                  >
                    Run Logs
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="md"
                  loading={loading}
                  disabled={!enabled}
                  onClick={handleRun}
                  icon={
                    <svg viewBox="0 0 20 20" fill="currentColor">
                      <path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z" />
                    </svg>
                  }
                >
                  {loading ? 'Running…' : emails ? 'Re-run' : 'Run shortlist'}
                </Button>
              </div>
            }
          />

          {/* Locked state */}
          {!enabled && !emails && (
            <div className="flex items-center gap-2.5 p-3 bg-neutral-50 border border-neutral-200 rounded-lg text-neutral-500 text-xs mb-4">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-neutral-400 flex-shrink-0">
                <path fillRule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clipRule="evenodd" />
              </svg>
              Sync emails first to enable shortlisting.
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mb-4 flex items-start gap-2.5 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0 mt-0.5">
                <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
              </svg>
              {error}
            </div>
          )}

          {/* Empty prompt */}
          {!emails && !loading && enabled && (
            <EmptyState
              icon={<BoltIcon className="w-6 h-6" />}
              title="Ready to shortlist"
              description="The classifier uses rule-based scoring: asset keyword hits (+0.5), subject signals (+0.3), trade ID presence (+0.2). Scores ≥ 0.70 are RELEVANT."
            />
          )}

          {/* Loading skeleton */}
          {loading && (
            <ProcessLoader
              steps={SHORTLIST_STEPS}
              currentStep={loader.step}
              title="Running classification pipeline…"
            />
          )}

          {/* Table */}
          {emails && !loading && (
            <>
              {/* Filter tabs + search */}
              <div className="flex items-center gap-1 mb-3 flex-wrap">
                {FILTER_TABS.map((f) => {
                  const count    = f === 'ALL' ? emails.length : byLabel(f);
                  const isActive = filter === f;
                  return (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                        isActive
                          ? 'bg-brand-600 text-white'
                          : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                      }`}
                    >
                      {DOT[f] && !isActive && <span className={`w-1.5 h-1.5 rounded-full ${DOT[f]}`} />}
                      {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()} ({count})
                    </button>
                  );
                })}

                <div className="ml-auto relative">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400">
                    <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clipRule="evenodd" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs border border-neutral-200 rounded-md bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white w-48"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-neutral-200 overflow-hidden">
                <table className="w-full text-xs data-table">
                  <thead>
                    <tr className="bg-neutral-50 border-b border-neutral-200">
                      {['Trade ID', 'Subject', 'Sender', 'Decision', 'Confidence', 'Asset Class', 'Attachment', ''].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-neutral-500 uppercase tracking-wide whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-3 py-10 text-center text-neutral-400">
                          No emails match this filter.
                        </td>
                      </tr>
                    ) : (
                      filtered.map((e) => (
                        <Fragment key={e.message_id}>
                          <tr
                            onClick={() => setDrawerEmail(e)}
                            className={`cursor-pointer transition-colors ${
                              drawerEmail?.message_id === e.message_id
                                ? 'bg-brand-50'
                                : 'hover:bg-neutral-50/70'
                            }`}
                          >
                            <td className="px-4 py-2.5 font-mono text-brand-700 font-medium whitespace-nowrap">
                              {e.trade_id ?? <span className="text-neutral-400 font-sans italic">—</span>}
                            </td>
                            <td className="px-4 py-2.5 max-w-[200px]">
                              <span className="truncate block font-medium text-neutral-800" title={e.subject}>
                                {e.subject?.slice(0, 52) ?? '—'}{(e.subject?.length ?? 0) > 52 ? '…' : ''}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-neutral-600 max-w-[130px] truncate whitespace-nowrap">
                              {e.sender?.replace(/<.*?>/, '').trim() || '—'}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <Badge variant={(e.label ?? 'pending').toLowerCase()} dot>
                                  {e.label ?? 'Unknown'}
                                </Badge>
                                {e.skip_reason && e.skip_reason !== 'already_processed' && (
                                  <span className="text-[10px] text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded border border-neutral-200">
                                    {e.skip_reason.replace(/_/g, ' ')}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-2.5 w-32">
                              <ConfidenceBar value={e.confidence} label={e.label} />
                            </td>
                            <td className="px-4 py-2.5 text-neutral-600 whitespace-nowrap">
                              {e.asset_class ?? '—'}
                            </td>
                            <td className="px-4 py-2.5 text-neutral-600 whitespace-nowrap">
                              {(e.attachment_count ?? 0) > 0
                                ? <span className="text-neutral-700">{e.attachment_count}</span>
                                : <span className="text-neutral-300">—</span>
                              }
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="flex items-center gap-1 text-brand-500 hover:text-brand-700 whitespace-nowrap font-medium">
                                <span className="text-[10px]">View</span>
                                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 flex-shrink-0">
                                  <path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd" />
                                </svg>
                              </span>
                            </td>
                          </tr>
                        </Fragment>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <p className="mt-2 text-xs text-neutral-400">
                {filtered.length} of {emails.length} email{emails.length !== 1 ? 's' : ''} · Click any row to open decision breakdown
              </p>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
