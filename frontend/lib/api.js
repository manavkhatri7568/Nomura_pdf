const BASE = '/api/backend';

async function call(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE}${path}`, opts);

  // Parse JSON — if it fails, surface the HTTP status text
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`HTTP ${res.status} — ${res.statusText || 'no response body'}`);
  }

  // Envelope error (backend returned status:"error")
  if (json.status === 'error') {
    throw new Error(json.error?.message || 'Unknown API error');
  }

  // FastAPI native errors: {"detail": "Not Found"} or {"detail": [...validation...]}
  if (!res.ok) {
    const detail = json.detail;
    const msg =
      typeof detail === 'string'       ? detail :
      Array.isArray(detail)            ? detail.map(d => d.msg ?? d).join('; ') :
      typeof detail === 'object' && detail?.message ? detail.message :
      `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return json.data;
}

export const api = {
  health: () => call('GET', '/health'),

  fetchEmails: (source = 'local') =>
    call('POST', '/connector/fetch', { source }),

  previewEmail: (source, message_id) =>
    call('POST', '/connector/preview', { source, message_id }),

  runPipeline: (source = 'local') =>
    call('POST', '/agent/run', { source }),

  listCases: () => call('GET', '/storage/cases'),
  getCase:   (tradeId) => call('GET', `/storage/cases/${encodeURIComponent(tradeId)}`),
  getStats:  () => call('GET', '/storage/stats'),

  // Trade rows parsed from stored xlsx/csv attachments (one row per trade).
  getExtractedTrades: () => call('GET', '/extract/trades'),

  classify: (subject, body) =>
    call('POST', '/classifier/classify', { subject, body }),

  // Runtime classifier configuration (keywords, weights, thresholds)
  getConfig:    () => call('GET', '/config'),
  updateConfig: (patch) => call('PUT', '/config', patch),
  resetConfig:  () => call('POST', '/config/reset'),
};
