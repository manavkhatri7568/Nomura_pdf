'use client';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import { Card, CardHeader } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import StatCard from '@/components/ui/StatCard';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import { ProcessLoader, useStagedLoader } from '@/components/ui/Loader';
import { EnvelopeIcon, PaperClipIcon, ClockIcon } from '@/components/ui/Icons';

const SYNC_STEPS = [
  'Establishing connection',
  'Authenticating with source',
  'Fetching mailbox messages',
  'Parsing email metadata',
  'Finalising sync',
];

function fmt(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return dateStr; }
}

/* ─── Email body drawer ────────────────────────────────────── */
function EmailDrawer({ email, source, onClose }) {
  const open = !!email;
  const [mounted, setMounted] = useState(false);
  const [body,    setBody]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!email) { setBody(null); setError(null); return; }
    let cancelled = false;
    setBody(null);
    setError(null);
    setLoading(true);
    api.previewEmail(source, email.message_id)
      .then(d => { if (!cancelled) { setBody(d.body ?? ''); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [email?.message_id]);

  if (!mounted) return null;

  return createPortal(
    <>
      <div
        className={`drawer-backdrop fixed inset-0 z-40 bg-neutral-900/25 backdrop-blur-[2px] ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      <div className={`drawer-slide fixed top-0 right-0 bottom-0 z-50 h-screen w-full max-w-xl bg-white border-l border-neutral-200 shadow-2xl flex flex-col ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        {!email ? null : (
          <>
            {/* Header */}
            <div className="px-5 py-4 border-b border-neutral-150 flex-shrink-0">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-neutral-900 leading-snug mb-2 line-clamp-2">
                    {email.subject || <span className="text-neutral-400 italic">(no subject)</span>}
                  </p>
                  <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium text-neutral-600">From</span>
                      {email.sender?.replace(/<.*?>/, '').trim() || email.sender}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium text-neutral-600">Date</span>
                      {fmt(email.received_at)}
                    </span>
                    {email.attachment_count > 0 && (
                      <span className="flex items-center gap-1">
                        <PaperClipIcon className="w-3.5 h-3.5" />
                        {email.attachment_count} attachment{email.attachment_count !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-7 h-7 rounded flex items-center justify-center hover:bg-neutral-100 text-neutral-400 transition-colors flex-shrink-0"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                    <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {loading && (
                <div className="flex items-center justify-center gap-2.5 py-16 text-xs text-neutral-400">
                  <svg className="w-4 h-4 animate-spin text-brand-500" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Loading email body…
                </div>
              )}

              {error && (
                <div className="m-5 space-y-2">
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">
                    <p className="font-semibold mb-0.5">Failed to load email body</p>
                    <p className="text-red-600">{error}</p>
                  </div>
                  {(error.toLowerCase().includes('not found') || error.includes('404')) && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-xs">
                      <p className="font-semibold mb-0.5">Backend needs restart</p>
                      <p>The <code className="bg-amber-100 px-1 rounded">/connector/preview</code> endpoint was recently added. Restart the backend server and try again.</p>
                      <p className="mt-1 font-mono text-[10px] text-amber-600">cd Nomura-main &amp;&amp; uvicorn api.app:app --port 8000</p>
                    </div>
                  )}
                </div>
              )}

              {body !== null && !loading && (
                body.trim() ? (
                  <div className="px-5 py-4">
                    <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-3">Email Body</p>
                    <div className="bg-neutral-50 border border-neutral-150 rounded-lg px-4 py-4 text-xs text-neutral-700 leading-relaxed whitespace-pre-wrap font-sans">
                      {body}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-neutral-400 text-xs">
                    <EnvelopeIcon className="w-8 h-8 mb-3 text-neutral-300" />
                    No body content available for this message.
                  </div>
                )
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-neutral-150 flex-shrink-0 flex items-center justify-between">
              <p className="text-[10px] text-neutral-300 font-mono truncate flex-1 mr-4">{email.message_id}</p>
              <Badge variant={email.has_body ? 'synced' : 'pending'} dot>
                {email.has_body ? 'Has body' : 'No body'}
              </Badge>
            </div>
          </>
        )}
      </div>
    </>,
    document.body,
  );
}

export default function StepSync({ source, onSynced, initialEmails = null, initialTs = null }) {
  const [loading,  setLoading]  = useState(false);
  const [emails,   setEmails]   = useState(initialEmails);  // seeded from restored session
  const [error,    setError]    = useState(null);
  const [ts,       setTs]       = useState(initialTs);
  const [search,   setSearch]   = useState('');
  const [preview,  setPreview]  = useState(null);   // email being viewed

  const loader = useStagedLoader(SYNC_STEPS, 480);

  async function handleSync() {
    setLoading(true);
    setError(null);
    loader.start();
    try {
      const [data] = await Promise.all([
        api.fetchEmails(source),
        new Promise(r => setTimeout(r, SYNC_STEPS.length * 480 + 300)),
      ]);
      const tsVal = new Date().toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
      setEmails(data.emails ?? []);
      setTs(tsVal);
      onSynced?.(data.emails ?? [], tsVal);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      loader.reset();
    }
  }

  const filtered = (emails ?? []).filter(e =>
    !search ||
    e.subject?.toLowerCase().includes(search.toLowerCase()) ||
    e.sender?.toLowerCase().includes(search.toLowerCase()),
  );

  const withAttach = (emails ?? []).filter(e => e.attachment_count > 0).length;

  return (
    <>
      <EmailDrawer email={preview} source={source} onClose={() => setPreview(null)} />

      <div className="space-y-4">
        {emails && !loading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Emails Synced"    value={emails.length} icon={<EnvelopeIcon />}    color="blue"    />
            <StatCard label="With Attachments" value={withAttach}    icon={<PaperClipIcon />}   color="neutral" />
            <StatCard label="Last Sync"
              value={ts ? (ts.split(', ')[1] ?? ts) : ts}
              sub={ts && ts.includes(', ') ? ts.split(', ')[0] : undefined}
              icon={<ClockIcon />} color="neutral" />
          </div>
        )}

        <Card>
          <CardHeader
            title="Sync Emails"
            description="Pull messages from mailboxes via Microsoft Graph API · auto-syncs every 24 hours"
            actions={
              <div className="flex items-center gap-2">
                {emails && !loading && (
                  <span className="text-xs text-neutral-400">Last run: {ts}</span>
                )}
                <Button
                  variant="primary"
                  size="md"
                  loading={loading}
                  onClick={handleSync}
                  icon={
                    <svg viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0V5.36l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z" clipRule="evenodd" />
                    </svg>
                  }
                >
                  {loading ? 'Syncing…' : emails ? 'Re-sync' : 'Sync now'}
                </Button>
              </div>
            }
          />

          {error && (
            <div className="mb-4 flex items-start gap-2.5 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0 mt-0.5">
                <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
              </svg>
              {error}
            </div>
          )}

          {!emails && !loading && (
            <EmptyState
              icon={<EnvelopeIcon className="w-6 h-6" />}
              title="No emails synced yet"
              description="Pull messages from mailboxes via Microsoft Graph. In production this runs automatically every 24 hours."
              action={<Button variant="primary" onClick={handleSync}>Sync now</Button>}
            />
          )}

          {loading && <ProcessLoader steps={SYNC_STEPS} currentStep={loader.step} title="Syncing mailbox…" />}

          {emails && !loading && (
            <>
              <div className="mb-3 flex items-center gap-2">
                <div className="relative flex-1 max-w-sm">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400">
                    <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clipRule="evenodd" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search subject or sender…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-neutral-200 rounded-md bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white"
                  />
                </div>
                <span className="text-xs text-neutral-400">{filtered.length} of {emails.length}</span>
              </div>

              <div className="overflow-x-auto rounded-lg border border-neutral-150">
                <table className="w-full text-xs data-table">
                  <thead>
                    <tr className="bg-neutral-50 border-b border-neutral-150">
                      {['#', 'Subject', 'Sender', 'Received', 'Attachments'].map(h => (
                        <th key={h} className="px-3 py-2.5 text-left text-[11px] font-semibold text-neutral-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {filtered.length === 0 ? (
                      <tr><td colSpan={5} className="px-3 py-8 text-center text-neutral-400">No results.</td></tr>
                    ) : (
                      filtered.map((email, i) => (
                        <tr key={email.message_id ?? i}
                          onClick={() => setPreview(email)}
                          title="Click to read this email"
                          className={`cursor-pointer transition-colors ${preview?.message_id === email.message_id ? 'bg-brand-50' : 'hover:bg-neutral-50/70'}`}
                        >
                          <td className="px-3 py-2.5 text-neutral-400 font-mono">{i + 1}</td>
                          <td className="px-3 py-2.5 max-w-xs">
                            <span className="font-medium text-neutral-800 truncate block" title={email.subject}>
                              {email.subject || <span className="text-neutral-400 italic">(no subject)</span>}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-neutral-600 whitespace-nowrap max-w-[140px] truncate">
                            {email.sender?.replace(/<.*?>/, '').trim() || '—'}
                          </td>
                          <td className="px-3 py-2.5 text-neutral-500 whitespace-nowrap font-mono text-[10px]">
                            {fmt(email.received_at)}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {email.attachment_count > 0 ? (
                              <span className="inline-flex items-center gap-1 text-neutral-600">
                                <PaperClipIcon className="w-3.5 h-3.5" />{email.attachment_count}
                              </span>
                            ) : <span className="text-neutral-300">—</span>}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center gap-1.5 text-xs text-neutral-400">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                  <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z" clipRule="evenodd" />
                </svg>
                Scheduled sync · every 24h · auto-syncs from Microsoft Graph in production · click <strong>any row</strong> to read the email
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
