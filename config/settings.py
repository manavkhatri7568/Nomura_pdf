"""Central configuration for the Email Agent (Phase 1)."""

import os
from dataclasses import dataclass, field
from typing import List


def _env(name: str, default: str) -> str:
    """Read an env override, falling back to the default (12-factor friendly)."""
    return os.getenv(name, default)


@dataclass
class EmailAgentConfig:
    # -- Paths (env-overridable; relative to the email_agent/ project root) --
    inbox_path: str = field(default_factory=lambda: _env("EMAIL_INBOX_PATH", "data/raw_emails/inbox"))
    processed_path: str = field(default_factory=lambda: _env("EMAIL_PROCESSED_PATH", "data/processed"))
    db_path: str = field(default_factory=lambda: _env("EMAIL_DB_PATH", "data/email_index.db"))
    log_dir: str = field(default_factory=lambda: _env("EMAIL_LOG_DIR", "logs"))
    audit_log_dir: str = field(default_factory=lambda: _env("EMAIL_AUDIT_LOG_DIR", _env("EMAIL_LOG_DIR", "logs")))
    # Runtime config overrides (edited via the /config API) are persisted here.
    config_path: str = field(default_factory=lambda: _env("EMAIL_CONFIG_PATH", "data/runtime_config.json"))

    # -- Strong asset-level signals (any hit => +asset_weight) --
    # These phrases are specific to FX trade settlement notifications and do
    # NOT appear in generic "settlement query" / noise emails.
    asset_keywords: List[str] = field(default_factory=lambda: [
        "fx trade settlement",
        "fx settlement",
        "settlement instructions",
        "deal reference",
        "fx trade",
        "currency pair",
    ])

    # -- Subject-level signals (any hit in SUBJECT => +subject_weight) --
    subject_keywords: List[str] = field(default_factory=lambda: [
        "settlement",
        "confirm",
        "trade",
        "swift",
        "counterparty",
        "value date",
        "transaction",
        "allege",
        "dk",
        "fx",
    ])

    # -- Hard-negative signals. If any present AND no asset keyword => skip. --
    negative_keywords: List[str] = field(default_factory=lambda: [
        "happy birthday", "birthday", "anniversary", "congratulations", "congrats",
        "it support", "ticket", "password", "vpn",
        "policy", "remote work", "newsletter", "monthly update",
        "out of office", "team sync", "lunch", "calendar invite",
    ])

    # -- Trade ID regex patterns (tried in order). Primary = real FXOPT format. --
    trade_id_patterns: List[str] = field(default_factory=lambda: [
        r"FXOPT-\d{4}-\d{5}",            # FXOPT-2026-00046 (ground truth)
        r"[A-Z]{2,5}-\d{4}-\d{4,6}",     # generic dealref fallback
        r"\b[A-Z]{2,4}\d{6,12}\b",       # e.g. FX123456
    ])

    # -- Scoring weights --
    asset_weight: float = 0.5
    subject_weight: float = 0.3
    trade_id_weight: float = 0.2

    # -- Thresholds --
    relevant_threshold: float = 0.7     # score >= => RELEVANT
    ambiguous_threshold: float = 0.3    # score in [this, relevant) => AMBIGUOUS

    # -- Body chars scanned for trade ID extraction --
    max_body_scan_chars: int = 2000

    # -- Default asset class label for relevant emails --
    default_asset_class: str = "FX Settlement"

    # -- Attachment extraction (tabular blotters in .xlsx/.csv attachments) --
    # Real FX-settlement emails carry the trades as a table in an attachment.
    # When enabled, RELEVANT emails have their .xlsx/.csv attachments parsed into
    # normalized trade rows written to the case folder + summarized in the manifest.
    attachment_extract_enabled: bool = True
    attachment_extract_exts: List[str] = field(default_factory=lambda: [".xlsx", ".xlsm", ".csv"])
    attachment_max_rows: int = 10_000

    # -- Fields the (future) extraction agent should pull from each case. --
    # Not used by the rule classifier; persisted so the UI is the single source
    # of truth and Phase 2 can consume it.
    extract_fields: List[str] = field(default_factory=lambda: [
        "trade id", "currency pair", "asset class", "amount", "counterparty", "direction",
    ])

    # -- How often the (future) scheduler re-runs the pipeline, in hours. --
    # Metadata today (no scheduler is wired); surfaced + editable in the UI.
    sync_frequency_hours: int = 24

    # -- Graph / mock-Graph connector (env-overridable) --
    # Points at the mock Graph service in dev; swap base_url + real credentials
    # to talk to production Microsoft Graph with no other code change.
    graph_base_url: str = field(default_factory=lambda: _env("GRAPH_BASE_URL", "http://localhost:8001"))
    graph_tenant_id: str = field(default_factory=lambda: _env("GRAPH_TENANT_ID", "mock-tenant-id"))
    graph_client_id: str = field(default_factory=lambda: _env("GRAPH_CLIENT_ID", "mock-client-id"))
    graph_client_secret: str = field(default_factory=lambda: _env("GRAPH_CLIENT_SECRET", "mock-client-secret"))
    graph_mailbox: str = field(default_factory=lambda: _env("GRAPH_MAILBOX", "mo-team@nomura.com"))
    graph_folder: str = field(default_factory=lambda: _env("GRAPH_FOLDER", "inbox"))
    graph_page_size: int = 10          # mirrors Graph's default page size (exercises paging)
    graph_prefer_text: bool = True     # request plain-text body via the Prefer header

    # -- Pipeline source selection: "local" (.eml folder) or "graph" (Graph API) --
    default_source: str = field(default_factory=lambda: _env("EMAIL_SOURCE", "local"))
