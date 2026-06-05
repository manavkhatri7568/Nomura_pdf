# Agentic Capabilities — Email Triage & Trade Extraction
### Nomura SSG · Agentic AI Proof of Concept (Phase 1)

A working, end-to-end system that watches a shared FX/OTC settlement mailbox, **automatically separates real trade-settlement emails from office noise**, **deduplicates by trade**, and **extracts the individual trades** — from both the email body and its Excel/CSV attachments — into a clean, structured **trade register** ready for the next stage of automation.

This document is the single source of truth for **what has actually been built so far**. It is written for two audiences:

| If you are… | Read… |
|---|---|
| **Business / operations / leadership** | §1 Executive Summary · §2 The Problem · §3 What It Does · §4 Demo Walkthrough · §13 What's Built vs Not · §14 Roadmap |
| **Technical / engineering** | §5 Architecture onwards (agent, classifier, extractor, storage, API, frontend, running, testing) |

> Scope note: This describes **Phase 1 — the Email Agent**. It is a proof of concept running on **synthetic, non-production data** that mirrors the real settlement-email shapes. Forward-looking items are clearly marked in §14.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [The Business Problem](#2-the-business-problem)
3. [What the Platform Does](#3-what-the-platform-does)
4. [Demo Walkthrough](#4-demo-walkthrough)
5. [System Architecture](#5-system-architecture)
6. [The Agent — the SPAR Loop](#6-the-agent--the-spar-loop)
7. [The Classification Engine](#7-the-classification-engine)
8. [Attachment Extraction (Excel / CSV)](#8-attachment-extraction-excel--csv)
9. [Storage, Deduplication & the Phase-2 Handoff](#9-storage-deduplication--the-phase-2-handoff)
10. [The Service Layer — Mock Graph & the Dev↔Prod Swap](#10-the-service-layer--mock-graph--the-devprod-swap)
11. [The Agent API & Observability](#11-the-agent-api--observability)
12. [The Frontend](#12-the-frontend)
13. [What's Built vs Not Built](#13-whats-built-vs-not-built)
14. [How We Proceed Further (Roadmap)](#14-how-we-proceed-further-roadmap)
15. [Running the System](#15-running-the-system)
16. [Testing & Quality](#16-testing--quality)
17. [Project Structure](#17-project-structure)
18. [Glossary](#18-glossary)

---

## 1. Executive Summary

**The pain.** A Middle-Office settlement team shares a single mailbox. Into it flow genuine FX/OTC trade-settlement notifications — each needing timely action — mixed with a constant stream of office noise (IT tickets, newsletters, calendar invites, birthday emails). A person has to read every message, decide what is a real trade, open attachments, copy trade details into downstream systems, and avoid acting twice on the same trade. It is slow, repetitive, error-prone, and does not scale.

**What we built.** An **AI agent** that does the first mile of that work automatically and explainably:

1. **Connects** to the mailbox (today: a folder of `.eml` files or a mock Microsoft Graph API that is field-identical to the real one).
2. **Classifies** every email — *Relevant*, *Ambiguous* (held for a human), or *Irrelevant* — using transparent, tunable rules (no black-box model).
3. **Extracts** the trades — pulling structured fields out of both the email body **and** its Excel/CSV attachments, where one attachment can contain an entire blotter of 30+ trades.
4. **Deduplicates** by trade ID so the same trade is never processed twice.
5. **Stores** each result as a structured **case folder + manifest** — the clean handoff to the next automation stage.

**The result, on the current demo dataset:** a noisy inbox of **29 emails** is triaged into **14 relevant**, **3 ambiguous (held for review)**, **10 irrelevant**, and **2 duplicates** — and the relevant emails yield an **80-row trade register**, each row tagged with where it came from (email **Body** or **Attachment (xlsx)**).

**Why it matters.** Every decision is **auditable** (an append-only compliance log records who/what/when/outcome), **explainable** (each classification states the keywords and signals that drove it), and **tunable by the business** (an operations user can edit the keywords live and see the classification change). The connector is the *only* thing that changes between this demo and a live production mailbox.

**Maturity.** This is a **proof of concept** with a real backend, a real UI, and **61 automated tests passing**. It is not yet connected to production mailboxes or downstream settlement systems — see §13 and §14.

---

## 2. The Business Problem

Settlement operations in capital markets run on email. Counterparties, custodians, and internal desks send **Standard Settlement Instructions (SSIs)**, trade confirmations, and settlement notifications to shared team mailboxes. For each one, an operations analyst must:

- **Triage** — is this a real trade that needs action, or just noise?
- **Read attachments** — the actual trade economics often live in an Excel or CSV "blotter" attached to a short cover email, not in the email body.
- **Extract** — copy trade ID, counterparty, currency pair, notional, settlement date, etc. into the settlement workflow.
- **De-duplicate** — the same trade can arrive multiple times (original + forward + chase-up); acting twice causes breaks.
- **Escalate** — when something is genuinely unclear, a human must decide; nothing must be silently dropped.

At volume, this is hours of repetitive reading per day, with operational-risk consequences if a real settlement email is missed or a trade is double-booked. **This agent automates the triage and the first-pass extraction, while keeping a human in the loop for the genuinely ambiguous cases.**

---

## 3. What the Platform Does

The product surfaces one core capability — **Classify & Extract** — as a guided, three-step pipeline, plus a **Configure Agents** screen where the business tunes the agent's behaviour.

### The three steps

| Step | What happens | Business value |
|---|---|---|
| **1 · Sync Emails** | Pull all emails from the mailbox (local `.eml` folder or the Graph API). | A live view of the raw inbox — nothing hidden. |
| **2 · Classify** | Score and label every email: **Relevant** / **Ambiguous** / **Irrelevant**, with a reason. Duplicates are flagged. | Cuts the noise; surfaces only what needs action; never silently drops the unclear ones. |
| **3 · Extract Trade Data** | Parse each relevant email + its Excel/CSV attachments into a **trade register** — one row per trade, with a **Source** column. | A clean, structured handoff — the analyst no longer copies fields by hand. |

### The principles that make it trustworthy

- **Explainable, not a black box.** Classification is rule-based scoring. Each result shows the exact signals (keywords, trade-ID match) that produced it. A reviewer can always answer "why was this email kept / dropped?"
- **Human-in-the-loop by design.** Anything that scores in the middle band is labelled **Ambiguous** and **held for human review** — it is logged, never discarded.
- **Idempotent & safe.** Re-running the pipeline never creates duplicates or double-counts a trade. The same trade ID is captured once.
- **Tunable by the business.** On **Configure Agents**, an operations user edits the agent's keyword vocabulary live; the next classification reflects it immediately, with no code change or redeploy.
- **Audit-ready.** Every business action writes a structured, append-only audit event — the trail a risk/compliance function expects.

---

## 4. Demo Walkthrough

The whole stack starts with one double-click of **`launch.bat`**, which opens the app at **http://localhost:3000**.

1. **Login.** A branded sign-in screen (Protiviti). Auth is a placeholder for the PoC — clicking *Sign In* enters the app. The top-right **HP** avatar opens an account menu with **Logout** (returns to this screen and clears the session).

2. **Sync Emails.** Choose the source — **Local (.eml)** or **Graph API** — and Sync. The current inbox shows **29 emails**, a realistic mix of genuine settlement emails and office noise. Click any row to preview the email.

3. **Classify.** Run the classifier. The 29 emails split into:
   - **14 Relevant** — kept for extraction,
   - **3 Ambiguous** — held for human review,
   - **10 Irrelevant** — office noise, dropped,
   - **2 Duplicates** — same trade ID already captured, skipped.
   Each row carries a confidence and a plain-language reason. A run-log drawer shows the agent's reasoning.

4. **Extract Trade Data.** The agent produces an **80-row trade register**:
   - **12 rows** parsed from **email bodies** (single-trade emails) — `Source = Body`,
   - **68 rows** parsed from **Excel attachments** (two "blotter" emails, each carrying ~34 trades) — `Source = Attachment (xlsx)`.
   Columns: Trade ID · UTI · Trade Date · Counterparty · Currency Pair · Buy/Sell · Notional Amount · Notional Ccy · Settlement Date · **Source**. Click any row for the full trade detail (option type, strike, expiry, premium, settlement status, trader, book, and its source file). Search filters across trade ID, UTI, counterparty, and currency pair.

5. **Configure Agents.** The operations view of the agent. Edit the agent's **shortlisting keywords** (which drive classification *live*), the fields-to-extract list, and the sync cadence. Saving applies keyword changes to the running classifier immediately.

> **Demo tip:** delete `data/processed/` and re-run Classify — the agent **self-heals**, rebuilding every case folder and manifest from scratch. This is the "clean run" you can showcase repeatedly.

---

## 5. System Architecture

The system is two cooperating tiers: a **Python backend** (the agent + its API + a mock of Microsoft Graph) and a **Next.js frontend**. They are deliberately decoupled — the backend is fully usable from the command line or via HTTP without the UI.

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Browser — Next.js UI (:3000)                  │
│   Login → Classify & Extract (Sync → Classify → Extract)               │
│           Configure Agents · Settings                                  │
└───────────────┬──────────────────────────────────────────────────────┘
                │  /api/backend/*   (Next.js rewrite proxy → :8000, no CORS)
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       Agent API — FastAPI (:8000)                      │
│  /classifier  /connector  /agent  /storage  /config  /extract  /health │
│  correlation-id middleware · developer log · audit log · uniform JSON   │
└───────┬───────────────────────────────────────────────┬───────────────┘
        │ source = local                                 │ source = graph
        ▼                                                ▼
┌────────────────────┐                       ┌────────────────────────────────┐
│ LocalEmailConnector │                      │ GraphConnector (OAuth2 + paging) │
│  reads .eml inbox   │                      │   → Mock Graph API (:8001)        │
└────────┬───────────┘                       │     ≡ Microsoft Graph v1.0 shape  │
         │                                    └────────────────────────────────┘
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  EmailAgentRunner  —  SPAR loop                         │
│   Sense → Plan → Act → Reflect                                         │
│   RuleClassifier  +  AttachmentExtractor  →  FileStore  +  DBIndex      │
└───────┬───────────────────────────────────────────────┬───────────────┘
        ▼                                                 ▼
  data/processed/<case>/                            data/email_index.db
   ├ manifest.json   (Phase-2 contract)              (SQLite: dedup +
   ├ email_body.txt                                   case tracking)
   ├ attachments/<files>
   └ extracted_trades.json
```

**Design choices that matter:**

- **No orchestration framework.** The agent is plain Python — a readable SPAR loop with **constructor-injected** components (connector, classifier, store, index). Each piece is independently testable and replaceable.
- **The connector is the only dev↔prod seam.** Local `.eml` reading and live Microsoft Graph both produce the *same* uniform email dict. Everything downstream is identical. Going live is a base-URL + credentials change.
- **Frontend ↔ backend over a proxy.** Next.js rewrites `/api/backend/*` to the API on `:8000`, so the browser makes same-origin calls — no CORS configuration.
- **Single config object.** All tunables (keywords, weights, thresholds, paths, Graph settings) live in one `EmailAgentConfig` dataclass, env-overridable, runtime-editable.

---

## 6. The Agent — the SPAR Loop

The heart of the system is `agent/email_agent.py` → `EmailAgentRunner`. It implements a classic agent loop, **SPAR**:

| Phase | What it does |
|---|---|
| **Sense** | Fetch all emails from the injected connector into a uniform list. |
| **Plan** | For each email, decide the path: already-processed? → skip (or self-heal). New? → classify. |
| **Act** | Classify → for *Relevant* emails, deduplicate, store the case (body + metadata + attachments + extracted trades + manifest), and index it. |
| **Reflect** | Log a structured run summary and write audit events for the whole run. |

**Why this is an "agent" and not a script:** it senses its environment (the live mailbox), makes labelled decisions with reasons, takes consequential actions (persisting cases), and reflects on the outcome — all idempotently, so it can run on a schedule against a changing inbox and converge to the correct state every time.

**Notable behaviours:**

- **Idempotent re-runs.** Before acting, the runner checks the SQLite index. An already-processed email is skipped; a trade ID already captured is skipped as a duplicate. `INSERT OR IGNORE` guarantees the index never duplicates.
- **Self-heal.** If a case was recorded in the index but its folder is missing on disk (e.g. someone deleted `data/processed/` for a demo reset), the runner **recreates** the folder, attachments, extracted trades, and manifest at its original path — and emits a `case.restored` audit event. A run always (re)produces a complete, consistent case store.
- **Collision-free fallback IDs.** A blotter email carries its trade IDs only inside the attachment, so the subject yields none. Rather than a naïve `message_id[:8]` (which collides across Outlook emails sharing a server prefix), the runner hashes the full message ID into a stable `UNKNOWN_<10-hex>` id — unique per email, identical across re-runs.

---

## 7. The Classification Engine

`classifier/rule_classifier.py` → `RuleClassifier`. Deterministic, transparent **additive scoring** — no LLM, no training data, no opacity. Every weight, keyword, and threshold lives in `EmailAgentConfig` and is editable at runtime.

### How an email is scored

Three signal groups contribute to a score, and the **place each is matched is deliberately asymmetric**:

| Signal | Matched against | Weight | Rationale |
|---|---|---|---|
| **Asset keywords** (`"settlement instructions"`, `"deal reference"`, `"fx trade settlement"`, …) | subject **and** body | **+0.5** | Specific FX-settlement phrases that generic noise never contains — the strong signal. |
| **Subject keywords** (`"settlement"`, `"confirm"`, `"trade"`, `"swift"`, …) | subject **only** | **+0.3** | Topical hints, but only meaningful in the subject line. |
| **Trade-ID regex** (primary: `FXOPT-\d{4}-\d{5}`) | subject + first 2000 body chars | **+0.2** | The presence of a real deal reference. |

### From score to decision

```
score ≥ 0.70                →  RELEVANT     (kept, stored)
0.30 ≤ score < 0.70         →  AMBIGUOUS    (held for human review, logged)
score < 0.30               →  IRRELEVANT   (dropped)
```

A **hard-negative early exit** runs first: if the email contains any *negative keyword* (`"happy birthday"`, `"it support"`, `"out of office"`, `"newsletter"`, …) **and** no asset keyword at all, it is immediately `IRRELEVANT` with high confidence — office noise never wastes further scoring.

Each `Classification` returns the **label, confidence, a human-readable reason, the matched keywords, and any extracted trade ID** — which is exactly what the UI shows and what the audit log records.

### Worked examples (current demo)

- *"FX Trade Settlements_FXOPT_270526"* (cover email for an Excel blotter) → asset hit (`fx trade settlement`) +0.5, subject hits +0.3 = **0.8 → RELEVANT**.
- *"Settlement query – account reconciliation"* → subject hit only (`settlement`) +0.3, no asset phrase = **0.3 → AMBIGUOUS**, held for review.
- *"Happy Birthday from the team!"* → negative keyword, no asset signal = **IRRELEVANT** (early exit).

### Tunable live

The keyword lists, weights, and thresholds are not constants in code — they are read from a live config object that the **Configure Agents** screen edits via the API. Add `"office picnic"` to the asset keywords and re-classify, and an email that was irrelevant becomes relevant — no redeploy. This is the "business owns the rules" story.

---

## 8. Attachment Extraction (Excel / CSV)

Real settlement emails follow a pattern the synthetic single-trade emails did not: a **short cover note in the body** ("please find attached…") with the actual trades as a **table in an attachment** — one row per trade, often 30+ trades in a single file (a "blotter"). `agent/attachment_extractor.py` turns those tables into normalized trade rows.

### What it handles

- **Excel** (`.xlsx`, `.xlsm`) via `openpyxl` (read-only, data-only).
- **CSV** via the Python standard library.
- **PDF is intentionally out of scope** here (the sample SSI PDFs are vector-rendered with no text layer and would need OCR — a separate workstream; see §14).

### How it is engineered for robustness

- **Never raises.** Every failure path (unsupported type, unreadable file, empty sheet) returns a structured `ExtractionResult` with a `status` (`success` / `empty` / `unsupported` / `error`) and an empty trade list. One bad attachment can never break the batch.
- **Header auto-detection.** It scans the first rows and picks the one mapping the most known columns, tolerating a title/logo/banner row sitting above the real headers.
- **Column mapping.** A normalization map turns many header spellings (`"Counterparty Name"`, `"Cpty"`; `"Buy / Sell"`, `"Direction"`; `"Value Date"`, `"Settlement Date"`) into a single canonical field set. Unmapped columns are reported, never silently dropped.
- **Source-agnostic value normalization.** This is the key correctness property: a CSV cell (always a string, e.g. `"897,327.00"`, `"29-May-26"`) and the equivalent native Excel value (a number `897327`, a `datetime`) normalize to the **same** canonical value (`897327`, `29-May-2026`). Downstream comparison never has to care whether a trade came from a spreadsheet or a CSV — or, later, an email body.

### Served to the UI

The **Extract Trade Data** step combines two sources into one register:

1. **Attachment trades** — from `GET /extract/trades`, which reads each relevant case's stored attachments and parses every `.xlsx`/`.csv` into rows. Each trade is tagged `source: "Attachment (xlsx)"`.
2. **Body trades** — parsed from relevant emails that have **no** spreadsheet attachment (so a blotter email is never also parsed from its body), tagged `source: "Body"`.

The two are **merged, de-duplicated by trade ID** (attachment preferred on any collision, as a safety net), and **sorted** into one clean register. The **Source** column makes the provenance of every row explicit.

> **On the demo data:** the body emails carry trade IDs `FXOPT-2026-00047…00058`; the two Excel blotters carry `00001…00034` and `00067…00100`. There is **no overlap**, so the 80-row register (12 Body + 68 Attachment) has zero clashes. (An earlier CSV file spanning `00035…00066` overlapped the body range and was removed from the demo inbox precisely to keep the register clean.)

---

## 9. Storage, Deduplication & the Phase-2 Handoff

Every **Relevant** email becomes a self-contained **case** on disk, plus a row in a SQLite index.

### The case folder

```
data/processed/{trade_id}_{asset_class}_{YYYYMMDD}/
├── email_body.txt          the raw email body
├── email_metadata.json     sender, subject, received, source file, classification
├── manifest.json           the Phase-2 contract (see below)
├── attachments/            every attachment, saved byte-for-byte
│   └── FX_Options_trade_270526.xlsx
└── extracted_trades.json   normalized trade rows parsed from the attachments
```

The folder date is the **processing date**, not the email date. Emails with no extractable trade ID get a stable `UNKNOWN_<hash>` id and are **not** deduplicated (a blotter email is a batch, not a single trade).

### `manifest.json` — the contract to the next stage

The manifest is the deliberate, stable handoff to a future Phase-2 extraction/settlement agent. It contains the trade ID, asset class, message ID, subject, sender, paths, the full attachment list (with per-attachment extraction status and trade counts), the classification block (label, confidence, reason), the extraction summary (count, trade IDs, by-attachment breakdown), and `ready_for_extraction: true`.

### The SQLite index (`data/email_index.db`)

A single `email_cases` table tracks every processed email: message ID, trade ID, asset class, subject, sender, classification label/confidence, case folder, attachment count, status. It powers two idempotency guards:

- `message_id_exists` → skip an already-processed email.
- `trade_id_exists` → skip a different email carrying an already-captured trade (a duplicate).

It also backs the `/storage/cases`, `/storage/cases/{trade_id}`, and `/storage/stats` endpoints that the UI reads.

---

## 10. The Service Layer — Mock Graph & the Dev↔Prod Swap

In production, the mailbox is **Microsoft 365 / Outlook**, read via the **Microsoft Graph API**. To build and demo without a tenant, the project ships a **mock Graph service** that replicates the real Graph mail surface with **identical field names**.

### Mock Graph API (`mock_graph/`, port 8001)

A FastAPI service that mirrors Microsoft Graph v1.0:

- **OAuth2 client-credentials** token endpoint (returns a bearer token).
- **Bearer-authenticated** `/v1.0/users/{mailbox}/messages` with `$top`/`$skip` paging and `@odata.nextLink`, `$select`, `$expand`, and the `Prefer` header for body type.
- **Attachments** endpoint returning base64 `contentBytes`.
- `eml_to_graph.py` parses the inbox `.eml` files into Graph-shaped records at startup, so the mock serves the *same* emails the local connector reads.

### GraphConnector (`connectors/graph_connector.py`)

The production-shaped connector: OAuth2 token → paged message fetch (following `@odata.nextLink`) → per-message attachment fetch (base64-decoded). It emits the **exact same uniform email dict** as the local connector.

### The swap

Because the mock is field-identical to real Graph and the connector output is identical for both sources, **moving from this PoC to a live mailbox is a configuration change** — point `GRAPH_BASE_URL` at `https://graph.microsoft.com`, supply a real tenant ID, client ID, and secret. No classifier, extractor, storage, or UI code changes.

---

## 11. The Agent API & Observability

`api/` is the agent's own FastAPI service (port 8000). **Every pipeline module is an endpoint**, and **every response is the same envelope**, success or failure.

### The uniform envelope

```json
{
  "status": "success",          // or "error"
  "data":   { … },              // payload on success
  "error":  { "code", "message" },  // populated on failure
  "correlation_id": "…",
  "timestamp": "…Z"
}
```

A caller gets one predictable shape for *every* outcome — including validation errors, 404s, and unexpected exceptions, all routed through exception handlers into the same envelope.

### Endpoints

| Method · Path | Purpose |
|---|---|
| `GET /health` | Liveness + the configured source and Graph URL. |
| `POST /classifier/classify` | Classify a single `{subject, body}` — returns label, confidence, reason, signals. |
| `POST /connector/fetch` | Fetch all emails from `{source: local\|graph}`. |
| `POST /connector/preview` | Fetch one email's body by message ID. |
| `POST /agent/run` | Run the full pipeline from `{source}`; returns run stats + the classified list. |
| `GET /storage/cases` | List all stored cases + counts by status. |
| `GET /storage/cases/{trade_id}` | One case + its manifest + body excerpt. |
| `GET /storage/stats` | Case totals by status. |
| `GET /extract/trades` | Trades parsed from all stored xlsx/csv attachments (the trade register). |
| `GET /config` · `PUT /config` · `POST /config/reset` | Read / live-update / reset the tunable classifier config. |

### Two log streams

- **Developer log** (`utils/logger.py`) — human-readable, level-gated, for debugging the logical flow. It reconfigures stdout/stderr to UTF-8 to avoid Windows cp1252 crashes.
- **Audit log** (`utils/audit.py`) — append-only, one JSON object per **business** event (`agent.run.start/complete`, `email.classified`, `case.stored`, `case.restored`, `attachment.extracted`, `api.request`), written to `logs/audit_<date>.log`. Never level-gated. Its field set is a **contract** — built to be shipped to a WORM store / SIEM in production. Treat it as the compliance trail.

Both streams, plus every HTTP response, carry a shared **correlation ID** (honouring an inbound `X-Correlation-ID` or generating one), so a single request can be traced across the developer log, the audit log, and the response header.

---

## 12. The Frontend

A modern single-page application (`frontend/`) that makes the pipeline tangible and gives operations a place to tune the agent.

### Stack

| Layer | Choice |
|---|---|
| Framework | **Next.js 14** (App Router) |
| UI | **React 18** + **Tailwind CSS** (+ PostCSS, autoprefixer) |
| Helpers | `clsx`, `date-fns`, `next/font` (Inter); inline SVG icons |
| State | **React Context + sessionStorage** (no Redux) |
| Backend link | `next.config.js` rewrite: `/api/backend/*` → `http://localhost:8000/*` |

> *No TypeScript — plain JS/JSX, by current choice.* See §14 for the rationale and when revisiting it makes sense.

### Pages

- **Login** (`/login`) — branded sign-in (placeholder auth for the PoC).
- **Classify & Extract** (`/pipeline`) — the three-step pipeline (Sync → Classify → Extract). The flagship screen.
- **Configure Agents** (`/schedules`) — define/edit agents: shortlisting keywords (drive classification live), fields to extract, sync cadence.
- **Settings**, **Match Queue**, **Records** — present as labelled **"coming soon"** placeholders for Phase 2.

### State persistence (a real UX detail)

The pipeline's state (synced emails, classification results, the enriched trade register, the active step) lives in a **React Context provider mounted in the root layout** and mirrored to `sessionStorage`. Because the layout does not unmount on navigation, **moving to Configure Agents and back does not re-sync or re-extract** — and the state even survives a page reload within the session. The enriched trade register is cached keyed to its dataset, so revisiting the Extract step is instant; an explicit **Refresh** re-runs it.

---

## 13. What's Built vs Not Built

Honesty about scope is part of the deliverable.

### ✅ Built and working

- Email ingestion from a **local `.eml` inbox** and from a **mock Microsoft Graph API** (OAuth2, paging, attachments) via a production-shaped `GraphConnector`.
- **Rule-based classification** (Relevant / Ambiguous / Irrelevant) with hard-negative early exit, trade-ID extraction, explainable reasons, and confidence.
- **Deduplication** by message ID and trade ID; idempotent re-runs; self-healing case store.
- **Attachment extraction** from **Excel and CSV** blotters, with header detection, column mapping, and source-agnostic value normalization.
- **Body extraction** of single-trade emails, combined with attachment trades into one register with a **Source** column.
- **Structured case storage** (case folder + `manifest.json` + `extracted_trades.json`) — the Phase-2 contract.
- A full **FastAPI service** (every module an endpoint, uniform envelope, correlation IDs, developer + audit logging).
- **Runtime-tunable configuration** via `/config`, driven from the **Configure Agents** UI (live, persisted to disk).
- A **Next.js UI**: login, the three-step pipeline, configure-agents, persistent pipeline state, account/logout.
- One-command **`launch.bat` / `stop.bat`** orchestration; **61 automated tests** passing.

### ⛔ Not built yet (Phase 2 and beyond)

- **PDF / SSI extraction** — the sample SSI PDFs are vector-rendered (no text layer) and need render-to-image + **OCR**. The xlsx/csv path is done; PDF is deferred by design.
- **Compare & Match** — reconciling extracted trades against a golden source / counterparty SSIs (the "Match Queue").
- **Live Microsoft Graph** connection to a production mailbox (the code is ready; only credentials + base URL are needed).
- **Authentication & RBAC** — login is a placeholder; no real identity, roles, or permissions yet.
- **A scheduler** — `sync_frequency_hours` is captured and shown but no timer runs the pipeline automatically.
- **A backend extraction *agent*** that consumes the editable `extract_fields` list (today that list is persisted but the extracted columns are fixed).
- **Records / persistence UI** for browsing historical cases beyond the current run.

---

## 14. How We Proceed Further (Roadmap)

A pragmatic, value-ordered path from this PoC to a production capability.

### Tier 1 — Close the extraction loop

1. **PDF / SSI extraction (OCR).** Render the SSI PDFs to images and OCR them (Tesseract), then reuse the same normalization layer so PDF trades flow into the identical register with `Source = Attachment (pdf)`. This unlocks the SSI-heavy real mailbox.
2. **A real backend extraction agent.** Move field extraction behind a service that **consumes the editable `extract_fields`** — so editing the fields-to-extract list in *Configure Agents* genuinely changes what is pulled, making that screen fully "live" like the keywords already are.
3. **Compare & Match (the Match Queue).** Reconcile each extracted trade against a golden trade source / counterparty SSIs; surface matches, breaks, and exceptions for an analyst — the natural Phase-2 capability the placeholders point at.

### Tier 2 — Productionize

4. **Go live on Microsoft Graph.** Point `GRAPH_BASE_URL` at real Graph with a tenant/client/secret and process a real (or UAT) mailbox. No downstream code changes.
5. **Authentication & RBAC.** Replace placeholder login with real identity (e.g. Entra ID / SSO) and role-based access for reviewers vs. operators — the natural home is the account menu and the API middleware already in place.
6. **A scheduler.** Run the pipeline on the configured cadence (`sync_frequency_hours`) and notify on new relevant/ambiguous items, turning the agent from on-demand into always-on.

### Tier 3 — Scale & enrich

7. **Optional LLM assist for the ambiguous band.** Keep the deterministic rules as the backbone (auditable, cheap), and use an LLM *only* to help adjudicate the 0.3–0.7 ambiguous emails — with the rule reasons still recorded. This keeps explainability while improving recall on edge cases.
8. **Durable case store & history.** Move from the local SQLite/disk store to a managed database + object store, and build the **Records** UI to browse, search, and audit historical cases.
9. **Observability at scale.** Ship the audit stream to a SIEM/WORM store (Splunk / Microsoft Sentinel) and add metrics/dashboards on volumes, label mix, and extraction yield.

> Each tier is independently shippable. The architecture was built so these slot in **without re-plumbing** — the connector seam, the uniform config, the manifest contract, and the audit log are all already in place.

---

## 15. Running the System

**All backend commands run from inside the project root** (`agentic-workflows/`). Developed on CPython 3.13; targets 3.11+. The core batch pipeline is pure standard library; the service layer + extractor need the dependencies in `requirements.txt` (FastAPI, Uvicorn, httpx, python-multipart, openpyxl, pytest).

### One command (recommended)

```
launch.bat
```

Starts all three services in their own windows — **Mock Graph (:8001)**, **Agent API (:8000)**, **Frontend (:3000)** — installs dependencies on first run, ensures the sample attachment emails are in the inbox, and opens the browser. `stop.bat` frees the three ports.

### Manually

```powershell
# Backend (two processes):
python -m uvicorn mock_graph.app:app --port 8001
$env:GRAPH_BASE_URL="http://localhost:8001"; python -m uvicorn api.app:app --port 8000

# Frontend:
cd frontend
npm install          # first run only
npm run dev          # http://localhost:3000

# Command-line pipeline (no UI, no service layer needed):
python demo.py       # regenerate inbox, run, prove dedup
python main.py       # single run against the current inbox
python tools/generate_test_emails.py --clean   # rebuild the synthetic inbox
```

### Configuration (environment-overridable)

| Variable | Purpose |
|---|---|
| `EMAIL_INBOX_PATH` · `EMAIL_PROCESSED_PATH` · `EMAIL_DB_PATH` · `EMAIL_LOG_DIR` · `EMAIL_AUDIT_LOG_DIR` · `EMAIL_CONFIG_PATH` | Pipeline paths. |
| `GRAPH_BASE_URL` · `GRAPH_TENANT_ID` · `GRAPH_CLIENT_ID` · `GRAPH_CLIENT_SECRET` · `GRAPH_MAILBOX` · `GRAPH_FOLDER` | Graph / mock-Graph connection. |
| `EMAIL_SOURCE` | Default source (`local` / `graph`). |

---

## 16. Testing & Quality

**61 automated tests**, all passing (`python -m pytest` from the project root):

| Suite | Tests | Covers |
|---|---|---|
| `test_api.py` | 11 | The full API surface end-to-end (classify, fetch, run, storage, self-heal) over real HTTP. |
| `test_config.py` | 12 | Runtime config: validation, live re-classification after a keyword edit, persistence, reset. |
| `test_attachment_extractor.py` | 11 | The extractor unit logic: header detection, normalization, status paths. |
| `test_extract.py` | 11 | The extractor + the `/extract/trades` endpoint (CSV/XLSX parity, PDF ignored, dedup). |
| `test_mock_graph_api.py` | 8 | The mock Graph response shape vs. real Graph (paging, `$select`, attachments). |
| `test_graph_connector.py` | 4 | The `GraphConnector` over a genuine HTTP round-trip to the mock. |
| `test_eml_to_graph.py` | 4 | `.eml` → Graph-record conversion. |

The test harness redirects all write paths to a temp dir, regenerates the deterministic synthetic inbox once per session, and runs the **mock Graph service as a real Uvicorn server** in a background thread so the synchronous `GraphConnector` exercises true HTTP. The pipeline tests assert the known classification split and idempotency on re-run.

---

## 17. Project Structure

```
agentic-workflows/
├── agent/
│   ├── email_agent.py            EmailAgentRunner — the SPAR loop
│   └── attachment_extractor.py   xlsx/csv blotter parsing + normalization
├── classifier/
│   └── rule_classifier.py        scoring, thresholds, trade-ID extraction
├── connectors/
│   ├── local_connector.py        read .eml inbox → uniform dict
│   └── graph_connector.py        Microsoft Graph (OAuth2, paging, attachments)
├── storage/
│   ├── file_store.py             case folders, body, attachments, manifest, trades
│   └── db_index.py               SQLite dedup + case index
├── config/
│   ├── settings.py               EmailAgentConfig — all tunables
│   └── config_store.py           live, validated, persisted config edits
├── api/
│   ├── app.py                    FastAPI: middleware, exception handlers, routers
│   ├── deps.py                   DI: config store, connector factory
│   ├── models.py                 the uniform Envelope + request models
│   └── routers/                  classifier · connector · agent · storage · config · extract
├── mock_graph/
│   ├── app.py                    mock Microsoft Graph v1.0 service
│   └── eml_to_graph.py           .eml → Graph-shaped records
├── utils/
│   ├── logger.py                 developer logging (UTF-8 safe)
│   └── audit.py                  append-only compliance audit log
├── frontend/                     Next.js 14 app (App Router, JS/JSX, Tailwind)
│   ├── app/                      login · pipeline · schedules · settings · …
│   ├── components/               layout · pipeline steps · ui kit
│   └── lib/                      api client · pipeline context
├── tools/generate_test_emails.py synthetic inbox generator (stdlib only)
├── data/                         raw_emails/inbox · processed/ · email_index.db · samples
├── tests/                        61 tests
├── demo.py · main.py             CLI entry points
├── launch.bat · stop.bat         one-command orchestration
├── requirements.txt · pytest.ini
└── README.md · SERVICES.md · DOCUMENTATION.md
```

---

## 18. Glossary

| Term | Meaning |
|---|---|
| **FX** | Foreign Exchange. |
| **OTC** | Over-the-counter (privately negotiated) derivatives. |
| **Settlement** | The process of exchanging payments/assets to complete a trade. |
| **SSI** | Standard Settlement Instructions — where/how to settle a trade. |
| **Blotter** | A tabular list of trades (here: an Excel/CSV attachment, one row per trade). |
| **Trade ID / Deal Reference** | A trade's unique identifier (e.g. `FXOPT-2026-00047`). |
| **UTI** | Unique Trade Identifier — a regulatory trade reference. |
| **Notional** | The face amount of a trade. |
| **Counterparty** | The other party to the trade. |
| **Middle Office / SSG** | The operations function that processes and settles trades. |
| **Microsoft Graph** | Microsoft 365's API, used to read the Outlook mailbox. |
| **SPAR** | Sense → Plan → Act → Reflect — the agent loop. |
| **Idempotent** | Re-running produces the same result without duplicating work. |
| **Envelope** | The uniform success/error JSON shape every API endpoint returns. |
| **Correlation ID** | A per-request ID threading one request across all logs and the response. |
| **WORM** | Write-Once-Read-Many storage, used for tamper-evident audit trails. |

---

*This document covers the system as built for the Phase 1 PoC. It describes a proof of concept on synthetic data; it is not connected to production mailboxes or downstream settlement systems. Figures (29 emails → 14 relevant → 80-row register; 61 tests) reflect the current demo dataset and will change as the inbox and rules evolve.*
