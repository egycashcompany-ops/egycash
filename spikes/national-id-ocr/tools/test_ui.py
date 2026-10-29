"""A local test page for the OCR sidecar: a National ID (front, then back) or any document.

    python tools/test_ui.py            # then open http://127.0.0.1:8098
    OCR_SIDECAR=http://127.0.0.1:8099 python tools/test_ui.py

Standard library only, so it runs on the host Python with nothing installed. The page talks to
this process, and this process forwards `/api/extract` to the sidecar — the sidecar sends no CORS
headers and should not grow any just for a test page, so the proxy is what keeps it untouched.

Nothing is written to disk. Card images pass through memory on their way to the sidecar and are
gone when the request ends, which matters because the cards you test with are real people's.
Binds to 127.0.0.1 only: this is a bench tool, not something to expose on a network.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PAGE = Path(__file__).with_name("test_ui.html")
SIDECAR = os.environ.get("OCR_SIDECAR", "http://127.0.0.1:8099").rstrip("/")
PORT = int(os.environ.get("TEST_UI_PORT", "8098"))
MAX_BODY_BYTES = 32 * 1024 * 1024
#: How long a card may take. PaddleOCR alone needs seconds; the VLM readers on CPU need minutes.
FORWARD_TIMEOUT_S = int(os.environ.get("OCR_FORWARD_TIMEOUT_S", "180"))


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status: int, message: str) -> None:
        self._send(status, json.dumps({"error": message}).encode(), "application/json")

    def _forward(self, method: str, path: str, body: bytes | None = None) -> None:
        request = urllib.request.Request(
            SIDECAR + path,
            data=body,
            method=method,
            headers={"Content-Type": "application/json"} if body is not None else {},
        )
        try:
            with urllib.request.urlopen(request, timeout=FORWARD_TIMEOUT_S) as response:
                self._send(response.status, response.read(), "application/json")
        except urllib.error.HTTPError as error:
            self._send(error.code, error.read(), "application/json")
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            self._error(
                502,
                f"The OCR service at {SIDECAR} did not answer ({error}). "
                "Is it running? Start it with `make serve`.",
            )

    def do_GET(self) -> None:  # noqa: N802 — BaseHTTPRequestHandler API
        route = self.path.split("?")[0].rstrip("/") or "/"
        if route == "/":
            self._send(200, PAGE.read_bytes(), "text/html; charset=utf-8")
        elif route == "/api/health":
            self._forward("GET", "/health")
        else:
            self._error(404, "not found")

    def do_POST(self) -> None:  # noqa: N802 — BaseHTTPRequestHandler API
        routes = {"/api/extract": "/extract", "/api/read": "/read"}
        target = routes.get(self.path.split("?")[0].rstrip("/"))
        if target is None:
            self._error(404, "not found")
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY_BYTES:
            self._error(413, "the photos are too large; the page downsizes them, so retry there")
            return
        self._forward("POST", target, self.rfile.read(length))

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002 — stdlib signature
        # Method, path and status only — nothing about a card's content is ever logged here.
        sys.stderr.write(f"{self.address_string()} {format % args}\n")


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"test page: http://127.0.0.1:{PORT}   (OCR service: {SIDECAR})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
