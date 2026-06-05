"""Trade extraction from stored email attachments (xlsx / csv).

For each RELEVANT case the agent stored, the attachment bytes were written to
``<case_folder>/attachments/``. This reads those spreadsheets back, parses each
into normalized trade rows, and returns the aggregated trade register — the
Phase-2-style "blotter" extracted from the batch emails.

PDF attachments are skipped here by design (the sample SSI PDFs are vector-only
and would need OCR).
"""

from pathlib import Path

from fastapi import APIRouter, Depends

from agent.attachment_extractor import extract_attachment, is_supported
from api.deps import get_config, get_correlation_id, open_db
from api.models import Envelope, success
from config.settings import EmailAgentConfig
from utils.audit import record_audit
from utils.logger import get_logger

router = APIRouter(prefix="/extract", tags=["extract"])
logger = get_logger("api.extract")


@router.get("/trades", response_model=Envelope)
def trades(cfg: EmailAgentConfig = Depends(get_config),
           cid: str = Depends(get_correlation_id)) -> Envelope:
    """Aggregate trade rows parsed from every stored case's xlsx/csv attachments."""
    db = open_db(cfg)
    try:
        cases = [c for c in db.list_cases() if c.get("classification_label") == "RELEVANT"]
    finally:
        db.close()

    all_trades: list[dict] = []
    sources: list[dict] = []
    seen: set[str] = set()

    for case in cases:
        folder = case.get("case_folder")
        if not folder:
            continue
        att_dir = Path(folder) / "attachments"
        if not att_dir.exists():
            continue
        for f in sorted(att_dir.iterdir()):
            if not f.is_file() or not is_supported(f.name):
                continue
            try:
                result = extract_attachment(f.name, f.read_bytes())
            except Exception as exc:  # noqa: BLE001 - one bad file never breaks the batch
                logger.warning("extract failed for %s: %s", f.name, exc)
                continue

            sources.append({
                "file": f.name,
                "case_trade_id": case.get("trade_id"),
                "message_id": case.get("message_id"),
                "subject": case.get("subject"),
                "file_type": result.file_type,
                "status": result.status,
                "trade_count": result.trade_count,
                "unmapped_columns": result.unmapped_columns,
            })

            for row in result.trades:
                tid = str(row.get("trade_id") or "").strip()
                if tid and tid in seen:
                    continue  # dedup across batches by trade id
                if tid:
                    seen.add(tid)
                all_trades.append({
                    **row,
                    "source": f"Attachment ({result.file_type})",
                    "source_file": f.name,
                    "source_message_id": case.get("message_id"),
                })

    logger.info("extract.trades -> %d trade(s) from %d file(s) across %d case(s) cid=%s",
                len(all_trades), len(sources), len(cases), cid)
    record_audit("trades.extracted", "success", actor="api-client", correlation_id=cid,
                 log_dir=cfg.audit_log_dir, trade_count=len(all_trades), files=len(sources))

    return success({
        "count": len(all_trades),
        "trades": all_trades,
        "sources": sources,
    }, cid)
