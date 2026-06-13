'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/*
 * Visual workflow builder — MOCK / SHOWCASE ONLY.
 *
 * The block library reflects the Compare & Match settlement pipeline:
 *   Email Ingestor → Triage Classifier → Trade Extractor → Compare & Match
 *   → Decision Router → { Human Review | Output Action },  plus Golden Source
 *   and Feedback Loop blocks for the full agent-marketplace vision.
 *
 * Drag blocks from the library, click to configure, drag to reposition, connect
 * ports (Decision Router supports multiple branches), undo/redo with Ctrl+Z /
 * Ctrl+X. Nothing is wired to the backend — Save / Trigger are placeholders.
 */

/* ─── node icons ─── */
const Icon = {
  ingest: (p) => (<svg viewBox="0 0 20 20" fill="currentColor" {...p}><path d="M5.5 13a3.5 3.5 0 0 1-.5-6.96 4.5 4.5 0 0 1 8.86-.16A3.5 3.5 0 0 1 14 13h-2.25V9.81l.72.72a.75.75 0 1 0 1.06-1.06l-2-2a.75.75 0 0 0-1.06 0l-2 2a.75.75 0 1 0 1.06 1.06l.72-.72V13H5.5Z" /><path d="M9.25 13v3.19l-.72-.72a.75.75 0 1 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l2-2a.75.75 0 1 0-1.06-1.06l-.72.72V13h-1.5Z" /></svg>),
  golden: (p) => (<svg viewBox="0 0 20 20" fill="currentColor" {...p}><path d="M10 2c3.314 0 6 1.12 6 2.5S13.314 7 10 7 4 5.88 4 4.5 6.686 2 10 2Z" /><path d="M4 7.2v3.3C4 11.88 6.686 13 10 13s6-1.12 6-2.5V7.2C14.7 8.3 12.5 9 10 9s-4.7-.7-6-1.8Z" /><path d="M4 12.7V16c0 1.38 2.686 2.5 6 2.5s6-1.12 6-2.5v-3.3C14.7 13.8 12.5 14.5 10 14.5s-4.7-.7-6-1.8Z" /></svg>),
  classify: (p) => (<svg viewBox="0 0 20 20" fill="currentColor" {...p}><path fillRule="evenodd" d="M2.628 3.262A1 1 0 0 1 3.5 2.75h13a1 1 0 0 1 .8 1.6l-4.55 6.067a1 1 0 0 0-.2.6v3.983a1 1 0 0 1-.55.894l-2 1A1 1 0 0 1 8.25 16V11.017a1 1 0 0 0-.2-.6L3.5 4.35a1 1 0 0 1-.872-1.088Z" clipRule="evenodd" /></svg>),
  extract: (p) => (<svg viewBox="0 0 20 20" fill="currentColor" {...p}><path d="M6 4.5a2.5 2.5 0 1 0-1.4 2.247l2.06 2.06-2.06 2.06A2.5 2.5 0 1 0 6 13.5l3-3 6.22 6.22a.75.75 0 0 0 1.06-1.06L10.06 9.44 16.28 3.22a.75.75 0 0 0-1.06-1.06L9 8.38 6 5.38c.34-.37.5-.62.5-.88Zm-2.5 1a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm0 9a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" /></svg>),
  match: (p) => (<svg viewBox="0 0 20 20" fill="currentColor" {...p}><path fillRule="evenodd" d="M2.22 5.97a.75.75 0 0 1 0-1.06l2.5-2.5a.75.75 0 0 1 1.06 1.06L4.81 4.94h9.69a.75.75 0 0 1 0 1.5H4.81l.97.97a.75.75 0 0 1-1.06 1.06l-2.5-2.5Zm15.56 8.06a.75.75 0 0 1 0 1.06l-2.5 2.5a.75.75 0 1 1-1.06-1.06l1.97-1.97H6.5a.75.75 0 0 1 0-1.5h9.69l-.97-.97a.75.75 0 0 1 1.06-1.06l2.5 2.5Z" clipRule="evenodd" /></svg>),
  router: (p) => (<svg viewBox="0 0 20 20" fill="currentColor" {...p}><path d="M6 3.75A2.75 2.75 0 1 0 4.5 6.32v3.93a2.75 2.75 0 0 0 2.75 2.75h2.5v1.18a2.75 2.75 0 1 0 1.5 0V13h2.5A2.75 2.75 0 0 0 16.5 10.25V6.32a2.75 2.75 0 1 0-1.5 0v3.93c0 .69-.56 1.25-1.25 1.25H6.75c-.69 0-1.25-.56-1.25-1.25V6.32A2.75 2.75 0 0 0 6 3.75Z" /></svg>),
  review: (p) => (<svg viewBox="0 0 20 20" fill="currentColor" {...p}><path d="M10 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-7 9a7 7 0 0 1 14 0H3Z" /></svg>),
  action: (p) => (<svg viewBox="0 0 20 20" fill="currentColor" {...p}><path d="M3.105 2.29a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.084l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.154.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.29Z" /></svg>),
  feedback: (p) => (<svg viewBox="0 0 20 20" fill="currentColor" {...p}><path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0V5.36l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z" clipRule="evenodd" /></svg>),
};

const PALETTE = ['#16a34a', '#e11d48', '#2563eb', '#d97706', '#7c3aed', '#0891b2'];
let _uid = 100;
const uid = () => `n${_uid++}`;
const bid = () => 'b' + Math.random().toString(36).slice(2, 8);

/* ─── block registry ─── */
const NODE_TYPES = {
  ingest: {
    label: 'Email Ingestor', accent: '#2563eb', tint: '#eff6ff',
    defaults: { source: 'Microsoft Graph API', mailbox: 'mo-team@nomura.com', filter: 'subject contains "Settlement"', store: 'File System' },
    summary: (c) => [['SOURCE', c.source === 'Microsoft Graph API' ? 'MS Graph API' : c.source], ['MAILBOX', c.mailbox], ['STORE', c.store]],
  },
  golden: {
    label: 'Golden Source', accent: '#0d9488', tint: '#f0fdfa',
    defaults: { system: 'Master Blotter', connection: 'data/golden/FX_Options_Trade_masterDataset.xlsx', key: 'trade_id' },
    summary: (c) => [['SYSTEM', c.system], ['KEY', c.key], ['SOURCE', c.connection]],
  },
  classify: {
    label: 'Triage Classifier', accent: '#16a34a', tint: '#f0fdf4',
    defaults: { mode: 'NLP (Keyword based)', keywords: 'fx trade settlement, deal reference, settlement instructions', relevant: '0.7', ambiguous: '0.3' },
    summary: (c) => [['MODE', (c.mode || '').replace(' (Keyword based)', '')], ['KEYWORDS', c.keywords], ['RELEVANT ≥', c.relevant]],
  },
  extract: {
    label: 'Trade Extractor', accent: '#e11d48', tint: '#fff1f3',
    defaults: { input: 'from upstream', formats: '.eml,.xlsx,.csv', fields: 'trade_id, currency_pair, notional_amount, settlement_date, counterparty, rate', method: 'Regex Rules' },
    summary: (c) => [['FIELDS', c.fields], ['FORMATS', c.formats], ['METHOD', c.method]],
  },
  match: {
    label: 'Compare & Match', accent: '#d97706', tint: '#fffbeb',
    defaults: { golden: 'Master Blotter', fields: 'asset, counterparty, notional, value_date, rate', tolerance: '1', fill: 'Yes', scoring: 'Yes' },
    summary: (c) => [['GOLDEN', c.golden], ['FIELDS', c.fields], ['TOLERANCE', c.tolerance ? `${c.tolerance}%` : '']],
  },
  router: {
    label: 'Decision Router', accent: '#7c3aed', tint: '#f5f3ff',
    defaults: {
      field: 'confidence_score', operator: '>= Greater or equal', value: '90',
      branches: [
        { id: 'b1', label: 'matched ≥ 90%', color: '#16a34a' },
        { id: 'b2', label: 'break / review', color: '#e11d48' },
      ],
    },
    summary: (c) => {
      const sym = (c.operator || '').split(' ')[0];
      const cond = [c.field, sym, c.value].filter(Boolean).join(' ') || '—';
      const rows = [['CONDITION', cond]];
      (c.branches || []).forEach((b, i) => rows.push([`BRANCH ${i + 1}`, b.label || `(branch ${i + 1})`]));
      return rows;
    },
  },
  review: {
    label: 'Human Review', accent: '#db2777', tint: '#fdf2f8',
    defaults: { assignee: 'trade-ops@nomura.com', role: 'Settlements Reviewer', subject: 'Trade break requires review', content: 'Confidence below threshold or fields mismatch — please review and adjudicate.' },
    summary: (c) => [['ASSIGNEE', c.assignee], ['ROLE', c.role], ['STATUS', c.assignee || c.subject ? 'Awaiting Review' : '']],
  },
  action: {
    label: 'Output Action', accent: '#0891b2', tint: '#ecfeff',
    defaults: { type: 'ServiceNow (NEWS)', target: 'Settlements queue', template: 'Auto-draft confirmation' },
    summary: (c) => [['TYPE', c.type], ['TARGET', c.target], ['TEMPLATE', c.template]],
  },
  feedback: {
    label: 'Feedback Loop', accent: '#65a30d', tint: '#f7fee7',
    defaults: { store: 'Long-term memory', captures: 'HITL decisions, overrides, MO replies', applies: 'Compare & Match' },
    summary: (c) => [['MEMORY', c.store], ['CAPTURES', c.captures], ['APPLIES', c.applies]],
  },
};
const LIBRARY = ['ingest', 'golden', 'classify', 'extract', 'match', 'router', 'review', 'action', 'feedback'];

const NODE_W = 230;
const estHeight = (n) => 40 + NODE_TYPES[n.type].summary(n.config).length * 20 + 16;

/* Blank config — a freshly added block carries NO details. */
function emptyConfig(type) {
  switch (type) {
    case 'ingest': return { source: '', mailbox: '', filter: '', store: '' };
    case 'golden': return { system: '', connection: '', key: '' };
    case 'classify': return { mode: '', keywords: '', relevant: '', ambiguous: '' };
    case 'extract': return { input: '', formats: '', fields: '', method: '' };
    case 'match': return { golden: '', fields: '', tolerance: '', fill: '', scoring: '' };
    case 'router': return { field: '', operator: '', value: '', branches: [{ id: bid(), label: '', color: PALETTE[0] }, { id: bid(), label: '', color: PALETTE[1] }] };
    case 'review': return { assignee: '', role: '', subject: '', content: '' };
    case 'action': return { type: '', target: '', template: '' };
    case 'feedback': return { store: '', captures: '', applies: '' };
    default: return {};
  }
}

/* Seed: the default FX Trade Settlement pipeline (edit mode). */
function seedPipeline() {
  const mk = (id, type, x, y) => ({ id, type, x, y, config: JSON.parse(JSON.stringify(NODE_TYPES[type].defaults)) });
  const nodes = [
    mk('n1', 'ingest', 620, 24),
    mk('n2', 'classify', 620, 176),
    mk('n3', 'extract', 620, 328),
    mk('n4', 'match', 620, 480),
    mk('n5', 'router', 620, 636),
    mk('n6', 'review', 330, 812),
    mk('n7', 'action', 910, 812),
  ];
  const edges = [
    { id: 'e1', from: 'n1', to: 'n2', fromPort: 'out' },
    { id: 'e2', from: 'n2', to: 'n3', fromPort: 'out' },
    { id: 'e3', from: 'n3', to: 'n4', fromPort: 'out' },
    { id: 'e4', from: 'n4', to: 'n5', fromPort: 'out' },
    { id: 'e5', from: 'n5', to: 'n7', fromPort: 'b1' }, // matched → Output Action
    { id: 'e6', from: 'n5', to: 'n6', fromPort: 'b2' }, // break → Human Review
  ];
  return { nodes, edges };
}

export default function WorkflowBuilder({ mode = 'edit', workflow, onClose }) {
  const seeded = mode === 'edit' ? seedPipeline() : { nodes: [], edges: [] };
  const [nodes, setNodes] = useState(seeded.nodes);
  const [edges, setEdges] = useState(seeded.edges);
  const [selectedId, setSelectedId] = useState(null);
  const [hoverEdge, setHoverEdge] = useState(null);
  const [connecting, setConnecting] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState(null);

  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const connRef = useRef(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  // Measure real node heights so connectors attach flush (no gap).
  const [heights, setHeights] = useState({});
  const nodeEls = useRef({});
  const nodeHeight = (n) => heights[n.id] ?? estHeight(n);
  useLayoutEffect(() => {
    let changed = false;
    const next = { ...heights };
    for (const n of nodes) {
      const el = nodeEls.current[n.id];
      if (el && next[n.id] !== el.offsetHeight) { next[n.id] = el.offsetHeight; changed = true; }
    }
    if (changed) setHeights(next);
  });

  // ── undo / redo history ──
  const histRef = useRef({ past: [], future: [] });
  const lastEditRef = useRef({ id: null, key: null, t: 0 });
  const [histLen, setHistLen] = useState({ p: 0, f: 0 });
  const snap = () => ({ nodes: JSON.parse(JSON.stringify(nodesRef.current)), edges: JSON.parse(JSON.stringify(edgesRef.current)) });
  function bumpHist() { setHistLen({ p: histRef.current.past.length, f: histRef.current.future.length }); }
  function pushPast() { histRef.current.past.push(snap()); histRef.current.future = []; lastEditRef.current = { id: null, key: null, t: 0 }; bumpHist(); }
  function recordForEdit(id, key) {
    const now = Date.now();
    const le = lastEditRef.current;
    const same = le.id === id && le.key === key && now - le.t < 1500;
    if (!same) pushPast();
    lastEditRef.current = { id, key, t: now };
  }
  function undo() {
    const h = histRef.current;
    if (h.past.length === 0) return;
    const prev = h.past.pop();
    h.future.unshift(snap());
    setNodes(prev.nodes); setEdges(prev.edges); setSelectedId(null);
    lastEditRef.current = { id: null, key: null, t: 0 };
    bumpHist();
  }
  function redo() {
    const h = histRef.current;
    if (h.future.length === 0) return;
    const next = h.future.shift();
    h.past.push(snap());
    setNodes(next.nodes); setEdges(next.edges); setSelectedId(null);
    lastEditRef.current = { id: null, key: null, t: 0 };
    bumpHist();
  }
  useEffect(() => {
    function onKey(e) {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey) || k === 'x') { e.preventDefault(); redo(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const title = mode === 'add' ? 'New Workflow' : (workflow?.name ?? 'FX Trade Settlement') + ' Pipeline';
  const selected = nodes.find((n) => n.id === selectedId) || null;
  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 2600); }

  /* ── output ports (Decision Router gets one per branch) ── */
  function nodeOutPorts(n) {
    const h = nodeHeight(n);
    if (n.type === 'router') {
      const bs = n.config.branches || [];
      const count = bs.length || 1;
      return bs.map((b, i) => ({ key: b.id, label: b.label || `Branch ${i + 1}`, color: b.color || '#94a3b8', x: n.x + (NODE_W * (i + 1)) / (count + 1), y: n.y + h }));
    }
    return [{ key: 'out', label: '', color: NODE_TYPES[n.type].accent, x: n.x + NODE_W / 2, y: n.y + h }];
  }
  const portById = (n, key) => nodeOutPorts(n).find((p) => p.key === key) || nodeOutPorts(n)[0];
  const anchorIn = (n) => ({ x: n.x + NODE_W / 2, y: n.y });

  /* ── node drag ── */
  function onNodeDown(e, id) {
    e.stopPropagation();
    setSelectedId(id);
    const node = nodes.find((n) => n.id === id);
    const rect = canvasRef.current.getBoundingClientRect();
    dragRef.current = { id, dx: e.clientX - rect.left + canvasRef.current.scrollLeft - node.x, dy: e.clientY - rect.top + canvasRef.current.scrollTop - node.y, moved: false, snap: snap() };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  function onMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left + canvasRef.current.scrollLeft - d.dx);
    const y = Math.max(0, e.clientY - rect.top + canvasRef.current.scrollTop - d.dy);
    d.moved = true;
    setNodes((ns) => ns.map((n) => (n.id === d.id ? { ...n, x, y } : n)));
  }
  function onUp() {
    if (dragRef.current?.moved) {
      histRef.current.past.push(dragRef.current.snap);
      histRef.current.future = [];
      lastEditRef.current = { id: null, key: null, t: 0 };
      bumpHist();
      setDirty(true);
    }
    dragRef.current = null;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }
  useEffect(() => () => {
    window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
    window.removeEventListener('mousemove', onConnMove); window.removeEventListener('mouseup', onConnEnd);
  }, []);

  /* ── connect nodes ── */
  function canvasPoint(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left + canvasRef.current.scrollLeft, y: e.clientY - rect.top + canvasRef.current.scrollTop };
  }
  function startConnect(e, id, portKey) {
    e.stopPropagation();
    const n = nodesRef.current.find((x) => x.id === id);
    const p = portById(n, portKey);
    connRef.current = { fromId: id, fromPort: portKey };
    setConnecting({ fromId: id, fromPort: portKey, x: p.x, y: p.y });
    window.addEventListener('mousemove', onConnMove);
    window.addEventListener('mouseup', onConnEnd);
  }
  function onConnMove(e) { const p = canvasPoint(e); setConnecting((c) => (c ? { ...c, x: p.x, y: p.y } : c)); }
  function onConnEnd(e) {
    window.removeEventListener('mousemove', onConnMove);
    window.removeEventListener('mouseup', onConnEnd);
    const c = connRef.current;
    connRef.current = null;
    setConnecting(null);
    if (!c) return;
    const p = canvasPoint(e);
    const target = nodesRef.current.find((n) => n.id !== c.fromId && p.x >= n.x && p.x <= n.x + NODE_W && p.y >= n.y && p.y <= n.y + nodeHeight(n));
    if (!target) return;
    if (edgesRef.current.some((ed) => ed.from === c.fromId && ed.to === target.id && ed.fromPort === c.fromPort)) return;
    pushPast();
    setEdges((es) => [...es, { id: uid(), from: c.fromId, to: target.id, fromPort: c.fromPort }]);
    setDirty(true);
  }
  function deleteEdge(id) { pushPast(); setEdges((es) => es.filter((e) => e.id !== id)); setHoverEdge(null); setDirty(true); }

  /* ── library drop ── */
  function onDrop(e) {
    e.preventDefault();
    const type = e.dataTransfer.getData('nodeType');
    if (!type || !NODE_TYPES[type]) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left + canvasRef.current.scrollLeft - NODE_W / 2);
    const y = Math.max(0, e.clientY - rect.top + canvasRef.current.scrollTop - 24);
    const id = uid();
    pushPast();
    setNodes((ns) => [...ns, { id, type, x, y, config: emptyConfig(type) }]);
    setSelectedId(id);
    setDirty(true);
  }

  function updateConfig(id, key, value) {
    recordForEdit(id, key);
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, config: { ...n.config, [key]: value } } : n)));
    if (key === 'branches') {
      const ids = new Set(value.map((b) => b.id));
      setEdges((es) => es.filter((e) => e.from !== id || !e.fromPort || e.fromPort === 'out' || ids.has(e.fromPort)));
    }
    setDirty(true);
  }
  function deleteNode(id) {
    pushPast();
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.from !== id && e.to !== id));
    setSelectedId(null);
    setDirty(true);
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] bg-white flex flex-col">
      {/* Top bar */}
      <div className="h-14 flex items-center px-4 border-b border-neutral-200 flex-shrink-0 bg-white">
        <button onClick={onClose} className="w-8 h-8 rounded-md hover:bg-neutral-100 flex items-center justify-center text-neutral-500 transition-colors" title="Back to Configure Workflows">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd" /></svg>
        </button>
        <div className="flex items-center gap-2 ml-1 text-sm">
          <span className="text-neutral-400 font-medium">Workflows</span>
          <span className="text-neutral-300">/</span>
          <span className="font-semibold text-neutral-900">{title}</span>
          <span className="inline-flex items-center gap-1.5 ml-2 text-xs text-emerald-600 font-medium"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Active</span>
          {dirty && <span className="ml-1 text-[11px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Unsaved</span>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center mr-1">
            <button onClick={undo} disabled={histLen.p === 0} title="Undo (Ctrl+Z)" className="w-8 h-8 rounded-md flex items-center justify-center text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M7.793 2.232a.75.75 0 0 1-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 0 1 0 10.75H10.75a.75.75 0 0 1 0-1.5h2.875a3.875 3.875 0 0 0 0-7.75H3.622l4.146 3.957a.75.75 0 0 1-1.036 1.085l-5.5-5.25a.75.75 0 0 1 0-1.085l5.5-5.25a.75.75 0 0 1 1.06.025Z" clipRule="evenodd" /></svg>
            </button>
            <button onClick={redo} disabled={histLen.f === 0} title="Redo (Ctrl+Y / Ctrl+Shift+Z / Ctrl+X)" className="w-8 h-8 rounded-md flex items-center justify-center text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M12.207 2.232a.75.75 0 0 0 .025 1.06l4.146 3.958H6.375a5.375 5.375 0 0 0 0 10.75H9.25a.75.75 0 0 0 0-1.5H6.375a3.875 3.875 0 0 1 0-7.75h10.003l-4.146 3.957a.75.75 0 0 0 1.036 1.085l5.5-5.25a.75.75 0 0 0 0-1.085l-5.5-5.25a.75.75 0 0 0-1.06.025Z" clipRule="evenodd" /></svg>
            </button>
          </div>
          <button onClick={() => { setDirty(false); flash('Workflow saved (demo — not persisted).'); }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-neutral-700 bg-white border border-neutral-300 rounded-md hover:bg-neutral-50 transition-colors">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M3.5 3A1.5 1.5 0 0 0 2 4.5v11A1.5 1.5 0 0 0 3.5 17h13a1.5 1.5 0 0 0 1.5-1.5V6.621a1.5 1.5 0 0 0-.44-1.06l-2.122-2.122A1.5 1.5 0 0 0 13.38 3H3.5Zm9 1.5v3a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5v-3h6Zm-6 7a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5V16h-7v-4.5Z" /></svg>
            Save
          </button>
          <button onClick={() => flash('Trigger queued (demo — execution is mocked in the builder).')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white rounded-md transition-colors" style={{ background: '#ee7624' }}>
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z" /></svg>
            Trigger
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex min-h-0">
        {/* Library */}
        <aside className="w-60 flex-shrink-0 border-r border-neutral-200 bg-white p-4 overflow-y-auto">
          <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Block Library</p>
          <p className="text-[11px] text-neutral-400 mb-4">Drag to canvas</p>
          <div className="space-y-2.5">
            {LIBRARY.map((type) => {
              const t = NODE_TYPES[type];
              const Ico = Icon[type];
              return (
                <div key={type} draggable onDragStart={(e) => e.dataTransfer.setData('nodeType', type)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-neutral-200 bg-white cursor-grab active:cursor-grabbing hover:shadow-card hover:border-neutral-300 transition-all"
                  style={{ borderLeft: `3px solid ${t.accent}` }}>
                  <span className="w-5 h-5 flex items-center justify-center flex-shrink-0" style={{ color: t.accent }}><Ico className="w-[18px] h-[18px]" /></span>
                  <span className="text-sm font-medium text-neutral-700">{t.label}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-6 p-3 rounded-lg bg-neutral-50 border border-neutral-150 text-[11px] text-neutral-400 leading-relaxed">
            Drag a block onto the canvas, click it to configure, drag to reposition, and connect ports. The Decision Router can have multiple branches. Undo / redo with Ctrl+Z / Ctrl+X. Save &amp; Trigger are mocked.
          </div>
        </aside>

        {/* Canvas */}
        <div ref={canvasRef} onDragOver={(e) => e.preventDefault()} onDrop={onDrop} onMouseDown={() => setSelectedId(null)}
          className="flex-1 relative overflow-auto"
          style={{ backgroundColor: '#f7f8fa', backgroundImage: 'radial-gradient(#d6dae1 1px, transparent 1px)', backgroundSize: '22px 22px' }}>
          <div className="relative" style={{ width: 1480, height: 980 }}>
            <svg className="absolute inset-0" width={1480} height={980} style={{ pointerEvents: 'none' }}>
              {edges.map((edge) => {
                const from = nodes.find((n) => n.id === edge.from);
                const to = nodes.find((n) => n.id === edge.to);
                if (!from || !to) return null;
                const sp = portById(from, edge.fromPort);
                const t = anchorIn(to);
                const c = Math.max(40, Math.abs(t.y - sp.y) / 2);
                const d = `M ${sp.x} ${sp.y} C ${sp.x} ${sp.y + c} ${t.x} ${t.y - c} ${t.x} ${t.y}`;
                const mx = (sp.x + t.x) / 2;
                const my = (sp.y + t.y) / 2;
                const color = sp.color || '#94a3b8';
                const label = sp.label;
                const hovered = hoverEdge === edge.id;
                return (
                  <g key={edge.id}>
                    <path d={d} fill="none" stroke={color} strokeWidth={hovered ? 3 : 2} strokeDasharray="5 4" />
                    <circle cx={t.x} cy={t.y} r="3.5" fill={color} />
                    <path d={d} fill="none" stroke="transparent" strokeWidth="16" style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                      onMouseEnter={() => setHoverEdge(edge.id)} onMouseLeave={() => setHoverEdge((h) => (h === edge.id ? null : h))} />
                    {label && !hovered && (
                      <g>
                        <rect x={mx - label.length * 3.4 - 6} y={my - 9} width={label.length * 6.8 + 12} height="18" rx="9" fill="white" stroke={color} strokeOpacity="0.4" />
                        <text x={mx} y={my + 3} textAnchor="middle" fontSize="10" fill={color} fontWeight="600">{label}</text>
                      </g>
                    )}
                    {hovered && (
                      <g style={{ pointerEvents: 'auto', cursor: 'pointer' }} onMouseEnter={() => setHoverEdge(edge.id)} onClick={() => deleteEdge(edge.id)}>
                        <circle cx={mx} cy={my} r="10" fill="#ef4444" />
                        <path d={`M ${mx - 3.5} ${my - 3.5} L ${mx + 3.5} ${my + 3.5} M ${mx + 3.5} ${my - 3.5} L ${mx - 3.5} ${my + 3.5}`} stroke="white" strokeWidth="1.6" strokeLinecap="round" />
                      </g>
                    )}
                  </g>
                );
              })}
              {connecting && (() => {
                const from = nodes.find((n) => n.id === connecting.fromId);
                if (!from) return null;
                const s = portById(from, connecting.fromPort);
                const c = Math.max(40, Math.abs(connecting.y - s.y) / 2);
                const d = `M ${s.x} ${s.y} C ${s.x} ${s.y + c} ${connecting.x} ${connecting.y - c} ${connecting.x} ${connecting.y}`;
                return (<g><path d={d} fill="none" stroke="#2356d4" strokeWidth="2" strokeDasharray="4 4" /><circle cx={connecting.x} cy={connecting.y} r="4" fill="#2356d4" /></g>);
              })()}
            </svg>

            {nodes.map((n) => {
              const t = NODE_TYPES[n.type];
              const Ico = Icon[n.type];
              const isSel = n.id === selectedId;
              const ports = nodeOutPorts(n);
              return (
                <div key={n.id} ref={(el) => { if (el) nodeEls.current[n.id] = el; }} onMouseDown={(e) => onNodeDown(e, n.id)}
                  className={`absolute rounded-xl bg-white shadow-card border transition-shadow ${isSel ? 'ring-2 ring-offset-1' : ''}`}
                  style={{ left: n.x, top: n.y, width: NODE_W, borderColor: isSel ? t.accent : '#e5e7eb', '--tw-ring-color': t.accent, cursor: 'grab' }}>
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-t-xl" style={{ background: t.tint }}>
                    <span className="w-4 h-4 flex items-center justify-center" style={{ color: t.accent }}><Ico className="w-3.5 h-3.5" /></span>
                    <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: t.accent }}>{t.label}</span>
                  </div>
                  <div className="px-3 py-2 space-y-1">
                    {t.summary(n.config).map(([k, v]) => (
                      <div key={k} className="flex gap-2 text-[10px] leading-tight">
                        <span className="text-neutral-400 font-semibold uppercase tracking-wide w-[68px] flex-shrink-0">{k}</span>
                        <span className="text-neutral-600 truncate">{v || '—'}</span>
                      </div>
                    ))}
                  </div>
                  <span className="absolute left-1/2 -top-1.5 -translate-x-1/2 w-3 h-3 rounded-full bg-white border-2 border-neutral-300" />
                  {ports.map((p) => (
                    <span key={p.key} onMouseDown={(e) => startConnect(e, n.id, p.key)} title={p.label ? `Connect: ${p.label}` : 'Drag to connect'}
                      className="absolute -translate-x-1/2 -bottom-1.5 w-3 h-3 rounded-full bg-white border-2 hover:scale-150 transition-transform"
                      style={{ left: p.x - n.x, borderColor: p.color, cursor: 'crosshair' }} />
                  ))}
                </div>
              );
            })}

            {nodes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center text-neutral-400">
                  <p className="text-sm font-medium">Drag blocks from the library to start building</p>
                  <p className="text-xs mt-1">A blank workflow — every block you add starts with no details.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {selected && (
          <ConfigPanel node={selected} onChange={(k, v) => updateConfig(selected.id, k, v)} onClose={() => setSelectedId(null)} onDelete={() => deleteNode(selected.id)} />
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] px-4 py-2.5 rounded-lg bg-neutral-900 text-white text-xs font-medium shadow-card-lg">{toast}</div>
      )}
    </div>,
    document.body,
  );
}

/* ─── right config panel ─── */
function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-neutral-600 mb-1.5">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-neutral-400">{hint}</p>}
    </div>
  );
}
const inputCls = 'w-full px-3 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500';
const Sel = ({ value, onChange, placeholder, options }) => (
  <select className={`${inputCls} bg-white`} value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="">{placeholder}</option>
    {options.map((o) => <option key={o}>{o}</option>)}
  </select>
);

function ConfigPanel({ node, onChange, onClose, onDelete }) {
  const t = NODE_TYPES[node.type];
  const c = node.config;
  const branches = c.branches || [];
  const setBranches = (bs) => onChange('branches', bs);

  return (
    <aside className="w-[380px] flex-shrink-0 border-l border-neutral-200 bg-white flex flex-col">
      <div className="px-5 py-4 border-b border-neutral-150 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 flex items-center justify-center" style={{ color: t.accent }}>{Icon[node.type]({ className: 'w-4 h-4' })}</span>
          <h2 className="text-sm font-semibold text-neutral-900">{t.label}</h2>
        </div>
        <button onClick={onClose} className="w-7 h-7 rounded hover:bg-neutral-100 flex items-center justify-center text-neutral-400">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
        </button>
      </div>

      <div className="px-5 py-5 space-y-5 overflow-y-auto flex-1 scrollbar-thin">
        {node.type === 'ingest' && (<>
          <Field label="Source"><Sel value={c.source} onChange={(v) => onChange('source', v)} placeholder="Select source…" options={['Microsoft Graph API', 'IMAP', 'Local Folder']} /></Field>
          <Field label="Mailbox"><input className={inputCls} placeholder="team@company.com" value={c.mailbox} onChange={(e) => onChange('mailbox', e.target.value)} /></Field>
          <Field label="Filter" hint="OData / search filter applied at the source"><input className={inputCls} placeholder='subject contains "…"' value={c.filter} onChange={(e) => onChange('filter', e.target.value)} /></Field>
          <Field label="Store To"><Radio value={c.store} options={['Database', 'File System']} onChange={(v) => onChange('store', v)} /></Field>
        </>)}

        {node.type === 'golden' && (<>
          <div className="flex items-start gap-2 p-3 bg-teal-50 border-l-2 border-teal-400 rounded text-[11px] text-teal-700">The trusted record set the extracted trades are reconciled against.</div>
          <Field label="System"><Sel value={c.system} onChange={(v) => onChange('system', v)} placeholder="Select system…" options={['Master Blotter', 'GLOSS API', 'OBI', 'FO Systems', 'Snowflake']} /></Field>
          <Field label="Connection / Path"><input className={inputCls} placeholder="endpoint or file path" value={c.connection} onChange={(e) => onChange('connection', e.target.value)} /></Field>
          <Field label="Match Key" hint="Field both sides are keyed on"><input className={inputCls} placeholder="trade_id" value={c.key} onChange={(e) => onChange('key', e.target.value)} /></Field>
        </>)}

        {node.type === 'classify' && (<>
          <Field label="Mode"><Sel value={c.mode} onChange={(v) => onChange('mode', v)} placeholder="Select mode…" options={['NLP (Keyword based)', 'AI', 'NLP + AI']} /></Field>
          <Field label="Shortlisting Keywords" hint="Comma-separated — drive the relevance score"><textarea rows={2} className={inputCls} placeholder="e.g. fx trade settlement, deal reference" value={c.keywords} onChange={(e) => onChange('keywords', e.target.value)} /></Field>
          <Field label="Relevant threshold" hint="Score ≥ this → RELEVANT"><input className={inputCls} placeholder="0.7" value={c.relevant} onChange={(e) => onChange('relevant', e.target.value)} /></Field>
          <Field label="Ambiguous threshold" hint="Score in this band → AMBIGUOUS (held for review)"><input className={inputCls} placeholder="0.3" value={c.ambiguous} onChange={(e) => onChange('ambiguous', e.target.value)} /></Field>
        </>)}

        {node.type === 'extract' && (<>
          <Field label="Input Source" hint="Upstream node or a file/folder"><input className={inputCls} placeholder="from upstream" value={c.input} onChange={(e) => onChange('input', e.target.value)} /></Field>
          <Field label="File Formats" hint="Comma-separated"><input className={inputCls} placeholder=".eml,.xlsx,.csv" value={c.formats} onChange={(e) => onChange('formats', e.target.value)} /></Field>
          <Field label="Fields to Extract" hint="Comma-separated field names"><textarea rows={3} className={inputCls} placeholder="trade_id, …" value={c.fields} onChange={(e) => onChange('fields', e.target.value)} /></Field>
          <Field label="Method"><Sel value={c.method} onChange={(v) => onChange('method', v)} placeholder="Select method…" options={['NLP Pattern Matching', 'Regex Rules', 'AI Extraction']} /></Field>
        </>)}

        {node.type === 'match' && (<>
          <div className="flex items-start gap-2 p-3 bg-amber-50 border-l-2 border-amber-400 rounded text-[11px] text-amber-700">Reconcile each extracted trade against the golden source — populate missing fields and flag breaks with a confidence score.</div>
          <Field label="Golden Source"><Sel value={c.golden} onChange={(v) => onChange('golden', v)} placeholder="Select source…" options={['Master Blotter', 'GLOSS API', 'OBI', 'FO Systems', 'Connected node']} /></Field>
          <Field label="Match Fields" hint="Compared for agreement (rest are fill-only)"><textarea rows={2} className={inputCls} placeholder="asset, counterparty, notional, …" value={c.fields} onChange={(e) => onChange('fields', e.target.value)} /></Field>
          <Field label="Tolerance (%)" hint="Numeric agreement tolerance"><input className={inputCls} placeholder="1" value={c.tolerance} onChange={(e) => onChange('tolerance', e.target.value)} /></Field>
          <Field label="Populate missing fields"><Radio value={c.fill} options={['Yes', 'No']} onChange={(v) => onChange('fill', v)} /></Field>
          <Field label="Confidence scoring"><Radio value={c.scoring} options={['Yes', 'No']} onChange={(v) => onChange('scoring', v)} /></Field>
        </>)}

        {node.type === 'router' && (<>
          <div className="flex items-start gap-2 p-3 bg-brand-50 border-l-2 border-brand-400 rounded text-[11px] text-brand-700">Reference a field from a previous node and route into one or more branches.</div>
          <Field label="Field Reference" hint="e.g. confidence_score"><input className={inputCls} placeholder="field name" value={c.field} onChange={(e) => onChange('field', e.target.value)} /></Field>
          <Field label="Operator"><Sel value={c.operator} onChange={(v) => onChange('operator', v)} placeholder="Select operator…" options={['> Greater than', '>= Greater or equal', '< Less than', '<= Less or equal', '== Equal', '!= Not equal']} /></Field>
          <Field label="Value"><input className={inputCls} placeholder="threshold" value={c.value} onChange={(e) => onChange('value', e.target.value)} /></Field>
          <Field label="Branches" hint="Each branch is its own output port — drag it to a node.">
            <div className="space-y-2">
              {branches.map((b, i) => (
                <div key={b.id} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: b.color }} />
                  <input className={inputCls} placeholder={`Branch ${i + 1} condition`} value={b.label} onChange={(e) => setBranches(branches.map((x) => (x.id === b.id ? { ...x, label: e.target.value } : x)))} />
                  {branches.length > 1 && (
                    <button onClick={() => setBranches(branches.filter((x) => x.id !== b.id))} className="w-6 h-6 rounded flex items-center justify-center text-neutral-400 hover:text-red-600 hover:bg-red-50 flex-shrink-0" title="Remove branch">
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
                    </button>
                  )}
                </div>
              ))}
              <button onClick={() => setBranches([...branches, { id: bid(), label: '', color: PALETTE[branches.length % PALETTE.length] }])}
                className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" /></svg>
                Add branch
              </button>
            </div>
          </Field>
        </>)}

        {node.type === 'review' && (<>
          <Field label="Assign To"><input className={inputCls} placeholder="name@company.com" value={c.assignee} onChange={(e) => onChange('assignee', e.target.value)} /></Field>
          <Field label="Role (RBAC)"><Sel value={c.role} onChange={(v) => onChange('role', v)} placeholder="Select role…" options={['Settlements Reviewer', 'Settlements Approver', 'Operations Analyst']} /></Field>
          <Field label="Subject"><input className={inputCls} placeholder="Subject line" value={c.subject} onChange={(e) => onChange('subject', e.target.value)} /></Field>
          <Field label="Instructions"><textarea rows={3} className={inputCls} placeholder="What the reviewer should do…" value={c.content} onChange={(e) => onChange('content', e.target.value)} /></Field>
          <div className="flex items-start gap-2 p-3 bg-pink-50 border-l-2 border-pink-400 rounded text-[11px] text-pink-700">Workflow pauses here until a human approves / rejects / overrides via the review interface.</div>
        </>)}

        {node.type === 'action' && (<>
          <Field label="Action Type"><Sel value={c.type} onChange={(v) => onChange('type', v)} placeholder="Select action…" options={['ServiceNow (NEWS)', 'Draft Response Email', 'Store Record', 'EMODEST Broadcast']} /></Field>
          <Field label="Target" hint="Queue, recipient, or table"><input className={inputCls} placeholder="e.g. Settlements queue" value={c.target} onChange={(e) => onChange('target', e.target.value)} /></Field>
          <Field label="Template / Content"><textarea rows={3} className={inputCls} placeholder="Template name or message…" value={c.template} onChange={(e) => onChange('template', e.target.value)} /></Field>
        </>)}

        {node.type === 'feedback' && (<>
          <div className="flex items-start gap-2 p-3 bg-lime-50 border-l-2 border-lime-500 rounded text-[11px] text-lime-700">Capture human decisions into memory so the agents recalibrate over time.</div>
          <Field label="Memory Store"><Sel value={c.store} onChange={(v) => onChange('store', v)} placeholder="Select store…" options={['Long-term memory', 'Vector DB']} /></Field>
          <Field label="Captures"><input className={inputCls} placeholder="HITL decisions, overrides…" value={c.captures} onChange={(e) => onChange('captures', e.target.value)} /></Field>
          <Field label="Applies To"><Sel value={c.applies} onChange={(v) => onChange('applies', v)} placeholder="Select target…" options={['Triage Classifier', 'Compare & Match', 'Both']} /></Field>
        </>)}
      </div>

      <div className="px-5 py-4 border-t border-neutral-150 flex items-center justify-between flex-shrink-0">
        <button onClick={onDelete} className="text-xs font-medium text-red-600 hover:text-red-700">Delete block</button>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-3.5 py-2 text-xs font-medium text-neutral-600 bg-white border border-neutral-200 rounded-md hover:bg-neutral-50">Cancel</button>
          <button onClick={onClose} className="px-3.5 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-md">Save</button>
        </div>
      </div>
    </aside>
  );
}

function Radio({ value, options, onChange }) {
  return (
    <div className="flex items-center gap-5 pt-1">
      {options.map((o) => (
        <label key={o} className="flex items-center gap-2 cursor-pointer text-sm text-neutral-700">
          <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${value === o ? 'border-brand-600' : 'border-neutral-300'}`}>
            {value === o && <span className="w-2 h-2 rounded-full bg-brand-600" />}
          </span>
          <input type="radio" className="sr-only" checked={value === o} onChange={() => onChange(o)} />
          {o}
        </label>
      ))}
    </div>
  );
}
