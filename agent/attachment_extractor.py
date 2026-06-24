"""Extract trade rows from .xlsx / .csv email attachments.

Real FX-settlement emails carry a short cover note in the body and the actual
trades as a *table* in an attachment — one row per trade (a "blotter"). This
module parses those tables into a list of normalized trade dicts.

* Excel (.xlsx / .xlsm) via ``openpyxl`` (data-only, read-only).
* CSV via the standard library.

Design contract:
* **Never raises.** One bad attachment must not break the batch — every failure
  path returns an :class:`ExtractionResult` with ``status="error"`` (or
  ``"unsupported"`` / ``"empty"``) and an empty trade list.
* **Source-agnostic normalization.** A CSV cell (always a string, e.g.
  ``"897,327.00"`` / ``"29-May-26"``) and the equivalent native Excel value
  (a number / ``datetime``) normalize to the *same* canonical value, so
  downstream compare & match never has to care where a trade came from.

PDF is intentionally out of scope here (the sample SSI PDFs are vector-rendered
with no text layer and would need OCR — a separate workstream).
"""

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

SUPPORTED_EXTS: Tuple[str, ...] = (".xlsx", ".xlsm", ".csv", ".pdf")
DEFAULT_MAX_ROWS = 10_000

# How many leading rows to scan when locating the header (handles a title /
# logo row sitting above the real column headers).
_HEADER_SEARCH_DEPTH = 15
# Minimum number of recognised columns for a row to be accepted as the header.
_HEADER_MIN_HITS = 3

# Spreadsheet header (normalized: lower + single-spaced) -> canonical field name.
_HEADER_MAP = {
    "trade id": "trade_id",
    "trade ref": "trade_id",
    "trade reference": "trade_id",
    "deal reference": "trade_id",
    "uti": "uti",
    "trade date": "trade_date",
    "counterparty code": "counterparty_code",
    "counterparty name": "counterparty",
    "counterparty": "counterparty",
    "cpty": "counterparty",
    "currency pair": "currency_pair",
    "ccy pair": "currency_pair",
    "base currency": "base_currency",
    "quote currency": "quote_currency",
    "option type": "option_type",
    "exercise style": "exercise_style",
    "buy / sell": "buy_sell",
    "buy/sell": "buy_sell",
    "direction": "buy_sell",
    "notional amount": "notional_amount",
    "notional": "notional_amount",
    "notional currency": "notional_currency",
    "strike rate": "strike_rate",
    "strike": "strike_rate",
    "expiry date": "expiry_date",
    "settlement date": "settlement_date",
    "value date": "settlement_date",
    "premium amount": "premium_amount",
    "premium currency": "premium_currency",
    "premium settle date": "premium_settle_date",
    "delta": "delta",
    "implied vol (%)": "implied_vol",
    "implied vol": "implied_vol",
    "settlement status": "settlement_status",
    "status": "settlement_status",
    "portfolio": "portfolio",
    "trader": "trader",
    "book": "book",
}

# The set of canonical names we know about (used to score candidate header rows).
_KNOWN_FIELDS = set(_HEADER_MAP.values())

_DATE_FIELDS = {"trade_date", "expiry_date", "settlement_date", "premium_settle_date"}
_NUMERIC_FIELDS = {"notional_amount", "premium_amount", "strike_rate", "delta", "implied_vol"}

# Input date formats accepted, normalized to the canonical output below.
_DATE_INPUT_FORMATS = (
    "%d-%b-%Y", "%d-%b-%y",      # 13-Oct-2026 / 29-May-26
    "%d/%m/%Y", "%d/%m/%y",      # 13/10/2026 / 29/05/26
    "%Y-%m-%d", "%Y/%m/%d",      # 2026-10-13
    "%d-%m-%Y", "%d-%m-%y",
    "%m/%d/%Y", "%m/%d/%y",
    "%d %b %Y", "%d %B %Y",
)
_DATE_OUTPUT_FORMAT = "%d-%b-%Y"  # 13-Oct-2026


@dataclass
class ExtractionResult:
    """Outcome of parsing one attachment. ``status`` is always set."""

    filename: str
    file_type: str                                   # "csv" | "xlsx" | "unsupported"
    status: str                                      # "success" | "empty" | "unsupported" | "error"
    trade_count: int = 0
    trades: List[Dict[str, Any]] = field(default_factory=list)
    columns: List[str] = field(default_factory=list)         # recognised canonical columns
    unmapped_columns: List[str] = field(default_factory=list)  # headers we couldn't map
    error: Optional[str] = None

    def as_summary(self) -> Dict[str, Any]:
        """Compact dict for the manifest (omits the full row payload)."""
        return {
            "filename": self.filename,
            "file_type": self.file_type,
            "status": self.status,
            "trade_count": self.trade_count,
            "unmapped_columns": self.unmapped_columns,
            "error": self.error,
        }


# --------------------------------------------------------------------------
# Type / support helpers
# --------------------------------------------------------------------------

def file_type_for(filename: str) -> str:
    name = (filename or "").lower()
    if name.endswith(".csv"):
        return "csv"
    if name.endswith((".xlsx", ".xlsm")):
        return "xlsx"
    if name.endswith(".pdf"):
        return "pdf"
    return "unsupported"


def is_supported(filename: str, supported_exts: Tuple[str, ...] = SUPPORTED_EXTS) -> bool:
    name = (filename or "").lower()
    return name.endswith(tuple(supported_exts))


# --------------------------------------------------------------------------
# Value normalization (source-agnostic)
# --------------------------------------------------------------------------

def _canonical_key(header: Any) -> str:
    h = " ".join(str(header or "").strip().lower().split())
    if h in _HEADER_MAP:
        return _HEADER_MAP[h]
    # Fallback slug for unknown columns (kept so nothing is silently dropped).
    return "_".join("".join(c if c.isalnum() else " " for c in h).split())


def _coerce_date(v: Any) -> Any:
    if isinstance(v, (datetime, date)):
        return v.strftime(_DATE_OUTPUT_FORMAT)
    s = str(v or "").strip()
    if not s:
        return ""
    for fmt in _DATE_INPUT_FORMATS:
        try:
            return datetime.strptime(s, fmt).strftime(_DATE_OUTPUT_FORMAT)
        except ValueError:
            continue
    return s  # leave unrecognised date strings untouched (never lose data)


def _coerce_number(v: Any) -> Any:
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        f = float(v)
        return int(f) if f.is_integer() else f
    s = str(v or "").strip().replace(",", "").replace(" ", "")
    if s == "":
        return ""
    # tolerate a trailing %; tolerate parentheses negatives e.g. (1,234)
    neg = s.startswith("(") and s.endswith(")")
    if neg:
        s = s[1:-1]
    s = s.rstrip("%")
    try:
        f = float(s)
    except ValueError:
        return str(v).strip()
    if neg:
        f = -f
    return int(f) if f.is_integer() else f


def _normalize_row(raw: Dict[str, Any]) -> Dict[str, Any]:
    row: Dict[str, Any] = {}
    for header, value in raw.items():
        key = _canonical_key(header)
        if not key:
            continue
        if key in _DATE_FIELDS:
            row[key] = _coerce_date(value)
        elif key in _NUMERIC_FIELDS:
            row[key] = _coerce_number(value)
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            row[key] = value
        else:
            row[key] = str(value).strip() if value is not None else ""
    return row


# --------------------------------------------------------------------------
# Raw table readers -> list[list[cell]]
# --------------------------------------------------------------------------

def _read_csv_rows(data: bytes, max_rows: int) -> List[List[Any]]:
    text = data.decode("utf-8-sig", errors="ignore")
    rows: List[List[Any]] = []
    for r in csv.reader(io.StringIO(text)):
        rows.append(list(r))
        if len(rows) > max_rows + _HEADER_SEARCH_DEPTH:
            break
    return rows


def _read_xlsx_rows(data: bytes, max_rows: int) -> List[List[Any]]:
    import openpyxl  # imported lazily so the stdlib batch pipeline has no hard dep

    wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    try:
        ws = wb.worksheets[0]
        rows: List[List[Any]] = []
        for r in ws.iter_rows(values_only=True):
            rows.append(list(r))
            if len(rows) > max_rows + _HEADER_SEARCH_DEPTH:
                break
        return rows
    finally:
        wb.close()


# --------------------------------------------------------------------------
# Header location + table -> dict rows
# --------------------------------------------------------------------------

def _header_hits(cells: List[Any]) -> int:
    return sum(
        1 for c in cells
        if " ".join(str(c or "").strip().lower().split()) in _HEADER_MAP
    )


def _locate_header(rows: List[List[Any]]) -> int:
    """Return the index of the header row, or -1 if none looks like a header.

    Scans the first few rows and picks the one mapping the most known columns
    (tolerating a title/banner row above the real headers).
    """
    best_idx, best_hits = -1, 0
    for i, cells in enumerate(rows[:_HEADER_SEARCH_DEPTH]):
        hits = _header_hits(cells)
        if hits > best_hits:
            best_idx, best_hits = i, hits
    return best_idx if best_hits >= _HEADER_MIN_HITS else -1


def _rows_to_dicts(rows: List[List[Any]], max_rows: int) -> Tuple[List[Dict[str, Any]], List[str], List[str]]:
    """Split a raw table into (dict rows, recognised canonical cols, unmapped headers)."""
    hdr_idx = _locate_header(rows)
    if hdr_idx < 0:
        return [], [], []
    headers = [str(h or "") for h in rows[hdr_idx]]

    recognised, unmapped = [], []
    for h in headers:
        key = " ".join(str(h).strip().lower().split())
        if not key:
            continue
        (recognised if key in _HEADER_MAP else unmapped).append(h)

    out: List[Dict[str, Any]] = []
    for cells in rows[hdr_idx + 1:]:
        if not any(c is not None and str(c).strip() != "" for c in cells):
            continue  # skip fully blank rows
        raw = {headers[i]: (cells[i] if i < len(cells) else None) for i in range(len(headers))}
        out.append(_normalize_row(raw))
        if len(out) >= max_rows:
            break

    canonical_cols = sorted({_HEADER_MAP[" ".join(str(h).strip().lower().split())] for h in recognised})
    return out, canonical_cols, unmapped


# --------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------
from functools import lru_cache

@lru_cache(maxsize=16)
def extract_pdf_pages_text(pdf_data: bytes) -> List[str]:
    """Extract text from a PDF's pages, falling back to PaddleOCR if scanned/image-only."""
    import pdfplumber
    import io
    import os
    pages_text = []
    try:
        with pdfplumber.open(io.BytesIO(pdf_data)) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                pages_text.append(text)
    except Exception:
        pass
    
    total_len = sum(len(t.strip()) for t in pages_text)
    if total_len < 50:
        pages_text = []
        import tempfile
        
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(pdf_data)
            tmp_path = tmp.name
        
        try:
            # Set environment variables to disable MKLDNN and prevent NotImplementedError on Windows CPU
            os.environ["FLAGS_use_mkldnn"] = "0"
            os.environ["PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT"] = "0"
            from paddleocr import PaddleOCR
            ocr = PaddleOCR(
                lang="en",
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
                enable_mkldnn=False,
            )
            results = ocr.predict(input=tmp_path)
            for res in results:
                try:
                    texts = res["rec_texts"]
                except Exception:
                    texts = getattr(res, "rec_texts", []) or []
                pages_text.append("\n".join(texts))
        except Exception:
            pass
        finally:
            try:
                os.remove(tmp_path)
            except Exception:
                pass
    return pages_text


def _read_pdf_trades(data: bytes, max_rows: int) -> Tuple[List[Dict[str, Any]], List[str], List[str]]:
    import pdfplumber

    trades: List[Dict[str, Any]] = []
    canonical_cols = set()
    unmapped = set()

    # First attempt: digital tabular extraction
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables() or []
            for table in tables:
                if not table:
                    continue
                dict_rows, cols, unmapped_cols = _rows_to_dicts(table, max_rows - len(trades))
                rows_with_tid = [r for r in dict_rows if str(r.get("trade_id") or "").strip()]
                if rows_with_tid:
                    trades.extend(rows_with_tid)
                    canonical_cols.update(cols)
                    unmapped.update(unmapped_cols)
                    if len(trades) >= max_rows:
                        break
            if len(trades) >= max_rows:
                break

    # Second attempt (fallback): text-based hybrid layout + regex parser
    if not trades:
        labels_regex = r"(?:Book\b|Portfolio\b|UTI\b|Notional(?:\s*\([^)]*\))?|Settlement(?:\s*date\b|\s*status\b)?|Settelement(?:\s*status\b)?|Value(?:\s*date\b)?|Premium(?:\s*settle\b)?|Strike\b|Trader\b|LEI\b|Domicile\b)"
        
        patterns = {
            "trade_id": r"\bFXOPT-\d{4}-\d{5}\b",
            "uti": rf"UTI\s*[:\-]\s*(.*?)(?:\s+{labels_regex}\s*[:\-\u2013\u2014]|[;\n]|$)",
            "counterparty": rf"(?:Counterparty|Counterparty Name|Cpty)\s*[:\-]\s*(.*?)(?:\s+{labels_regex}\s*[:\-\u2013\u2014]|[;\n]|$)",
            "currency_pair": r"\b([A-Z]{3}/[A-Z]{3})\b",
            "buy_sell": r"\b(Buy|Sell)\b",
            "notional_amount": rf"(?:Notional\s*(?:\([^)]*\))?|Amount)\s*[:\-]\s*(.*?)(?:\s+{labels_regex}\s*[:\-\u2013\u2014]|[;\n]|$)",
            "strike_rate": rf"(?:Strike|Strike Rate|Strike\s*Rate)\s*[:\-]\s*(.*?)(?:\s+{labels_regex}\s*[:\-\u2013\u2014]|[;\n]|$)",
            "settlement_date": rf"(?:Settlement\s*date|Value\s*Date|Value\s*date)\s*[:\-\u2013\u2014]\s*(.*?)(\s+{labels_regex}\s*[:\-\u2013\u2014]|[;\n]|$)",
            "premium_settle_date": rf"(?:Premium\s*settle|Premium\s*Settle\s*Date|Premium\s*Settle)\s*[:\-\u2013\u2014]\s*(.*?)(?:\s+{labels_regex}\s*[:\-\u2013\u2014]|[;\n]|$)",
            "trader": rf"Trader\s*[:\-]\s*(.*?)(?:\s+{labels_regex}\s*[:\-\u2013\u2014]|[;\n]|$)",
            "book": rf"Book\s*[:\-]\s*(.*?)(?:\s+{labels_regex}\s*[:\-\u2013\u2014]|[;\n]|$)",
            "portfolio": rf"Portfolio\s*[:\-]\s*(.*?)(?:\s+{labels_regex}\s*[:\-\u2013\u2014]|[;\n]|$)",
            "settlement_status": rf"(?:Settlement\s*status|Settelement\s*status|Status)\s*[:\-\u2013\u2014]\s*(.*?)(?:\s+{labels_regex}\s*[:\-\u2013\u2014]|[;\n]|$)",
        }

        pages_text = extract_pdf_pages_text(data)
        for page_text in pages_text:
            if not page_text:
                continue
            
            # Split page text by "Trade <digits>" to handle multiple trades per page/block
            trade_starts = [m.start() for m in re.finditer(r"\bTrade\s+\d+", page_text, re.IGNORECASE)]
            sections = []
            if trade_starts:
                for idx, start in enumerate(trade_starts):
                    end = trade_starts[idx + 1] if idx + 1 < len(trade_starts) else len(page_text)
                    sections.append(page_text[start:end])
            else:
                sections = [page_text]

            for section in sections:
                trade_id_m = re.search(patterns["trade_id"], section)
                if not trade_id_m:
                    trade_id_m = re.search(r"\b[A-Z]{2,5}-\d{4}-\d{4,6}\b", section)
                    if not trade_id_m:
                        continue
                
                raw_extracted = {}
                raw_extracted["trade_id"] = trade_id_m.group(0)

                # 1. Layout-aware offset parser for OCR block layouts
                sec_lines = [line.strip() for line in section.split("\n") if line.strip()]
                label_to_field = {
                    "counterparty": "counterparty",
                    "lei": "lei",
                    "domicile": "domicile",
                    "settlement status": "settlement_status",
                    "settelement status": "settlement_status",
                    "status": "settlement_status",
                    "uti": "uti",
                    "notional": "notional_amount",
                    "settlement date": "settlement_date",
                    "value date": "settlement_date",
                    "premium settle": "premium_settle_date",
                    "trader": "trader",
                    "book": "book",
                    "portfolio": "portfolio",
                    "strike": "strike_rate"
                }
                
                for i in range(len(sec_lines) - 4):
                    hits = 0
                    block_fields = []
                    for offset in range(4):
                        item = sec_lines[i + offset].lower()
                        found_field = None
                        for kw, fld in label_to_field.items():
                            if kw in ("book", "trader", "strike", "portfolio", "lei", "uti", "status"):
                                if item == kw:
                                    found_field = fld
                                    break
                            else:
                                if kw in item:
                                    found_field = fld
                                    break
                        if found_field:
                            hits += 1
                            block_fields.append(found_field)
                        else:
                            block_fields.append(None)
                    
                    if hits >= 3:
                        for offset in range(4):
                            fld = block_fields[offset]
                            if fld and (i + 4 + offset < len(sec_lines)):
                                val = sec_lines[i + 4 + offset].strip()
                                # Avoid matching another label as a value
                                is_val_label = val.lower().strip() in label_to_field
                                if not is_val_label:
                                    raw_extracted[fld] = val

                # 2. Fallback to Regex parser for missing fields
                for field, pat in patterns.items():
                    if field not in raw_extracted or not raw_extracted[field]:
                        m = re.search(pat, section, re.IGNORECASE)
                        if m:
                            val = m.group(1) if m.groups() else m.group(0)
                            raw_extracted[field] = val.strip()

                if "notional_amount" in raw_extracted:
                    num_m = re.search(r"[\d,]+(?:\.\d+)?", str(raw_extracted["notional_amount"]))
                    if num_m:
                        raw_extracted["notional_amount"] = num_m.group(0)

                opt_type_m = re.search(r"\b(Call|Put)\b", section, re.IGNORECASE)
                if opt_type_m:
                    raw_extracted["option_type"] = opt_type_m.group(0)

                ex_style_m = re.search(r"\b(American|European)\b", section, re.IGNORECASE)
                if ex_style_m:
                    raw_extracted["exercise_style"] = ex_style_m.group(0)

                normalized = _normalize_row(raw_extracted)
                if normalized.get("trade_id"):
                    trades.append(normalized)
                    for k, v in normalized.items():
                        if v != "" and k in _KNOWN_FIELDS:
                            canonical_cols.add(k)
                    if len(trades) >= max_rows:
                        break
            if len(trades) >= max_rows:
                break

    return trades, sorted(list(canonical_cols)), sorted(list(unmapped))


def extract_attachment(
    filename: str,
    data: bytes,
    *,
    supported_exts: Tuple[str, ...] = SUPPORTED_EXTS,
    max_rows: int = DEFAULT_MAX_ROWS,
) -> ExtractionResult:
    """Parse one attachment into a structured :class:`ExtractionResult`.

    Never raises. Unsupported types and parse failures come back with an empty
    trade list and an explanatory ``status`` (and ``error`` where relevant).
    """
    ftype = file_type_for(filename)
    if ftype == "unsupported" or not is_supported(filename, supported_exts):
        return ExtractionResult(filename=filename, file_type=ftype, status="unsupported")

    try:
        if ftype == "csv":
            rows = _read_csv_rows(data or b"", max_rows)
            dict_rows, canonical_cols, unmapped = _rows_to_dicts(rows, max_rows)
            trades = [r for r in dict_rows if str(r.get("trade_id") or "").strip()]
        elif ftype == "xlsx":
            rows = _read_xlsx_rows(data or b"", max_rows)
            dict_rows, canonical_cols, unmapped = _rows_to_dicts(rows, max_rows)
            trades = [r for r in dict_rows if str(r.get("trade_id") or "").strip()]
        elif ftype == "pdf":
            trades, canonical_cols, unmapped = _read_pdf_trades(data or b"", max_rows)
        else:
            return ExtractionResult(filename=filename, file_type=ftype, status="unsupported")
    except Exception as exc:  # noqa: BLE001 - one bad file must not stop the batch
        return ExtractionResult(filename=filename, file_type=ftype, status="error", error=str(exc))

    status = "success" if trades else "empty"
    return ExtractionResult(
        filename=filename,
        file_type=ftype,
        status=status,
        trade_count=len(trades),
        trades=trades,
        columns=canonical_cols,
        unmapped_columns=unmapped,
    )


def extract_trades(
    filename: str,
    data: bytes,
    *,
    supported_exts: Tuple[str, ...] = SUPPORTED_EXTS,
    max_rows: int = DEFAULT_MAX_ROWS,
) -> List[Dict[str, Any]]:
    """Convenience wrapper: return just the normalized trade rows (``[]`` on failure)."""
    return extract_attachment(
        filename, data, supported_exts=supported_exts, max_rows=max_rows
    ).trades
