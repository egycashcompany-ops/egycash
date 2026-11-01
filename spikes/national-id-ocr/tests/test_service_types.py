"""The service's document types: the rename, the old name as an alias, and the verdict on every answer."""

from __future__ import annotations

import base64
import json
import sys
import threading
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import importlib  # noqa: E402

from nidocr import service as service_module  # noqa: E402
from nidocr.engine import MockRecognizer  # noqa: E402
from nidocr.extract import ExtractionResult  # noqa: E402

extract_module = importlib.import_module("nidocr.extract")
FIXTURES = ROOT / "fixtures" / "synthetic"


def _fake_badge(_path, _recognizer, *_rest):
    result = ExtractionResult()
    result.fields["employeeCode"] = {"value": "0100004", "confidence": "high"}
    result.diagnostics["badgeCheck"] = {
        "verdict": "egycash_badge", "companyFound": True, "employeeCodeValid": True,
        "nationalIdValid": False, "labelled": [],
    }
    result.diagnostics["front"] = {"linesDetected": 6}
    return result


@pytest.fixture()
def server(monkeypatch):
    if not (FIXTURES / "manifest.json").exists():
        pytest.skip("run `make fixtures` first")
    manifest = json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))
    monkeypatch.setattr(service_module, "get_recognizer", lambda: MockRecognizer(dict(manifest[0]["truth"])))
    monkeypatch.setattr(extract_module, "extract_badge", _fake_badge)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), service_module.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        yield httpd.server_address, manifest[0]
    finally:
        httpd.shutdown()
        httpd.server_close()


def _request(address, method: str, path: str, payload: dict | None = None) -> tuple[int, dict]:
    conn = HTTPConnection(*address, timeout=60)
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    conn.request(method, path, body, {"Content-Type": "application/json"} if body else {})
    response = conn.getresponse()
    raw = response.read().decode("utf-8")
    conn.close()
    return response.status, (json.loads(raw) if raw else {})


def _image(entry) -> str:
    return base64.b64encode((FIXTURES / entry["front"]).read_bytes()).decode("ascii")


def test_egycash_id_is_accepted_and_answers_with_its_verdict(server):
    address, entry = server
    status, payload = _request(address, "POST", "/extract", {"documentType": "egycash_id", "imageBase64": _image(entry)})
    assert status == 200
    assert payload["documentType"] == "egycash_id"
    assert payload["verdict"]["status"] == "match"
    assert "deprecation" not in payload


def test_the_old_badge_name_still_works_and_says_it_is_renamed(server):
    address, entry = server
    status, payload = _request(address, "POST", "/extract", {"documentType": "egycash_badge", "imageBase64": _image(entry)})
    assert status == 200
    assert payload["documentType"] == "egycash_id"
    assert "egycash_id" in payload["deprecation"]


def test_an_unknown_type_is_a_400_naming_the_valid_ones(server):
    address, entry = server
    status, payload = _request(address, "POST", "/extract", {"documentType": "passport", "imageBase64": _image(entry)})
    assert status == 400
    assert "army_exemption" in payload["error"]


def test_the_national_id_answer_carries_a_verdict(server):
    address, entry = server
    status, payload = _request(address, "POST", "/extract", {"imageBase64": _image(entry)})
    assert status == 200
    assert payload["documentType"] == "national_id"
    assert payload["verdict"]["status"] in ("match", "not_match", "unreadable")
    assert isinstance(payload["verdict"]["reasons"], list)


def test_the_army_reader_answers_without_inventing_fields(server):
    address, entry = server
    status, payload = _request(address, "POST", "/extract", {"documentType": "army_exemption", "imageBase64": _image(entry)})
    assert status == 200
    assert payload["documentType"] == "army_exemption"
    assert payload["verdict"]["status"] in ("not_match", "unreadable")


def test_the_types_are_listed_for_the_ui(server):
    address, _ = server
    status, payload = _request(address, "GET", "/types")
    assert status == 200
    assert [item["id"] for item in payload["types"]] == ["national_id", "egycash_id", "army_exemption"]


def test_a_job_is_started_at_once_and_watched_to_its_verdict(server):
    import time

    address, entry = server
    status, started = _request(address, "POST", "/jobs", {"documentType": "egycash_id", "imageBase64": _image(entry)})
    assert status == 202
    assert started["documentType"] == "egycash_id"
    deadline = time.monotonic() + 30
    while True:
        status, state = _request(address, "GET", started["status"])
        assert status == 200
        if state["done"] or time.monotonic() > deadline:
            break
        time.sleep(0.05)
    assert state["state"] == "match"
    assert state["result"]["verdict"]["status"] == "match"


def test_job_events_stream_until_the_job_is_done(server):
    address, entry = server
    _, started = _request(address, "POST", "/jobs", {"documentType": "egycash_id", "imageBase64": _image(entry)})
    conn = HTTPConnection(*address, timeout=30)
    conn.request("GET", started["events"])
    response = conn.getresponse()
    assert response.getheader("Content-Type").startswith("text/event-stream")
    text = response.read().decode("utf-8")
    conn.close()
    states = [line.split(": ", 1)[1] for line in text.splitlines() if line.startswith("event: ")]
    assert states[-1] == "match"
    assert "reading" in states or "queued" in states


def test_an_unknown_job_is_404(server):
    address, _ = server
    status, _ = _request(address, "GET", "/jobs/nope")
    assert status == 404


def test_a_job_for_an_unknown_type_is_refused_up_front(server):
    address, entry = server
    status, payload = _request(address, "POST", "/jobs", {"documentType": "passport", "imageBase64": _image(entry)})
    assert status == 400


def test_ui_files_outside_the_ui_folder_are_not_reachable(server):
    address, _ = server
    status, _ = _request(address, "GET", "/ui/../../src/nidocr/service.py")
    assert status == 404


def test_the_readers_page_and_its_files_are_served(server):
    address, _ = server
    for path, kind in (("/readers", "text/html"), ("/ui/readers.js", "text/javascript"), ("/ui/tokens.css", "text/css")):
        conn = HTTPConnection(*address, timeout=10)
        conn.request("GET", path)
        response = conn.getresponse()
        body = response.read()
        conn.close()
        assert response.status == 200, path
        assert response.getheader("Content-Type").startswith(kind)
        assert body
