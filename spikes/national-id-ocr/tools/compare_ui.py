"""Three copies of the test page, one per reader, so they can be compared side by side.

    python tools/compare_ui.py
    # http://127.0.0.1:8101  PaddleOCR
    # http://127.0.0.1:8102  PaddleOCR-VL
    # http://127.0.0.1:8103  Qwen

Docker has room for one reader at a time (Qwen alone peaks near 6.8 GB), so the three pages share
the single `nid-ocr-serve` container on port 8099: a card sent from a page first swaps that
container to the page's reader if another one is loaded. A swap takes up to a minute; cards from
the same page after that run at the reader's normal speed. Cards are handled one at a time, so a
swap can never pull a reader out from under a card another page is still reading.

Same rules as `test_ui.py`: standard library only, nothing written to disk, 127.0.0.1 only.
"""

from __future__ import annotations

import json
import subprocess
import threading
import time
import urllib.request
from http.server import ThreadingHTTPServer

import test_ui

CONTAINER = "nid-ocr-serve"
#: port -> (OCR_TEXT_RECOGNIZER value the image reports, image tag, label)
READERS = {
    8101: ("paddle", "latest", "PaddleOCR"),
    8102: ("paddleocr_vl", "paddleocr-vl", "PaddleOCR-VL"),
    8103: ("qwen", "qwen", "Qwen"),
}
_one_card_at_a_time = threading.Lock()
# A swap plus a PaddleOCR-VL read of a real photo runs well past the single-reader page's 3 minutes.
test_ui.FORWARD_TIMEOUT_S = 15 * 60


def _loaded_reader() -> str | None:
    try:
        with urllib.request.urlopen(test_ui.SIDECAR + "/health", timeout=3) as response:
            health = json.load(response)
    except (OSError, ValueError):
        return None
    return health.get("textRecognizer") if health.get("recognizerLoaded") else None


def _ensure_reader(kind: str, tag: str) -> None:
    if _loaded_reader() == kind:
        return
    subprocess.run(["docker", "rm", "-f", CONTAINER], capture_output=True, check=False)
    subprocess.run(
        ["docker", "run", "-d", "--rm", "--name", CONTAINER,
         "-p", "127.0.0.1:8099:8099", f"ecms/nid-ocr-spike:{tag}"],
        capture_output=True, check=True,
    )
    deadline = time.monotonic() + 300
    while time.monotonic() < deadline:
        if _loaded_reader() == kind:
            return
        time.sleep(2)
    raise TimeoutError("the reader did not load within 5 minutes")


def _handler(kind: str, tag: str, label: str) -> type[test_ui.Handler]:
    class Handler(test_ui.Handler):
        def do_GET(self) -> None:  # noqa: N802 — BaseHTTPRequestHandler API
            route = self.path.split("?")[0].rstrip("/") or "/"
            if route == "/":
                page = (
                    test_ui.PAGE.read_text(encoding="utf-8")
                    .replace("<title>Local OCR Test</title>", f"<title>{label} · OCR test</title>")
                    .replace("<h1>OCR test</h1>", f"<h1>OCR test · {label}</h1>")
                )
                self._send(200, page.encode("utf-8"), "text/html; charset=utf-8")
            elif route == "/api/health":
                # Answered here: probing the shared container would report another page's reader.
                note = f"{label}; the first card after another page used a different reader takes up to a minute longer"
                self._send(200, json.dumps({"status": "ok", "layoutProfile": note}).encode(), "application/json")
            else:
                super().do_GET()

        def _forward(self, method: str, path: str, body: bytes | None = None) -> None:
            with _one_card_at_a_time:
                try:
                    _ensure_reader(kind, tag)
                except (subprocess.CalledProcessError, TimeoutError) as error:
                    self._error(503, f"Could not start {label}: {error}")
                    return
                super()._forward(method, path, body)

    return Handler


def main() -> None:
    servers = [
        ThreadingHTTPServer(("127.0.0.1", port), _handler(*reader))
        for port, reader in READERS.items()
    ]
    for server, (port, (_, _, label)) in zip(servers, READERS.items()):
        threading.Thread(target=server.serve_forever, daemon=True).start()
        print(f"{label:>13}: http://127.0.0.1:{port}", flush=True)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
