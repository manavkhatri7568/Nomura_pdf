"""Extract trade fields from a single-trade email body + subject.

Real FX-settlement *blotter* emails carry their trades in an attachment
(handled by :mod:`agent.attachment_extractor`). The other relevant emails are
*single-trade* notifications whose fields live in the cover text — a "Trade
Details" block in the body plus the deal reference / currency pair / UTI in the
subject. This module turns that text into one normalized trade dict.

Output uses the **same canonical field names** as the attachment extractor and
the golden source, and reuses its value coercers, so a body-parsed trade and a
spreadsheet-parsed trade compare apples-to-apples in Compare & Match.

Mirrors the regex logic the frontend used (frontend/components/pipeline/
StepExtract.js → parseTradeFields), moved server-side so the agent can carry a
complete trade record into the Compare & Match step on its own.

Never raises: a field that cannot be found is simply omitted.
"""

import re
from typing import Any, Dict, Optional

from agent.attachment_extractor import _coerce_date, _coerce_number

# Bare/symbol currency → ISO code (mirrors the generator's amount styles).
_SYMBOL_MAP = {
    "A$": "AUD", "C$": "CAD", "NZ$": "NZD", "HK$": "HKD", "S$": "SGD",
    "$": "USD", "£": "GBP", "€": "EUR", "¥": "JPY", "kr": "SEK", "CHF": "CHF",
}
_SYMBOL_RE = r"(NZ\$|HK\$|A\$|C\$|S\$|\$|£|€|¥|kr|CHF)"


def _field(body: str, label_re: str) -> Optional[str]:
    """Grab a 'Label: value' line value (same line only — never the next line)."""
    m = re.search(label_re + r"\s*:[^\S\n\r]*([^\n\r*]+)", body, re.IGNORECASE)
    if not m:
        return None
    val = m.group(1).replace("*", "").strip()
    return val or None


def parse_body_fields(subject: str, body: str, *, trade_id: Optional[str] = None) -> Dict[str, Any]:
    """Parse a single-trade email into a canonical, normalized trade dict."""
    subject = subject or ""
    body = body or ""
    full = f"{subject} {body}"
    out: Dict[str, Any] = {}
    if trade_id:
        out["trade_id"] = trade_id

    # -- Currency pair: subject first (EUR/USD), then a body "Currency Pair:" line
    pair = None
    m = re.search(r"\b([A-Z]{3})/([A-Z]{3})\b", subject)
    if m:
        pair = m.group(0)
    if not pair:
        bp = re.search(r"Currency\s*Pair\s*:[^\S\n\r]*([A-Z]{3}/[A-Z]{3})", body, re.IGNORECASE)
        if bp:
            pair = bp.group(1).upper()
    if pair:
        out["currency_pair"] = pair
        out["base_currency"] = pair.split("/")[0]
        out["quote_currency"] = pair.split("/")[1]

    # -- UTI (subject or body)
    m = re.search(r"\bUTI[A-Z0-9]{6,}\b", full)
    if m:
        out["uti"] = m.group(0)

    # -- Trade date from subject: dd_mm_yy | dd/mm/yy | dd/mm/yyyy | yyyy-mm-dd
    td = None
    m = re.search(r"\b(\d{2})[_](\d{2})[_](\d{2,4})\b", subject)
    if m:
        yr = ("20" + m.group(3)) if len(m.group(3)) == 2 else m.group(3)
        td = f"{m.group(1)}/{m.group(2)}/{yr}"
    if not td:
        m = re.search(r"\b(\d{2})/(\d{2})/(\d{4})\b", subject)
        if m:
            td = f"{m.group(1)}/{m.group(2)}/{m.group(3)}"
    if not td:
        m = re.search(r"\b(\d{2})/(\d{2})/(\d{2})\b", subject)
        if m:
            td = f"{m.group(1)}/{m.group(2)}/20{m.group(3)}"
    if not td:
        m = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", subject)
        if m:
            td = m.group(1)
    if td:
        out["trade_date"] = _coerce_date(td)

    # -- Body fields
    bs = _field(body, r"Buy\s*/\s*Sell")
    if bs:
        out["buy_sell"] = bs
    cp = _field(body, r"Counterparty")
    if cp:
        out["counterparty"] = cp
    vd = _field(body, r"Value\s*Date")
    if vd and len(vd) > 2:
        out["settlement_date"] = _coerce_date(vd)

    # -- Amount → notional_amount (+ notional_currency from code or symbol)
    amount_raw = _field(body, r"Amount")
    if amount_raw:
        ccy = None
        code = re.match(r"^([A-Z]{3})\b", amount_raw)
        if code:
            ccy = code.group(1)
        else:
            sym = re.match(r"^" + _SYMBOL_RE, amount_raw)
            if sym:
                ccy = _SYMBOL_MAP.get(sym.group(1))
        # numeric part: strip a leading code or symbol, then coerce
        num = re.sub(r"^[A-Z]{3}\s*", "", amount_raw)
        num = re.sub(r"^" + _SYMBOL_RE + r"\s*", "", num)
        out["notional_amount"] = _coerce_number(num.strip())
        # base of the pair wins for notional ccy; else inferred from the amount
        out.setdefault("notional_currency", out.get("base_currency") or ccy)

    return out
