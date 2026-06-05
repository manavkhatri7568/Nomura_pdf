# Email Agent — Nomura SSG Agentic AI POC (Phase 1)

Triages a noisy shared mailbox of FX-settlement emails: keeps the real trade
emails, discards office noise, flags ambiguous ones for review, deduplicates by
trade ID, and writes one structured case folder + `manifest.json` per trade as
the handoff to a (future) extraction phase.

Two ways to run it:

* **Batch pipeline** — pure Python standard library, reads `.eml` files from a
  local folder.
* **Service layer** — a FastAPI **mock Microsoft Graph API** plus an **Email
  Agent API** that reads from the Graph source over HTTP. The production swap to
  real Microsoft Graph is a base-URL + credentials change only.

## Quick start

```bash
pip install -r requirements.txt

# Batch
python tools/generate_test_emails.py --clean   # create the synthetic inbox
python demo.py                                  # run + prove deduplication

# Tests
python -m pytest                                # 38 tests

# Services (two processes; the API calls the mock over HTTP)
python -m uvicorn mock_graph.app:app --port 8001
GRAPH_BASE_URL=http://localhost:8001 python -m uvicorn api.app:app --port 8000
```

API docs at `http://localhost:8000/docs`. Endpoint reference: [`SERVICES.md`](SERVICES.md).

## Architecture

```
            source = local | graph
                     │
 LocalEmailConnector │ GraphConnector ─HTTP─▶ Mock Graph API (mock_graph/)
        └────────────┴────────────┘
                     ▼
   RuleClassifier ─▶ FileStore + DBIndex ─▶ case folder + manifest.json
   (score & label)   (write + SQLite dedup)
```

* **Classifier** — deterministic keyword/regex scoring, no LLM. Asset keywords
  (subject+body, +0.5), subject keywords (subject only, +0.3), trade-ID regex
  (+0.2); `≥0.7` RELEVANT, `0.3–0.7` AMBIGUOUS, `<0.7` IRRELEVANT; a
  hard-negative early exit drops obvious noise.
* **Dedup** — SQLite guards on `message_id` (already processed) and `trade_id`
  (duplicate trade); `INSERT OR IGNORE` makes every run idempotent.
* **API** — every module is an endpoint, each returning a uniform
  success/failure envelope with a `correlation_id`.
* **Logging** — a developer log plus a separate append-only **audit log**
  (one JSON event per business action, tagged with the request correlation id).

## Configuration

Paths and Graph settings are environment-overridable — see `config/settings.py`
and the table in [`SERVICES.md`](SERVICES.md). No real credentials live in the
repo; the mock uses placeholder values.

The **classifier itself is tunable at runtime** via the `/config` API (and the
Schedules screen in the UI): keyword lists, scoring weights and thresholds can be
edited live — no restart — validated, persisted to `data/runtime_config.json`,
and audited. Edits take effect on the next pipeline run, so changing a keyword
visibly changes which emails are classified RELEVANT.

## Status

Rule-based and deterministic by design. An LLM fallback for the AMBIGUOUS bucket
and an attachment-content extractor are planned, not yet built — attachment
bytes are currently stored raw.
