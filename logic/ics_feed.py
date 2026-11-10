"""Canvas calendar feed: URL checks, fetching, parsing, and turning events into assignments.

No database and no LLM in here, so it can be tested on its own. logic/ics_sync.py does the rest.

A Canvas feed is an iCal file where every event we care about is an assignment:

    BEGIN:VEVENT
    UID:event-assignment-417537
    DTSTART:20261027T203000Z                      (or DTSTART;VALUE=DATE:20261026 for "due that day")
    SUMMARY:In-class pop quiz 2  [CS-3341.004-SE-3341.004-STAT-3341.004 - F26]
    URL;VALUE=URI:https://elearning.utdallas.edu/calendar?include_contexts=cour
     se_20125&month=10&year=2026#assignment_417537
    END:VEVENT
"""
import hashlib
import re
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import httpx

# --- where feeds may come from ----------------------------------------------------------------------
# UT Dallas's Canvas only, for now. The server fetches whatever URL a user saves, from inside the home
# network, so only known Canvas hosts get through, and the stored "Open in Canvas" links are held to
# them too. Every Canvas serves the same feed format, so adding a school is one line here; opening it
# to any host would need a check that the address isn't a private/internal one (SSRF) instead.
# Users can ask for their school from the Canvas panel (REQUEST_SCHOOL in main.py).
ALLOWED_HOSTS = {"elearning.utdallas.edu"}
_FEED_PATH = re.compile(r"/feeds/calendars/user_[A-Za-z0-9]{20,100}\.ics")

FETCH_TIMEOUT = httpx.Timeout(20.0, connect=10.0)
MAX_FEED_BYTES = 5 * 1024 * 1024
USER_AGENT = "TaskerCalendarSync/1.0"

# all-day assignments ("due that day") are due at 11:59 PM local time, like Canvas shows them
ALL_DAY_DUE = time(23, 59)

# imported task names: the edit UI allows 120 characters
MAX_TASK_NAME = 120


class FeedURLError(ValueError):
    """The URL a user typed isn't a Canvas calendar feed we accept. The message is safe to show them."""


class FeedGone(Exception):
    """The feed answered, but not with a calendar (4xx, a login page...). Several in a row mean the
    feed was removed or its link reset, and the feed gets switched off."""


class FeedTemporary(Exception):
    """Network trouble, a timeout, a 5xx, a cut-off body: try again next time, nothing changes."""


def host_allowed(host: str) -> bool:
    return (host or "").lower() in ALLOWED_HOSTS


def validate_feed_url(raw: str) -> tuple[str, str]:
    """Returns (clean url, host) or raises FeedURLError. Accepts webcal:// links too (calendar apps
    hand those out) and rebuilds the URL from its checked parts, so nothing unexpected rides along."""
    raw = (raw or "").strip()
    if not raw or len(raw) > 500:
        raise FeedURLError("Paste your Canvas calendar feed link.")
    if raw.lower().startswith("webcal://"):
        raw = "https://" + raw[len("webcal://"):]
    try:
        parts = urlsplit(raw)
        port = parts.port
    except ValueError:
        raise FeedURLError("That doesn't look like a link.")
    if parts.scheme.lower() != "https":
        raise FeedURLError("The link has to start with https://")
    host = (parts.hostname or "").lower()
    if parts.username or parts.password or port not in (None, 443) or not host_allowed(host):
        raise FeedURLError("Only UT Dallas Canvas links for now.")
    if not _FEED_PATH.fullmatch(parts.path):
        raise FeedURLError("That's not a calendar feed link. In Canvas: Calendar → Calendar Feed, then copy the link.")
    return f"https://{host}{parts.path}", host


def full_history(url: str) -> str:
    """The same feed with the whole term in it. Canvas's plain feed has every upcoming assignment but
    only a couple of weeks of past ones; all_events=1 goes back to the start, which is how a first sync
    finds every course (including ones with nothing left due)."""
    return url + "?all_events=1"


def fetch(url: str) -> str:
    """GET the feed. Returns the body text, or raises FeedGone / FeedTemporary. Redirects are not
    followed: Canvas serves feeds directly, and a redirect could leave the allowed hosts."""
    try:
        with httpx.Client(timeout=FETCH_TIMEOUT, follow_redirects=False,
                          headers={"User-Agent": USER_AGENT}) as client:
            with client.stream("GET", url) as response:
                status = response.status_code
                if status >= 500 or status in (408, 429):
                    raise FeedTemporary(f"HTTP {status}")
                if status != 200:
                    raise FeedGone(f"HTTP {status}")
                chunks, size = [], 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > MAX_FEED_BYTES:
                        raise FeedTemporary(f"feed bigger than {MAX_FEED_BYTES // (1024 * 1024)} MB")
                    chunks.append(chunk)
    except httpx.TimeoutException:
        raise FeedTemporary("timed out")
    except httpx.HTTPError as e:
        raise FeedTemporary(f"connection failed ({type(e).__name__})")
    text = b"".join(chunks).decode("utf-8", errors="replace")
    if not text.lstrip("﻿ \t\r\n").startswith("BEGIN:VCALENDAR"):
        raise FeedGone("not a calendar")
    return text


def body_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# --- iCal parsing -------------------------------------------------------------------------------------

def _unfold(text: str) -> list[str]:
    """iCal wraps long lines: a line starting with a space or tab continues the one before."""
    lines: list[str] = []
    for line in re.split(r"\r\n|\n|\r", text):
        if line[:1] in (" ", "\t") and lines:
            lines[-1] += line[1:]
        else:
            lines.append(line)
    return lines


def _split_property(line: str):
    """'DTSTART;VALUE=DATE;VALUE=DATE:20261026' -> ('DTSTART', {'VALUE': 'DATE'}, '20261026').
    The value starts at the first colon that isn't inside a quoted parameter."""
    in_quotes = False
    for i, ch in enumerate(line):
        if ch == '"':
            in_quotes = not in_quotes
        elif ch == ":" and not in_quotes:
            head, value = line[:i], line[i + 1:]
            break
    else:
        return None
    name, *raw_params = head.split(";")
    params = {}
    for p in raw_params:
        key, _, val = p.partition("=")
        params.setdefault(key.strip().upper(), val.strip().strip('"'))   # repeated params (VALUE=DATE twice): first wins
    return name.strip().upper(), params, value


def _unescape(value: str) -> str:
    return re.sub(r"\\([\\;,nN])", lambda m: "\n" if m.group(1) in "nN" else m.group(1), value)


def parse_events(text: str) -> list[dict]:
    """The VEVENTs as {NAME: (params, value)}, first occurrence of each property only.
    Raises FeedTemporary if the calendar is cut off: acting on half a feed would delete tasks."""
    lines = _unfold(text)
    if not any(l.strip() == "END:VCALENDAR" for l in lines):
        raise FeedTemporary("calendar is cut off (no END:VCALENDAR)")
    events, current = [], None
    for line in lines:
        prop = _split_property(line)
        if prop is None:
            continue
        name, params, value = prop
        if name == "BEGIN" and value.strip().upper() == "VEVENT":
            current = {}
        elif name == "END" and value.strip().upper() == "VEVENT":
            if current is not None:
                events.append(current)
            current = None
        elif current is not None and name not in current:
            current[name] = (params, value)
    return events


# --- events -> assignments ------------------------------------------------------------------------------

@dataclass
class Assignment:
    uid: str
    title: str                 # cleaned, without the [course] tag
    course_key: str | None     # e.g. "CE 4390/CS 4390": cache key for the course name
    course_code: str | None    # what the task shows until the name resolves, e.g. "CE 4390"
    course_codes: list         # every code in the tag, e.g. ["CE 4390", "CS 4390"]
    due_utc: datetime          # naive UTC, same convention as tasks.task_datetime
    due_date: date             # in the user's timezone
    due_time: time             # in the user's timezone
    canvas_url: str | None


_TAG = re.compile(r"^(.*?)\s*\[([^\[\]]*)\]\s*$", re.DOTALL)
_CODE = re.compile(r"\b([A-Z]{2,5})[ -]?(\d{4})(?:\.[0-9A-Z]+)?\b")
_TERM_SUFFIX = re.compile(r"\s*-\s*[A-Z]{1,3}\s?\d{2,4}\s*$")     # " - F26"


def clean_text(text: str, limit: int) -> str:
    """Instructor-written text, made safe to drop into any template: no markup characters, no control
    characters, quotes swapped for typographic ones, whitespace collapsed."""
    text = re.sub(r"[\x00-\x1f\x7f]+", " ", text or "")
    text = text.replace("<", "").replace(">", "").replace("`", "").replace("\\", "")
    text = text.replace("'", "’").replace('"', "”")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit].rstrip()


def parse_course_tag(tag: str | None):
    """'CE-4390.502-CS-4390.502 - F26' -> ('CE 4390/CS 4390', 'CE 4390', ['CE 4390', 'CS 4390']).
    Sections and the term are dropped; cross-listed codes become one course. A tag with no
    recognisable code is kept as-is (minus the term), so the course still gets a name and a color."""
    if not tag or not tag.strip():
        return None, None, []
    codes = []
    for dept, number in _CODE.findall(tag.upper()):
        code = f"{dept} {number}"
        if code not in codes:
            codes.append(code)
    if codes:
        return "/".join(sorted(codes))[:100], codes[0], codes
    plain = clean_text(_TERM_SUFFIX.sub("", tag), 40)
    return (plain, plain, []) if plain else (None, None, [])


def to_local(due_utc: datetime, tz_name: str):
    """Naive UTC -> (date, time) in the user's timezone, the way tasks store due_date / task_time."""
    local = due_utc.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(tz_name))
    return local.date(), local.time().replace(second=0, microsecond=0)


def _parse_due(params: dict, value: str, user_tz: ZoneInfo):
    """DTSTART -> (naive UTC datetime, local date, local time), or None if it can't be read."""
    value = value.strip()
    try:
        if params.get("VALUE", "").upper() == "DATE" or re.fullmatch(r"\d{8}", value):
            local = datetime.combine(datetime.strptime(value[:8], "%Y%m%d").date(), ALL_DAY_DUE, tzinfo=user_tz)
        else:
            naive = datetime.strptime(value[:15], "%Y%m%dT%H%M%S")
            if value.endswith("Z"):
                local = naive.replace(tzinfo=timezone.utc).astimezone(user_tz)
            else:
                try:
                    tz = ZoneInfo(params["TZID"]) if params.get("TZID") else user_tz
                except Exception:
                    tz = user_tz
                local = naive.replace(tzinfo=tz).astimezone(user_tz)
    except ValueError:
        return None
    utc = local.astimezone(timezone.utc).replace(tzinfo=None)
    return utc, local.date(), local.time().replace(second=0, microsecond=0)


def _canvas_link(host: str, url_value: str | None) -> str | None:
    """The assignment's own page, built from the ids in the feed's calendar link. Only digits from the
    feed make it into the link, so it always points at the allowed host."""
    if not url_value or not host_allowed(host):
        return None
    course = re.search(r"course_(\d{1,12})\b", url_value)
    assignment = re.search(r"#assignment_(\d{1,12})\b", url_value)
    if not course or not assignment:
        return None
    return f"https://{host}/courses/{course.group(1)}/assignments/{assignment.group(1)}"


def to_assignments(events: list[dict], host: str, tz_name: str) -> list[Assignment]:
    """The assignments in a parsed feed; anything else (calendar events, unreadable dates) is skipped."""
    user_tz = ZoneInfo(tz_name)
    out, seen = [], set()
    for ev in events:
        uid = clean_text(_unescape(ev.get("UID", ({}, ""))[1]), 200)
        if not uid.startswith("event-assignment-") or uid in seen:
            continue
        if "DTSTART" not in ev:
            continue
        due = _parse_due(*ev["DTSTART"], user_tz)
        if due is None:
            continue
        summary = _unescape(ev.get("SUMMARY", ({}, ""))[1])
        m = _TAG.match(summary)
        title, tag = (m.group(1), m.group(2)) if m else (summary, None)
        title = clean_text(title, 300) or "Untitled assignment"
        course_key, course_code, codes = parse_course_tag(tag)
        url_value = _unescape(ev["URL"][1]) if "URL" in ev else None
        seen.add(uid)
        out.append(Assignment(uid=uid, title=title, course_key=course_key, course_code=course_code,
                              course_codes=codes, due_utc=due[0], due_date=due[1], due_time=due[2],
                              canvas_url=_canvas_link(host, url_value)))
    return out


def task_name(title: str, course_label: str | None) -> str:
    """'Homework 2' + 'Networks' -> 'Homework 2 - Networks', cut to fit without losing the course."""
    if not course_label:
        return title[:MAX_TASK_NAME].rstrip()
    suffix = f" - {course_label}"
    room = MAX_TASK_NAME - len(suffix)
    if len(title) > room:
        title = title[:max(room - 1, 1)].rstrip() + "…"
    return title + suffix
