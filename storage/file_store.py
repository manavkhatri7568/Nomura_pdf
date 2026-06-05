"""Writes per-case artifacts (body, metadata, attachments, manifest) to disk."""

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict


class FileStore:
    def __init__(self, base_path: str):
        self.base = Path(base_path)
        self.base.mkdir(parents=True, exist_ok=True)

    def create_case_folder(self, trade_id: str, asset_class: str) -> Path:
        date_str = datetime.today().strftime("%Y%m%d")
        safe_asset = asset_class.replace(" ", "_").replace("/", "-")
        safe_trade = re.sub(r"[^A-Za-z0-9_-]", "_", trade_id)
        case_dir = self.base / f"{safe_trade}_{safe_asset}_{date_str}"
        (case_dir / "attachments").mkdir(parents=True, exist_ok=True)
        return case_dir

    def save_email_body(self, case_dir: Path, body: str) -> Path:
        path = case_dir / "email_body.txt"
        path.write_text(body or "", encoding="utf-8")
        return path

    def save_metadata(self, case_dir: Path, metadata: Dict[str, Any]) -> Path:
        path = case_dir / "email_metadata.json"
        path.write_text(json.dumps(metadata, indent=2, default=str), encoding="utf-8")
        return path

    def save_attachment(self, case_dir: Path, filename: str, data: bytes) -> Path:
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", filename) or "attachment"
        dest = case_dir / "attachments" / safe
        dest.write_bytes(data)
        return dest

    def save_manifest(self, case_dir: Path, manifest: Dict[str, Any]) -> Path:
        path = case_dir / "manifest.json"
        path.write_text(json.dumps(manifest, indent=2, default=str), encoding="utf-8")
        return path

    def save_extracted_trades(self, case_dir: Path, trades: list) -> Path:
        """Write the normalized trade rows parsed from .xlsx/.csv attachments."""
        path = case_dir / "extracted_trades.json"
        path.write_text(json.dumps(trades, indent=2, default=str), encoding="utf-8")
        return path
