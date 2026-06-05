"""Pydantic request/response models and the uniform success/failure envelope.

Every endpoint returns an :class:`Envelope`:

    { "status": "success"|"error", "data": {...}|null,
      "error": {"code","message"}|null,
      "correlation_id": "...", "timestamp": "...Z" }

so callers get a single, predictable shape for positive and negative outcomes.
"""

from datetime import datetime, timezone
from typing import Any, List, Literal, Optional

from pydantic import BaseModel, Field


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ErrorInfo(BaseModel):
    code: str
    message: str


class Envelope(BaseModel):
    status: Literal["success", "error"]
    data: Optional[Any] = None
    error: Optional[ErrorInfo] = None
    correlation_id: str
    timestamp: str = Field(default_factory=_now)


def success(data: Any, correlation_id: str) -> Envelope:
    return Envelope(status="success", data=data, correlation_id=correlation_id)


def failure(code: str, message: str, correlation_id: str) -> Envelope:
    return Envelope(status="error", error=ErrorInfo(code=code, message=message),
                    correlation_id=correlation_id)


# ---- Request bodies ---------------------------------------------------------

class ClassifyRequest(BaseModel):
    subject: str = ""
    body: str = ""


Source = Literal["local", "graph"]


class FetchRequest(BaseModel):
    source: Source = "local"


class RunRequest(BaseModel):
    source: Source = "local"


class PreviewRequest(BaseModel):
    source: Source = "local"
    message_id: str


class ConfigUpdate(BaseModel):
    """Partial update of the tunable classifier config. All fields optional;
    only those supplied are changed (validated server-side in ConfigStore)."""
    asset_keywords: Optional[List[str]] = None
    subject_keywords: Optional[List[str]] = None
    negative_keywords: Optional[List[str]] = None
    trade_id_patterns: Optional[List[str]] = None
    asset_weight: Optional[float] = None
    subject_weight: Optional[float] = None
    trade_id_weight: Optional[float] = None
    relevant_threshold: Optional[float] = None
    ambiguous_threshold: Optional[float] = None
    default_asset_class: Optional[str] = None
    extract_fields: Optional[List[str]] = None
    sync_frequency_hours: Optional[int] = None
