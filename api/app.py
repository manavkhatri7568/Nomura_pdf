"""Email Agent API (FastAPI).

Exposes every pipeline module as an endpoint, each returning the uniform
success/failure :class:`~api.models.Envelope`:

    GET  /health                      liveness + configured source
    POST /classifier/classify         classify a {subject, body}
    POST /connector/fetch             fetch from {source: local|graph}
    POST /agent/run                   run the full pipeline from {source}
    GET  /storage/cases               list stored cases
    GET  /storage/cases/{trade_id}    one case + its manifest
    GET  /storage/stats               case counts by status
    GET  /config                      current tunable classifier config
    PUT  /config                      update keywords/weights/thresholds (live)
    POST /config/reset                restore defaults

Cross-cutting concerns handled here:
* a per-request **correlation id** (honours an inbound ``X-Correlation-ID``,
  else generates one) echoed back on the response and threaded into every log;
* **developer logging** of each request (method, path, status, latency);
* an **audit** record per request (``api.request``);
* uniform envelopes for *all* failures (validation, not-found, unexpected),
  not just the happy path.
"""

import time

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from api.deps import get_config
from api.models import failure
from api.routers import agent, classifier, config, connector, extract, match, storage
from utils.audit import new_correlation_id, record_audit
from utils.logger import get_logger, setup_logging

cfg = get_config()
setup_logging(cfg.log_dir)
logger = get_logger("api")

app = FastAPI(title="Nomura SSG Email Agent API", version="1.0.0")
app.include_router(classifier.router)
app.include_router(connector.router)
app.include_router(agent.router)
app.include_router(storage.router)
app.include_router(config.router)
app.include_router(extract.router)
app.include_router(match.router)


@app.middleware("http")
async def correlation_and_audit(request: Request, call_next):
    cid = request.headers.get("X-Correlation-ID") or new_correlation_id()
    request.state.correlation_id = cid
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:  # noqa: BLE001 - surfaced by exception handlers; audit the failure
        duration_ms = round((time.perf_counter() - start) * 1000, 1)
        record_audit("api.request", "failure", actor="api-client",
                     resource=request.url.path, correlation_id=cid,
                     method=request.method, status_code=500, duration_ms=duration_ms,
                     log_dir=cfg.audit_log_dir)
        raise

    duration_ms = round((time.perf_counter() - start) * 1000, 1)
    response.headers["X-Correlation-ID"] = cid
    logger.info("%s %s -> %d (%.1fms) cid=%s",
                request.method, request.url.path, response.status_code, duration_ms, cid)
    record_audit("api.request", "success" if response.status_code < 400 else "failure",
                 actor="api-client", resource=request.url.path, correlation_id=cid,
                 method=request.method, status_code=response.status_code,
                 duration_ms=duration_ms, log_dir=cfg.audit_log_dir)
    return response


def _cid(request: Request) -> str:
    return getattr(request.state, "correlation_id", "unknown")


@app.exception_handler(RequestValidationError)
async def _validation_handler(request: Request, exc: RequestValidationError):
    env = failure("ValidationError", str(exc.errors()), _cid(request))
    return JSONResponse(status_code=422, content=env.model_dump())


@app.exception_handler(StarletteHTTPException)
async def _http_handler(request: Request, exc: StarletteHTTPException):
    detail = exc.detail
    if isinstance(detail, dict):
        code, message = detail.get("code", "error"), detail.get("message", "")
    else:
        code, message = "error", str(detail)
    env = failure(code, message, _cid(request))
    return JSONResponse(status_code=exc.status_code, content=env.model_dump())


@app.exception_handler(Exception)
async def _unhandled_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error cid=%s", _cid(request))
    env = failure("InternalError", str(exc), _cid(request))
    return JSONResponse(status_code=500, content=env.model_dump())


@app.get("/health")
async def health():
    return {"status": "ok", "default_source": cfg.default_source,
            "graph_base_url": cfg.graph_base_url}
