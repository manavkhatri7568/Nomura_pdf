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
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

SUPPORTED_EXTS: Tuple[str, ...] = (".xlsx", ".xlsm", ".csv")
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
        else:
            rows = _read_xlsx_rows(data or b"", max_rows)
    except Exception as exc:  # noqa: BLE001 - one bad file must not stop the batch
        return ExtractionResult(filename=filename, file_type=ftype, status="error", error=str(exc))

    dict_rows, canonical_cols, unmapped = _rows_to_dicts(rows, max_rows)
    # Keep only rows that actually carry a trade id (drops totals/footers/noise).
    trades = [r for r in dict_rows if str(r.get("trade_id") or "").strip()]

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
