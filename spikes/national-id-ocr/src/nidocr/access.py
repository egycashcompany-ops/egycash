"""An access code in front of the whole service, for when it is reached over a shared network.

Set OCR_ACCESS_CODE and every route but the health check needs it: a browser enters it once on
/unlock and keeps a cookie (a token derived from the code, never the code itself); a server calling
the API sends it as the X-Access-Code header. Unset, the service is open as before (it then listens
on this computer only). This keeps others on the same Wi-Fi out; it does not encrypt the traffic.
"""

from __future__ import annotations

import hashlib
import hmac
import html
import os
import threading
import time
from http.cookies import SimpleCookie
from urllib.parse import parse_qs, urlsplit

COOKIE = "ocr_access"
#: How long a browser stays unlocked.
COOKIE_DAYS = 30
#: Wrong codes from one address before it waits, and how long it waits (seconds).
MAX_ATTEMPTS = 5
LOCKOUT = 300
#: Routes that answer without the code: the container's health check and the unlock page itself.
OPEN_ROUTES = ("/health", "/unlock")

_attempts: dict[str, list[float]] = {}
_lock = threading.Lock()


def configured() -> str:
    return os.environ.get("OCR_ACCESS_CODE", "").strip()


def reset_attempts() -> None:
    with _lock:
        _attempts.clear()


def _token(code: str) -> str:
    return hmac.new(code.encode("utf-8"), b"egycash-readers-access-v1", hashlib.sha256).hexdigest()


def _route(path: str) -> str:
    return path.split("?")[0].rstrip("/") or "/"


def _has_access(handler, code: str) -> bool:
    sent = handler.headers.get("X-Access-Code", "")
    if sent and hmac.compare_digest(sent.encode("utf-8"), code.encode("utf-8")):
        return True
    cookies = SimpleCookie()
    try:
        cookies.load(handler.headers.get("Cookie", ""))
    except Exception:  # noqa: BLE001 - a malformed cookie is no cookie
        return False
    morsel = cookies.get(COOKIE)
    return morsel is not None and hmac.compare_digest(morsel.value.encode("utf-8"), _token(code).encode("utf-8"))


def _safe_next(target: str) -> str:
    """Only a path on this site: never another host, a scheme, or a protocol-relative URL."""
    parts = urlsplit(target or "")
    if parts.scheme or parts.netloc or not target.startswith("/") or target.startswith("//"):
        return "/readers"
    return target


def _locked_out(address: str) -> bool:
    now = time.monotonic()
    with _lock:
        recent = [moment for moment in _attempts.get(address, []) if now - moment < LOCKOUT]
        _attempts[address] = recent
        return len(recent) >= MAX_ATTEMPTS


def _note_failure(address: str) -> None:
    with _lock:
        _attempts.setdefault(address, []).append(time.monotonic())


def guard(handler) -> bool:
    """True when the request may go on. Otherwise the answer has been sent: the unlock page, a
    redirect to it, or a refusal."""
    code = configured()
    route = _route(handler.path)
    if not code:
        return True
    if route == "/unlock":
        if handler.command == "POST":
            _unlock(handler, code)
        else:
            query = parse_qs(urlsplit(handler.path).query)
            _page(handler, 200, _safe_next((query.get("next") or ["/readers"])[0]))
        return False
    if route in OPEN_ROUTES or _has_access(handler, code):
        return True
    if handler.command == "GET" and route in ("/", "/readers", "/readers.html"):
        handler.send_response(303)
        handler.send_header("Location", "/unlock?next=" + route)
        handler.send_header("Content-Length", "0")
        handler.end_headers()
        return False
    handler._send(401, {"error": "an access code is required: open /unlock in a browser, or send X-Access-Code"})
    return False


def _unlock(handler, code: str) -> None:
    address = handler.client_address[0]
    length = int(handler.headers.get("Content-Length") or 0)
    form = parse_qs(handler.rfile.read(min(length, 4096)).decode("utf-8", "replace")) if length > 0 else {}
    target = _safe_next((form.get("next") or ["/readers"])[0])
    if _locked_out(address):
        _page(handler, 429, target, "Too many wrong codes. Wait five minutes. · محاولات خاطئة كثيرة. انتظر خمس دقائق.")
        return
    given = (form.get("code") or [""])[0].strip()
    if not given or not hmac.compare_digest(given.encode("utf-8"), code.encode("utf-8")):
        _note_failure(address)
        _page(handler, 401, target, "That code is not right. · الرمز غير صحيح.")
        return
    handler.send_response(303)
    handler.send_header("Location", target)
    handler.send_header(
        "Set-Cookie",
        f"{COOKIE}={_token(code)}; Path=/; Max-Age={COOKIE_DAYS * 86400}; HttpOnly; SameSite=Strict",
    )
    handler.send_header("Content-Length", "0")
    handler.end_headers()


def _page(handler, status: int, target: str, message: str = "") -> None:
    note = f'<p class="note" role="alert">{html.escape(message)}</p>' if message else ""
    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Access code · EGY CASH Readers</title>
<style>
:root{{color-scheme:dark;--bg:#0b0b12;--card:#16161f;--line:#2a2a38;--text:#f2f2f7;--muted:#a9a9c0;--accent:#5b8cff;--bad:#ff8a7a}}
body{{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,"Segoe UI",Tahoma,sans-serif;padding:16px;box-sizing:border-box}}
form{{width:100%;max-width:360px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px;display:grid;gap:12px}}
h1{{margin:0;font-size:19px}} p{{margin:0;color:var(--muted);font-size:13.5px}} .note{{color:var(--bad)}}
input{{font:inherit;padding:12px;border-radius:10px;border:1px solid var(--line);background:#0f0f17;color:var(--text)}}
button{{font:inherit;font-weight:700;padding:12px;border:0;border-radius:10px;background:var(--accent);color:#fff;cursor:pointer}}
</style></head><body>
<form method="post" action="/unlock">
<h1>Enter the access code</h1>
<p>أدخل رمز الدخول. Asked once on this device.</p>
{note}
<input type="hidden" name="next" value="{html.escape(target, quote=True)}">
<input name="code" type="password" autocomplete="current-password" aria-label="Access code" required autofocus>
<button type="submit">Open · فتح</button>
</form></body></html>"""
    body = page.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)
