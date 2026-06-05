"""Runtime-editable configuration backed by :class:`EmailAgentConfig`.

The rule classifier reads its keyword lists, weights and thresholds straight
off an ``EmailAgentConfig`` instance. This store wraps a single live instance
so that:

* edits made through the ``/config`` API mutate the *same* object the classifier
  reads — no process restart needed (a fresh ``RuleClassifier(cfg)`` is built per
  request, so it always sees the current values);
* the editable subset is validated before being applied (bad regex, weights or
  thresholds are rejected, not silently stored);
* overrides are persisted to ``config_path`` (JSON) and re-applied on startup,
  so changes survive a restart while the code defaults remain the baseline.

Only the fields in :data:`EDITABLE_FIELDS` may be changed at runtime; paths,
credentials and source selection stay environment-driven.
"""

import json
import re
import threading
from pathlib import Path
from typing import Any, Dict

from config.settings import EmailAgentConfig

# The tunable subset. Everything else (paths, Graph creds) stays env-driven.
KEYWORD_FIELDS = ("asset_keywords", "subject_keywords", "negative_keywords", "extract_fields")
WEIGHT_FIELDS = ("asset_weight", "subject_weight", "trade_id_weight")
THRESHOLD_FIELDS = ("relevant_threshold", "ambiguous_threshold")
EDITABLE_FIELDS = (
    *KEYWORD_FIELDS,
    "trade_id_patterns",
    *WEIGHT_FIELDS,
    *THRESHOLD_FIELDS,
    "default_asset_class",
    "sync_frequency_hours",
)


class ConfigValidationError(ValueError):
    """Raised when a config patch fails validation (mapped to HTTP 422)."""


def _clean_str_list(field: str, value: Any) -> list:
    if not isinstance(value, list):
        raise ConfigValidationError(f"'{field}' must be a list of strings")
    out, seen = [], set()
    for item in value:
        s = str(item).strip()
        if s and s.lower() not in seen:      # drop blanks + case-insensitive dupes
            seen.add(s.lower())
            out.append(s)
    return out


def _clean_patterns(value: Any) -> list:
    if not isinstance(value, list):
        raise ConfigValidationError("'trade_id_patterns' must be a list of regex strings")
    out = []
    for item in value:
        s = str(item).strip()
        if not s:
            continue
        try:
            re.compile(s)
        except re.error as exc:
            raise ConfigValidationError(f"invalid regex pattern '{s}': {exc}") from exc
        out.append(s)
    return out


def _clean_unit_float(field: str, value: Any) -> float:
    try:
        f = float(value)
    except (TypeError, ValueError):
        raise ConfigValidationError(f"'{field}' must be a number")
    if not 0.0 <= f <= 1.0:
        raise ConfigValidationError(f"'{field}' must be between 0.0 and 1.0")
    return round(f, 4)


def validate_patch(patch: Dict[str, Any]) -> Dict[str, Any]:
    """Validate + normalise a partial config update. Unknown keys are ignored."""
    clean: Dict[str, Any] = {}
    for key, value in patch.items():
        if value is None or key not in EDITABLE_FIELDS:
            continue
        if key in KEYWORD_FIELDS:
            clean[key] = _clean_str_list(key, value)
        elif key == "trade_id_patterns":
            clean[key] = _clean_patterns(value)
        elif key in WEIGHT_FIELDS or key in THRESHOLD_FIELDS:
            clean[key] = _clean_unit_float(key, value)
        elif key == "default_asset_class":
            s = str(value).strip()
            if not s:
                raise ConfigValidationError("'default_asset_class' cannot be empty")
            clean[key] = s
        elif key == "sync_frequency_hours":
            try:
                n = int(value)
            except (TypeError, ValueError):
                raise ConfigValidationError("'sync_frequency_hours' must be an integer")
            if n < 1:
                raise ConfigValidationError("'sync_frequency_hours' must be >= 1")
            clean[key] = n
    return clean


class ConfigStore:
    def __init__(self, config: EmailAgentConfig):
        self._cfg = config
        self._lock = threading.Lock()
        self._path = Path(config.config_path)
        self._load_overrides()

    @property
    def config(self) -> EmailAgentConfig:
        """The live config object the classifier reads."""
        return self._cfg

    def editable(self) -> Dict[str, Any]:
        """The current values of the user-tunable fields."""
        return {k: getattr(self._cfg, k) for k in EDITABLE_FIELDS}

    def snapshot(self) -> Dict[str, Any]:
        """Editable values plus read-only context useful to the UI."""
        return {
            **self.editable(),
            "max_body_scan_chars": self._cfg.max_body_scan_chars,
            "editable_fields": list(EDITABLE_FIELDS),
        }

    def _apply(self, values: Dict[str, Any]) -> None:
        for key, value in values.items():
            setattr(self._cfg, key, value)

    def _load_overrides(self) -> None:
        if not self._path.exists():
            return
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        try:
            self._apply(validate_patch(data))
        except ConfigValidationError:
            pass  # ignore a corrupt override file; fall back to defaults

    def _persist(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps(self.editable(), indent=2), encoding="utf-8")

    def update(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        """Validate, apply and persist a partial update. Returns editable view."""
        clean = validate_patch(patch)
        if not clean:
            raise ConfigValidationError("no valid editable fields supplied")
        with self._lock:
            # Cross-field rule: AMBIGUOUS band must sit below the RELEVANT cut.
            amb = clean.get("ambiguous_threshold", self._cfg.ambiguous_threshold)
            rel = clean.get("relevant_threshold", self._cfg.relevant_threshold)
            if amb > rel:
                raise ConfigValidationError(
                    "ambiguous_threshold must be <= relevant_threshold")
            self._apply(clean)
            self._persist()
        return self.editable()

    def reset(self) -> Dict[str, Any]:
        """Restore code/env defaults and drop the persisted override file."""
        defaults = EmailAgentConfig()
        with self._lock:
            self._apply({k: getattr(defaults, k) for k in EDITABLE_FIELDS})
            if self._path.exists():
                try:
                    self._path.unlink()
                except OSError:
                    pass
        return self.editable()
