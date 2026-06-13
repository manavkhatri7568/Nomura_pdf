"""Compare & Match — exposed as an endpoint.

The step that runs *after* extraction: it rebuilds the trade register from every
stored RELEVANT case (trades parsed from xlsx/csv attachments + fields parsed
from single-trade email bodies), then reconciles each trade against the golden
source — populating missing fields and flagging field-level breaks with a
confidence score.

    GET /match/trades   → the enriched + compared trade register
"""

from pathlib import Path

from fastapi import APIRouter, Depends

from agent.attachment_extractor import extract_attachment, is_supported
from agent.body_extractor import parse_body_fields
from agent.compare_match import CompareMatcher, GoldenSource
from api.deps import get_config, get_correlation_id, open_db
from api.models import Envelope, success
from config.settings import EmailAgentConfig
from utils.audit import record_audit
from utils.logger import get_logger

router = APIRouter(prefix="/match", tags=["match"])
logger = get_logger("api.match")


def _gather_extracted_trades(cfg: EmailAgentConfig, db) -> list[dict]:
    """Rebuild the full extracted register from stored cases (attachment + body).

    Mirrors the merge the Extract step does: attachment trades (one row per
    blotter line) plus body trades for relevant cases that have no spreadsheet
    attachment, de-duplicated by trade id (attachment preferred).
    """
    cases = [c for c in db.list_cases() if c.get("classification_label") == "RELEVANT"]

    att_rows: list[dict] = []
    att_message_ids: set = set()
    body_rows: list[dict] = []

    for case in cases:
        folder = case.get("case_folder")
        if not folder:
            continue
        case_dir = Path(folder)
        att_dir = case_dir / "attachments"

        produced_attachment = False
        if att_dir.exists():
            for f in sorted(att_dir.iterdir()):
                if not f.is_file() or not is_supported(f.name):
                    continue
                try:
                    res = extract_attachment(f.name, f.read_bytes())
                except Exception as exc:  # noqa: BLE001 - one bad file never breaks the batch
                    logger.warning("match: extract failed for %s: %s", f.name, exc)
                    continue
                for row in res.trades:
                    att_rows.append({**row, "source": f"Attachment ({res.file_type})",
                                     "source_file": f.name,
                                     "source_message_id": case.get("message_id")})
                    produced_attachment = True

        if produced_attachment:
            att_message_ids.add(case.get("message_id"))
            continue

        # No spreadsheet attachment → parse the single-trade fields from the body.
        tid = case.get("trade_id")
        if not tid or str(tid).startswith("UNKNOWN"):
            continue
        body = ""
        bpath = case_dir / "email_body.txt"
        if bpath.exists():
            try:
                body = bpath.read_text(encoding="utf-8")
            except Exception:  # noqa: BLE001
                body = ""
        fields = parse_body_fields(case.get("subject", ""), body, trade_id=tid)
        if not fields.get("counterparty"):
            # fall back to the sender's display name (mirrors the UI behaviour)
            sender = (case.get("sender") or "").split("<")[0].split("(")[0].strip()
            if sender:
                fields["counterparty"] = sender
        body_rows.append({**fields, "source": "Body",
                          "source_message_id": case.get("message_id")})

    # De-dup by trade id (attachment preferred over body).
    by_id: dict = {}
    for r in [*body_rows, *att_rows]:
        key = r.get("trade_id") or r.get("source_message_id")
        prev = by_id.get(key)
        if prev is None or (r.get("source", "").startswith("Attachment")
                            and not prev.get("source", "").startswith("Attachment")):
            by_id[key] = r
    return sorted(by_id.values(), key=lambda r: str(r.get("trade_id") or ""))


@router.get("/trades", response_model=Envelope)
def match_trades(cfg: EmailAgentConfig = Depends(get_config),
                 cid: str = Depends(get_correlation_id)) -> Envelope:
    """Match every extracted trade against the golden source; enrich + compare."""
    db = open_db(cfg)
    try:
        extracted = _gather_extracted_trades(cfg, db)
    finally:
        db.close()

    golden = GoldenSource(cfg.golden_source_path, sheet=cfg.golden_source_sheet, key=cfg.match_key)
    matcher = CompareMatcher(
        golden, key=cfg.match_key, match_fields=cfg.match_fields,
        tolerance=cfg.match_numeric_tolerance, break_threshold=cfg.match_break_threshold,
        enrich=cfg.match_enrich_enabled,
    )
    results = matcher.match(extracted)
    summary = matcher.summarize(results)

    # Merge the completed record to the top level + a compact "match" block.
    trades = []
    for src, res in zip(extracted, results):
        d = res.as_dict()
        completed = d.pop("completed")
        trades.append({
            **completed,
            "source": src.get("source"),
            "source_file": src.get("source_file"),
            "source_message_id": src.get("source_message_id"),
            "match": d,
        })

    logger.info("match.trades -> %d trade(s) | %s | golden=%s(%d) cid=%s",
                len(trades), summary["by_status"], golden.available, len(golden), cid)
    record_audit("trades.matched", "success", actor="api-client", correlation_id=cid,
                 log_dir=cfg.audit_log_dir, total=summary["total"],
                 by_status=summary["by_status"], fields_filled=summary["fields_filled"])

    return success({
        "count": len(trades),
        "golden_source": {
            "available": golden.available,
            "records": len(golden),
            "path": cfg.golden_source_path,
        },
        "match_fields": cfg.match_fields,
        "summary": summary,
        "trades": trades,
    }, cid)
