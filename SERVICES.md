# Email Agent — Service Layer

Two FastAPI services. The **mock Graph API** stands in for Microsoft Graph in
dev; the **Email Agent API** exposes every pipeline module as an endpoint and
reads email from either the local `.eml` folder or the Graph source.

```
┌──────────────┐    HTTP (OAuth2 + Graph v1.0)    ┌─────────────────────┐
│  Email Agent │ ───────────────────────────────▶ │  Mock Microsoft     │
│  API  :8000  │   token / messages / attachments  │  Graph API   :8001  │
└──────────────┘                                   └─────────────────────┘
        │                                                     ▲
        │ classify · run · storage                            │ parses .eml at startup
        ▼                                                     │
   case folders + manifest.json                         data/raw_emails/inbox
```

## Install & run

```powershell
cd email_agent
pip install -r requirements.txt

# Terminal 1 — mock Graph
python -m uvicorn mock_graph.app:app --port 8001

# Terminal 2 — agent API (point it at the mock)
$env:GRAPH_BASE_URL="http://localhost:8001"
python -m uvicorn api.app:app --port 8000
```

Interactive docs: `http://localhost:8000/docs` and `http://localhost:8001/docs`.

## Email Agent API (`:8000`)

Every response is the uniform envelope:

```json
{ "status": "success",
  "data": { ... },
  "error": null,
  "correlation_id": "uuid",
  "timestamp": "2026-05-27T07:03:50Z" }
```

On failure, `status` is `"error"`, `data` is `null`, and `error` is
`{ "code", "message" }` — including for validation (422) and not-found (404).
Send `X-Correlation-ID` to thread your own id through the logs and audit trail;
otherwise one is generated and returned in the `X-Correlation-ID` header.

| Method & path | Purpose |
|---|---|
| `GET  /health` | Liveness + configured source / Graph URL |
| `POST /classifier/classify` | Classify `{subject, body}` → label/confidence/reason/trade_id |
| `POST /connector/fetch` | Fetch (no store) from `{source: local\|graph}` → email summaries |
| `POST /agent/run` | Run the full pipeline from `{source}` → `RunStats` |
| `POST /connector/preview` | Single email with full body by `{source, message_id}` (404 if absent) |
| `GET  /storage/cases` | List stored cases + counts by status |
| `GET  /storage/cases/{trade_id}` | One case + its `manifest.json` + body excerpt (404 if absent) |
| `GET  /storage/stats` | Case totals by status |
| `GET  /config` | Current tunable classifier config (keywords, weights, thresholds) |
| `PUT  /config` | Partial update — applied live (no restart), validated, persisted, audited |
| `POST /config/reset` | Restore code/env defaults |

```bash
curl -s localhost:8000/agent/run -H 'content-type: application/json' -d '{"source":"graph"}'
curl -s localhost:8000/classifier/classify -H 'content-type: application/json' \
     -d '{"subject":"FX Trade Settlement[FXOPT-2026-00047]","body":"Settlement Instructions ..."}'

# Tune the classifier live, then re-run to see the split change:
curl -s -X PUT localhost:8000/config -H 'content-type: application/json' \
     -d '{"asset_keywords":["fx trade settlement","deal reference","ssi verification"]}'
```

## Mock Graph API (`:8001`)

Faithful to Graph v1.0 field names so the `GraphConnector` is portable to
production with only a base-URL + credentials change.

| Method & path | Notes |
|---|---|
| `POST /{tenant}/oauth2/v2.0/token` | client-credentials grant → `access_token` |
| `GET  /v1.0/users/{mailbox}/messages` | list; `$top`/`$skip` paging → `@odata.nextLink`, `$select`, `$count` |
| `GET  /v1.0/users/{mailbox}/mailFolders/{folder}/messages` | same, folder-scoped |
| `GET  /v1.0/users/{mailbox}/messages/{id}` | single message; `$expand=attachments` |
| `GET  /v1.0/users/{mailbox}/messages/{id}/attachments` | attachment list (base64 `contentBytes`) |
| `GET  /v1.0/users/{mailbox}/messages/{id}/attachments/{aid}` | single attachment |

Bearer auth is enforced on `/v1.0` routes (401 when missing). Send
`Prefer: outlook.body-content-type="text"` to get a plain-text body.

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `GRAPH_BASE_URL` | `http://localhost:8001` | Graph endpoint the API/connector calls |
| `GRAPH_MAILBOX` | `mo-team@nomura.com` | Mailbox to read |
| `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` | mock values | OAuth2 client-credentials |
| `EMAIL_SOURCE` | `local` | Default source when unspecified |
| `EMAIL_INBOX_PATH` | `data/raw_emails/inbox` | `.eml` folder (local source + mock source) |
| `EMAIL_PROCESSED_PATH` / `EMAIL_DB_PATH` / `EMAIL_LOG_DIR` / `EMAIL_AUDIT_LOG_DIR` | under `data/` & `logs/` | Write targets |

**Production swap:** point `GRAPH_BASE_URL` at `https://graph.microsoft.com`,
set real tenant/client/secret, and the same `GraphConnector` works unchanged.

## Logs

- **Developer log** — `logs/email_agent_<date>.log` (+ console): human-readable,
  level-gated, for debugging the logical flow.
- **Audit log** — `logs/audit_<date>.log`: append-only JSON, one event per
  business action (`agent.run.start/complete`, `email.classified`,
  `case.stored`, `api.request`), each tagged with the request `correlation_id`.
  In production these ship to a WORM store / SIEM rather than a local file.
