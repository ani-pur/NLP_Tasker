"""Logging: one clean, colored line per request, plus one-line events.

    30 Sep 26  06:03:05 PM  anirudh                    201 POST  /tasks                            412ms  gemini 0.38s · task 918 added
    30 Sep 26  06:03:09 PM  129.110.242.94         [!] 200 POST  /login                      auth   88ms  login FAILED user='admin'
    30 Sep 26  06:05:16 PM  worker 8               [!] warmup    openai slow 5.00s (3/3)

- every line starts the same way: date + time, then who (the logged-in user,
  the visitor's IP, or the numbered, color-coded worker for background work);
- a red [!] on anything worth a look: 4xx/5xx, auth POSTs, failed outcomes,
  warnings and errors;
- status color-coded (2xx green / 3xx cyan / 4xx yellow / 5xx red);
- a trailing NOTE (`applog.note`) for what the URL and status can't say: who a
  login attempt was for, which task id changed, which LLM vendor answered;
- `applog.event` for things that happen outside a request (warmup pings,
  vendor swaps, emails) or that deserve their own line (DB errors);
- pure noise (static files, PWA icons, the service worker, favicon) is dropped.

Never pass task text, passwords or tokens to note()/event(). Request bodies are
never logged, and `token` query params are masked.

Wire it up with `applog.init_app(app)` after the app is created. Set NO_COLOR
in the environment to get plain text (e.g. when piping logs to a file).
"""
import logging
import os
import re
import sys
import time

from flask import g, has_request_context, request, session

log = logging.getLogger("tasker")

# ANSI colors, honoring the NO_COLOR convention (https://no-color.org/). On by
# default because these logs are meant to be read in a terminal / `docker logs`.
_COLOR = os.environ.get("NO_COLOR") is None

ACTOR_W = 22    # pad the actor column so everything after it lines up
AREA_W = 10     # event area sits where "200 POST " sits on a request line
PATH_W = 26

_SECRET_ARGS = {"token"}
_AUTH_PATHS = ("/login", "/logout", "/signup", "/forgot-password", "/reset-password")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")


def _c(code, text):
    return f"\033[{code}m{text}\033[0m" if _COLOR and code else str(text)


def _clean(text, limit=160):
    """One printable line: scanners love newlines and escape codes in paths."""
    text = _CONTROL.sub(" ", str(text)).strip()
    return text if len(text) <= limit else text[:limit - 1] + "…"


def _stamp():
    return _c("2", time.strftime("%d %b %y  %I:%M:%S %p"))   # e.g. 30 Sep 26  04:09:38 PM


def client_ip():
    # Cloudflare passes the real address; remote_addr is the proxy
    return request.headers.get("CF-Connecting-IP") or request.remote_addr or "?"


_worker = None      # (label, color) once this process has been given a worker number, see set_worker()
_WORKER_COLORS = ("36", "35", "34", "96", "95", "94")   # no green/yellow/red: those mean something in the message text


def set_worker(number):
    """Give this process's background lines (warmup pings, vendor swaps) a small worker number
    and its own color, so interleaved lines from several gunicorn workers can be told apart."""
    global _worker
    _worker = (f"worker {number} (pid {os.getpid()})", _WORKER_COLORS[(number - 1) % len(_WORKER_COLORS)])


def _actor(label=None):
    """Padded, colored actor. Padding goes on the plain text *before* the color
    codes, otherwise the ANSI escapes count toward the width and misalign rows."""
    color = "2"
    if label is None:
        if has_request_context():
            label = session.get("username")
            color = None if label else "2"
            label = label or client_ip()
        elif _worker:
            label, color = _worker
        else:
            label = f"worker {os.getpid()}"
    return _c(color, f"{_clean(label, 40):<{ACTOR_W}}")


def _marker(important):
    return _c("1;31", "[!]") if important else "   "


def visitor():
    """Short 'Chrome on Linux · from google.com' for anonymous page views."""
    ua = request.headers.get("User-Agent", "")
    low = ua.lower()
    if not ua:
        browser = "no user-agent"
    elif any(b in low for b in ("bot", "spider", "crawl", "curl", "python", "wget", "go-http")):
        browser = _clean(ua, 40)
    else:
        browser = next((name for key, name in (("edg/", "Edge"), ("firefox", "Firefox"), ("chrome", "Chrome"),
                                               ("safari", "Safari")) if key in low), "browser")
        system = next((name for key, name in (("iphone", "iPhone"), ("ipad", "iPad"), ("android", "Android"),
                                              ("windows", "Windows"), ("mac os", "Mac"), ("linux", "Linux"))
                       if key in low), None)
        if system:
            browser += f" on {system}"
    ref = request.headers.get("Referer")
    if ref:
        browser += " · from " + _clean(re.sub(r"^https?://", "", ref).rstrip("/"), 50)
    return browser


def note(text, ok=None):
    """Attach a short outcome note to THIS request's log line.

    `ok=True` renders the note green, `ok=False` red (and marks the line),
    `None` dim. Several notes on one request are joined with ' · '.
    Outside a request it falls back to its own event line.
    """
    if not has_request_context():
        event("app", text, "warn" if ok is False else "info")
        return
    if not hasattr(g, "_log_notes"):
        g._log_notes = []
    g._log_notes.append((_clean(text), ok))


def event(area, text, level="info", color=None):
    """Log one line that isn't a request: `level` is info, warn or error.
    An info line can be tinted with `color` ("green" or "yellow") without being flagged."""
    text = _clean(text, 300)
    if level == "error":
        text = _c("1;31", text)
    elif level == "warn":
        text = _c("33", text)
    elif color:
        text = _c({"green": "32", "yellow": "33"}.get(color), text)
    line = f"{_stamp()}  {_actor()}  {_marker(level != 'info')} {_c('1', f'{area:<{AREA_W}}')} {text}"
    log.log({"error": logging.ERROR, "warn": logging.WARNING}.get(level, logging.INFO), line)


class LineFormatter(logging.Formatter):
    """Puts other loggers (gunicorn, Flask, the LLM SDKs) in the same columns."""

    def __init__(self, actor=None, area=None):
        super().__init__()
        self.actor, self.area = actor, area

    def format(self, record):
        area = self.area or record.name.split(".")[0].replace("google_genai", "gemini")
        text = _clean(record.getMessage(), 300)
        important = record.levelno >= logging.WARNING
        if record.levelno >= logging.ERROR:
            text = _c("1;31", text)
        elif important:
            text = _c("33", text)
        line = f"{_stamp()}  {_actor(self.actor)}  {_marker(important)} {_c('1', f'{area[:AREA_W]:<{AREA_W}}')} {text}"
        if record.exc_info:
            # a real crash: keep the traceback, it's the one thing worth many lines
            line += "\n" + self.formatException(record.exc_info)
        return line


def _is_noise(path):
    return (
        path.startswith("/static/")
        or path.startswith("/pwa/")
        or path in ("/sw.js", "/favicon.ico")
    )


def _status_color(status):
    if status >= 500:
        return "1;31"   # bold red
    if status >= 400:
        return "33"     # yellow
    if status >= 300:
        return "36"     # cyan
    return "32"         # green


def _path():
    path = request.path
    if request.args:
        path += "?" + "&".join(f"{k}={'***' if k in _SECRET_ARGS else v}" for k, v in request.args.items())
    return _clean(path, 90)


def _emit(status):
    """Build and log one line. Guarded so we never log a request twice."""
    if getattr(g, "_logged", False) or _is_noise(request.path):
        return
    g._logged = True

    dur = f"{(time.perf_counter() - g._t0) * 1000:.0f}ms" if hasattr(g, "_t0") else ""
    tag = "auth" if request.path.startswith(_AUTH_PATHS) else ""
    notes = getattr(g, "_log_notes", [])
    important = status >= 400 or (tag and request.method == "POST") or any(ok is False for _, ok in notes)

    status_s = _c(_status_color(status), f"{status:>3}")
    method = _c("2", f"{request.method:<6}")
    tag_s = _c("1;31", f"{tag:<4}") if tag else "    "
    note_s = _c("2", " · ").join(
        _c("32" if ok else ("1;31" if ok is False else "2"), text) for text, ok in notes
    )

    line = (f"{_stamp()}  {_actor()}  {_marker(important)} {status_s} {method} "
            f"{_path():<{PATH_W}} {tag_s} {_c('2', f'{dur:>6}')}  {note_s}")
    log.info(line.rstrip())


def _setup():
    # Our own handler so lines land on stderr as-is (gunicorn/docker capture it),
    # and don't inherit the root formatter or double-print via propagation.
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter("%(message)s"))
    log.handlers = [handler]
    log.setLevel(logging.INFO)
    log.propagate = False

    # Everything else (Flask tracebacks, SDK warnings) goes through the same
    # columns. WARNING and up only: httpx and the LLM SDKs chat at INFO.
    other = logging.StreamHandler(sys.stderr)
    other.setFormatter(LineFormatter())
    root = logging.getLogger()
    root.handlers = [other]
    root.setLevel(logging.WARNING)

    # Hush werkzeug's own per-request access line (dev server); keep warnings+.
    logging.getLogger("werkzeug").setLevel(logging.WARNING)


_setup()


def init_app(app):
    @app.before_request
    def _start_timer():
        g._t0 = time.perf_counter()

    @app.after_request
    def _log_response(response):
        _emit(response.status_code)
        return response

    @app.teardown_request
    def _log_unhandled(exc):
        # after_request is skipped when a view raises; catch that here as a 500.
        if exc is not None:
            _emit(500)
