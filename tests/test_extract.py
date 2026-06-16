"""Tests for the xlsx/csv attachment trade extractor and the /extract/trades endpoint."""

import io
import pathlib

import openpyxl
import pytest

from agent.attachment_extractor import extract_attachment, extract_trades

# A small two-trade CSV mirroring the real blotter columns. The amount carries
# a thousands separator and the date a 2-digit year (both CSV-isms) so we can
# assert source-agnostic normalization.
CSV = (
    "Trade ID,UTI,Trade Date,Counterparty Name,Currency Pair,Buy / Sell,"
    "Notional Amount,Notional Currency,Settlement Date\n"
    'FXOPT-2026-00001,UTIABC0001,29-May-26,HSBC Bank PLC,EUR/GBP,Sell,"897,327.00",EUR,15-Oct-26\n'
    "FXOPT-2026-00002,UTIABC0002,29-May-26,Deutsche Bank AG,EUR/USD,Buy,1000000,EUR,06-Sep-2026\n"
)


def _xlsx_bytes(rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# --------------------------------------------------------------------------
# Unit: parsing
# --------------------------------------------------------------------------

def test_extract_csv_basic_and_normalization():
    r = extract_attachment("trades.csv", CSV.encode())
    assert r.status == "success"
    assert r.file_type == "csv"
    assert r.trade_count == 2

    t = r.trades[0]
    assert t["trade_id"] == "FXOPT-2026-00001"
    assert t["counterparty"] == "HSBC Bank PLC"
    assert t["currency_pair"] == "EUR/GBP"
    assert t["buy_sell"] == "Sell"
    # "897,327.00" → numeric, comma stripped
    assert t["notional_amount"] == 897327
    # 2-digit year date → canonical DD-Mon-YYYY
    assert t["trade_date"] == "29-May-2026"
    assert t["settlement_date"] == "15-Oct-2026"


def test_extract_xlsx_basic():
    data = _xlsx_bytes([
        ["Trade ID", "UTI", "Trade Date", "Counterparty Name", "Currency Pair",
         "Buy / Sell", "Notional Amount", "Notional Currency", "Settlement Date"],
        ["FXOPT-2026-00010", "UTIXYZ0010", "2026-05-27", "BNP Paribas S.A.",
         "USD/JPY", "Sell", 8423778, "USD", "29-Jul-2026"],
    ])
    r = extract_attachment("trades.xlsx", data)
    assert r.status == "success"
    assert r.file_type == "xlsx"
    assert r.trade_count == 1
    t = r.trades[0]
    assert t["trade_id"] == "FXOPT-2026-00010"
    assert t["notional_amount"] == 8423778
    assert t["counterparty"] == "BNP Paribas S.A."
    assert t["currency_pair"] == "USD/JPY"


def test_csv_and_xlsx_normalize_identically():
    """The same trade in CSV vs Excel native types yields identical canonical values."""
    header = ["Trade ID", "Trade Date", "Notional Amount", "Currency Pair"]
    csv_bytes = ("{},{}\n{}\n".format(
        ",".join(header), "", "FXOPT-2026-00050,29-May-26,\"1,234,567.00\",EUR/USD"
    )).encode()
    xlsx_bytes = _xlsx_bytes([header, ["FXOPT-2026-00050", "2026-05-29", 1234567, "EUR/USD"]])

    csv_t = extract_attachment("a.csv", ("{}\nFXOPT-2026-00050,29-May-26,\"1,234,567.00\",EUR/USD\n".format(",".join(header))).encode()).trades[0]
    xlsx_t = extract_attachment("a.xlsx", xlsx_bytes).trades[0]

    for f in ("trade_id", "trade_date", "notional_amount", "currency_pair"):
        assert csv_t[f] == xlsx_t[f], f


def test_header_detection_skips_title_row():
    data = _xlsx_bytes([
        ["FX Options Blotter — 27 May 2026"],   # banner row above the header
        [],
        ["Trade ID", "Counterparty Name", "Currency Pair", "Notional Amount"],
        ["FXOPT-2026-00099", "UBS AG", "EUR/USD", 1000000],
    ])
    r = extract_attachment("blotter.xlsx", data)
    assert r.trade_count == 1
    assert r.trades[0]["trade_id"] == "FXOPT-2026-00099"


def test_rows_without_trade_id_are_dropped():
    r = extract_attachment("h.csv", b"Trade ID,UTI,Currency Pair\n,,\nFXOPT-2026-1,U1,EUR/USD\n")
    assert r.trade_count == 1
    assert r.trades[0]["trade_id"] == "FXOPT-2026-1"


@pytest.mark.parametrize("name,data,status", [
    ("report.txt", b"hello", "unsupported"),
    ("empty.csv", b"Trade ID,UTI\n", "empty"),
    ("broken.xlsx", b"this is not a real workbook", "error"),
    ("broken.pdf", b"this is not a real pdf", "error"),
])
def test_status_paths_never_raise(name, data, status):
    r = extract_attachment(name, data)
    assert r.status == status
    assert r.trades == []
    assert extract_trades(name, data) == []  # convenience wrapper agrees


# --------------------------------------------------------------------------
# Endpoint: /extract/trades
# --------------------------------------------------------------------------

def test_extract_trades_endpoint(clean_state, api_client, monkeypatch):
    from api.deps import get_config, open_db

    class MockPage:
        def extract_tables(self):
            return []
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

    cfg = get_config()
    case_dir = pathlib.Path(cfg.processed_path) / "UNKNOWN_test_FX_Settlement_20260603"
    (case_dir / "attachments").mkdir(parents=True, exist_ok=True)
    (case_dir / "attachments" / "blotter.csv").write_bytes(CSV.encode())
    (case_dir / "attachments" / "ssi.pdf").write_bytes(b"%PDF-1.4 vector only")

    db = open_db(cfg)
    db.insert_case({
        "message_id": "msg-extract-test",
        "trade_id": "UNKNOWN_test",
        "asset_class": "FX_Settlement",
        "subject": "FX Trade Settlements batch",
        "sender": "ops@bank.com",
        "classification_label": "RELEVANT",
        "case_folder": str(case_dir),
        "attachment_count": 2,
        "status": "ingested",
    })
    db.close()

    resp = api_client.get("/extract/trades")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "success"
    data = body["data"]
    assert data["count"] == 3
    assert {t["trade_id"] for t in data["trades"]} == {"FXOPT-2026-00001", "FXOPT-2026-00002", "FXOPT-2026-00008"}
    assert {s["file"] for s in data["sources"]} == {"blotter.csv", "ssi.pdf"}
    # Verify sources list properties
    pdf_src = next(s for s in data["sources"] if s["file"] == "ssi.pdf")
    assert pdf_src["status"] == "success"
    assert pdf_src["file_type"] == "pdf"
    assert pdf_src["trade_count"] == 1



def test_extract_trades_dedups_across_files(clean_state, api_client):
    from api.deps import get_config, open_db

    cfg = get_config()
    dup_csv = (
        "Trade ID,Counterparty Name,Currency Pair,Notional Amount\n"
        "FXOPT-2026-00001,HSBC Bank PLC,EUR/GBP,500000\n"
    )
    for i, name in enumerate(("a", "b")):
        case_dir = pathlib.Path(cfg.processed_path) / f"UNKNOWN_{name}_FX_20260603"
        (case_dir / "attachments").mkdir(parents=True, exist_ok=True)
        (case_dir / "attachments" / f"{name}.csv").write_bytes(dup_csv.encode())
        db = open_db(cfg)
        db.insert_case({
            "message_id": f"msg-{name}",
            "trade_id": f"UNKNOWN_{name}",
            "classification_label": "RELEVANT",
            "case_folder": str(case_dir),
            "attachment_count": 1,
            "status": "ingested",
        })
        db.close()

    data = api_client.get("/extract/trades").json()["data"]
    # same trade id present in both files → counted once
    assert data["count"] == 1
