# Scanned PDF OCR Feature Integration Guide

This document provides a comprehensive overview of how scanned PDF support using local **PaddleOCR** was integrated into the Nomura Email Agent project. It serves as a guide for new developers on the historical context, the technical implementation, and next steps.

---

## 1. Background & Limitations (Before OCR)

Originally, the Email Agent was designed only for digital vector files. Its processing flow assumed that incoming PDFs had standard digital text layers. When a **scanned PDF** (image-only scan of a trade ticket, such as the attachment in `31.eml`) entered the inbox, the pipeline failed in two key stages:

1. **Classification & Folder Naming**: 
   - `RuleClassifier` parsed the PDF using `pdfplumber.extract_text()`, which returned `None`.
   - Because no trade ID (e.g., `FXOPT-xxxx-xxxxx`) could be found in the attachment, the classifier fell back to generating an arbitrary unique ID.
   - This created folder structures like `UNKNOWN_9e09e9fe22_FX_Settlement_xxxx` instead of using the true trade ID (like `FXOPT-2026-00008`).
2. **Trade Extraction**:
   - `_read_pdf_trades` attempted tabular extraction or regex fallback on digital text. Both yielded 0 trade records on scanned inputs.
   - Consequently, the case was processed with zero extracted trade lines, preventing any matching or enrichment against the **Golden Source** blotter.

---

## 2. PaddleOCR Integration Architecture

To handle scanned PDFs locally without violating strict compliance policies (no cloud LLMs/APIs), we integrated **PaddleOCR** into the Python backend.

```
   Incoming Email (.eml)
          │
          ▼
   [Local Connector] (Extract attachment bytes)
          │
          ▼
   [Rule Classifier] (Scan PDF for Trade ID & Keywords)
          │
          ├─► Try Digital Text (pdfplumber) ─────────────────┐
          │                                                   ▼
          └─► [Fallback] ──► [Cached extract_pdf_pages_text] ──► Bounded Regex Search
                                      │
                                      ▼ (Temp PDF File)
                                [PaddleOCR]
                                      │ (Set environment variables to disable MKLDNN)
                                      ▼
                                Text Lines per Page
                                      │
                                      ▼
                           [Layout-Aware Offset Parser] (Align labels and values)
                                      │
                                      ▼
                           2 Normalized Trade Records (Trade 08 & 09)
                                      │
                                      ▼
                           [Golden Source Blotter] (Enrichment & Match Reconcile)
```

---

## 3. Key Technical Implementations

The implementation is located across three core modules:

### A. Environment Tuning & Windows Compatibility
We targeted a **Python 3.11.4 Anaconda virtual environment** to ensure PaddleOCR wheel compatibility.
- **oneDNN / MKLDNN Crash Bypass**: Recent versions of PaddlePaddle (3.3.x) running on Windows CPU environments crash with a `NotImplementedError` regarding intermediate representation attribute conversion (in `onednn_instruction.cc`).
- **Solution**: We explicitly disable optimized oneDNN kernels by injecting these environment variables before importing or instantiating `PaddleOCR`:
  ```python
  import os
  os.environ["FLAGS_use_mkldnn"] = "0"
  os.environ["PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT"] = "0"
  ```
  Additionally, we pass `enable_mkldnn=False` to the `PaddleOCR` instance.

### B. Shared Page-Text Caching
OCR is computationally heavy (taking 2–3 seconds per page on CPU). To avoid running OCR multiple times on the same attachment (once during classification, once during trade ID search, and once during extraction), we created a centralized cached function in [agent/attachment_extractor.py](file:///C:/Manav_personal/Arshi%20Project/New%20folder/Nomura/agent/attachment_extractor.py):
```python
from functools import lru_cache

@lru_cache(maxsize=16)
def extract_pdf_pages_text(pdf_data: bytes) -> List[str]:
    # 1. Try digital extraction via pdfplumber
    # 2. If character count is < 50, fall back to PaddleOCR
    # 3. Cache the output list of strings (one per page)
```
Both the `RuleClassifier` in `classifier/rule_classifier.py` and the `_read_pdf_trades` extractor import this helper.

### C. Layout-Aware Table Parser
Because PaddleOCR reads horizontal columns vertically or shifts text block alignments depending on bounding boxes, the resulting string sequence places labels and values in separate chunks rather than side-by-side (e.g. all column headers are grouped first, followed by all row values).
- **The Offset Matching Rule**: We implemented a layout-aware mapping algorithm. If we detect a contiguous block of at least 3 trade labels (e.g., `Counterparty`, `LEI`, `Domicile`, `Status`), we map their values using a fixed offset of `+4` lines.
- **Member Checks**: We validate that mapped values do not collide with label keyword definitions (`val.lower().strip() in label_to_field`) to prevent offsets from shifting on OCR noise.

### D. Section-Splitting (Multiple Trades per Page)
Single pages can contain multiple trades stacked vertically (e.g. `Trade 08` and `Trade 09` on page 5 of `31.eml`).
- **Solution**: The text is parsed by scanning for trade boundaries `Trade \d+`. The page is divided into logical trade chunks, and our layout-and-regex parser is executed independently on each chunk.

---

## 4. How to Run & Verify

1. **Verify Services**:
   The stack requires three running servers (Graph API, Agent API, and Next.js Frontend). To start them manually in background mode:
   ```powershell
   # 1. Start Mock Graph
   venv\Scripts\python.exe -m uvicorn mock_graph.app:app --port 8001
   
   # 2. Start Agent API
   $env:GRAPH_BASE_URL="http://localhost:8001"; venv\Scripts\python.exe -m uvicorn api.app:app --port 8000
   
   # 3. Start Frontend
   cd frontend; npm run dev
   ```
   Or use the updated [launch.bat](file:///C:/Manav_personal/Arshi%20Project/New%20folder/Nomura/launch.bat) by running `.\launch.bat` in a PowerShell terminal.

2. **Reprocess Inbox**:
   Place an email containing a scanned PDF (e.g. `31.eml`) into `data/raw_emails/inbox/` and trigger the agent run:
   ```bash
   venv\Scripts\python.exe main.py
   ```
   The terminal will print logs indicating it fetched the email, ran PaddleOCR fallback, and extracted the trade lines.

3. **Check Output**:
   Verify the extracted JSON inside `data/processed/<TRUE_TRADE_ID>_FX_Settlement_<DATE>/extracted_trades.json` to ensure all fields are normalized.

4. **Run Unit Tests**:
   Run the pytest suite to verify all test constraints still hold:
   ```bash
   venv\Scripts\python.exe -m pytest
   ```

---

## 5. Potential Next Steps for Developers

- **Direct Image Files**: Extend `file_type_for` and `is_supported` in `attachment_extractor.py` to allow direct image attachments (`.png`, `.jpg`, `.jpeg`) using the same `extract_pdf_pages_text` pipeline.
- **Bounding Box Visualizer**: Re-enable `res.save_to_img` or output bounding box coordinates in the case manifest so the frontend can draw the scanned trade ticket side-by-side with highlighting on the verified values.
- **Confidence Highlighting**: Surface the OCR word recognition confidence scores (returned by PaddleOCR) to the frontend, marking values below `99.5%` as requiring explicit human check.
