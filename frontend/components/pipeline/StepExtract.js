'use client';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import { usePipeline } from '@/lib/pipelineContext';
import { CardHeader } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import StatCard from '@/components/ui/StatCard';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { ProcessLoader, useStagedLoader } from '@/components/ui/Loader';
import {
  FolderOpenIcon2, PaperClipIcon,
  MagnifyingGlassIcon, DocumentIcon, CheckCircleIcon, ArrowPathIcon,
} from '@/components/ui/Icons';

const EXTRACT_STEPS = [
  'Loading case index',
  'Reading manifest files',
  'Parsing trade fields',
  'Resolving counterparties',
  'Building trade register',
];

/* ─── currency symbol / code map ──────────────────────────── */
const SYMBOL_MAP = {
  '$':   'USD',   // bare $ = USD (unless prefixed)
  'A$':  'AUD',
  'C$':  'CAD',
  'NZ$': 'NZD',
  'HK$': 'HKD',
  'S$':  'SGD',
  '£':   'GBP',
  '€':   'EUR',
  '¥':   'JPY',
  'kr':  'SEK',
  'CHF': 'CHF',
};

/* ─── parse trade fields from subject + body ────────────────
   Trade ID = deal reference (passed separately as trade_id).
   UTI, currency pair, trade date come from the subject; buy/sell,
   amount, counterparty, value date come from the body.            */
function parseTradeFields(subject = '', body = '') {
  // Currency pair (EUR/USD) — subject first, then body
  const ccySlash = subject.match(/\b([A-Z]{3})\/([A-Z]{3})\b/);
  let currencyPair = ccySlash ? ccySlash[0] : null;

  // UTI (subject, then body)
  const utiM = `${subject} ${body}`.match(/\bUTI[A-Z0-9]{6,}\b/);
  const uti = utiM ? utiM[0] : null;

  // Trade date from subject: dd_mm_yy | dd/mm/yy | dd/mm/yyyy | yyyy-mm-dd
  let tradeDate = null;
  {
    const d_und = subject.match(/\b(\d{2})[_](\d{2})[_](\d{2,4})\b/);
    const d_sl4 = subject.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
    const d_sl2 = subject.match(/\b(\d{2})\/(\d{2})\/(\d{2})\b/);
    const d_iso = subject.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (d_und)      tradeDate = `${d_und[1]}/${d_und[2]}/${d_und[3].length === 2 ? '20' + d_und[3] : d_und[3]}`;
    else if (d_sl4) tradeDate = `${d_sl4[1]}/${d_sl4[2]}/${d_sl4[3]}`;
    else if (d_sl2) tradeDate = `${d_sl2[1]}/${d_sl2[2]}/20${d_sl2[3]}`;
    else if (d_iso) tradeDate = d_iso[1];
  }

  // Body fields
  let amountRaw = null, buyOrSell = null, counterparty = null, settlementDate = null;
  if (body) {
    // NB: [^\S\n\r]* after the colon = spaces/tabs only (NOT newlines), so an
    // empty field (e.g. "Value Date:" with nothing after) does not grab the
    // next line's text.
    const amtLine = body.match(/Amount\s*:[^\S\n\r]*([^\n\r*]+)/i);
    if (amtLine) amountRaw = amtLine[1].trim().replace(/\*/g, '').trim();

    const bsLine = body.match(/Buy\s*\/\s*Sell\s*:[^\S\n\r]*([^\n\r*]+)/i);
    if (bsLine) buyOrSell = bsLine[1].trim().replace(/\*/g, '').trim();

    const cpLine = body.match(/Counterparty\s*:[^\S\n\r]*([^\n\r*]+)/i);
    if (cpLine) counterparty = cpLine[1].trim().replace(/\*/g, '').trim();

    const vdLine = body.match(/Value\s*Date\s*:[^\S\n\r]*([^\n\r*]+)/i);
    if (vdLine) { const vd = vdLine[1].trim().replace(/\*/g, '').trim(); if (vd.length > 2) settlementDate = vd; }

    if (!currencyPair) {
      const bodyPair = body.match(/Currency\s*Pair\s*:[^\S\n\r]*([A-Z]{3}\/[A-Z]{3})/);
      if (bodyPair) currencyPair = bodyPair[1].toUpperCase();
    }
  }

  // Notional currency = base of the pair (EUR/USD → EUR); else infer from amount
  let notionalCurrency = null;
  if (currencyPair && currencyPair.includes('/')) {
    notionalCurrency = currencyPair.split('/')[0];
  } else if (amountRaw) {
    const codeM = amountRaw.match(/^([A-Z]{3})\b/);
    if (codeM) notionalCurrency = codeM[1];
    else {
      const symM = amountRaw.match(/^(NZ\$|HK\$|A\$|C\$|S\$|\$|£|€|¥|kr|CHF)/);
      if (symM) notionalCurrency = SYMBOL_MAP[symM[1]] ?? null;
    }
  }

  // Notional amount = numeric part of the amount string (strip currency code/symbol)
  let notionalAmount = null;
  if (amountRaw) {
    const n = amountRaw
      .replace(/^([A-Z]{3})\s*/, '')
      .replace(/^(NZ\$|HK\$|A\$|C\$|S\$|\$|£|€|¥|kr|CHF)\s*/, '')
      .trim();
    notionalAmount = n || amountRaw;
  }

  return { currencyPair, uti, tradeDate, settlementDate, notionalAmount, notionalCurrency, buyOrSell, counterparty, amountRaw };
}

/* Normalise a "classified email" record (from Step 2) into the
   same shape StepExtract expects from a DB case row. */
function normalise(entry) {
  return {
    trade_id:                 entry.trade_id,
    subject:                  entry.subject,
    sender:                   entry.sender,
    received_at:              entry.received_at,
    asset_class:              entry.asset_class,
    attachment_count:         entry.attachment_count ?? 0,
    message_id:               entry.message_id,
    status:                   entry.skip_reason === 'duplicate' ? 'duplicate' : (entry.status ?? 'ingested'),
    skip_reason:              entry.skip_reason ?? null,
    classification_label:     entry.classification_label ?? entry.label,
    classification_confidence:entry.classification_confidence ?? entry.confidence,
  };
}

/* Map a backend /extract/trades row (parsed from an xlsx/csv attachment) into
   the same display shape the table + drawer use. One spreadsheet row = one
   trade; every field comes straight from the attachment (no body parsing). */
function fmtNum(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v.toLocaleString('en-US');
  return v; // already a formatted string (e.g. a CSV cell)
}

function mapAttachmentTrade(t) {
  const subject =
    [t.buy_sell, t.currency_pair, t.option_type].filter(Boolean).join(' ') +
    (t.option_type ? ' option' : '');
  return {
    trade_id:          t.trade_id,
    message_id:        `${t.source_message_id ?? ''}::${t.trade_id}`,
    subject:           subject || t.trade_id,
    sender:            t.counterparty,
    received_at:       t.trade_date,
    asset_class:       'FX Option',
    attachment_count:  1,
    status:            'extracted',
    skip_reason:       null,
    fromAttachment:    true,
    source:            t.source || `Attachment (${(t.source_file ?? '').split('.').pop() || 'file'})`,
    source_file:       t.source_file,
    source_message_id: t.source_message_id,
    counterparty:      t.counterparty || '',
    tf: {
      uti:              t.uti,
      tradeDate:        t.trade_date,
      currencyPair:     t.currency_pair,
      buyOrSell:        t.buy_sell,
      notionalAmount:   fmtNum(t.notional_amount),
      notionalCurrency: t.notional_currency,
      settlementDate:   t.settlement_date,
      // richer FX-option fields (shown in the drawer)
      optionType:       t.option_type,
      exerciseStyle:    t.exercise_style,
      strikeRate:       t.strike_rate,
      expiryDate:       t.expiry_date,
      premiumAmount:    fmtNum(t.premium_amount),
      premiumCurrency:  t.premium_currency,
      settlementStatus: t.settlement_status,
      trader:           t.trader,
      book:             t.book,
      baseCurrency:     t.base_currency,
      quoteCurrency:    t.quote_currency,
      portfolio:        t.portfolio,
    },
  };
}

/* ─── Trade detail drawer ──────────────────────────────────── */
function TradeDrawer({ entry, onClose }) {
  const open = !!entry;
  const [mounted, setMounted] = useState(false);
  const [detail, setDetail]   = useState(null);
  const [loadingD, setLoadingD] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!entry) { setDetail(null); return; }
    // Attachment trades + duplicates have no per-trade stored case to fetch.
    if (entry.fromAttachment || entry.skip_reason === 'duplicate') { setDetail(null); return; }
    setLoadingD(true);
    api.getCase(entry.trade_id)
      .then(d => setDetail(d))
      .catch(() => {})
      .finally(() => setLoadingD(false));
  }, [entry?.trade_id]);

  useEffect(() => {
    const fn = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  const fromAtt = !!entry?.fromAttachment;
  const c    = detail?.case ?? entry;
  const mf   = detail?.manifest;
  const body = detail?.body_excerpt ?? '';
  const tf   = fromAtt ? (entry?.tf ?? {}) : (entry ? parseTradeFields(entry.subject ?? '', body) : {});
  const senderName = entry?.sender?.match(/^([^<(]+?)(?:\s*<|\s*\(|$)/)?.[1]?.trim() ?? entry?.sender ?? '—';
  const counterparty = fromAtt ? (entry?.counterparty || '—') : (tf.counterparty || senderName);

  if (!mounted) return null;

  return createPortal(
    <>
      <div className={`drawer-backdrop fixed inset-0 z-40 bg-neutral-900/25 backdrop-blur-[2px] ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={onClose} />
      <div className={`drawer-slide fixed top-0 right-0 bottom-0 z-50 h-screen w-full max-w-lg bg-white border-l border-neutral-200 shadow-2xl flex flex-col ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        {!entry ? null : <>
          {/* Header */}
          <div className="px-5 py-4 border-b border-neutral-200 flex-shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <Badge variant="relevant" dot>RELEVANT</Badge>
                  {entry.skip_reason === 'duplicate' && (
                    <Badge variant="ambiguous">Duplicate</Badge>
                  )}
                  <span className="font-mono text-xs font-semibold text-brand-500 bg-brand-50 px-2 py-0.5 rounded border border-brand-200">
                    {entry.trade_id ?? '—'}
                  </span>
                  {tf.currencyPair && (
                    <span className="text-xs font-semibold text-neutral-700 bg-neutral-100 px-2 py-0.5 rounded border border-neutral-200 font-mono">
                      {tf.currencyPair}
                    </span>
                  )}
                </div>
                <p className="text-sm font-semibold text-neutral-900 leading-snug line-clamp-2">{entry.subject ?? '—'}</p>
              </div>
              <button onClick={onClose} className="w-7 h-7 rounded flex items-center justify-center hover:bg-neutral-100 text-neutral-500 flex-shrink-0 transition-colors">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 scrollbar-thin">
            {loadingD && (
              <div className="flex items-center gap-2 text-xs text-neutral-400 py-4">
                <svg className="w-4 h-4 animate-spin text-brand-500" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                Loading manifest…
              </div>
            )}

            {entry.skip_reason === 'duplicate' && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-xs">
                This trade ID was already present in the case store. This email was classified as RELEVANT but not stored to avoid duplicate trade records.
              </div>
            )}

            {/* Extracted trade data */}
            <div>
              <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-3">Extracted Trade Data</p>
              <div className="grid grid-cols-2 gap-2.5">
                <TradeField label="Trade ID"         value={entry.trade_id}      mono />
                <TradeField label="UTI"              value={tf.uti}              mono />
                <TradeField label="Trade Date"       value={tf.tradeDate} />
                <TradeField label="Counterparty"     value={counterparty} />
                <TradeField label="Currency Pair"    value={tf.currencyPair}     mono />
                <TradeField label="Buy / Sell"       value={tf.buyOrSell} />
                {fromAtt && <TradeField label="Option Type"    value={tf.optionType} />}
                {fromAtt && <TradeField label="Exercise Style" value={tf.exerciseStyle} />}
                <TradeField label="Notional Amount"  value={tf.notionalAmount}   mono />
                <TradeField label="Notional Ccy"     value={tf.notionalCurrency} mono />
                {fromAtt && <TradeField label="Strike Rate"    value={tf.strikeRate} mono />}
                {fromAtt && <TradeField label="Expiry Date"    value={tf.expiryDate} />}
                <TradeField label="Settlement Date"  value={tf.settlementDate} />
                {fromAtt && <TradeField label="Sett. Status"   value={tf.settlementStatus} />}
                {fromAtt && <TradeField label="Premium"        value={tf.premiumAmount ? `${tf.premiumAmount} ${tf.premiumCurrency ?? ''}`.trim() : null} mono />}
                {fromAtt && <TradeField label="Trader"         value={tf.trader} />}
                {fromAtt && <TradeField label="Book"           value={tf.book} mono />}
                {!fromAtt && <TradeField label="Attachments"   value={entry.attachment_count ?? 0} />}
                <TradeField label="Source"        value={entry.source} />
              </div>
            </div>

            {fromAtt ? (
              /* Source attachment */
              <div>
                <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Source</p>
                <div className="flex items-center gap-3 px-3 py-2 bg-neutral-50 border border-neutral-150 rounded-lg text-xs">
                  <span className="w-7 h-7 rounded-lg bg-neutral-100 flex items-center justify-center text-neutral-400 flex-shrink-0">
                    <DocumentIcon className="w-4 h-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-neutral-800 truncate">{entry.source_file ?? '—'}</p>
                    <p className="text-neutral-400 text-[10px]">Extracted from spreadsheet attachment · one row per trade</p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Classification */}
                <div>
                  <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Classification</p>
                  <div className="flex items-start gap-3 p-3 bg-[#ecfdf3] border border-[#abefc6] rounded-lg">
                    <span className="w-7 h-7 rounded-lg bg-[#dcfae6] flex items-center justify-center flex-shrink-0 text-[#027a48] mt-0.5">
                      <CheckCircleIcon className="w-4 h-4" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge variant="relevant" dot>RELEVANT</Badge>
                      </div>
                      <p className="text-xs text-[#027a48] leading-relaxed break-words">
                        {mf?.classification?.reason ?? '—'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Email metadata */}
                <div>
                  <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Email Metadata</p>
                  <div className="space-y-1.5 text-xs">
                    {[
                      ['Sender',      entry.sender],
                      ['Received',    entry.received_at],
                      ['Message ID',  entry.message_id,    true],
                      ['Case Folder', c?.case_folder,       true],
                      ['Status',      entry.status ?? 'ingested'],
                    ].map(([label, value, mono]) => (
                      <div key={label} className="flex gap-2">
                        <span className="text-neutral-400 w-24 flex-shrink-0 text-[11px] pt-px">{label}</span>
                        <span className={`text-neutral-700 break-all leading-snug ${mono ? 'font-mono text-[10px]' : ''}`}>{value ?? '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Attachments */}
                {mf?.attachments?.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Attachments ({mf.attachments.length})</p>
                    <div className="space-y-1.5">
                      {mf.attachments.map((att, i) => (
                        <div key={i} className="flex items-center gap-3 px-3 py-2 bg-neutral-50 border border-neutral-150 rounded-lg text-xs">
                          <span className="w-7 h-7 rounded-lg bg-neutral-100 flex items-center justify-center text-neutral-400 flex-shrink-0">
                            <DocumentIcon className="w-4 h-4" />
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-neutral-800 truncate">{att.filename}</p>
                            <p className="text-neutral-400 text-[10px]">{att.mime_type} · {att.size_bytes != null ? `${(att.size_bytes / 1024).toFixed(1)} KB` : 'unknown'}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Raw body excerpt */}
                {body && (
                  <div>
                    <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Email Body Excerpt</p>
                    <pre className="text-[10px] text-neutral-600 bg-neutral-50 border border-neutral-150 rounded-lg px-3 py-2.5 whitespace-pre-wrap leading-relaxed font-mono overflow-x-auto scrollbar-thin">
                      {body}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="px-5 py-3 border-t border-neutral-150 flex-shrink-0">
            <p className="text-[10px] text-neutral-300 font-mono break-all">{entry.message_id ?? '—'}</p>
          </div>
        </>}
      </div>
    </>,
    document.body,
  );
}

/* Small pill showing where a trade was extracted from: the email body, or an
   attachment (with the file type). */
function SourceBadge({ source }) {
  if (!source) return <span className="text-neutral-300">—</span>;
  const isBody = /body/i.test(source);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border whitespace-nowrap ${
      isBody ? 'bg-neutral-100 text-neutral-600 border-neutral-200'
             : 'bg-brand-50 text-brand-600 border-brand-200'}`}>
      {!isBody && (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
          <path fillRule="evenodd" d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a4 4 0 1 0 5.656 5.656l5.5-5.5a.75.75 0 0 0-1.06-1.06l-5.5 5.5a2.5 2.5 0 0 1-3.536-3.536l7-7a1.5 1.5 0 0 1 2.122 2.121l-5.879 5.879a.5.5 0 0 1-.707-.707l5.5-5.5a.75.75 0 0 0-1.06-1.061l-5.5 5.5a2 2 0 0 0 2.828 2.829l5.879-5.879a3 3 0 0 0 0-4.242Z" clipRule="evenodd" />
        </svg>
      )}
      {source}
    </span>
  );
}

function TradeField({ label, value, mono, highlight }) {
  const hasValue = value !== null && value !== undefined && value !== '';
  return (
    <div className={`px-3 py-2.5 rounded-lg border text-xs ${highlight && hasValue ? 'bg-brand-50 border-brand-200' : 'bg-neutral-50 border-neutral-150'}`}>
      <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className={`font-medium truncate ${highlight && hasValue ? 'text-brand-700' : 'text-neutral-700'} ${mono ? 'font-mono text-[11px]' : ''}`}>
        {hasValue ? value : <span className="text-neutral-300 font-normal italic">—</span>}
      </p>
    </div>
  );
}

/* ─── main ─────────────────────────────────────────────────── */

export default function StepExtract({ enabled, preloadedCases }) {
  // Enriched rows are cached in the pipeline context (survives navigation +
  // reload), keyed to the dataset, so this step does NOT re-fetch/re-parse on
  // every revisit — only when the dataset changes or on an explicit Refresh.
  const { extractRows, extractKey, setExtract } = usePipeline();

  const [loading,   setLoading]   = useState(false);
  // Seed from restored cases so returning to this tab shows rows immediately.
  const [entries,   setEntries]   = useState(
    () => (preloadedCases?.length ? preloadedCases.map(normalise) : null),
  );
  const [enriching, setEnriching] = useState(false);
  const [error,     setError]     = useState(null);
  const [drawer,    setDrawer]    = useState(null);
  const [search,    setSearch]    = useState('');

  const loader = useStagedLoader(EXTRACT_STEPS, 440);

  // Signature of the current dataset; the cached rows are keyed to it.
  const entriesKey = useMemo(
    () => (entries ?? []).map(e => e.message_id ?? e.trade_id ?? '').join('|'),
    [entries],
  );

  useEffect(() => {
    if (!enabled) return;
    if (preloadedCases?.length > 0) {
      setEntries(preloadedCases.map(normalise));
    } else if (!entries && !loading) {
      loadFromDB();
    }
  }, [enabled, preloadedCases]);

  async function loadFromDB() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listCases();
      const r = (data.cases ?? [])
        .filter(c => c.classification_label === 'RELEVANT')
        .map(normalise);
      setEntries(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  /* Enrich each case with parsed trade fields — fetch the email body once per
     case. Cached in context keyed by `entriesKey`, so it runs only when the
     dataset differs from the cache (new classify, or Refresh clears it). */
  useEffect(() => {
    if (!entries || !entriesKey) return;
    if (extractKey === entriesKey) return;   // already enriched & cached
    let cancelled = false;
    setEnriching(true);
    loader.start();
    (async () => {
      const started = Date.now();

      // 1) Trades parsed from xlsx/csv attachments (one row per trade).
      let attRows = [];
      let attMsgIds = new Set();
      try {
        const ex = await api.getExtractedTrades();
        attRows = (ex?.trades ?? []).map(mapAttachmentTrade);
        attMsgIds = new Set((ex?.sources ?? []).map(s => s.message_id));
      } catch {}

      // 2) Body-parsed trades — only for relevant cases that did NOT yield an
      //    attachment (so a spreadsheet email isn't also parsed from its body).
      const bodyEntries = entries.filter(e => !attMsgIds.has(e.message_id));
      const bodyRows = await Promise.all(bodyEntries.map(async (e) => {
        let body = '';
        if (e.skip_reason !== 'duplicate' && e.trade_id) {
          try { const d = await api.getCase(e.trade_id); body = d?.body_excerpt ?? ''; } catch {}
        }
        const tf = parseTradeFields(e.subject ?? '', body);
        const senderName = e.sender?.match(/^([^<(]+?)(?:\s*<|\s*\(|$)/)?.[1]?.trim() ?? e.sender ?? '';
        return { ...e, tf, counterparty: tf.counterparty || senderName, source: 'Body' };
      }));

      // 3) Combine, dedup by trade id (prefer attachment > body > duplicate),
      //    then order as a clean register by trade id.
      const rank = (r) => (r.fromAttachment ? 2 : (r.status === 'duplicate' ? 0 : 1));
      const byId = new Map();
      for (const r of [...bodyRows, ...attRows]) {
        const key = r.trade_id || r.message_id;
        const prev = byId.get(key);
        if (!prev || rank(r) > rank(prev)) byId.set(key, r);
      }
      const enriched = [...byId.values()].sort(
        (a, b) => String(a.trade_id ?? '').localeCompare(String(b.trade_id ?? '')),
      );

      // Keep the staged loader visible for a minimum beat.
      const minMs = EXTRACT_STEPS.length * 440 + 200;
      const elapsed = Date.now() - started;
      if (elapsed < minMs) await new Promise(r => setTimeout(r, minMs - elapsed));
      if (!cancelled) setExtract(enriched, entriesKey);
    })().finally(() => {
      if (!cancelled) { setEnriching(false); loader.reset(); }
    });
    return () => { cancelled = true; loader.reset(); };
  }, [entriesKey, extractKey]);

  // Use the cached rows when they match the current dataset.
  const rows = extractKey && extractKey === entriesKey ? extractRows : null;
  const busy = loading || enriching;
  // Hide duplicates from the trade register — only show stored, unique trades.
  const activeCases = (rows ?? []).filter(c => c.status !== 'duplicate');
  // Attachment mode = rows came from xlsx/csv extraction (one row per trade).
  const attachmentMode = activeCases.some(c => c.fromAttachment);
  const filtered = activeCases.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (c.trade_id ?? '').toLowerCase().includes(q)
      || (c.tf?.uti ?? '').toLowerCase().includes(q)
      || (c.counterparty ?? '').toLowerCase().includes(q)
      || (c.tf?.currencyPair ?? '').toLowerCase().includes(q)
      || (c.subject ?? '').toLowerCase().includes(q);
  });

  // Refresh = drop the cache → the enrichment effect re-runs for this dataset.
  function handleRefresh() { setExtract(null, null); }

  return (
    <>
      <TradeDrawer entry={drawer} onClose={() => setDrawer(null)} />

      <div className="space-y-4">
        {activeCases.length > 0 && !busy && (
          attachmentMode ? (
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Extracted Trades" value={activeCases.length}                                                     icon={<FolderOpenIcon2 />} color="green"   />
              <StatCard label="Counterparties"   value={new Set(activeCases.map(c => c.counterparty).filter(Boolean)).size}     icon={<DocumentIcon />}    color="blue"    />
              <StatCard label="Currency Pairs"   value={new Set(activeCases.map(c => c.tf?.currencyPair).filter(Boolean)).size} icon={<PaperClipIcon />}   color="neutral" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Relevant Cases"   value={activeCases.length}                                     icon={<FolderOpenIcon2 />} color="green"   />
              <StatCard label="With Attachments" value={activeCases.filter(c => c.attachment_count > 0).length} icon={<PaperClipIcon />}   color="neutral" />
            </div>
          )
        )}

        <div className="bg-white border border-neutral-200 rounded-lg shadow-card">
          <div className="p-5 pb-0">
            <CardHeader
              title="Extracted Trade Register"
              description="Trade rows parsed from email bodies and attachments (Excel/CSV) · click any row to view the full trade details."
              actions={
                rows && !busy && (
                  <Button variant="ghost" size="sm" onClick={handleRefresh}
                    icon={<ArrowPathIcon className="w-3.5 h-3.5" />}>Refresh</Button>
                )
              }
            />
          </div>

          {!enabled && !entries && (
            <div className="px-5 pb-5">
              <div className="flex items-center gap-2.5 p-3 bg-neutral-50 border border-neutral-150 rounded-lg text-neutral-500 text-xs">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-neutral-400 flex-shrink-0">
                  <path fillRule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clipRule="evenodd" />
                </svg>
                Run the shortlist first to generate trade cases.
              </div>
            </div>
          )}

          {error && <div className="px-5 pb-5"><div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">{error}</div></div>}

          {busy && <div className="pb-4"><ProcessLoader steps={EXTRACT_STEPS} currentStep={loader.step} title="Loading trade register…" /></div>}

          {rows && !busy && (
            <>
              <div className="px-5 pb-3">
                <div className="relative max-w-sm">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400">
                    <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clipRule="evenodd" />
                  </svg>
                  <input type="text" placeholder="Search trade ID, UTI, counterparty, pair…" value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-neutral-200 rounded-md bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white" />
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="px-5 pb-5">
                  <EmptyState icon={<MagnifyingGlassIcon className="w-6 h-6" />} title="No cases found" description="No relevant cases match your search." />
                </div>
              ) : (
                <div className="overflow-x-auto border-t border-neutral-150">
                  <table className="w-full text-xs data-table">
                    <thead>
                      <tr className="bg-neutral-50 border-b border-neutral-150">
                        {['Trade ID', 'UTI', 'Trade Date', 'Counterparty', 'Currency Pair', 'Buy/Sell', 'Notional Amount', 'Notional Ccy', 'Sett. Date', 'Source'].map(h => (
                          <th key={h} className="px-3 py-2.5 text-left text-[11px] font-semibold text-neutral-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {filtered.map((c) => {
                        const tf = c.tf ?? {};
                        const isDup = c.status === 'duplicate';
                        return (
                          <tr key={c.message_id ?? c.trade_id}
                            onClick={() => setDrawer(c)}
                            title="Click to view full trade details"
                            className={`cursor-pointer transition-colors ${drawer?.trade_id === c.trade_id ? 'bg-brand-50' : isDup ? 'bg-amber-50/40 hover:bg-amber-50' : 'hover:bg-[#f5f8ff]'}`}
                          >
                            <td className="px-3 py-2.5 font-mono text-brand-500 font-semibold whitespace-nowrap">{c.trade_id ?? '—'}</td>
                            <td className="px-3 py-2.5 font-mono text-[10px] text-neutral-600 whitespace-nowrap">{tf.uti ?? <span className="text-neutral-300">—</span>}</td>
                            <td className="px-3 py-2.5 font-mono text-[11px] text-neutral-600 whitespace-nowrap">{tf.tradeDate ?? <span className="text-neutral-300">—</span>}</td>
                            <td className="px-3 py-2.5 text-neutral-700 max-w-[160px] truncate whitespace-nowrap" title={c.counterparty}>{c.counterparty || <span className="text-neutral-300">—</span>}</td>
                            <td className="px-3 py-2.5 font-mono text-neutral-700 whitespace-nowrap">{tf.currencyPair ?? <span className="text-neutral-300">—</span>}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              {tf.buyOrSell ? (
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                                  /buy/i.test(tf.buyOrSell)
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-red-50 text-red-700 border-red-200'
                                }`}>{tf.buyOrSell}</span>
                              ) : <span className="text-neutral-300">—</span>}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-neutral-800 whitespace-nowrap">{tf.notionalAmount ?? <span className="text-neutral-300">—</span>}</td>
                            <td className="px-3 py-2.5 font-mono text-neutral-700 whitespace-nowrap">{tf.notionalCurrency ?? <span className="text-neutral-300">—</span>}</td>
                            <td className="px-3 py-2.5 font-mono text-[11px] text-neutral-600 whitespace-nowrap">{tf.settlementDate ?? <span className="text-neutral-300">—</span>}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap"><SourceBadge source={c.source} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="px-4 py-2.5 border-t border-neutral-100">
                    <p className="text-xs text-neutral-400">
                      {filtered.length} of {activeCases.length} trade{activeCases.length !== 1 ? 's' : ''} · Click any row to view full trade details
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
