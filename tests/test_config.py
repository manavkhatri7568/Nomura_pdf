"""Tests for the runtime /config endpoint and that edits actually drive the classifier."""


def _assert_envelope(body, status="success"):
    assert body["status"] == status
    assert body["correlation_id"]
    if status == "success":
        assert body["data"] is not None and body["error"] is None
    else:
        assert body["error"] is not None


# ---- read -------------------------------------------------------------------

def test_get_config_returns_defaults(api_client):
    body = api_client.get("/config").json()
    _assert_envelope(body)
    data = body["data"]
    assert "fx trade settlement" in data["asset_keywords"]
    assert data["relevant_threshold"] == 0.7
    assert data["asset_weight"] == 0.5
    assert "asset_keywords" in data["editable_fields"]


# ---- update + validation ----------------------------------------------------

def test_put_config_updates_and_persists(api_client):
    resp = api_client.put("/config", json={"asset_keywords": ["alpha", "beta"]})
    assert resp.status_code == 200
    _assert_envelope(resp.json())
    assert resp.json()["data"]["asset_keywords"] == ["alpha", "beta"]
    # re-read reflects the change
    assert api_client.get("/config").json()["data"]["asset_keywords"] == ["alpha", "beta"]


def test_put_config_dedupes_and_trims_keywords(api_client):
    resp = api_client.put("/config", json={"asset_keywords": ["  Foo  ", "foo", "bar", ""]})
    assert resp.json()["data"]["asset_keywords"] == ["Foo", "bar"]


def test_put_config_rejects_bad_regex(api_client):
    resp = api_client.put("/config", json={"trade_id_patterns": ["FXOPT-[0-9"]})
    assert resp.status_code == 422
    body = resp.json()
    _assert_envelope(body, status="error")
    assert body["error"]["code"] == "InvalidConfig"


def test_put_config_rejects_out_of_range_weight(api_client):
    resp = api_client.put("/config", json={"asset_weight": 1.7})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "InvalidConfig"


def test_put_config_rejects_inverted_thresholds(api_client):
    resp = api_client.put("/config", json={
        "ambiguous_threshold": 0.8, "relevant_threshold": 0.5,
    })
    assert resp.status_code == 422
    assert "ambiguous_threshold" in resp.json()["error"]["message"]


def test_put_config_empty_patch_is_rejected(api_client):
    resp = api_client.put("/config", json={})
    assert resp.status_code == 422


# ---- the loop: config edits change classification ---------------------------

def test_editing_keywords_changes_classification(api_client):
    subject = "Quarterly picnic logistics"
    body = "Reminder about the office picnic next week."

    before = api_client.post("/classifier/classify",
                             json={"subject": subject, "body": body}).json()["data"]
    assert before["label"] == "IRRELEVANT"
    assert before["matched_asset"] == []

    # Teach the classifier a new strong asset keyword that this email contains.
    api_client.put("/config", json={"asset_keywords": ["office picnic"]})

    after = api_client.post("/classifier/classify",
                            json={"subject": subject, "body": body}).json()["data"]
    # The new asset signal now fires and the verdict moves off IRRELEVANT.
    assert "office picnic" in after["matched_asset"]
    assert after["label"] != before["label"]


def test_lowering_threshold_promotes_ambiguous_to_relevant(api_client):
    # A single subject-keyword hit scores 0.3 -> AMBIGUOUS by default.
    payload = {"subject": "Settlement", "body": ""}
    assert api_client.post("/classifier/classify", json=payload).json()["data"]["label"] == "AMBIGUOUS"

    # Drop the RELEVANT cut to 0.3 -> the same email is now RELEVANT.
    api_client.put("/config", json={"relevant_threshold": 0.3})
    assert api_client.post("/classifier/classify", json=payload).json()["data"]["label"] == "RELEVANT"


def test_config_edit_changes_full_pipeline_split(api_client, clean_state):
    # Baseline split on the 27-email corpus.
    base = api_client.post("/agent/run", json={"source": "graph"}).json()["data"]["stats"]
    assert base["relevant"] == 12

    # Wipe state, then strip asset keywords so far fewer emails reach RELEVANT.
    import os, pathlib, shutil
    db = pathlib.Path(os.environ["EMAIL_DB_PATH"])
    proc = pathlib.Path(os.environ["EMAIL_PROCESSED_PATH"])
    if db.exists():
        db.unlink()
    if proc.exists():
        shutil.rmtree(proc)

    api_client.put("/config", json={"asset_keywords": ["nonexistent-keyword-zzz"]})
    after = api_client.post("/agent/run", json={"source": "graph"}).json()["data"]["stats"]
    assert after["relevant"] < base["relevant"]


# ---- reset ------------------------------------------------------------------

def test_reset_restores_defaults(api_client):
    api_client.put("/config", json={"asset_keywords": ["temporary"]})
    reset = api_client.post("/config/reset").json()
    _assert_envelope(reset)
    assert "fx trade settlement" in reset["data"]["asset_keywords"]
    assert "temporary" not in reset["data"]["asset_keywords"]


# ---- audit ------------------------------------------------------------------

def test_config_update_is_audited(api_client):
    import json, os, pathlib
    api_client.put("/config", json={"asset_keywords": ["audited-change"]})
    log_dir = pathlib.Path(os.environ["EMAIL_AUDIT_LOG_DIR"])
    events = []
    for f in log_dir.glob("audit_*.log"):
        for ln in f.read_text(encoding="utf-8").strip().splitlines():
            events.append(json.loads(ln))
    assert any(e["action"] == "config.updated" and e["outcome"] == "success" for e in events)
