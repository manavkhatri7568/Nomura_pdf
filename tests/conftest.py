"""Shared test fixtures.

Write targets (processed/, the SQLite index, logs) are redirected to a temp dir
via env *before* any app module imports, so tests never touch real data. The
inbox stays pointed at the real synthetic folder, which is regenerated once per
session to the deterministic 27-email dataset (seed 42).

The mock Graph service is run as a real uvicorn server in a background thread so
the synchronous GraphConnector exercises a genuine HTTP round-trip.
"""

import os
import pathlib
import shutil
import socket
import subprocess
import sys
import threading
import time

import pytest

# --- redirect write paths to a temp dir BEFORE importing app modules ---------
PROJ = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJ))

import tempfile  # noqa: E402

TMP = pathlib.Path(tempfile.mkdtemp(prefix="email_agent_test_"))
os.environ["EMAIL_PROCESSED_PATH"] = str(TMP / "processed")
os.environ["EMAIL_DB_PATH"] = str(TMP / "index.db")
os.environ["EMAIL_LOG_DIR"] = str(TMP / "logs")
os.environ["EMAIL_AUDIT_LOG_DIR"] = str(TMP / "logs")
os.environ["EMAIL_INBOX_PATH"] = str(PROJ / "data" / "raw_emails" / "inbox")
os.environ["EMAIL_CONFIG_PATH"] = str(TMP / "runtime_config.json")

import httpx  # noqa: E402
import uvicorn  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


def _free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture(scope="session")
def populated_inbox() -> str:
    """Regenerate the deterministic synthetic inbox (27 emails, seed 42)."""
    subprocess.run(
        [sys.executable, str(PROJ / "tools" / "generate_test_emails.py"), "--clean"],
        check=True, capture_output=True,
    )
    return os.environ["EMAIL_INBOX_PATH"]


@pytest.fixture(scope="session")
def mock_app(populated_inbox):
    from mock_graph.app import create_mock_app
    return create_mock_app(populated_inbox)


@pytest.fixture()
def mock_client(mock_app):
    """In-process client for asserting the mock Graph response *shape*."""
    with TestClient(mock_app) as client:
        yield client


@pytest.fixture(scope="session")
def mock_server(populated_inbox):
    """Run the mock Graph service as a real server for HTTP round-trips."""
    from mock_graph.app import create_mock_app

    app = create_mock_app(populated_inbox)
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            if httpx.get(base + "/health", timeout=0.5).status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(0.05)
    else:
        raise RuntimeError("mock graph server failed to start")

    yield base
    server.should_exit = True
    thread.join(timeout=5)


@pytest.fixture()
def graph_connector(mock_server):
    from connectors.graph_connector import GraphConnector
    conn = GraphConnector(
        base_url=mock_server,
        tenant_id="mock-tenant-id", client_id="mock-client-id",
        client_secret="mock-client-secret", mailbox="mo-team@nomura.com",
        folder="inbox", page_size=10, prefer_text=True,
    )
    yield conn
    conn.close()


@pytest.fixture()
def clean_state():
    """Wipe the temp DB + processed folder for a fresh-slate run."""
    db = pathlib.Path(os.environ["EMAIL_DB_PATH"])
    proc = pathlib.Path(os.environ["EMAIL_PROCESSED_PATH"])
    if db.exists():
        db.unlink()
    if proc.exists():
        shutil.rmtree(proc)
    yield


@pytest.fixture()
def api_client(mock_server):
    from api.app import app
    from api.deps import get_config_store

    # Reset runtime config to defaults so a /config edit in one test can't leak
    # into another (the config store is a process-wide singleton).
    get_config_store().reset()

    app.state.graph_client = httpx.Client(base_url=mock_server, timeout=30)
    with TestClient(app) as client:
        yield client
    app.state.graph_client.close()
    app.state.graph_client = None
    get_config_store().reset()
