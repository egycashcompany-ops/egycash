"""Local HTTP surface for the OCR pipeline, the process the API's provider talks to."""

from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import socket
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .diagnose import diagnose
from .document import read_document
from . import access, pool, registry
from .extract import extract
from .layout import active_profile_name
from .preprocess import load_bgr
from .portrait import find_portrait
from .trace import Trace, render_html

LOG = logging.getLogger("nidocr.service")

#: Room for two full-resolution phone photos as base64 (the pages send up to 4000 px; shrinking
#: further cuts far-away cards below readable size). Anything larger gets a 413, not an OOM.
MAX_BODY_BYTES = 32 * 1024 * 1024

_recognizer = None
_jobs = None
_jobs_lock = threading.Lock()

#: Pages and their assets served by the service itself (the Readers page and its theme files), so
#: the three readers can be watched without the separate test-page server.
TOOLS = Path(__file__).resolve().parents[2] / "tools"
_STATIC = {
    "/readers": ("readers.html", "text/html; charset=utf-8"),
}
_STATIC_TYPES = {".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                 ".svg": "image/svg+xml", ".png": "image/png", ".glb": "model/gltf-binary", ".webp": "image/webp"}


def get_jobs():
    """The job board, built on first use. Reads go through the worker pool (see pool.py)."""
    global _jobs  # noqa: PLW0603 - one board per service process
    with _jobs_lock:
        if _jobs is None:
            from .jobs import Jobs  # noqa: PLC0415

            _jobs = Jobs(lambda payload: pool.submit_extraction(payload))
        return _jobs


def get_recognizer():
    """Build the recognizer once, lazily."""
    global _recognizer  # noqa: PLW0603 - process-wide singleton is the point
    if _recognizer is None:
        from .engine import PaddleRecognizer  # noqa: PLC0415 - lazy: the models are heavy

        started = time.perf_counter()
        _recognizer = PaddleRecognizer(model_dir=os.environ.get("PADDLE_OCR_MODEL_DIR", "/models"))
        LOG.info("recognizer ready in %.1f s", time.perf_counter() - started)
    return _recognizer


def _decode(value: str | None, suffix: str) -> str | None:
    """Base64 → a temp file path, because OpenCV reads from disk in this pipeline."""
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


#: Longest side of an oriented-image preview. Enough to see which way up the photo was read,
#: small enough not to double the response for a card the caller already has at full size.
PREVIEW_MAX_SIDE = 900


def _preview(image) -> str:
    """A photo as the pipeline read it → base64 JPEG, shrunk. Only ever sent when asked for."""
    import cv2  # noqa: PLC0415 - already loaded by the pipeline; kept local to this helper

    height, width = image.shape[:2]
    scale = min(1.0, PREVIEW_MAX_SIDE / max(height, width, 1))
    if scale < 1.0:
        image = cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
    ok, buffer = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return base64.b64encode(buffer.tobytes()).decode("ascii") if ok else ""


def _portrait_payload(result, payload: dict) -> dict:
    if not payload.get("returnPortrait") or "front" not in result.oriented:
        return {}
    portrait = find_portrait(result.oriented["front"])
    return {} if portrait is None else {"portraitImage": _preview(portrait)}


class Handler(BaseHTTPRequestHandler):
    server_version = "nidocr/1.0"

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003 - BaseHTTPRequestHandler API
        """Route access logs through logging, and never log a request body."""
        LOG.info("%s - %s", self.address_string(), fmt % args)

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, page: str) -> None:
        """The trace comes back as a page rather than JSON, because the hard part of a diagnostic is
        not producing it but getting it out of a container and in front of someone. Every image is
        inlined, so it survives being saved and emailed.
        """
        body = page.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_document(self, payload: dict) -> None:
        """POST /read, any document, no fields. See document.py."""
        path = None
        try:
            path = _decode(payload.get("imageBase64"), "-page.jpg")
            if path is None:
                self._send(400, {"error": "imageBase64 is required"})
                return
            result = read_document(load_bgr(path), get_recognizer())
            _forget(path)
            upright_image = result.pop("uprightImage", None)
            if payload.get("returnOrientedImages") and upright_image is not None:
                result["orientedImage"] = _preview(upright_image)
            # Counts and timing only, like /extract: a document's text is its owner's business.
            LOG.info(
                "read a document: %d lines in %.0f ms (rotated %d)",
                len(result["lines"]),
                result["elapsedMs"],
                result["rotated"],
            )
            self._send(200, result)
        except ValueError as error:
            self._send(400, {"error": str(error)})
        except Exception:  # noqa: BLE001 - a failed read must not take the service down
            LOG.exception("document read failed")
            self._send(500, {"error": "document read failed"})
        finally:
            _forget(path)

    def _send_file(self, path: Path, content_type: str) -> None:
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def _send_events(self, job_id: str) -> None:
        """GET /jobs/<id>/events: each state change as a server-sent event, until the job is done."""
        jobs = get_jobs()
        if jobs.get(job_id) is None:
            self._send(404, {"error": "no such job (finished jobs are forgotten after a few minutes)"})
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            for event in jobs.events(job_id):
                data = json.dumps(event, ensure_ascii=False)
                self.wfile.write(f"event: {event['state']}\ndata: {data}\n\n".encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # the page went away; the job carries on and expires on its own
        self.close_connection = True

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if not access.guard(self):
            return
        route = self.path.split("?")[0].rstrip("/") or "/"
        if route.startswith("/jobs/"):
            parts = route.split("/")
            if len(parts) == 4 and parts[3] == "events":
                self._send_events(parts[2])
                return
            state = get_jobs().get(parts[2]) if len(parts) == 3 else None
            if state is None:
                self._send(404, {"error": "no such job (finished jobs are forgotten after a few minutes)"})
            else:
                self._send(200, state)
            return
        if route in _STATIC:
            name, content_type = _STATIC[route]
            self._send_file(TOOLS / name, content_type)
            return
        if route.startswith("/ui/"):
            target = (TOOLS / "ui" / route[len("/ui/"):]).resolve()
            # Only files inside tools/ui/, of the kinds listed: nothing else is reachable.
            if (TOOLS / "ui").resolve() in target.parents and target.is_file() and target.suffix in _STATIC_TYPES:
                self._send_file(target, _STATIC_TYPES[target.suffix])
            else:
                self._send(404, {"error": "not found"})
            return
        if route == "/types":
            self._send(200, {"types": registry.catalogue()})
            return
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
                "textRecognizer": "paddle",
            },
        )

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if not access.guard(self):
            return
        route = self.path.rstrip("/")
        if route not in ("/extract", "/diagnose", "/trace", "/read", "/jobs"):
            self._send(404, {"error": "not found"})
            return
        if route == "/trace" and os.environ.get("OCR_TRACE_DISABLED") == "1":
            self._send(403, {"error": "tracing is disabled on this deployment"})
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
        if not isinstance(payload, dict):
            self._send(400, {"error": "body must be a JSON object"})
            return

        if route == "/read":
            self._read_document(payload)
            return

        if route == "/jobs":
            # Answer at once with the job's id; the read runs on (see jobs.py).
            try:
                kind, _ = registry.resolve(payload.get("documentType") or "national_id")
            except KeyError as error:
                self._send(400, {"error": error.args[0]})
                return
            payload["documentType"] = payload.get("documentType") or kind.id
            from .jobs import QueueFull  # noqa: PLC0415

            try:
                job_id = get_jobs().create(payload)
            except QueueFull as error:
                self._send(429, {"error": str(error)})
                return
            self._send(202, {"jobId": job_id, "documentType": kind.id, "status": f"/jobs/{job_id}",
                             "events": f"/jobs/{job_id}/events"})
            return

        if route == "/extract":
            status, body = pool.submit_extraction(payload)
            self._send(status, body)
            return

        front = back = None
        try:
            front = _decode(payload.get("frontImageBase64") or payload.get("imageBase64"), "-front.jpg")
            back = _decode(payload.get("backImageBase64"), "-back.jpg")
            if front is None and back is None:
                self._send(400, {"error": "at least one of frontImageBase64 / backImageBase64"})
                return

            if route == "/diagnose":
                # Geometry only, see diagnose.py. No card text is returned or logged, so the
                # output can be shared to correct the field boxes without sharing the card.
                report = {
                    side: diagnose(path, get_recognizer())
                    for side, path in (("front", front), ("back", back))
                    if path is not None
                }
                _forget(front, back)
                LOG.info(
                    "diagnosed %s",
                    {side: data["regionCount"] for side, data in report.items()},
                )
                self._send(200, report)
                return

            # /trace runs the real extraction with a collector attached, so it shows what
            # production does rather than what a parallel copy of the pipeline would do.
            recognizer = get_recognizer()
            keep = getattr(recognizer, "keep_line_images", None)
            trace = Trace()
            try:
                if keep is not None:
                    recognizer.keep_line_images = True
                extract(front, back, recognizer, trace)
            finally:
                if keep is not None:
                    recognizer.keep_line_images = keep
            _forget(front, back)
            LOG.info("traced a card: %d artefacts", len(trace.entries))
            self._send_html(render_html(trace))
        except ValueError as error:
            self._send(400, {"error": str(error)})
        except Exception:  # noqa: BLE001 - a failed read must not take the service down
            LOG.exception("%s failed", route)
            self._send(500, {"error": f"{route.strip('/')} failed"})
        finally:
            # Card images are personal data; they do not outlive the request.
            _forget(front, back)


def run_extraction(payload: dict, recognizer=None) -> tuple[int, dict]:
    """POST /extract, as a function: the request body → (HTTP status, answer).

    Runs wherever it is called: on the request's thread, or in a worker process of the pool (see
    pool.py), which passes its own recognizer. Photos are written to temporary files only for the
    length of the read.
    """
    # What is being read (see registry.py). The National ID Card is the default; the old
    # "egycash_badge" still works and is answered with a note that it is now "egycash_id".
    try:
        kind, deprecation = registry.resolve(payload.get("documentType") or "national_id")
    except KeyError as error:
        return 400, {"error": error.args[0]}
    front = back = None
    try:
        front = _decode(payload.get("frontImageBase64") or payload.get("imageBase64"), "-front.jpg")
        back = _decode(payload.get("backImageBase64"), "-back.jpg")
        if front is None and back is None:
            return 400, {"error": "at least one of frontImageBase64 / backImageBase64"}

        started = time.perf_counter()
        holder = payload.get("holder") if isinstance(payload.get("holder"), dict) else None
        result = kind.reader()(front, back, recognizer or get_recognizer(), holder=holder)
        verdict = kind.verdict()(result)
        elapsed = (time.perf_counter() - started) * 1000.0
        # Delete the photos before answering, so they are gone by the time the caller has the result.
        _forget(front, back)
        # Field count and timing only, never the values.
        LOG.info(
            "extracted %s: %d fields, verdict %s, in %.0f ms (quality=%s, anchoring=%s)",
            kind.id,
            len(result.as_raw_ocr_result()),
            verdict.status,
            elapsed,
            {
                side: {
                    "verdict": report.verdict,
                    "reasons": list(report.reasons),
                    **{
                        name: round(value, 3)
                        for name, value in report.metrics.items()
                        if name in ("cardWidthPx", "sharpness", "glare", "contrast")
                    },
                }
                for side, report in result.quality.items()
            },
            {
                side: {
                    "lines": notes.get("linesDetected", 0),
                    "boxes": notes.get("boxSources", {}),
                    **({"detectionFailed": True} if notes.get("detectionFailed") else {}),
                }
                for side, notes in result.diagnostics.items()
                # Per-side notes only: card-wide entries such as `crossChecksFailed` are lists.
                if isinstance(notes, dict)
            },
        )
        return 200, {
            "documentType": kind.id,
            # match | not_match | unreadable, with reason codes. See verdict.py.
            "verdict": verdict.as_dict(),
            **({"deprecation": deprecation} if deprecation else {}),
            "fields": result.as_raw_ocr_result(),
            # Additive: each field's confidence as a percentage inside its band.
            "scores": result.scores(),
            "elapsedMs": round(elapsed, 1),
            "layoutProfile": active_profile_name(),
            # Additive, so an older caller that ignores these keeps working unchanged.
            "quality": {side: report.as_dict() for side, report in result.quality.items()},
            "diagnostics": result.diagnostics,
            # Opt-in, for the test page: each side as it was read, so a reader can see
            # the turn that `diagnostics.rotated` only reports. The API never asks for it.
            **(
                {"orientedImages": {side: _preview(image) for side, image in result.oriented.items()}}
                if payload.get("returnOrientedImages")
                else {}
            ),
            # Opt-in, for the test page: the holder's photograph cut from the front.
            # Biometric data, never logged, never stored, only sent when asked for.
            **_portrait_payload(result, payload),
        }
    except ValueError as error:
        return 400, {"error": str(error)}
    except Exception:  # noqa: BLE001 - a failed read must not take the service down
        LOG.exception("extraction failed")
        return 500, {"error": "extraction failed"}
    finally:
        # Card images are personal data; they do not outlive the request.
        _forget(front, back)


def _forget(*paths: str | None) -> None:
    """Delete the temporary photo files."""
    for path in paths:
        if path:
            Path(path).unlink(missing_ok=True)


class DualStackServer(ThreadingHTTPServer):
    """Listens on IPv6 and, on a dual-stack host, IPv4 as well."""

    address_family = socket.AF_INET6
    daemon_threads = True

    def server_bind(self) -> None:
        if hasattr(socket, "IPPROTO_IPV6"):
            try:
                self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
            except OSError:
                # Some kernels refuse this. IPv6-only still works for IPv6-only hosts (Railway),
                # so warn and carry on rather than fail.
                LOG.warning("could not disable IPV6_V6ONLY; serving IPv6 only")
        super().server_bind()


def _build_server(host: str, port: int) -> ThreadingHTTPServer:
    """Prefer dual-stack; fall back to IPv4 where IPv6 is unavailable."""
    try:
        return DualStackServer((host, port), Handler)
    except OSError as error:
        LOG.warning("IPv6 bind on [%s]:%d failed (%s) — falling back to IPv4", host, port, error)
        return ThreadingHTTPServer(("0.0.0.0", port), Handler)  # noqa: S104 - internal network only


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(message)s")
    # `::` = every interface, both families. Override with OCR_HOST to pin it narrower.
    host = os.environ.get("OCR_HOST", "::")
    # OCR_PORT is the explicit setting.
    port = int(os.environ.get("OCR_PORT") or os.environ.get("PORT") or "8099")

    if pool.start():
        pass  # the workers have loaded their own models; this process does not need them
    elif os.environ.get("OCR_PRELOAD", "1") == "1":
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
