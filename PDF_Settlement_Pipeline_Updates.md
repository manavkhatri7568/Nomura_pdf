# FX Trade Settlement Pipeline: PDF Attachment Support & System Stabilization Report

This report outlines the enhancements and bug fixes implemented in the FX Trade Settlement pipeline to support **text-based PDF attachments** (such as SSI confirmation tickets) and stabilize the dev/test environment.

---

## 1. Project Context & Objectives

The FX Trade Settlement pipeline ingests emails, identifies relevant communications, and extracts trade data from attachments. Previously, the pipeline only supported Excel (`.xlsx` / `.xlsm`) and `.csv` files. 

### Key Requirements
- **Local & Private Extraction**: For compliance and privacy, extraction must happen entirely on the local system (no external Cloud/LLM API calls).
- **Dual-Extraction Strategy**:
  1. **Tabular Extraction**: Scan the PDF pages for structured tables.
  2. **Regex Fallback**: If no tables are found, extract trade properties (e.g., Trade ID, UTI, Counterparty, Notional, Settlement Date) from the raw text layer using robust regex patterns.
- **Deduplication & Pipeline Alignment**: Ensure new PDF-based cases follow the same state lifecycle, visual pipeline progression, and Compare & Match reconciliation as existing file formats.

---

## 2. Implemented Features

### A. Dual-Extraction Path in `attachment_extractor.py`
We integrated `pdfplumber` to extract tables and text layers locally. The extraction pipeline is configured as follows:
- **First Attempt**: Table-based parser scans every page for structured trade registers. If a table matching FX trade headers is found, it parses and normalizes it.
- **Second Attempt (Fallback)**: If no tables are found, a regex engine scans the raw text layer using anchor words to extract:
  - `trade_id`, `uti`, `counterparty`, `currency_pair`, `buy_sell`, `notional_amount`, `strike_rate`, `settlement_date`, `premium_settle_date`, `trader`, `book`, `portfolio`, `settlement_status`, `option_type`, and `exercise_style`.

### B. PDF Scanning in `rule_classifier.py`
Modified the email classifier to scan PDF attachments for trade IDs and asset/subject keywords. When trade details are missing from the email subject or cover note, the classifier uses the PDF content to confirm relevance.

---

## 3. Issues Identified & Resolved

### Issue 1: Mock Graph API Mailbox Caching
- **Symptom**: Newly added emails (like `30.eml`) did not appear in **Sync Emails** or **Classify** in the UI, but showed up in **Compare & Match** as unmatched/empty.
- **Root Cause**: The mock Microsoft Graph service loaded `.eml` files from `data/raw_emails/inbox` once on startup. Subsequent email additions were ignored until a manual server restart.
- **Resolution**: Updated `mock_graph/app.py` to call `.reload()` on the in-memory mailbox store on every list and detail API request, enabling dynamic email syncing.

### Issue 2: Virtual Environment Mismatch in `launch.bat`
- **Symptom**: On launch, the PDF trade ID in the Classify tab was blank (`—`), the trade was missing from Extract Trade Data, and Compare & Match showed empty details.
- **Root Cause**: `launch.bat` called system-wide global `python` instead of the virtual environment interpreter (`venv\Scripts\python.exe`). Because `pdfplumber` was only installed in the `venv` package cache, the imports inside `RuleClassifier` and the attachment extractor failed silently.
- **Resolution**: Updated `launch.bat` to detect if the local virtual environment exists and automatically invoke `venv\Scripts\python.exe`, ensuring all dependencies load correctly.

### Issue 3: Blank Trade ID in UI for Already-Processed Case Skips
- **Symptom**: If the pipeline was re-run, previously processed PDF emails showed blank Trade IDs in the Classify step.
- **Root Cause**: When skipping an already-processed message, the runner re-ran the classifier on the email and appended the evaluated `result.trade_id` to the UI list. If PDF parsing failed or attachments weren't supplied in the request, it returned `None`.
- **Resolution**: Updated `agent/email_agent.py` to hydrate metadata (Trade ID, label, confidence, asset class) directly from the SQLite database index for already-processed messages rather than calling the classifier.

---

## 4. Modified Files

| File Path | Description |
| :--- | :--- |
| **[mock_graph/app.py](Nomura/mock_graph/app.py)** | Added dynamic mailbox reload triggers on API fetch endpoints. |
| **[launch.bat](Nomura/launch.bat)** | Integrated auto-detection and execution of the `venv` Python binary. |
| **[agent/email_agent.py](Nomura/agent/email_agent.py)** | Enhanced skip-run logic to fetch case details from SQLite instead of re-classifying. |
| **[agent/attachment_extractor.py](Nomura/agent/attachment_extractor.py)** | Implemented PDF parsing with table extraction and regex fallbacks. |
| **[classifier/rule_classifier.py](Nomura/classifier/rule_classifier.py)** | Integrated PDF attachment scanning during classification. |
| **[config/settings.py](Nomura/config/settings.py)** | Added `.pdf` to runtime allowed extraction extensions. |

---

## 5. Verification & Testing

To test the end-to-end pipeline with the new PDF files:
1. Close all active server terminals.
2. Double-click **`launch.bat`** in the project root.
3. Open the UI at `http://localhost:3000`.
4. Select **Source: Graph API** or **Source: Local (.eml)**.
5. In **Sync Emails**, click **Sync now** (should show 32 synced emails).
6. In **Classify**, click **Run shortlist** (verifies relevance and shows extracted trade IDs like `FXOPT-2026-00106`).
7. In **Extract Trade Data**, confirm the PDF trades are extracted with status `success` and source set to `Attachment (pdf)`.
8. In **Compare & Match**, verify the unmatched trade contains all parsed fields (UTI, Notional, Counterparty, etc.) populated from the PDF.
