"""The HTTP contract between the sidecar and the API's provider.

This is the seam where the two languages meet, so it is worth pinning independently of model
quality: the TypeScript side parses this exact JSON, and a change in shape would surface as
"OCR silently returns nothing" rather than as a failure anyone could trace.

Recognition is stubbed, so these run with no weights and no network. What they prove is the part
the provider actually depends on — base64 in, `{fields: {name: {value, confidence}}}` out, sane
status codes on bad input, and no card image left on disk afterwards.
"""

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

from nidocr import service as service_module  # noqa: E402
from nidocr.engine import MockRecognizer  # noqa: E402

FIXTURES = ROOT / "fixtures" / "synthetic"
pytestmark = pytest.mark.skipif(
    not (FIXTURES / "manifest.json").exists(), reason="run `make fixtures` first"
)


@pytest.fixture()
def server(monkeypatch):
    """A live server on an ephemeral port, with recognition replaced by a replay stub."""
    manifest = json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))
    truth = manifest[0]["truth"]
    monkeypatch.setattr(service_module, "get_recognizer", lambda: MockRecognizer(dict(truth)))

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), service_module.Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd.server_address, manifest[0], truth
    finally:
        httpd.shutdown()
        httpd.server_close()


def _post(address, payload: dict) -> tuple[int, dict]:
    conn = HTTPConnection(*address, timeout=30)
    body = json.dumps(payload).encode("utf-8")
    conn.request("POST", "/extract", body, {"Content-Type": "application/json"})
    response = conn.getresponse()
    raw = response.read().decode("utf-8")
    conn.close()
    return response.status, (json.loads(raw) if raw else {})


def _b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def test_health_reports_readiness_and_profile(server):
    address, _, _ = server
    conn = HTTPConnection(*address, timeout=10)
    conn.request("GET", "/health")
    response = conn.getresponse()
    payload = json.loads(response.read().decode("utf-8"))
    conn.close()
    assert response.status == 200
    assert payload["status"] == "ok"
    assert "layoutProfile" in payload  # operators need to see which geometry is live


def test_extract_returns_the_raw_ocr_result_shape(server):
    """Exactly the shape `sanitize()` in paddle-ocr-provider.ts consumes."""
    address, entry, truth = server
    status, payload = _post(
        address,
        {
            "frontImageBase64": _b64(FIXTURES / entry["front"]),
            "backImageBase64": _b64(FIXTURES / entry["back"]),
        },
    )
    assert status == 200
    fields = payload["fields"]
    assert fields, "no fields returned"
    for name, field in fields.items():
        assert set(field) == {"value", "confidence"}, f"{name} has an unexpected shape"
        assert isinstance(field["value"], str) and field["value"]
        assert field["confidence"] in ("high", "medium", "low")
    assert fields["nationalId"]["value"] == truth["nationalId"]


def test_extract_never_returns_a_derived_field(server):
    """Birth date / gender / governorate belong to parseNationalId, downstream and in TypeScript."""
    address, entry, _ = server
    _, payload = _post(address, {"frontImageBase64": _b64(FIXTURES / entry["front"])})
    assert not {"birthDate", "gender", "governorate", "age"} & set(payload["fields"])


def test_one_sided_request_is_accepted(server):
    address, entry, _ = server
    status, payload = _post(address, {"backImageBase64": _b64(FIXTURES / entry["back"])})
    assert status == 200 and payload["fields"]


def test_missing_images_rejected(server):
    address, _, _ = server
    assert _post(address, {})[0] == 400


def test_invalid_base64_rejected(server):
    address, _, _ = server
    status, payload = _post(address, {"frontImageBase64": "not-base64!!"})
    assert status == 400 and "error" in payload


def test_unknown_route_is_404(server):
    address, _, _ = server
    conn = HTTPConnection(*address, timeout=10)
    conn.request("POST", "/nope", b"{}", {"Content-Type": "application/json"})
    assert conn.getresponse().status == 404
    conn.close()


def test_card_images_do_not_outlive_the_request(server, tmp_path, monkeypatch):
    """Personal data must not accumulate in the container's temp directory."""
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    monkeypatch.setattr("tempfile.tempdir", str(tmp_path))
    address, entry, _ = server
    _post(address, {"frontImageBase64": _b64(FIXTURES / entry["front"])})
    assert list(tmp_path.iterdir()) == []
