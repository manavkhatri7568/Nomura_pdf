"""Tests for Compare & Match: golden-source enrichment + field comparison.

Unit tests build a tiny in-memory golden workbook so they're self-contained.
The API test runs the full pipeline then hits GET /match/trades over real HTTP.
"""

import io

import openpyxl
import pytest

from agent.body_extractor import parse_body_fields
from agent.compare_match import (
    BREAK,
    ENRICHED,
    MATCHED,
    NEAR_MATCH,
    UNMATCHED,
    CompareMatcher,
    GoldenSource,
    values_agree,
)

# Canonical golden headers (a subset of the real master-dataset schema).
HEADERS = [
    "Trade ID", "UTI", "Trade Date", "Counterparty Name", "Currency Pair",
    "Option Type", "Buy / Sell", "Notional Amount", "Notional Currency",
    "Strike Rate", "Expiry Date", "Settlement Date", "Trader", "Book",
]
ROWS = [
    ["FXOPT-2026-00001", "UTIAAA0001", "26-May-2026", "Goldman Sachs International",
     "EUR/USD", "Put", "Buy", 2189177, "EUR", 1.1414, "18-Oct-2026", "20-Oct-2026", "V.Rao", "FXOPT-BOOK1"],
    ["FXOPT-2026-00047", "UTIBBB0047", "26-May-2026", "JPMorgan Chase Bank N.A.",
     "EUR/GBP", "Call", "Sell", 2243751, "EUR", 1.148, "16-Aug-2026", "18-Aug-2026", "S.Nair", "FXOPT-BOOK2"],
]


def _golden_file(tmp_path, headers=HEADERS, rows=ROWS):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "FX Options Trade Blotter"
    ws.append(headers)
    for r in rows:
        ws.append(r)
    path = tmp_path / "golden.xlsx"
    wb.save(path)
    return GoldenSource(str(path))


# ---- value agreement --------------------------------------------------------

def test_numeric_within_tolerance_agrees():
    assert values_agree("notional_amount", 1000000, 1000500, tolerance=0.01)      # 0.05%
    assert not values_agree("notional_amount", 1000000, 1200000, tolerance=0.01)  # 20%


def test_date_canonicalization_agrees():
    assert values_agree("settlement_date", "20-Oct-2026", "20/10/2026", tolerance=0)


def test_string_fold_agrees():
    assert values_agree("counterparty", "Goldman  SACHS", "goldman sachs", tolerance=0)


# ---- golden source ----------------------------------------------------------

def test_golden_loads_and_indexes(tmp_path):
    g = _golden_file(tmp_path)
    assert g.available
    assert len(g) == 2
    rec = g.lookup("FXOPT-2026-00001")
    assert rec["currency_pair"] == "EUR/USD"
    assert rec["notional_amount"] == 2189177
    assert g.lookup("NOPE") is None


def test_missing_golden_file_is_empty_not_error(tmp_path):
    g = GoldenSource(str(tmp_path / "does_not_exist.xlsx"))
    assert not g.available
    assert len(g) == 0
    assert g.lookup("FXOPT-2026-00001") is None


# ---- matcher ----------------------------------------------------------------

def _matcher(g):
    return CompareMatcher(
        g, match_fields=["currency_pair", "buy_sell", "notional_amount",
                         "counterparty", "settlement_date", "strike_rate"],
        tolerance=0.01, break_threshold=0.6,
    )


# A trade carrying *every* golden field for 00001 (so nothing needs filling).
FULL_00001 = {
    "trade_id": "FXOPT-2026-00001", "uti": "UTIAAA0001", "trade_date": "26-May-2026",
    "counterparty": "Goldman Sachs International", "currency_pair": "EUR/USD",
    "option_type": "Put", "buy_sell": "Buy", "notional_amount": 2189177,
    "notional_currency": "EUR", "strike_rate": 1.1414, "expiry_date": "18-Oct-2026",
    "settlement_date": "20-Oct-2026", "trader": "V.Rao", "book": "FXOPT-BOOK1",
}


def test_exact_match_no_fill(tmp_path):
    g = _matcher(_golden_file(tmp_path))
    r = g.match_one(dict(FULL_00001))
    assert r.status == MATCHED
    assert r.confidence == 1.0
    assert r.filled_fields == []


def test_enrichment_fills_missing_fields(tmp_path):
    g = _matcher(_golden_file(tmp_path))
    # only a couple of fields present (and they agree) → the rest are filled
    r = g.match_one({"trade_id": "FXOPT-2026-00001", "currency_pair": "EUR/USD",
                     "buy_sell": "Buy"})
    assert r.status == ENRICHED
    assert r.confidence == 1.0
    assert "uti" in r.filled_fields
    assert "strike_rate" in r.filled_fields
    assert r.completed["uti"] == "UTIAAA0001"
    assert r.completed["strike_rate"] == 1.1414
    # present fields are not overwritten
    assert r.completed["currency_pair"] == "EUR/USD"


def test_break_on_conflicting_fields(tmp_path):
    g = _matcher(_golden_file(tmp_path))
    # body-style trade: most economics disagree with golden
    r = g.match_one({"trade_id": "FXOPT-2026-00047", "currency_pair": "USD/JPY",
                     "buy_sell": "Buy", "notional_amount": 10534052,
                     "counterparty": "Barclays PLC", "settlement_date": "18-Jul-2026"})
    assert r.status == BREAK
    assert r.confidence < 0.6
    breaks = [d.field for d in r.diffs if not d.agree]
    assert "currency_pair" in breaks and "counterparty" in breaks
    # still enriches the fields the email never carried
    assert "uti" in r.filled_fields and "trader" in r.filled_fields


def test_near_match_when_mostly_agrees(tmp_path):
    g = _matcher(_golden_file(tmp_path))
    # 5 of 6 compared fields agree, 1 differs → confidence ~0.83 → NEAR_MATCH
    r = g.match_one({"trade_id": "FXOPT-2026-00047", "currency_pair": "EUR/GBP",
                     "buy_sell": "Sell", "notional_amount": 2243751,
                     "counterparty": "JPMorgan Chase Bank N.A.",
                     "settlement_date": "18-Aug-2026", "strike_rate": 9.99})
    assert r.status == NEAR_MATCH
    assert 0.6 <= r.confidence < 1.0


def test_unmatched_when_no_golden_record(tmp_path):
    g = _matcher(_golden_file(tmp_path))
    r = g.match_one({"trade_id": "FXOPT-2026-99999", "currency_pair": "EUR/USD"})
    assert r.status == UNMATCHED
    assert r.confidence == 0.0
    assert r.filled_fields == []


def test_summary_counts(tmp_path):
    g = _matcher(_golden_file(tmp_path))
    results = g.match([
        dict(FULL_00001),                                            # MATCHED (nothing to fill)
        {"trade_id": "FXOPT-2026-00001", "currency_pair": "EUR/USD"},  # ENRICHED
        {"trade_id": "FXOPT-2026-99999", "currency_pair": "EUR/USD"},  # UNMATCHED
    ])
    s = g.summarize(results)
    assert s["total"] == 3
    assert s["by_status"][MATCHED] == 1
    assert s["by_status"][ENRICHED] == 1
    assert s["by_status"][UNMATCHED] == 1
    assert s["fields_filled"] > 0


# ---- body extractor ---------------------------------------------------------

def test_body_extractor_parses_trade_details():
    subject = "FX Trade Settlement[FXOPT-2026-00047] – EUR/USD – 26_05_26 - UTIZZZ12345"
    body = (
        "Trade Details:\n"
        "  * Deal Reference: FXOPT-2026-00047\n"
        "  * Currency Pair: EUR/USD\n"
        "  * Buy/Sell: Buy\n"
        "  * Amount: EUR 2,189,177.00\n"
        "  * Counterparty: Barclays PLC\n"
        "  * Value Date: 20-Oct-2026\n"
    )
    f = parse_body_fields(subject, body, trade_id="FXOPT-2026-00047")
    assert f["trade_id"] == "FXOPT-2026-00047"
    assert f["currency_pair"] == "EUR/USD"
    assert f["buy_sell"] == "Buy"
    assert f["counterparty"] == "Barclays PLC"
    assert f["notional_amount"] == 2189177          # comma string → number
    assert f["notional_currency"] == "EUR"          # base of pair
    assert f["settlement_date"] == "20-Oct-2026"    # canonical date
    assert f["uti"] == "UTIZZZ12345"


def test_body_extractor_handles_blank_fields():
    # a "partial" email with a blank Value Date must not grab the next line
    body = "Trade Details:\n  * Buy/Sell: Sell\n  * Value Date:\n  * Counterparty: HSBC Bank PLC\n"
    f = parse_body_fields("FX Trade Settlement FXOPT-2026-00055", body, trade_id="FXOPT-2026-00055")
    assert f.get("buy_sell") == "Sell"
    assert "settlement_date" not in f          # blank, not the counterparty line
    assert f.get("counterparty") == "HSBC Bank PLC"


# ---- API endpoint -----------------------------------------------------------

def test_match_trades_endpoint(api_client, clean_state):
    # run the pipeline first so there are stored cases to match
    run = api_client.post("/agent/run", json={"source": "local"})
    assert run.status_code == 200

    resp = api_client.get("/match/trades")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "success"
    data = body["data"]

    assert data["golden_source"]["available"] is True
    assert data["golden_source"]["records"] == 100
    # the 27-email synthetic inbox yields 12 relevant single-trade (body) cases
    assert data["count"] == 12
    assert data["summary"]["total"] == 12
    assert data["summary"]["unmatched"] == 0          # all trade ids are in the golden source
    assert data["summary"]["fields_filled"] > 0       # missing fields were populated

    # every returned trade carries a match block + a completed record
    t = data["trades"][0]
    assert "match" in t and "status" in t["match"]
    assert t["trade_id"].startswith("FXOPT-2026-")
    # enrichment populated fields the body never carried (e.g. UTI/strike/book)
    assert any(t["match"]["filled_count"] > 0 for t in data["trades"])
