"""End-to-end tests for the Email Agent API (every module as an endpoint)."""

import json
import os
import pathlib


def _assert_envelope(body, status="success"):
    assert body["status"] == status
    assert "correlation_id" in body and body["correlation_id"]
    assert "timestamp" in body
    if status == "success":
        assert body["data"] is not None
        assert body["error"] is None
    else:
        assert body["error"] is not None


# ---- health -----------------------------------------------------------------

def test_health(api_client):
    resp = api_client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


# ---- classifier -------------------------------------------------------------

def test_classify_relevant(api_client):
    resp = api_client.post("/classifier/classify", json={
        "subject": "FX Trade Settlement[FXOPT-2026-00047] - USD/JPY",
        "body": "Settlement Instructions: SWIFT Code BARCGB22. Deal Reference FXOPT-2026-00047.",
    })
    assert resp.status_code == 200
    body = resp.json()
    _assert_envelope(body)
    assert body["data"]["label"] == "RELEVANT"
    assert body["data"]["trade_id"] == "FXOPT-2026-00047"


def test_classify_irrelevant(api_client):
    resp = api_client.post("/classifier/classify", json={
        "subject": "Happy Birthday Akshit!",
        "body": "Cake in the pantry at 4pm",
    })
    assert resp.json()["data"]["label"] == "IRRELEVANT"


def test_classify_validation_error_uses_envelope(api_client):
    resp = api_client.post("/classifier/classify", json={"subject": 123, "body": []})
    assert resp.status_code == 422
    _assert_envelope(resp.json(), status="error")
    assert resp.json()["error"]["code"] == "ValidationError"


def test_correlation_id_is_echoed(api_client):
    cid = "test-correlation-123"
    resp = api_client.post("/classifier/classify",
                           json={"subject": "x", "body": "y"},
                           headers={"X-Correlation-ID": cid})
    assert resp.headers["X-Correlation-ID"] == cid
    assert resp.json()["correlation_id"] == cid


# ---- connector --------------------------------------------------------------

def test_connector_fetch_local(api_client):
    resp = api_client.post("/connector/fetch", json={"source": "local"})
    assert resp.status_code == 200
    body = resp.json()
    _assert_envelope(body)
    assert body["data"]["count"] == 27


def test_connector_fetch_graph(api_client):
    resp = api_client.post("/connector/fetch", json={"source": "graph"})
    assert resp.status_code == 200
    body = resp.json()
    _assert_envelope(body)
    assert body["data"]["source"] == "graph"
    assert body["data"]["count"] == 27


# ---- agent run + storage (full pipeline over the Graph source) --------------

def test_agent_run_graph_then_storage(api_client, clean_state):
    run = api_client.post("/agent/run", json={"source": "graph"})
    assert run.status_code == 200
    body = run.json()
    _assert_envelope(body)
    stats = body["data"]["stats"]
    assert stats["read"] == 27
    assert stats["relevant"] == 12
    assert stats["ambiguous"] == 3
    assert stats["irrelevant"] == 10
    assert stats["duplicate"] == 2

    cases = api_client.get("/storage/cases").json()
    _assert_envelope(cases)
    assert cases["data"]["count"] == 12

    # one case carries a manifest with ready_for_extraction
    trade_id = cases["data"]["cases"][0]["trade_id"]
    one = api_client.get(f"/storage/cases/{trade_id}").json()
    _assert_envelope(one)
    assert one["data"]["manifest"]["ready_for_extraction"] is True

    missing = api_client.get("/storage/cases/NOPE-9999")
    assert missing.status_code == 404
    _assert_envelope(missing.json(), status="error")


def test_agent_rerun_is_idempotent(api_client, clean_state):
    first = api_client.post("/agent/run", json={"source": "graph"}).json()["data"]["stats"]
    assert first["relevant"] == 12

    second = api_client.post("/agent/run", json={"source": "graph"}).json()["data"]["stats"]
    assert second["relevant"] == 0
    assert second["already_processed"] == 12


def test_run_recreates_deleted_case_folders(api_client, clean_state):
    """Demo reset: delete data/processed (keep the DB) -> a run rebuilds it."""
    import os
    import pathlib
    import shutil

    proc = pathlib.Path(os.environ["EMAIL_PROCESSED_PATH"])

    first = api_client.post("/agent/run", json={"source": "graph"}).json()["data"]["stats"]
    assert first["relevant"] == 12
    assert len([p for p in proc.iterdir() if p.is_dir()]) == 12

    # delete the processed folder but keep the SQLite index
    shutil.rmtree(proc)
    assert not proc.exists()

    second = api_client.post("/agent/run", json={"source": "graph"}).json()["data"]["stats"]
    assert second["relevant"] == 12            # restored, not skipped as "already processed"
    assert second["already_processed"] == 0
    recreated = [p for p in proc.iterdir() if p.is_dir()]
    assert len(recreated) == 12
    assert all((d / "manifest.json").exists() for d in recreated)


# ---- audit trail ------------------------------------------------------------

def test_audit_log_written(api_client, clean_state):
    api_client.post("/agent/run", json={"source": "graph"})
    log_dir = pathlib.Path(os.environ["EMAIL_AUDIT_LOG_DIR"])
    audit_files = list(log_dir.glob("audit_*.log"))
    assert audit_files, "no audit log written"

    lines = audit_files[0].read_text(encoding="utf-8").strip().splitlines()
    events = [json.loads(ln) for ln in lines]
    actions = {e["action"] for e in events}
    assert "agent.run.start" in actions
    assert "agent.run.complete" in actions
    assert "case.stored" in actions
    # every event carries the audit contract fields
    for e in events:
        assert {"timestamp", "event_id", "actor", "action", "outcome"} <= set(e)
