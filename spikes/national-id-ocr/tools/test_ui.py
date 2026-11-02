"""A local test page for the OCR sidecar: a National ID (front, then back) or any document."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

#: The EGY CASH branded reader, served at /. The plain page it grew from stays at /classic.
PAGE = Path(__file__).with_name("test_ui_egycash.html")
CLASSIC_PAGE = Path(__file__).with_name("test_ui.html")
#: Optional 3D model for the branded page's hero; without it the page shows its built-in van.
VAN_MODEL = Path(__file__).with_name("van.glb")
#: A still of the dressed van, shown the moment the page opens while the 3D scene starts.
VAN_POSTER = Path(__file__).with_name("van-poster.png")
#: The live capture guide both pages load for their camera view.
CAPTURE_GUIDE = Path(__file__).with_name("capture_guide.js")
#: The Readers page (all three readers side by side) and its theme files.
READERS_PAGE = Path(__file__).with_name("readers.html")
UI_DIR = Path(__file__).with_name("ui")
UI_TYPES = {".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml",
            ".png": "image/png", ".webp": "image/webp"}
SIDECAR = os.environ.get("OCR_SIDECAR", "http://127.0.0.1:8099").rstrip("/")
PORT = int(os.environ.get("TEST_UI_PORT") or os.environ.get("PORT") or "8101")
MAX_BODY_BYTES = 32 * 1024 * 1024
#: How long a card may take. A card needs seconds; the limit is generous for a slow computer.
FORWARD_TIMEOUT_S = int(os.environ.get("OCR_FORWARD_TIMEOUT_S", "180"))
#: The service's access code, when it has one (see docker-compose.lan.yml): sent with every call.
ACCESS = {"X-Access-Code": os.environ["OCR_ACCESS_CODE"]} if os.environ.get("OCR_ACCESS_CODE") else {}


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
            headers={**({"Content-Type": "application/json"} if body is not None else {}), **ACCESS},
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
                "Is it running? Start it with start.ps1 (Windows) or ./start.sh.",
            )

    def _stream(self, path: str) -> None:
        """Forward server-sent events as they come, not once the stream ends."""
        try:
            upstream = urllib.request.urlopen(  # noqa: S310 - local sidecar
                urllib.request.Request(SIDECAR + path, headers=ACCESS), timeout=FORWARD_TIMEOUT_S
            )
        except urllib.error.HTTPError as error:
            self._send(error.code, error.read(), "application/json")
            return
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            self._error(502, f"The OCR service at {SIDECAR} did not answer ({error}).")
            return
        with upstream:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                for line in upstream:
                    self.wfile.write(line)
                    if line in (b"\n", b"\r\n"):
                        self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
        self.close_connection = True

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        route = self.path.split("?")[0].rstrip("/") or "/"
        if route == "/readers":
            self._send(200, READERS_PAGE.read_bytes(), "text/html; charset=utf-8")
            return
        if route.startswith("/ui/"):
            target = (UI_DIR / route[len("/ui/"):]).resolve()
            if UI_DIR.resolve() in target.parents and target.is_file() and target.suffix in UI_TYPES:
                self._send(200, target.read_bytes(), UI_TYPES[target.suffix])
            else:
                self._error(404, "not found")
            return
        if route == "/types":
            self._forward("GET", "/types")
            return
        if route.startswith("/jobs/"):
            if route.endswith("/events"):
                self._stream(route)
            else:
                self._forward("GET", route)
            return
        if route == "/":
            self._send(200, PAGE.read_bytes(), "text/html; charset=utf-8")
        elif route == "/classic":
            self._send(200, CLASSIC_PAGE.read_bytes(), "text/html; charset=utf-8")
        elif route == "/van.glb" and VAN_MODEL.is_file():
            self._send(200, VAN_MODEL.read_bytes(), "model/gltf-binary")
        elif route == "/capture_guide.js" and CAPTURE_GUIDE.is_file():
            self._send(200, CAPTURE_GUIDE.read_bytes(), "text/javascript; charset=utf-8")
        elif route == "/van-poster.png" and VAN_POSTER.is_file():
            self._send(200, VAN_POSTER.read_bytes(), "image/png")
        elif route == "/api/health":
            self._forward("GET", "/health")
        else:
            self._error(404, "not found")

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        routes = {"/api/extract": "/extract", "/api/read": "/read", "/jobs": "/jobs"}
        target = routes.get(self.path.split("?")[0].rstrip("/"))
        if target is None:
            self._error(404, "not found")
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY_BYTES:
            self._error(413, "the photos are too large; the page downsizes them, so retry there")
            return
        self._forward("POST", target, self.rfile.read(length))

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002 - stdlib signature
        # Method, path and status only, nothing about a card's content is ever logged here.
        sys.stderr.write(f"{self.address_string()} {format % args}\n")


def _lan_address() -> str | None:
    """This computer's address on the local network (UDP connect sends nothing; it picks a route)."""
    import socket

    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("192.168.0.1", 9))
        return probe.getsockname()[0]
    except OSError:
        return None
    finally:
        probe.close()


#: A phone only lets a page use its camera live (and so show the capture guide) over https. With
#: --lan the page is also served over https on this port, with a certificate made for this PC.
HTTPS_PORT = int(os.environ.get("TEST_UI_HTTPS_PORT", "8443"))
CERT_DIR = Path(__file__).resolve().parent.parent / "build" / "cert"


def _certificate(address: str | None) -> tuple[Path, Path] | None:
    """A self-signed certificate for this PC, made once with openssl. None if openssl is missing."""
    import shutil
    import subprocess

    cert, key = CERT_DIR / "test-ui.pem", CERT_DIR / "test-ui-key.pem"
    if cert.is_file() and key.is_file():
        return cert, key
    openssl = shutil.which("openssl") or next(
        # Git for Windows carries one, though not on the PATH of a plain PowerShell.
        (str(path) for path in (Path(r"C:\Program Files\Git\usr\bin\openssl.exe"),
                                Path(r"C:\Program Files\Git\mingw64\bin\openssl.exe")) if path.is_file()),
        None,
    )
    if openssl is None:
        return None
    CERT_DIR.mkdir(parents=True, exist_ok=True)
    names = "DNS:localhost,IP:127.0.0.1" + (f",IP:{address}" if address else "")
    try:
        subprocess.run(
            [openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "825",
             "-subj", "/CN=nid-ocr-test-page", "-addext", f"subjectAltName={names}",
             "-keyout", str(key), "-out", str(cert)],
            check=True, capture_output=True, timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return cert, key


def _serve_https(address: str | None) -> None:
    import ssl
    import threading

    found = _certificate(address)
    if found is None:
        print("https for phones: openssl not found, so the phone camera opens without the live "
              "frame guide (photos still work)", flush=True)
        return
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(*map(str, found))

    class SecureServer(ThreadingHTTPServer):
        def get_request(self):
            # The TLS handshake is made on the connection's own thread, when it first reads, not
            # here: a phone opens connections it never finishes (Safari does, on a certificate
            # warning), and a handshake done in this loop left every other connection waiting.
            connection, address = self.socket.accept()
            connection.settimeout(30)
            return context.wrap_socket(connection, server_side=True, do_handshake_on_connect=False), address

        def handle_error(self, request, client_address):  # noqa: ARG002 - a failed handshake is routine
            pass

    secure = SecureServer(("0.0.0.0", HTTPS_PORT), Handler)
    threading.Thread(target=secure.serve_forever, daemon=True).start()
    if address:
        print(f"phone with the live camera guide: https://{address}:{HTTPS_PORT}  "
              "(the phone warns once about the certificate; choose to continue)", flush=True)


def main() -> None:
    lan = "--lan" in sys.argv
    server = ThreadingHTTPServer(("0.0.0.0" if lan else "127.0.0.1", PORT), Handler)
    print(f"test page: http://127.0.0.1:{PORT}   (OCR service: {SIDECAR})", flush=True)
    if lan and _lan_address():
        print(f"from a phone on the same Wi-Fi: http://{_lan_address()}:{PORT}", flush=True)
    if lan:
        _serve_https(_lan_address())
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
