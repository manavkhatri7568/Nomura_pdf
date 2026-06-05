"""Configuration module exposed as an endpoint.

Lets the UI read and tune the rule classifier at runtime — the keyword lists,
weights and thresholds that decide RELEVANT / AMBIGUOUS / IRRELEVANT. Edits take
effect on the next pipeline run with no restart, and are persisted + audited.

    GET   /config         current tunable config (+ read-only context)
    PUT   /config         partial update (validated); returns the new config
    POST  /config/reset   restore code/env defaults
"""

from fastapi import APIRouter, Depends, HTTPException

from api.deps import get_config_store, get_correlation_id
from api.models import ConfigUpdate, Envelope, success
from config.config_store import ConfigStore, ConfigValidationError
from utils.audit import record_audit
from utils.logger import get_logger

router = APIRouter(prefix="/config", tags=["config"])
logger = get_logger("api.config")


@router.get("", response_model=Envelope)
def read_config(store: ConfigStore = Depends(get_config_store),
                cid: str = Depends(get_correlation_id)) -> Envelope:
    return success(store.snapshot(), cid)


@router.put("", response_model=Envelope)
def update_config(patch: ConfigUpdate,
                  store: ConfigStore = Depends(get_config_store),
                  cid: str = Depends(get_correlation_id)) -> Envelope:
    audit_dir = store.config.audit_log_dir
    # exclude_unset => only fields the caller actually sent are applied.
    supplied = patch.model_dump(exclude_unset=True)
    try:
        updated = store.update(supplied)
    except ConfigValidationError as exc:
        record_audit("config.updated", "failure", actor="api-client",
                     correlation_id=cid, log_dir=audit_dir,
                     error=str(exc), fields=list(supplied))
        raise HTTPException(422, {"code": "InvalidConfig", "message": str(exc)})

    changed = sorted(updated_keys(supplied))
    logger.info("config.update changed=%s cid=%s", changed, cid)
    record_audit("config.updated", "success", actor="api-client",
                 correlation_id=cid, log_dir=audit_dir, changed_fields=changed)
    return success(store.snapshot(), cid)


@router.post("/reset", response_model=Envelope)
def reset_config(store: ConfigStore = Depends(get_config_store),
                 cid: str = Depends(get_correlation_id)) -> Envelope:
    store.reset()
    logger.info("config.reset cid=%s", cid)
    record_audit("config.reset", "success", actor="api-client",
                 correlation_id=cid, log_dir=store.config.audit_log_dir)
    return success(store.snapshot(), cid)


def updated_keys(supplied: dict) -> list:
    from config.config_store import EDITABLE_FIELDS
    return [k for k in supplied if k in EDITABLE_FIELDS]
