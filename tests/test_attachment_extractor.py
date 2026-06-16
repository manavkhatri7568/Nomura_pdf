"""Unit tests for the .xlsx / .csv trade-blotter attachment extractor.

Fixtures are built in-memory (CSV bytes + an openpyxl workbook) so the tests are
self-contained and don't depend on any external sample emails. The core promise
verified here: CSV and XLSX inputs normalize to the *same* canonical values.
"""

import io

import pytest

from agent.attachment_extractor import (
    ExtractionResult,
    extract_attachment,
    extract_trades,
    file_type_for,
    is_supported,
)

# Real blotter header (matches the production FX_Options_trade_*.csv exactly).
HEADER = [
    "Trade ID", "UTI", "Trade Date", "Counterparty Code", "Counterparty Name",
    "Currency Pair", "Base Currency", "Quote Currency", "Option Type",
    "Exercise Style", "Buy / Sell", "Notional Amount", "Notional Currency",
    "Strike Rate", "Expiry Date", "Settlement Date", "Premium Amount",
    "Premium Currency", "Premium Settle Date", "Delta", "Implied Vol (%)",
    "Settlement Status", "Portfolio", "Trader", "Book",
]

# Two trades, as they'd appear in a CSV (every value a string).
CSV_ROWS = [
    ["FXOPT-2026-00035", "UTI2CWTG1M8XFDJGF1C8WQU0035", "29-May-26", "HSBC", "HSBC Bank PLC",
     "EUR/GBP", "EUR", "GBP", "Put", "European", "Sell", "897,327.00", "EUR", "1.0711",
     "13-Oct-2026", "15-Oct-2026", "5,898.08", "EUR", "30-May-2026", "-0.6966", "8.3200",
     "Matched", "CLIENT-FX", "V.Rao", "FXOPT-BOOK3"],
    ["FXOPT-2026-00036", "UTIQBNKX9DVNU80B6UGVS8Q0036", "29-May-26", "HSBC", "HSBC Bank PLC",
     "USD/CAD", "USD", "CAD", "Put", "European", "Sell", "987,568.00", "USD", "1.1051",
     "21-Dec-2026", "23-Dec-2026", "10,363.02", "USD", "28-May-2026", "-0.3816", "6.1100",
     "Confirmed", "FX-DESK-A", "V.Rao", "FXOPT-BOOK3"],
]


def _csv_bytes(header=HEADER, rows=CSV_ROWS) -> bytes:
    import csv
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    for r in rows:
        w.writerow(r)
    return buf.getvalue().encode("utf-8")


def _xlsx_bytes(header=HEADER, rows=CSV_ROWS, *, native_types=False, title_row=False) -> bytes:
    import openpyxl
    from datetime import datetime
    wb = openpyxl.Workbook()
    ws = wb.active
    if title_row:
        ws.append(["FX Options Trade Blotter — 29/05/2026"])
    ws.append(header)
    for r in rows:
        if native_types:
            row = list(r)
            # Notional Amount (idx 11) -> int, Strike Rate (13) -> float,
            # Trade Date (2) / Expiry (14) / Settlement (15) -> datetime.
            row[11] = int(float(r[11].replace(",", "")))
            row[13] = float(r[13])
            row[2] = datetime(2026, 5, 29)
            row[14] = datetime(2026, 10, 13)
            row[15] = datetime(2026, 10, 15)
            ws.append(row)
        else:
            ws.append(list(r))
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


# ---- type helpers -----------------------------------------------------------

def test_file_type_and_support():
    assert file_type_for("a.CSV") == "csv"
    assert file_type_for("b.xlsx") == "xlsx"
    assert file_type_for("c.pdf") == "pdf"
    assert is_supported("x.xlsm") and is_supported("x.csv") and is_supported("x.pdf")


# ---- CSV --------------------------------------------------------------------

def test_csv_extracts_and_maps_headers():
    res = extract_attachment("FX_Options_trade_290526_csv.csv", _csv_bytes())
    assert isinstance(res, ExtractionResult)
    assert res.status == "success"
    assert res.file_type == "csv"
    assert res.trade_count == 2
    t = res.trades[0]
    assert t["trade_id"] == "FXOPT-2026-00035"
    assert t["counterparty"] == "HSBC Bank PLC"
    assert t["currency_pair"] == "EUR/GBP"
    assert res.unmapped_columns == []  # every column is recognised


def test_csv_normalizes_dates_and_numbers():
    t = extract_trades("x.csv", _csv_bytes())[0]
    # date: "29-May-26" -> canonical 4-digit year
    assert t["trade_date"] == "29-May-2026"
    assert t["settlement_date"] == "15-Oct-2026"
    # amounts: comma string -> number; whole -> int, fractional -> float
    assert t["notional_amount"] == 897327
    assert t["premium_amount"] == 5898.08
    assert t["strike_rate"] == 1.0711
    assert t["delta"] == -0.6966
    assert t["implied_vol"] == 8.32


# ---- XLSX -------------------------------------------------------------------

def test_xlsx_extracts_string_cells():
    res = extract_attachment("FX_Options_trade_270526.xlsx", _xlsx_bytes())
    assert res.status == "success"
    assert res.file_type == "xlsx"
    assert res.trade_count == 2
    assert res.trades[1]["trade_id"] == "FXOPT-2026-00036"


def test_xlsx_native_types_match_csv_output():
    """Native Excel datetimes/numbers normalize identically to CSV strings."""
    csv_t = extract_trades("x.csv", _csv_bytes())[0]
    xlsx_t = extract_trades("x.xlsx", _xlsx_bytes(native_types=True))[0]
    for field in ("trade_date", "settlement_date", "notional_amount", "strike_rate"):
        assert csv_t[field] == xlsx_t[field], field


def test_xlsx_with_title_row_above_header():
    res = extract_attachment("blotter.xlsx", _xlsx_bytes(title_row=True))
    assert res.status == "success"
    assert res.trade_count == 2  # header located beneath the banner row


# ---- robustness / never-raises ---------------------------------------------

def test_unsupported_type_returns_empty():
    res = extract_attachment("ssi_report.txt", b"hello world")
    assert res.status == "unsupported"
    assert res.trades == []


def test_corrupt_pdf_returns_error_not_raise():
    res = extract_attachment("broken.pdf", b"%PDF-1.4 corrupt pdf content")
    assert res.status == "error"
    assert res.error
    assert res.trades == []


def test_corrupt_xlsx_returns_error_not_raise():
    res = extract_attachment("broken.xlsx", b"not a real zip/xlsx")
    assert res.status == "error"
    assert res.error
    assert res.trades == []


def test_empty_csv_returns_empty_status():
    res = extract_attachment("empty.csv", b"")
    assert res.status == "empty"
    assert res.trades == []


def test_rows_without_trade_id_are_dropped():
    rows = CSV_ROWS + [["", "", "", "", "TOTALS", "", "", "", "", "", "", "1,884,895", ""]]
    res = extract_attachment("x.csv", _csv_bytes(rows=rows))
    assert res.trade_count == 2  # the trailing totals row (no trade id) is dropped


def test_max_rows_cap_is_respected():
    many = CSV_ROWS * 50  # 100 rows
    res = extract_attachment("x.csv", _csv_bytes(rows=many), max_rows=10)
    assert res.trade_count == 10


def test_pdf_tabular_extraction(monkeypatch):
    class MockPage:
        def extract_tables(self):
            return [
                [
                    ["Trade ID", "UTI", "Counterparty Name", "Currency Pair", "Notional Amount"],
                    ["FXOPT-2026-00001", "UTI1", "Bank A", "EUR/USD", "1,000,000"]
                ]
            ]
        def extract_text(self):
            return ""

    class MockPDF:
        def __init__(self, *args, **kwargs):
            self.pages = [MockPage()]
        def __enter__(self):
            return self
        def __exit__(self, exc_type, exc_val, exc_tb):
            pass

    import pdfplumber
    monkeypatch.setattr(pdfplumber, "open", MockPDF)

    res = extract_attachment("mock_tabular.pdf", b"%PDF-1.4 ...")
    assert res.status == "success"
    assert res.trade_count == 1
    t = res.trades[0]
    assert t["trade_id"] == "FXOPT-2026-00001"
    assert t["counterparty"] == "Bank A"
    assert t["notional_amount"] == 1000000


def test_pdf_text_extraction_fallback(monkeypatch):
    class MockPage:
        def extract_tables(self):
            return [[["Some Header", "Some Value"]]]
        def extract_text(self):
            return (
                "Standard Settlement Instructions | FX Blotter Generated: 26/05/26\n"
                "Trade 08  FXOPT-2026-00008 AUD/USD Put American  Buy\n"
                "Counterparty : BNP Paribas S.A LEI : ROMUWSFPU8MPRO8K5P83 Domicile: Paris, France\n"
                "UTI : UTI9CHJ755NF4ZW9XA3KX7E0008 Notional (base) : 52910016 AUD Settlement date : 12/12/2026\n"
                "Trader : V.Rao Book : FXOPT-BOOK1 Portfolio: FX-DESK-A\n"
                "Settelement status - Matched Premium settle - 28/05/2026 Strike :0.9658"
            )

    class MockPDF:
        def __init__(self, *args, **kwargs):
            self.pages = [MockPage()]
        def __enter__(self):
            return self
        def __exit__(self, exc_type, exc_val, exc_tb):
            pass

    import pdfplumber
    monkeypatch.setattr(pdfplumber, "open", MockPDF)

    res = extract_attachment("mock_text.pdf", b"%PDF-1.4 ...")
    assert res.status == "success"
    assert res.trade_count == 1
    t = res.trades[0]
    assert t["trade_id"] == "FXOPT-2026-00008"
    assert t["counterparty"] == "BNP Paribas S.A"
    assert t["currency_pair"] == "AUD/USD"
    assert t["buy_sell"] == "Buy"
    assert t["notional_amount"] == 52910016
    assert t["settlement_date"] == "12-Dec-2026"
    assert t["premium_settle_date"] == "28-May-2026"
    assert t["strike_rate"] == 0.9658
    assert t["trader"] == "V.Rao"
    assert t["book"] == "FXOPT-BOOK1"
    assert t["portfolio"] == "FX-DESK-A"
    assert t["settlement_status"] == "Matched"
    assert t["option_type"] == "Put"
    assert t["exercise_style"] == "American"


def test_classifier_pdf_fallback(monkeypatch):
    from config.settings import EmailAgentConfig
    from classifier.rule_classifier import RuleClassifier

    class MockPage:
        def extract_text(self):
            return "Standard Settlement Instructions | FX Blotter\nTrade 106  FXOPT-2026-00106 AUD/USD Put\nfx trade settlement"

    class MockPDF:
        def __init__(self, *args, **kwargs):
            self.pages = [MockPage()]
        def __enter__(self):
            return self
        def __exit__(self, exc_type, exc_val, exc_tb):
            pass

    import pdfplumber
    monkeypatch.setattr(pdfplumber, "open", MockPDF)

    cfg = EmailAgentConfig()
    classifier = RuleClassifier(cfg)

    # Classify an email that only has signals inside the PDF attachment
    result = classifier.classify(
        subject="SSI Update",
        body="Please find attached SSI details.",
        attachments=[{"filename": "details.pdf", "data": b"%PDF-1.4"}]
    )

    assert result.label == "RELEVANT"
    assert result.trade_id == "FXOPT-2026-00106"
    assert "fx trade settlement" in result.matched_asset


