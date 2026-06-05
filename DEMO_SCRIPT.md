# Demo Script — Agentic Capabilities (Email Triage & Trade Extraction)
### Nomura SSG · Agentic AI PoC (Phase 1)

A presenter-ready script for a live walkthrough of what we've built. It gives you the **exact words to say** (🗣️), the **on-screen actions** (🖥️), and **presenter notes** (💡) for each beat — plus a pre-flight checklist, timing, Q&A prep, and recovery steps if something misbehaves live.

> **Two run lengths:** the full script runs **~12 minutes**. For a **~5-minute** version, do Scenes 1–4 and the Close, and skip the ⏭️-marked optional scenes.

---

## Pre-flight checklist (do this before the audience is watching)

- [ ] Run **`launch.bat`** — wait for all three windows (Mock Graph :8001, Agent API :8000, Frontend :3000) and the browser to open `http://localhost:3000`.
- [ ] **For a clean "first run" effect:** in a terminal at the project root, delete the processed data so you can rebuild it live — `Remove-Item -Recurse -Force data\processed` (the agent self-heals/rebuilds it when you run Classify).
- [ ] Open the browser **full-screen**; zoom to ~110% so the room can read the tables.
- [ ] Log out (HP avatar → Logout) so you **start on the Login screen**.
- [ ] Have this script on a second screen or printed.
- [ ] Close noisy apps / notifications.

💡 **Golden rule:** the app caches your last Sync in the browser session. If anything looks stale during the demo, click **Sync** again, or **HP → Logout** and back in. (See Recovery, end of doc.)

---

## The numbers you'll call out (memorize these)

| Moment | Number |
|---|---|
| Raw inbox | **29 emails** |
| After triage | **14 relevant · 3 ambiguous · 10 irrelevant · 2 duplicates** |
| One spreadsheet attachment | **34 trades** |
| Final trade register | **80 trades** — 12 from email **bodies**, 68 from **Excel attachments** |
| Quality bar | **61 automated tests passing** |

---

# PART 1 — FRAME THE PROBLEM  *(~2 min)*

## Opening hook  *(30 sec)*

🗣️ *"Settlement operations run on email. Every day, into one shared mailbox, come the real, time-sensitive trade-settlement notifications a team has to act on — and they arrive buried in office noise: IT tickets, newsletters, calendar invites, the occasional birthday email. Today, a person reads every single one. They decide what's a real trade, they open the attachments, they copy the trade details into the settlement systems, and they have to make sure they never act on the same trade twice. It's slow, it's repetitive, and when a real settlement email gets missed — that's operational risk."*

🗣️ *"What I'm going to show you is an AI agent that does that first mile of work automatically — and, just as importantly, explainably. Let me show you."*

💡 Keep it conversational. Land the phrase **"explainably"** — it's the theme of the whole demo.

## What we built — in one breath  *(60 sec)*

🖥️ Stay on the Login screen (don't sign in yet).

🗣️ *"In one sentence: it watches the mailbox, separates the real trade emails from the noise, pulls the trades out — from both the email body and its spreadsheet attachments — and hands off a clean, structured trade register. It does three things, and we'll see each one live:"*

🗣️ *"One — **Classify**: label every email Relevant, Ambiguous, or Irrelevant, with a reason. Two — **Extract**: pull the trade details into a structured register. Three — it stays **tunable**: the operations team owns the rules, and can change the agent's behaviour without a developer."*

🗣️ *"Three principles run through all of it. It's **explainable** — never a black box. It keeps a **human in the loop** — anything it's unsure about goes to a person, nothing is silently dropped. And every action is **audited**. Okay — let's run it."*

---

# PART 2 — THE LIVE DEMO  *(~7 min)*

## Scene 1 — Login  *(20 sec)*

🖥️ Click **Sign In**. Land on **Classify & Extract**.

🗣️ *"This is the operations console. Branded sign-in — for the proof of concept the login is a placeholder; in production this is your single sign-on. The left nav has two things we'll use: **Classify & Extract**, the pipeline, and **Configure Agents**, where the business tunes it."*

💡 Don't dwell. The login is polish, not the point.

## Scene 2 — Sync: the noisy inbox  *(45 sec)*

🖥️ On Step 1 (**Sync Emails**), make sure the source is **Local (.eml)**. Click **Sync**.

🗣️ *"First, the agent connects to the mailbox and pulls everything in. Right now I'm reading a local folder of email files, but see this toggle — **Graph API**? That's a full mock of Microsoft's real Outlook API, field-for-field identical. I'll come back to why that matters."*

🖥️ Let the synced list render. Scroll it briefly.

🗣️ *"Here's the raw inbox — **29 emails**. And it's a realistic mess: genuine FX settlement notifications sitting right next to IT tickets, newsletters, out-of-office replies. Nothing's been filtered yet — this is exactly what a person faces every morning."*

🖥️ Click one settlement email row to open the preview, then close it.

🗣️ *"I can open any one to read it — full transparency. Now let's let the agent triage it."*

## Scene 3 — Classify: the triage  *(2 min)* ⭐ *core scene*

🖥️ Go to Step 2 (**Classify**). Click **Run** / **Classify**. Let the loader run.

🗣️ *"Now it's scoring every email against signals that are specific to FX settlement — phrases like 'settlement instructions' and 'deal reference', the presence of a real trade ID — and labelling each one."*

🖥️ When results land, point at the summary stats.

🗣️ *"Here's the split. **14 Relevant** — the real trades, kept. **10 Irrelevant** — that's the office noise, dropped. **3 Ambiguous** — and these are the interesting ones. **2 Duplicates** — same trade arriving twice."*

🖥️ Point to (or click into) an **Ambiguous** row.

🗣️ *"This is the human-in-the-loop principle in action. When the agent isn't confident — when an email is settlement-adjacent but not clearly a trade — it does **not** guess and it does **not** throw it away. It labels it Ambiguous and holds it for a person to review. Nothing is silently dropped. In a regulated settlement function, that distinction is everything."*

🖥️ Click a **Relevant** row to open its detail; point to the **reason**.

🗣️ *"And this is the explainability. Every decision shows its work — the exact keywords and signals that produced the label, and a confidence. If anyone ever asks 'why did the agent keep this email, or drop that one?' — the answer is right here. There's no black box to argue with."*

🖥️ Point to a **Duplicate** row.

🗣️ *"And duplicates — the same trade ID, already captured — are flagged and skipped, so the same trade never gets booked twice. You can run this pipeline ten times and it converges to the same correct state every time."*

💡 This is your most important scene. Slow down. The three ideas to land: **explainable**, **human-in-the-loop (ambiguous held)**, **no double-counting**.

## Scene 4 — Extract: the trade register  *(2 min)* ⭐ *the "wow"*

🖥️ Go to Step 3 (**Extract Trade Data**). Let it build.

🗣️ *"Now the payoff. For every relevant email, the agent extracts the trades into a structured register — the thing the analyst would otherwise type by hand."*

🖥️ Let the **80-row** table render. Point to the row count.

🗣️ *"**80 trades** — and here's the part I want you to watch. Most settlement emails aren't one trade in the body. They're a short cover note — 'please find attached' — with the real trades sitting in a **spreadsheet attachment**. A single one of those attachments here carries **34 trades**. The agent opened the Excel file, read all 34 rows, and exploded them into individual trades — automatically."*

🖥️ Point to the **Source** column.

🗣️ *"That's what this last column tells you — the **Source** of every row. **'Attachment (xlsx)'** means it came out of a spreadsheet. **'Body'** means it was parsed from the email text itself. So you can see, at a glance, exactly where every trade came from. Of these 80: 68 came out of two Excel blotters, 12 from single-trade email bodies."*

🖥️ Use the **search** box — type a counterparty (e.g. `HSBC`) or `EUR/USD`. Then clear it.

🗣️ *"It's fully searchable — by trade ID, counterparty, currency pair. And every row drills in."*

🖥️ Click any row to open the trade drawer.

🗣️ *"Here's the full trade — counterparty, currency pair, buy/sell, notional, settlement date, and the option detail: strike, expiry, premium, settlement status, the book it sits in — all pulled straight from the spreadsheet, and it tells you the source file it came from. This is the clean, structured handoff to the next stage. The analyst stops copying fields."*

💡 The blotter moment — *one attachment, 34 trades* — is your headline. Say it with energy.

## Scene 5 — Configure Agents: the business owns the rules  *(90 sec)* ⭐ *differentiator*

🖥️ Left nav → **Configure Agents**. Open the agent's editor.

🗣️ *"Last thing, and this is what makes it genuinely operational rather than a fixed script. The agent's behaviour isn't buried in code — the operations team owns it. These are the **shortlisting keywords** that drive classification. Let me prove they're live."*

🖥️ Add a keyword the audience will recognize as "noise" — e.g. type **`office picnic`** into the shortlisting keywords — and **Save**.

🗣️ *"I've just told the agent that 'office picnic' is a meaningful settlement signal — deliberately wrong, to make the point. I save it... and that change is applied to the running agent immediately. No code change, no redeploy."*

🖥️ Go back to **Classify & Extract → Classify → Re-run** (Sync again first if needed).

🗣️ *"Re-run the classification, and an email that mentions an office picnic — which used to be dropped as noise — now scores as relevant. The business changed the agent's behaviour in ten seconds, live."*

🖥️ *(Tidy up:)* Go back to Configure Agents and **remove** the `office picnic` keyword (or click **Reset to defaults**), so the demo is clean for next time.

🗣️ *"I'll undo that. The point stands: this is a system the operations team can own and tune, with every change still fully explainable and audited."*

💡 If short on time, you can *describe* this instead of doing the round-trip — but doing it live is the strongest moment in the demo.

## Scene 6 — Self-heal / clean run  *(45 sec)* ⏭️ *optional, technical crowd*

🖥️ In a terminal: `Remove-Item -Recurse -Force data\processed`. Then re-run **Classify** in the UI.

🗣️ *"One for the engineers. I've just deleted the agent's entire output folder on disk. Watch — when I re-run, it **rebuilds every case** from scratch: the folders, the saved attachments, the extracted trades, the manifests. It self-heals to a correct, complete state. That's the idempotency that lets you safely run this on a schedule against a live, changing mailbox."*

## Scene 7 — Logout  *(10 sec)* ⏭️ *optional*

🖥️ HP avatar (top-right) → **Logout**.

🗣️ *"And signing out returns you to the start and clears the session — the seam where real identity and role-based access slot in."*

---

# PART 3 — UNDER THE HOOD  *(~2 min, for technical audience / Q&A)*

💡 Use this if engineers are in the room. For a pure business audience, compress to the two **bold** lines.

🗣️ *"Quickly, how it's built — because the architecture is what makes it production-credible."*

🗣️ *"It's a real **agent**, not a script — a sense-plan-act-reflect loop. It senses the mailbox, makes labelled decisions with reasons, acts by storing structured cases, and reflects with a run summary and an audit trail. The classifier is deliberately **rule-based** — transparent additive scoring with tunable weights and thresholds — so every decision is explainable and cheap. No model to train, nothing to second-guess."*

🗣️ **"The single most important design choice: the only thing that changes between this demo and your real Outlook mailbox is a URL and a password."** *"That toggle you saw — Graph API — talks to a mock of Microsoft Graph that we built field-for-field identical to the real thing: the same OAuth login, the same paging, the same attachment format. So the connector, the classifier, the extractor, the UI — none of it changes when we go live. We point at real Graph with real credentials, and it works."*

🗣️ *"Every business action — every classification, every stored case, every API call — writes an **append-only audit event**: who, what, when, outcome, with a correlation ID that traces one request across every log. That's the compliance trail a risk function expects."* **"And the whole thing is backed by 61 automated tests that pass today."**

---

# PART 4 — SCOPE & ROADMAP  *(~1 min)* — *be honest, it builds trust*

🗣️ *"Let me be clear about what this is and isn't. This is a **proof of concept on synthetic data** that mirrors the real email shapes. What works end-to-end today: ingestion, classification, deduplication, and extraction from **Excel and CSV** — with the full UI and audit trail you just saw."*

🗣️ *"What's next, in priority order:"*

🗣️ *"**One — PDF and SSI documents.** Some settlement instructions arrive as PDFs with no readable text layer; those need OCR. The framework is already in place — the Source column will just read 'Attachment (pdf)'. **Two — Compare & Match**: reconciling each extracted trade against a golden source and surfacing the breaks — that's the next big capability. **Three — going live** on a real Graph mailbox, which as I said is a configuration change. Then **authentication and roles**, a **scheduler** to run it automatically, and over time an optional **AI assist** purely for the ambiguous middle band — keeping the rules as the auditable backbone."*

🗣️ *"Every one of those slots into the architecture we already have — we built the seams for them."*

---

# CLOSE  *(~30 sec)*

🗣️ *"So — to bring it back to where we started. A person used to read every email in that mailbox, sort the real trades from the noise, open the attachments, and copy out the trades by hand. You just watched an agent do that first mile automatically: **29 noisy emails triaged into 14 real trades, and an 80-line trade register pulled out — most of it from spreadsheet attachments — in seconds**. Explainable at every step, with a human kept in the loop, and an audit trail behind all of it."*

🗣️ *"And it's built so that going from this demo to your live mailbox is a change of address, not a rebuild. Happy to take questions, or go deeper on any part."*

💡 End on the **"change of address, not a rebuild"** line — it's the memorable close.

---

# APPENDIX A — Anticipated Q&A

**Q: Is this using AI / an LLM? How do we trust it?**
🗣️ *"Today the classifier is deliberately rule-based — transparent scoring you can read and tune. That's a feature for a regulated function: every decision is explainable and reproducible, with no model drift. Where an LLM earns its place later is only on the genuinely ambiguous emails, as an assist — and even then the rule-based reasons stay on the record."*

**Q: What happens when it gets one wrong?**
🗣️ *"Two safety nets. Anything it's unsure about is labelled Ambiguous and routed to a human — it never silently drops. And because the rules are explainable and tunable, when ops sees a miss they correct it in seconds by adjusting a keyword — live, as I showed."*

**Q: How does it connect to our real mailbox?**
🗣️ *"Through Microsoft Graph — the standard Outlook/M365 API. We've built and tested against a mock that's identical to it, so the production switch is a base URL plus an app registration's credentials. No other code changes."*

**Q: Where does the extracted data go next?**
🗣️ *"Each trade becomes a structured case with a manifest — an explicit contract for the next stage. The natural next capability is Compare & Match, reconciling those trades against a golden source."*

**Q: Can it handle PDFs?**
🗣️ *"Excel and CSV today. PDFs with a text layer are straightforward to add; the scanned/vector SSI PDFs need OCR, which is the very next item on the roadmap — and it'll flow into the same register with a 'Attachment (pdf)' source."*

**Q: How does it avoid double-processing a trade?**
🗣️ *"It indexes every email and every trade ID it's seen. A repeat email is skipped; a trade ID already captured is flagged as a duplicate. Re-running is completely safe — it converges to the same state."*

**Q: Is it secure / auditable?**
🗣️ *"Every business action writes an append-only audit event — who, what, when, outcome — designed to ship to a SIEM/WORM store in production. Real authentication and role-based access are the next productionization step."*

**Q: How long did this take / how big is it?**
🗣️ *"It's a focused Phase-1 build: a Python agent and API, a Next.js console, a full Microsoft Graph mock, and 61 automated tests — all running on one machine with a single launch command."*

---

# APPENDIX B — If something breaks live (recovery)

| Symptom | Fix on the fly | What to say |
|---|---|---|
| Sync shows old/stale emails | Click **Sync** again; or **HP → Logout** and back in | *"Let me re-sync that."* (casual, no apology) |
| A page looks blank / not loaded | Hard refresh **Ctrl+Shift+R** | *"Quick refresh."* |
| Extract/Classify shows nothing | Re-run **Classify** first (Extract needs classified cases), then Extract | *"It runs in order — let me classify first."* |
| API seems down (errors) | Check the **Agent API :8000** window is still running; if not, re-run `launch.bat` | Pivot to the **DOCUMENTATION.md** / architecture while it restarts |
| Port conflict on launch | Run **`stop.bat`**, then **`launch.bat`** | — |
| Totally stuck | Talk through screenshots / the architecture diagram in DOCUMENTATION.md | *"Let me walk you through it while this comes back."* |

💡 Never apologize twice. A live demo hiccup handled calmly reads as competence.

---

# APPENDIX C — Timing cheat sheet

| Part | Scene | Time | Skippable? |
|---|---|---|---|
| 1 | Opening hook + what we built | 2:00 | No |
| 2 | Scene 1 — Login | 0:20 | No |
| 2 | Scene 2 — Sync | 0:45 | No |
| 2 | Scene 3 — Classify ⭐ | 2:00 | No |
| 2 | Scene 4 — Extract ⭐ | 2:00 | No |
| 2 | Scene 5 — Configure Agents ⭐ | 1:30 | Shorten to verbal |
| 2 | Scene 6 — Self-heal | 0:45 | ⏭️ Optional |
| 2 | Scene 7 — Logout | 0:10 | ⏭️ Optional |
| 3 | Under the hood | 2:00 | Compress for biz |
| 4 | Scope & roadmap | 1:00 | No |
| — | Close | 0:30 | No |

**Full run ≈ 12 min · Short run (Scenes 1–4 + Close) ≈ 5 min.**

---

*Deliver with confidence: you built something that works. The three lines that carry the whole demo are — "every decision shows its reasons," "one attachment, thirty-four trades," and "a change of address, not a rebuild."*
