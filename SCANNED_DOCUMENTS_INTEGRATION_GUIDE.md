# Architectural Guide: Processing Scanned PDFs & Images in Production

When processing scanned PDFs (image-only, no digital text layer) or direct email image attachments (PNG/JPG) for financial trade settlements, **data accuracy is the absolute highest priority**. A single character read error (e.g., misreading a decimal point or converting an `8` to a `B`) can lead to failed settlement transactions or financial loss.

This document details production-ready approaches, ranks them based on accuracy, cost, complexity, and compliance, and provides concrete strategies for error fallback and integration.

---

## 1. The Core Trade-off in Financial OCR

```
  High Accuracy / Low Latency  <───────────────────>  Strict On-Premises Privacy
  (Enterprise Cloud Document AI)                         (Local Open-Source OCR / VLMs)
```

- **Cloud Document APIs** (Azure Document Intelligence, AWS Textract) provide the highest table-parsing accuracy and are built for production scale but require routing data through secure cloud endpoints.
- **Local OCR/VLM Deployments** (PaddleOCR, local Qwen2-VL) guarantee $100\%$ data privacy on-premises but require dedicated GPU infrastructure and extensive model-tuning to achieve financial-grade accuracy.

---

## 2. Comparison & Ranking of Approaches

### Approach 1: Secure Enterprise Cloud Document Services (Azure Document Intelligence / AWS Textract)
*Rank: 1 (Highly Recommended for Production)*

* **How it works**: The Agent API routes the binary image payload to a cloud endpoint. The cloud service returns a structured layout JSON containing tables (with cell row/column indices) and document key-value pairs.
* **Level of Complexity**: Low to Moderate. No local machine learning model host is needed; only secure HTTPS API integration and VPC (Virtual Private Cloud) setup.
* **Data Accuracy**: **Extremely High ($98\% - 99.5\%$ on clear scans)**. Built-in neural layout analysis prevents columns from shifting.
* **Compliance Resolution**: To meet strict privacy requirements, deploy these services inside your corporate Azure/AWS private tenant (VPC) with **"Zero Data Retention"** flags enabled, ensuring document data is never cached or used for training by the provider.
* **Fallbacks & Integration Issues**:
  - *Issue*: Network failure or API rate limits.
  - *Fallback*: Route the document directly to the BA Manual Review queue with an warning label: *"Network timeout during OCR processing - manual data entry required."*

---

### Approach 2: Local Vision-Language Models (VLM) (Qwen2-VL / Llama-3.2-Vision)
*Rank: 2*

* **How it works**: Run an open-source vision-language model locally on corporate GPU servers. The model is prompted: *"Extract the trade table from this image in JSON format."*
* **Level of Complexity**: High. Requires hosting models via frameworks like `vLLM` or `Ollama` and managing GPU memory pools.
* **Data Accuracy**: **High ($92\% - 96\%$ depending on prompts and model size)**. Excellent at understanding semantic relationships (e.g., associating a label with a far-away value).
* **Fallbacks & Integration Issues**:
  - *Issue*: Hallucinations (the LLM invents trade details if a scan is blurry) and high latency (each document takes 2-5 seconds on a GPU).
  - *Fallback*: Compare the extracted values against strict schemas. If the JSON structure is invalid or key-value fields are missing, fail open and route to HITL.

---

### Approach 3: Local OCR Engines + Coordinate-based Table Heuristics (PaddleOCR + Table Transformer)
*Rank: 3*

* **How it works**: Use a local open-source OCR engine (like **PaddleOCR** or **EasyOCR**) to generate text bounding boxes, then run a layout analysis heuristic to reconstruct table cells.
* **Level of Complexity**: Extremely High. Reconstructing tables from raw bounding box coordinates is notoriously fragile and requires writing complex spatial geometry algorithms.
* **Data Accuracy**: **Moderate ($85\% - 90\%$ on tables)**. Misalignments are common when tables lack clear borders.
* **Fallbacks & Integration Issues**:
  - *Issue*: Character misreads (reading `0.9658` as `0.965B`).
  - *Fallback*: Mandatory **double-engine check**: Run the document through both PaddleOCR and Tesseract. If there is a single character difference in trade-critical fields, flag the trade for manual review.

---

## 3. Production Safeguards: Guaranteeing 100% Accuracy

Because this is a production-grade system handling trade settlements, **no machine learning model can run fully unsupervised**. The following safeguards must be integrated:

```
  [OCR Extraction] ──> [Deterministic Verification] ──> [Field Confidence Check] ──> [HITL UI Gate]
```

### 1. Mathematical Checks (Deterministic Verification)
Before routing to the database, the system must validate the arithmetic logic of the extracted values:
$$\text{Premium Amount} \approx \text{Notional Amount} \times \text{Strike Rate} \times \text{Delta}$$
$$\text{Notional Leg 1 (e.g. AUD)} \times \text{Strike Rate} \approx \text{Notional Leg 2 (e.g. USD)}$$
If the mathematical validation fails, the system immediately flags the case and sends it to the manual verification queue.

### 2. Character-Level Confidence Scores
Modern OCR and VLM frameworks return a probability score ($0.0 - 1.0$) for every word extracted. 
- *Safeguard*: Define a strict threshold of **$99.5\%$** for critical fields (`notional_amount`, `strike_rate`, `settlement_date`). If the confidence of any of these fields falls below the threshold, the field is highlighted in red in the UI and requires a human BA click-to-approve.

### 3. Human-In-The-Loop (HITL) Dual-Step Verification
For scanned/image-based documents, establish a mandatory UI gateway:
- **STP (Straight-Through Processing)** is only allowed for clean digital spreadsheets (`.xlsx`/`.csv`).
- **All scanned/image inputs** are automatically routed to a **Verification Screen**. The system pre-fills the trade fields from the OCR extraction to save time, but a BA must explicitly verify the visual side-by-side comparison and click **Confirm Case** to authorize database commit.

---

## 4. Integration Blueprint for current codebase

To integrate image/scanned PDF support into the current pipeline:

1. **Connector Extension**: Update `connectors/local_connector.py` and `connectors/graph_connector.py` to extract `.png`, `.jpg`, and `.jpeg` attachments alongside `.pdf`.
2. **Dynamic OCR Routing**: In `agent/attachment_extractor.py`, inside `extract_attachment`:
   - If the file is a PDF, run a check: `is_scanned_pdf()`.
   - If the PDF has no digital text or the file is an image, route it to `extract_via_ocr(file_bytes)`.
3. **HITL Database Flag**: Add a `requires_human_approval` column to the `email_cases` database schema. If the case source was an image or scanned PDF, set this flag to `1`, disabling automatic extraction downstream until the BA clears the gate.
