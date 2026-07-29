"""Local HTTP surface for the OCR pipeline — the process the API's provider talks to.

Runs on the loopback/compose network only. It makes NO outbound calls: the weights are baked into
the image and the recognizer is constructed with explicit local paths. There is no third-party
service and no external API in this path, by construction rather than by policy.

Deliberately built on the standard library rather than FastAPI/uvicorn. The surface is two
endpoints; adding a web framework plus an ASGI server to a container that already carries
PaddlePaddle would grow the image for no capability. Fewer dependencies also means fewer things
that can pull a wheel at build time.

Endpoints
  GET  /health   → readiness, model directory, active layout profile
  POST /extract  → {frontImageBase64?, backImageBase64?} → RawOcrResult-shaped fields

Images arrive as base64 in a JSON body rather than as multipart because the caller already holds
them in memory (it read them from the Files service) and the payloads are small — a card photo is
a few hundred KB. That keeps the client in the API a plain `fetch`, with no multipart assembly.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import socket
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .diagnose import diagnose
from .extract import extract
from .layout import active_profile_name

LOG = logging.getLogger("nidocr.service")

#: Refuse oversized bodies outright. A National-ID photo is well under this; anything larger is a
#: mistake or an attempt to exhaust memory, and both deserve a 413 rather than an OOM.
MAX_BODY_BYTES = 12 * 1024 * 1024

_recognizer = None


def get_recognizer():
    """Build the recognizer once, lazily.

    Lazy so that `/health` can answer while the model is still loading, and once so that PP-OCR's
    weights are not re-read per request — first-call latency is seconds, per-call is milliseconds.
    """
    global _recognizer  # noqa: PLW0603 — process-wide singleton is the point
    if _recognizer is None:
        from .engine import PaddleRecognizer

        started = time.perf_counter()
        _recognizer = PaddleRecognizer(model_dir=os.environ.get("PADDLE_OCR_MODEL_DIR", "/models"))
        LOG.info("recognizer ready in %.1f s", time.perf_counter() - started)
    return _recognizer


def _decode(value: str | None, suffix: str) -> str | None:
    """Base64 → a temp file path, because OpenCV reads from disk in this pipeline.

    Written under the process's own temp dir and removed by the caller. Card images are personal
    data, so they must not outlive the request that carried them.
    """
    if not value:
        return None
    try:
        raw = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("image is not valid base64") from error
    if not raw:
        raise ValueError("image is empty")
    handle = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        handle.write(raw)
    finally:
        handle.close()
    return handle.name


class Handler(BaseHTTPRequestHandler):
    server_version = "nidocr/1.0"

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003 — BaseHTTPRequestHandler API
        """Route access logs through logging, and never log a request body.

        The default handler prints to stderr; more importantly, nothing here may echo the payload,
        which is a photograph of someone's identity document.
        """
        LOG.info("%s - %s", self.address_string(), fmt % args)

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 — BaseHTTPRequestHandler API
        if self.path.rstrip("/") != "/health":
            self._send(404, {"error": "not found"})
            return
        model_dir = Path(os.environ.get("PADDLE_OCR_MODEL_DIR", "/models"))
        self._send(
            200,
            {
                "status": "ok",
                "modelDir": str(model_dir),
                "modelsPresent": model_dir.is_dir() and any(model_dir.rglob("*")),
                "layoutProfile": active_profile_name(),
                "recognizerLoaded": _recognizer is not None,
            },
        )

    def do_POST(self) -> None:  # noqa: N802 — BaseHTTPRequestHandler API
        route = self.path.rstrip("/")
        if route not in ("/extract", "/diagnose"):
            self._send(404, {"error": "not found"})
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            self._send(400, {"error": "empty body"})
            return
        if length > MAX_BODY_BYTES:
            self._send(413, {"error": "payload too large"})
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send(400, {"error": "body is not valid JSON"})
            return

        front = back = None
        try:
            front = _decode(payload.get("frontImageBase64"), "-front.jpg")
            back = _decode(payload.get("backImageBase64"), "-back.jpg")
            if front is None and back is None:
                self._send(400, {"error": "at least one of frontImageBase64 / backImageBase64"})
                return

            if route == "/diagnose":
                # Geometry only — see diagnose.py. No card text is returned or logged, so the
                # output can be shared to correct the field boxes without sharing the card.
                report = {
                    side: diagnose(path, get_recognizer())
                    for side, path in (("front", front), ("back", back))
                    if path is not None
                }
                LOG.info(
                    "diagnosed %s",
                    {side: data["regionCount"] for side, data in report.items()},
                )
                self._send(200, report)
                return

            started = time.perf_counter()
            result = extract(front, back, get_recognizer())
            elapsed = (time.perf_counter() - started) * 1000.0
            # Field COUNT and timing only — never the values. Logs are not a place for the
            # contents of someone's identity card. The quality verdict is a property of the
            # photograph rather than of its holder, so it is safe to log and worth logging: a
            # sudden run of rejected captures is an operational signal.
            LOG.info(
                "extracted %d fields in %.0f ms (quality=%s)",
                len(result.as_raw_ocr_result()),
                elapsed,
                {side: report.verdict for side, report in result.quality.items()},
            )
            self._send(
                200,
                {
                    "fields": result.as_raw_ocr_result(),
                    "elapsedMs": round(elapsed, 1),
                    "layoutProfile": active_profile_name(),
                    # Additive, so an older caller that ignores these keeps working unchanged.
                    #
                    # `quality` is the actionable half: it carries per-side reason codes ('too_small',
                    # 'blurred', 'glare', …) that let the UI tell someone what to change about their
                    # photograph. Without it the only available message is "could not read the card",
                    # which sends people back to take the same bad photograph a second time.
                    #
                    # `diagnostics` is the explanatory half — which detector located the card,
                    # whether it was dewarped or read upside down, how many boxes had to be moved
                    # onto the text. It answers "why was this read poor?" without anyone needing to
                    # send the card image to someone who can look at it. Coordinates and counts only:
                    # like `/diagnose`, it carries no card content.
                    "quality": {
                        side: report.as_dict() for side, report in result.quality.items()
                    },
                    "diagnostics": result.diagnostics,
                },
            )
        except ValueError as error:
            self._send(400, {"error": str(error)})
        except Exception:  # noqa: BLE001 — a failed read must not take the service down
            LOG.exception("extraction failed")
            self._send(500, {"error": "extraction failed"})
        finally:
            # Card images are personal data; they do not outlive the request.
            for path in (front, back):
                if path:
                    Path(path).unlink(missing_ok=True)


class DualStackServer(ThreadingHTTPServer):
    """Listens on IPv6 and, on a dual-stack host, IPv4 as well.

    This is not a nicety — Railway's private network is IPv6-ONLY. A service bound to
    `0.0.0.0` is simply unreachable at `http://<service>.railway.internal`, and the failure
    looks like a timeout rather than a binding mistake. (The same trap is already documented for
    Redis in `docs/09-guides/railway-deployment.md`, which is why `REDIS_URL` needs `?family=0`.)

    Binding `::` with `IPV6_V6ONLY` off accepts both families, so one configuration serves
    Railway's private network, a compose bridge, and `localhost` in development.
    """

    address_family = socket.AF_INET6
    daemon_threads = True

    def server_bind(self) -> None:
        if hasattr(socket, "IPPROTO_IPV6"):
            try:
                self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
            except OSError:
                # Some kernels forbid changing it; IPv6-only still serves Railway, which is the
                # case that would otherwise break silently.
                LOG.warning("could not disable IPV6_V6ONLY; serving IPv6 only")
        super().server_bind()


def _build_server(host: str, port: int) -> ThreadingHTTPServer:
    """Prefer dual-stack; fall back to IPv4 where IPv6 is unavailable."""
    try:
        return DualStackServer((host, port), Handler)
    except OSError as error:
        LOG.warning("IPv6 bind on [%s]:%d failed (%s) — falling back to IPv4", host, port, error)
        return ThreadingHTTPServer(("0.0.0.0", port), Handler)  # noqa: S104 — internal network only


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(message)s")
    # `::` = every interface, both families. Override with OCR_HOST to pin it narrower.
    host = os.environ.get("OCR_HOST", "::")
    # OCR_PORT is the explicit setting. `PORT` is the fallback because platforms that inject it
    # (Railway among them) expect the process to honour it; without the fallback a forgotten
    # OCR_PORT leaves the container listening somewhere the platform never routes to.
    port = int(os.environ.get("OCR_PORT") or os.environ.get("PORT") or "8099")

    if os.environ.get("OCR_PRELOAD", "1") == "1":
        # Pay the model-load cost at start rather than on the first user-facing request.
        get_recognizer()

    server = _build_server(host, port)
    LOG.info(
        "nidocr listening on [%s]:%d (family=%s, profile=%s)",
        host,
        port,
        server.address_family.name,
        active_profile_name(),
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
