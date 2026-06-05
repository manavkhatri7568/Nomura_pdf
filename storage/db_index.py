"""SQLite index for deduplication and case tracking."""

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

_CREATE = """
CREATE TABLE IF NOT EXISTS email_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT UNIQUE,
    trade_id TEXT,
    asset_class TEXT,
    subject TEXT,
    sender TEXT,
    received_at TEXT,
    classification_label TEXT,
    classification_confidence REAL,
    case_folder TEXT,
    attachment_count INTEGER,
    processed_at TEXT,
    status TEXT DEFAULT 'ingested'
);
"""


class DBIndex:
    def __init__(self, db_path: str):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute(_CREATE)
        self.conn.commit()

    def trade_id_exists(self, trade_id: str) -> bool:
        cur = self.conn.execute(
            "SELECT 1 FROM email_cases WHERE trade_id = ? LIMIT 1", (trade_id,)
        )
        return cur.fetchone() is not None

    def message_id_exists(self, message_id: str) -> bool:
        cur = self.conn.execute(
            "SELECT 1 FROM email_cases WHERE message_id = ? LIMIT 1", (message_id,)
        )
        return cur.fetchone() is not None

    def insert_case(self, record: dict) -> None:
        record = dict(record)
        record.setdefault("processed_at", datetime.now(timezone.utc).isoformat())
        cols = ", ".join(record.keys())
        placeholders = ", ".join("?" * len(record))
        self.conn.execute(
            f"INSERT OR IGNORE INTO email_cases ({cols}) VALUES ({placeholders})",
            list(record.values()),
        )
        self.conn.commit()

    def update_status(self, message_id: str, status: str) -> None:
        self.conn.execute(
            "UPDATE email_cases SET status = ? WHERE message_id = ?",
            (status, message_id),
        )
        self.conn.commit()

    def list_cases(self) -> list:
        cur = self.conn.execute("SELECT * FROM email_cases ORDER BY id")
        return [dict(row) for row in cur.fetchall()]

    def get_case(self, trade_id: str) -> Optional[dict]:
        cur = self.conn.execute(
            "SELECT * FROM email_cases WHERE trade_id = ? ORDER BY id LIMIT 1", (trade_id,)
        )
        row = cur.fetchone()
        return dict(row) if row else None

    def get_case_by_message_id(self, message_id: str) -> Optional[dict]:
        cur = self.conn.execute(
            "SELECT * FROM email_cases WHERE message_id = ? LIMIT 1", (message_id,)
        )
        row = cur.fetchone()
        return dict(row) if row else None

    def count_by_status(self) -> dict:
        cur = self.conn.execute(
            "SELECT status, COUNT(*) AS n FROM email_cases GROUP BY status"
        )
        return {row["status"]: row["n"] for row in cur.fetchall()}

    def close(self) -> None:
        self.conn.close()
