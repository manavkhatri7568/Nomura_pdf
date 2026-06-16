"""Mock Microsoft Graph API service (FastAPI).

Replicates the Graph v1.0 surface the Email Agent needs, with identical JSON
field names, so the production swap is a base-URL + credentials change only:

* ``POST /{tenant}/oauth2/v2.0/token``            OAuth2 client-credentials grant
* ``GET  /v1.0/users/{mailbox}/messages``          message list (paged)
* ``GET  /v1.0/users/{mailbox}/mailFolders/{folder}/messages``
* ``GET  /v1.0/users/{mailbox}/messages/{id}``     single message
* ``GET  /v1.0/users/{mailbox}/messages/{id}/attachments``         attachment list
* ``GET  /v1.0/users/{mailbox}/messages/{id}/attachments/{aid}``   single attachment

Honours ``$top``/``$skip`` paging (returns ``@odata.nextLink``), ``$select``,
``$count``, ``$expand=attachments`` and the ``Prefer: outlook.body-content-type``
header. Bearer auth is enforced on ``/v1.0`` routes (401 when missing), matching
real Graph error shapes.

Source of truth: the ``.eml`` files in the configured inbox folder, parsed once
at startup by :mod:`mock_graph.eml_to_graph`.
"""

from pathlib import Path
from typing import Dict, List, Optional

from fastapi import Depends, FastAPI, Form, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from config.settings import EmailAgentConfig
from mock_graph.eml_to_graph import parse_eml, render_attachment, render_message
from utils.logger import get_logger

logger = get_logger("mock_graph")

_DEFAULT_PAGE = 10


class MockMailbox:
    """In-memory store of parsed messages, ordered by receivedDateTime."""

    def __init__(self, inbox_path: str):
        self.inbox_path = Path(inbox_path)
        self.records: List[Dict] = []
        self.by_id: Dict[str, Dict] = {}
        self.reload()

    def reload(self) -> None:
        records = []
        if self.inbox_path.exists():
            for path in sorted(self.inbox_path.glob("*.eml")):
                try:
                    records.append(parse_eml(path))
                except Exception as exc:  # noqa: BLE001
                    logger.warning("mock-graph failed to parse %s: %s", path.name, exc)
        records.sort(key=lambda r: r.get("receivedDateTime") or "")
        self.records = records
        self.by_id = {r["id"]: r for r in records}
        logger.info("mock-graph loaded %d messages from %s", len(records), self.inbox_path)


def _graph_error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def _parse_list_params(request: Request):
    q = request.query_params
    top = int(q.get("$top", _DEFAULT_PAGE))
    skip = int(q.get("$skip", 0))
    select = q.get("$select")
    expand = q.get("$expand")
    return {
        "top": max(1, top),
        "skip": max(0, skip),
        "select": select.split(",") if select else None,
        "expand": expand.split(",") if expand else None,
        "count": q.get("$count", "").lower() == "true",
    }


def _body_type(prefer: Optional[str]) -> str:
    if prefer and 'outlook.body-content-type="text"' in prefer.lower():
        return "text"
    return "html"


def create_mock_app(inbox_path: Optional[str] = None) -> FastAPI:
    cfg = EmailAgentConfig()
    mailbox_store = MockMailbox(inbox_path or cfg.inbox_path)

    app = FastAPI(title="Mock Microsoft Graph API", version="1.0.0")
    app.state.mailbox = mailbox_store

    def require_bearer(authorization: Optional[str] = Header(default=None)) -> str:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(
                status_code=401,
                detail={"code": "InvalidAuthenticationToken",
                        "message": "Access token is empty or malformed."},
            )
        return authorization.split(" ", 1)[1]

    @app.exception_handler(HTTPException)
    async def _graph_http_exc(_request: Request, exc: HTTPException):
        detail = exc.detail
        if isinstance(detail, dict):
            return _graph_error(exc.status_code, detail.get("code", "error"), detail.get("message", ""))
        return _graph_error(exc.status_code, "error", str(detail))

    # ---- OAuth2 client-credentials token endpoint ---------------------------
    @app.post("/{tenant_id}/oauth2/v2.0/token")
    async def token(
        tenant_id: str,
        grant_type: str = Form(...),
        client_id: str = Form(...),
        client_secret: str = Form(...),
        scope: str = Form(default="https://graph.microsoft.com/.default"),
    ):
        if grant_type != "client_credentials":
            return _graph_error(400, "unsupported_grant_type",
                                f"grant_type '{grant_type}' is not supported.")
        if not client_id or not client_secret:
            return _graph_error(401, "invalid_client", "client_id/client_secret required.")
        access_token = f"mock.{tenant_id}.{client_id}.token"
        logger.info("mock-graph issued token for client_id=%s tenant=%s", client_id, tenant_id)
        return {
            "token_type": "Bearer",
            "expires_in": 3599,
            "ext_expires_in": 3599,
            "access_token": access_token,
        }

    # ---- Message collection -------------------------------------------------
    def _list(request: Request, mailbox: str, prefer: Optional[str]):
        request.app.state.mailbox.reload()
        p = _parse_list_params(request)
        records = request.app.state.mailbox.records
        page = records[p["skip"]: p["skip"] + p["top"]]
        body_type = _body_type(prefer)
        value = [render_message(r, body_type=body_type, select=p["select"], expand=p["expand"])
                 for r in page]
        resp: Dict = {
            "@odata.context": f"https://graph.microsoft.com/v1.0/$metadata#users('{mailbox}')/messages",
            "value": value,
        }
        if p["count"]:
            resp["@odata.count"] = len(records)
        if p["skip"] + p["top"] < len(records):
            nxt = request.url.include_query_params(**{"$skip": p["skip"] + p["top"], "$top": p["top"]})
            resp["@odata.nextLink"] = str(nxt)
        logger.info("mock-graph list mailbox=%s returned %d/%d (skip=%d top=%d)",
                    mailbox, len(value), len(records), p["skip"], p["top"])
        return resp

    @app.get("/v1.0/users/{mailbox}/messages")
    async def list_messages(mailbox: str, request: Request,
                            prefer: Optional[str] = Header(default=None),
                            _: str = Depends(require_bearer)):
        return _list(request, mailbox, prefer)

    @app.get("/v1.0/users/{mailbox}/mailFolders/{folder}/messages")
    async def list_folder_messages(mailbox: str, folder: str, request: Request,
                                   prefer: Optional[str] = Header(default=None),
                                   _: str = Depends(require_bearer)):
        return _list(request, mailbox, prefer)

    # ---- Single message -----------------------------------------------------
    @app.get("/v1.0/users/{mailbox}/messages/{message_id}")
    async def get_message(mailbox: str, message_id: str, request: Request,
                          prefer: Optional[str] = Header(default=None),
                          _: str = Depends(require_bearer)):
        request.app.state.mailbox.reload()
        record = request.app.state.mailbox.by_id.get(message_id)
        if record is None:
            raise HTTPException(404, {"code": "ErrorItemNotFound",
                                      "message": f"Message '{message_id}' not found."})
        p = _parse_list_params(request)
        msg = render_message(record, body_type=_body_type(prefer),
                             select=p["select"], expand=p["expand"])
        msg["@odata.context"] = (
            f"https://graph.microsoft.com/v1.0/$metadata#users('{mailbox}')/messages/$entity"
        )
        return msg

    # ---- Attachments --------------------------------------------------------
    @app.get("/v1.0/users/{mailbox}/messages/{message_id}/attachments")
    async def list_attachments(mailbox: str, message_id: str, request: Request,
                               _: str = Depends(require_bearer)):
        request.app.state.mailbox.reload()
        record = request.app.state.mailbox.by_id.get(message_id)
        if record is None:
            raise HTTPException(404, {"code": "ErrorItemNotFound",
                                      "message": f"Message '{message_id}' not found."})
        return {
            "@odata.context": (
                f"https://graph.microsoft.com/v1.0/$metadata#users('{mailbox}')"
                f"/messages('{message_id}')/attachments"
            ),
            "value": [render_attachment(a) for a in record["_attachments"]],
        }

    @app.get("/v1.0/users/{mailbox}/messages/{message_id}/attachments/{attachment_id}")
    async def get_attachment(mailbox: str, message_id: str, attachment_id: str, request: Request,
                             _: str = Depends(require_bearer)):
        request.app.state.mailbox.reload()
        record = request.app.state.mailbox.by_id.get(message_id)
        if record is None:
            raise HTTPException(404, {"code": "ErrorItemNotFound",
                                      "message": f"Message '{message_id}' not found."})
        for a in record["_attachments"]:
            if a["id"] == attachment_id:
                return render_attachment(a)
        raise HTTPException(404, {"code": "ErrorItemNotFound",
                                  "message": f"Attachment '{attachment_id}' not found."})

    @app.get("/health")
    async def health():
        return {"status": "ok", "messages": len(app.state.mailbox.records)}

    return app


# Module-level app for `uvicorn mock_graph.app:app`
app = create_mock_app()
