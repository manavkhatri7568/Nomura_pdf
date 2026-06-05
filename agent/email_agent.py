"""Email Agent Runner (Phase 1) — plain Python SPAR loop.

Sense  : read emails from the inbox connector
Plan   : iterate, skip already-processed
Act    : classify -> (relevant) store case + manifest
Reflect: log a run summary
"""

import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from agent.attachment_extractor import extract_attachment, is_supported
from classifier.rule_classifier import Classification, RuleClassifier
from config.settings import EmailAgentConfig
from connectors.local_connector import LocalEmailConnector
from storage.db_index import DBIndex
from storage.file_store import FileStore
from utils.audit import new_correlation_id, record_audit
from utils.logger import get_logger

logger = get_logger("email_agent")


@dataclass
class RunStats:
    read: int = 0
    relevant: int = 0
    ambiguous: int = 0
    irrelevant: int = 0
    duplicate: int = 0
    already_processed: int = 0
    extracted_trades: int = 0
    ambiguous_subjects: List[str] = field(default_factory=list)
    classified_emails: List[Dict] = field(default_factory=list)


class EmailAgentRunner:
    def __init__(self, config: EmailAgentConfig, connector: LocalEmailConnector,
                 classifier: RuleClassifier, store: FileStore, db: DBIndex):
        self.cfg = config
        self.connector = connector
        self.classifier = classifier
        self.store = store
        self.db = db

    @staticmethod
    def _fallback_trade_id(message_id: str) -> str:
        """Stable, collision-free id for a RELEVANT email with no extractable trade id.

        Blotter emails carry their trade ids only inside the attachment, so the
        subject yields none. A naive ``message_id[:8]`` collides across Outlook
        emails that share a server prefix (e.g. ``PN2P287M...``) — which would
        make their case folders overwrite each other. Hash the *full* message id
        instead: unique per email, identical across re-runs (keeps dedup idempotent).
        """
        mid = (message_id or "").strip("<>")
        digest = hashlib.sha1(mid.encode("utf-8")).hexdigest()[:10]
        return f"UNKNOWN_{digest}"

    def run(self, correlation_id: Optional[str] = None) -> RunStats:
        cid = correlation_id or new_correlation_id()
        audit_dir = getattr(self.cfg, "audit_log_dir", "logs")
        stats = RunStats()

        # -- SENSE --
        emails = self.connector.fetch_emails()
        stats.read = len(emails)
        record_audit("agent.run.start", "success", correlation_id=cid,
                     log_dir=audit_dir, emails_read=stats.read)

        # -- PLAN + ACT --
        for mail in emails:
            mid = mail["message_id"]

            def _email_record(label, confidence, reason, trade_id, asset_class,
                              matched_asset, matched_subject, skip_reason=None):
                return {
                    "message_id":      mid,
                    "subject":         mail.get("subject", ""),
                    "sender":          mail.get("sender", ""),
                    "received_at":     mail.get("received_at", ""),
                    "attachment_count": len(mail.get("attachments", [])),
                    "label":           label,
                    "confidence":      confidence,
                    "reason":          reason,
                    "trade_id":        trade_id,
                    "asset_class":     asset_class,
                    "matched_asset":   matched_asset,
                    "matched_subject": matched_subject,
                    "skip_reason":     skip_reason,
                }

            if self.db.message_id_exists(mid):
                result = self.classifier.classify(mail["subject"], mail["body"])
                case = self.db.get_case_by_message_id(mid)
                folder = case.get("case_folder") if case else None

                # Self-heal: if the case was stored before but its folder is now
                # missing on disk (e.g. the demo reset deletes data/processed),
                # recreate it at its original path instead of skipping — so a run
                # always (re)produces the case folders + manifests.
                if result.label == "RELEVANT" and folder and not Path(folder).exists():
                    trade_id = (case.get("trade_id") if case else None) \
                        or result.trade_id or self._fallback_trade_id(mid)
                    extraction = self._store_case(mail, result, trade_id, case_dir=Path(folder))
                    stats.relevant += 1
                    stats.extracted_trades += extraction["trades_extracted"]
                    logger.info("RESTORED missing case folder | %s | trade_id=%s (%d trade rows)",
                                mail["subject"], trade_id, extraction["trades_extracted"])
                    record_audit("case.restored", "success", resource=trade_id,
                                 correlation_id=cid, log_dir=audit_dir, message_id=mid)
                    if extraction["trades_extracted"]:
                        record_audit("attachment.extracted", "success", resource=trade_id,
                                     correlation_id=cid, log_dir=audit_dir, message_id=mid,
                                     trades=extraction["trades_extracted"])
                    stats.classified_emails.append(_email_record(
                        "RELEVANT", result.confidence, result.reason,
                        trade_id, result.asset_class,
                        result.matched_asset, result.matched_subject,
                    ))
                    continue

                stats.already_processed += 1
                logger.debug("Already processed, skipping: %s", mid)
                record_audit("email.classified", "skipped", resource=mid,
                             correlation_id=cid, log_dir=audit_dir, reason="already_processed")
                stats.classified_emails.append(_email_record(
                    result.label, result.confidence, result.reason,
                    result.trade_id, result.asset_class,
                    result.matched_asset, result.matched_subject,
                    skip_reason="already_processed",
                ))
                continue

            result = self.classifier.classify(mail["subject"], mail["body"])

            if result.label == "IRRELEVANT":
                stats.irrelevant += 1
                logger.debug("IRRELEVANT | %s | %s", mail["subject"], result.reason)
                record_audit("email.classified", "skipped", resource=mid,
                             correlation_id=cid, log_dir=audit_dir,
                             label="IRRELEVANT", confidence=result.confidence)
                stats.classified_emails.append(_email_record(
                    "IRRELEVANT", result.confidence, result.reason,
                    result.trade_id, result.asset_class,
                    result.matched_asset, result.matched_subject,
                ))
                continue

            if result.label == "AMBIGUOUS":
                stats.ambiguous += 1
                stats.ambiguous_subjects.append(mail["subject"])
                logger.warning("AMBIGUOUS (%.2f) | %s | %s",
                               result.confidence, mail["subject"], result.reason)
                record_audit("email.classified", "skipped", resource=mid,
                             correlation_id=cid, log_dir=audit_dir,
                             label="AMBIGUOUS", confidence=result.confidence,
                             subject=mail["subject"])
                stats.classified_emails.append(_email_record(
                    "AMBIGUOUS", result.confidence, result.reason,
                    result.trade_id, result.asset_class,
                    result.matched_asset, result.matched_subject,
                ))
                continue

            # RELEVANT
            trade_id = result.trade_id or self._fallback_trade_id(mid)
            if not trade_id.startswith("UNKNOWN") and self.db.trade_id_exists(trade_id):
                stats.duplicate += 1
                logger.warning("DUPLICATE trade_id %s — skipping (%s)", trade_id, mail["subject"])
                record_audit("email.classified", "skipped", resource=trade_id,
                             correlation_id=cid, log_dir=audit_dir, reason="duplicate_trade_id")
                stats.classified_emails.append(_email_record(
                    result.label, result.confidence, result.reason,
                    trade_id, result.asset_class,
                    result.matched_asset, result.matched_subject,
                    skip_reason="duplicate",
                ))
                continue

            extraction = self._store_case(mail, result, trade_id)
            stats.relevant += 1
            stats.extracted_trades += extraction["trades_extracted"]
            logger.info("RELEVANT (%.2f) | %s | trade_id=%s (%d trade rows)",
                        result.confidence, mail["subject"], trade_id,
                        extraction["trades_extracted"])
            stats.classified_emails.append(_email_record(
                "RELEVANT", result.confidence, result.reason,
                trade_id, result.asset_class,
                result.matched_asset, result.matched_subject,
            ))
            record_audit("case.stored", "success", resource=trade_id,
                         correlation_id=cid, log_dir=audit_dir,
                         confidence=result.confidence, message_id=mid)
            if extraction["trades_extracted"]:
                record_audit("attachment.extracted", "success", resource=trade_id,
                             correlation_id=cid, log_dir=audit_dir, message_id=mid,
                             trades=extraction["trades_extracted"])

        # -- REFLECT --
        self._log_summary(stats)
        record_audit("agent.run.complete", "success", correlation_id=cid, log_dir=audit_dir,
                     relevant=stats.relevant, ambiguous=stats.ambiguous,
                     irrelevant=stats.irrelevant, duplicate=stats.duplicate,
                     already_processed=stats.already_processed)
        return stats

    def _store_case(self, mail: Dict, result: Classification, trade_id: str,
                    case_dir: Optional[Path] = None) -> Dict:
        if case_dir is None:
            case_dir = self.store.create_case_folder(trade_id, result.asset_class)
        else:
            # Reuse an existing path (folder-restore) — ensure it + attachments exist.
            case_dir = Path(case_dir)
            (case_dir / "attachments").mkdir(parents=True, exist_ok=True)
        self.store.save_email_body(case_dir, mail["body"])
        self.store.save_metadata(case_dir, {
            "message_id": mail["message_id"],
            "subject": mail["subject"],
            "sender": mail["sender"],
            "received_at": mail["received_at"],
            "source_file": mail["source_file"],
            "classification": result.__dict__,
        })

        # Save every attachment, and parse trades out of supported (.xlsx/.csv) ones.
        extract_enabled = getattr(self.cfg, "attachment_extract_enabled", True)
        extract_exts = tuple(getattr(self.cfg, "attachment_extract_exts",
                                     (".xlsx", ".xlsm", ".csv")))
        max_rows = getattr(self.cfg, "attachment_max_rows", 10_000)

        attachments_meta: List[Dict] = []
        all_trades: List[Dict] = []
        by_attachment: List[Dict] = []
        for att in mail.get("attachments", []):
            saved = self.store.save_attachment(case_dir, att["filename"], att["data"])
            meta = {
                "filename": att["filename"],
                "path": str(saved),
                "mime_type": att.get("mime_type", ""),
                "size_bytes": len(att.get("data", b"")),
                "extraction_status": "skipped",
                "extracted_trade_count": 0,
            }
            if extract_enabled and is_supported(att["filename"], extract_exts):
                res = extract_attachment(att["filename"], att.get("data", b"") or b"",
                                         supported_exts=extract_exts, max_rows=max_rows)
                meta["extraction_status"] = res.status
                meta["extracted_trade_count"] = res.trade_count
                all_trades.extend(res.trades)
                by_attachment.append(res.as_summary())
            attachments_meta.append(meta)

        trade_ids = sorted({str(t["trade_id"]) for t in all_trades if t.get("trade_id")})
        extracted_path = None
        if all_trades:
            extracted_path = str(self.store.save_extracted_trades(case_dir, all_trades))

        extraction = {
            "enabled": extract_enabled,
            "trades_extracted": len(all_trades),
            "trade_ids": trade_ids,
            "extracted_trades_path": extracted_path,
            "by_attachment": by_attachment,
        }

        manifest = {
            "trade_id": trade_id,
            "asset_class": result.asset_class,
            "message_id": mail["message_id"],
            "subject": mail["subject"],
            "sender": mail["sender"],
            "received_at": mail["received_at"],
            "case_folder": str(case_dir),
            "email_body_path": str(case_dir / "email_body.txt"),
            "attachments": attachments_meta,
            "classification": {
                "label": result.label,
                "confidence": result.confidence,
                "reason": result.reason,
                "asset_class": result.asset_class,
            },
            "extraction": extraction,
            "ready_for_extraction": True,
        }
        self.store.save_manifest(case_dir, manifest)

        self.db.insert_case({
            "message_id": mail["message_id"],
            "trade_id": trade_id,
            "asset_class": result.asset_class,
            "subject": mail["subject"],
            "sender": mail["sender"],
            "received_at": mail["received_at"],
            "classification_label": result.label,
            "classification_confidence": result.confidence,
            "case_folder": str(case_dir),
            "attachment_count": len(attachments_meta),
        })
        return extraction

    def _log_summary(self, stats: RunStats) -> None:
        logger.info("=" * 56)
        logger.info("[Phase 1 Run Complete]")
        logger.info("  Emails read:          %d", stats.read)
        logger.info("  RELEVANT (stored):    %d", stats.relevant)
        logger.info("  AMBIGUOUS (skipped):  %d", stats.ambiguous)
        logger.info("  IRRELEVANT (skipped): %d", stats.irrelevant)
        logger.info("  DUPLICATE (skipped):  %d", stats.duplicate)
        logger.info("  Already processed:    %d", stats.already_processed)
        logger.info("  Trade rows extracted: %d", stats.extracted_trades)
        if stats.ambiguous_subjects:
            logger.info("  --- Ambiguous emails for manual review ---")
            for subj in stats.ambiguous_subjects:
                logger.info("    • %s", subj)
        logger.info("=" * 56)
