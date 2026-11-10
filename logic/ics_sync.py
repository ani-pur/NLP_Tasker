"""Canvas feed sync worker: keeps each user's imported Canvas assignments in step with their feed.

Runs as its own process (its own compose service, same image):

    python -m logic.ics_sync

NOT inside gunicorn, where each of the 4 workers would run its own copy. A Postgres advisory lock
makes sure only one sync worker is ever active, even if two get started by mistake.

It picks up feeds whose next_sync_at has come, SYNC_THREADS at a time. Saving a link sets next_sync_at to
now and sends NOTIFY ics_sync, which wakes the worker at once (POLL_SECONDS is only the fallback), and
first imports go ahead of routine re-syncs, so a new user isn't stuck behind everyone else. For each feed:

    fetch -> not a calendar? strike (DEAD_AFTER in a row: feed switched off, its tasks stay; a link
             that has never synced is switched off at the first one, so the user hears right away)
          -> network/5xx trouble? try again in RETRY_TEMPORARY
    same body as last time and nothing pending? done
    look up any course names not cached yet (LLM + web search, see course_names.py)
    reconcile against ics_imports, in one transaction:
        new assignment (not yet due)       -> task + reminder + ics_imports row
        Canvas moved the due date          -> move the task, shift its reminders
        Canvas renamed it                  -> rename the task (Canvas wins when Canvas changes)
        course name found since import     -> rename the task, unless the user already renamed it
        gone from the feed                 -> deleted after DELETE_AFTER_MISSES syncs in a row
                                              (never past-due tasks; never more than half at once)
        user deleted the task              -> left alone for good
"""
import os
import random
import select
import time
from concurrent.futures import ThreadPoolExecutor
from collections import namedtuple
from datetime import timedelta

import psycopg2

from logic import applog, colors, course_names, hasher, ics_feed
from logic import tasks_db
from logic.tasks_db import get_db_connection as _db, utc_now as _now_utc

POLL_SECONDS = 30              # fallback check; saving a link wakes the worker at once (NOTIFY ics_sync)
# feeds synced at the same time: mostly waiting on Canvas, so threads (not processes) are plenty
SYNC_THREADS = max(1, int(os.environ.get("ICS_SYNC_THREADS", "6")))
HEARTBEAT_EVERY = 15           # seconds between ics_sync_heartbeat stamps
SYNC_EVERY = timedelta(minutes=10)    # catch Canvas changes early; an unchanged feed is a cheap no-op (hash)
RETRY_TEMPORARY = timedelta(minutes=5)
DEAD_AFTER = 6                 # responses in a row that weren't a calendar: about an hour, so a Canvas
                               # maintenance page can't switch everyone's feed off
DELETE_AFTER_MISSES = 2        # syncs in a row an assignment was missing from the feed
NAME_RETRY_AFTER = "6 hours"   # between course-name lookups that found nothing
NAME_MAX_ATTEMPTS = 5          # then the course keeps showing its code
NAME_BATCH = 15                # courses per LLM call
RECENT_COURSE_DAYS = 120       # a course counts as this term's if it had anything due this recently (or still has):
                               # the full-history first sync can reach back into old terms
# Only one sync worker may run at a time. Postgres "advisory locks" are named by a number, so this
# readable name gets hashed into one (hashtext). Whoever holds it syncs; a second worker stands by.
LOCK_NAME = "tasker:ics_sync"



def _jitter(base: timedelta) -> timedelta:
    # spread feeds out so they don't all come due in the same round
    return base + timedelta(seconds=random.randint(0, 60))


# --- feed bookkeeping --------------------------------------------------------------------------------

def _finish(feed_id: int, url: str, *, ok: bool, digest: str | None = None, error: str | None = None,
            retry: timedelta = SYNC_EVERY, cur=None):
    """Record how a sync went and when to come back. If the user saved a different link while this
    sync was running, their link gets synced right away instead (the row's url no longer matches)."""
    sql = ("UPDATE ics_feeds SET "
           "sync_stage = NULL, "
           "next_sync_at = CASE WHEN url = %(url)s THEN now() + %(retry)s ELSE next_sync_at END, "
           "last_error = CASE WHEN url = %(url)s THEN %(error)s ELSE last_error END "
           + (", last_hash = CASE WHEN url = %(url)s THEN %(digest)s ELSE last_hash END, "
              "last_success_at = now(), fail_count = 0 " if ok else "")
           + "WHERE id = %(id)s")
    params = {"url": url, "retry": _jitter(retry), "error": error, "digest": digest, "id": feed_id}
    if cur is not None:
        cur.execute(sql, params)
        return
    with _db() as conn, conn.cursor() as c:
        c.execute(sql, params)
        conn.commit()


def _strike(feed_id: int, url: str, username: str, reason: str):
    """The feed answered with something that isn't a calendar. DEAD_AFTER in a row: switch it off."""
    with _db() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE ics_feeds SET "
            "fail_count = fail_count + 1, last_error = %(reason)s, next_sync_at = now() + %(retry)s, "
            "sync_stage = NULL, "
            # a link that has never synced is simply wrong (mistyped, old): no point retrying it for an hour
            "disabled_at = CASE WHEN fail_count + 1 >= %(dead)s OR last_success_at IS NULL THEN now() END, "
            "disabled_reason = CASE WHEN fail_count + 1 >= %(dead)s OR last_success_at IS NULL THEN 'dead' END "
            "WHERE id = %(id)s AND url = %(url)s AND disabled_at IS NULL "
            "RETURNING fail_count, disabled_at IS NOT NULL",
            {"reason": reason[:200], "retry": _jitter(SYNC_EVERY), "dead": DEAD_AFTER, "id": feed_id, "url": url})
        row = cur.fetchone()
        conn.commit()
    if row and row[1]:
        applog.event("ics", f"feed {feed_id} ({username}) switched off: {reason}, {row[0]} times in a row", "warn")
    elif row:
        applog.event("ics", f"feed {feed_id} ({username}) is not serving a calendar ({reason}), strike {row[0]}/{DEAD_AFTER}", "warn")


def _has_pending(cur, feed_id: int) -> bool:
    """Work that has to happen even when the feed body hasn't changed: a missing assignment counting
    toward deletion, or a course name still waiting to be found."""
    now = _now_utc()
    cur.execute(
        "SELECT EXISTS (SELECT 1 FROM ics_imports i LEFT JOIN tasks t ON t.id = i.task_id WHERE i.feed_id = %s AND ("
        "(t.id IS NOT NULL AND t.task_datetime > %s AND (i.missing_count > 0 OR NOT i.name_resolved)) "
        "OR (t.id IS NULL AND i.canvas_due_at > %s AND i.missing_count > 0)))",
        (feed_id, now, now))
    return cur.fetchone()[0]


# --- course names --------------------------------------------------------------------------------------

def resolve_names(host: str, keys: set, on_lookup=None):
    """Look up the courses on this host that have no name yet (and are due another try). The LLM call
    happens outside any transaction; it can take a while. on_lookup() runs first if there's anything to look up."""
    if not keys:
        return
    with _db() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT course_key FROM course_names WHERE host = %s AND course_key = ANY(%s) AND ("
            "short_name IS NOT NULL OR failed_attempts >= %s "
            "OR last_attempt_at > now() - %s::interval)",
            (host, list(keys), NAME_MAX_ATTEMPTS, NAME_RETRY_AFTER))
        settled = {r[0] for r in cur.fetchall()}
        conn.commit()
    pending = sorted(keys - settled)
    if pending and on_lookup:
        on_lookup()
    for start in range(0, len(pending), NAME_BATCH):
        batch = pending[start:start + NAME_BATCH]
        started = time.time()
        try:
            found = course_names.lookup(host, batch)
            error = None
        except course_names.LookupFailed as e:
            found, error = {}, str(e)
        with _db() as conn, conn.cursor() as cur:
            for key in batch:
                if key in found:
                    official, short = found[key]
                    # first answer wins: two syncs can look up the same course at once (users from one
                    # school connecting together). Postgres takes their writes to this (host, course_key)
                    # row one at a time; the second finds a name already there and changes nothing, so
                    # every user's tasks and course list end up with the same name.
                    cur.execute(
                        "INSERT INTO course_names (host, course_key, official_name, short_name, resolved_at, last_attempt_at) "
                        "VALUES (%s, %s, %s, %s, now(), now()) ON CONFLICT (host, course_key) DO UPDATE SET "
                        "official_name = EXCLUDED.official_name, short_name = EXCLUDED.short_name, "
                        "resolved_at = now(), last_attempt_at = now() "
                        "WHERE course_names.short_name IS NULL",
                        (host, key, official, short))
                else:
                    cur.execute(
                        "INSERT INTO course_names (host, course_key, failed_attempts, last_attempt_at) "
                        "VALUES (%s, %s, 1, now()) ON CONFLICT (host, course_key) DO UPDATE SET "
                        "failed_attempts = course_names.failed_attempts + 1, last_attempt_at = now()",
                        (host, key))
            conn.commit()
        took = f"{time.time() - started:.1f}s"
        if error:
            applog.event("ics", f"course name lookup failed for {len(batch)} course(s) on {host} ({took}): {error}", "warn")
        else:
            names = ", ".join(f"{k} = {v[1]}" for k, v in found.items())
            missed = [k for k in batch if k not in found]
            applog.event("ics", f"course names on {host} ({took}): {names or 'none found'}"
                                + (f"; not found: {', '.join(missed)}" if missed else ""),
                         "warn" if missed else "info")


# --- reconcile -----------------------------------------------------------------------------------------

Imported = namedtuple("Imported", "id uid task_id canvas_due_at canvas_title canvas_url course_key "
                                  "synced_name name_resolved missing_count task_name task_datetime")


def current_courses(assignments: list) -> set:
    """Course keys of this term: with an assignment due within RECENT_COURSE_DAYS, or still to come."""
    since = _now_utc() - timedelta(days=RECENT_COURSE_DAYS)
    return {a.course_key for a in assignments if a.course_key and a.due_utc > since}


def course_label(short_names: dict, course_key: str | None, course_code: str | None):
    """(what a task name shows for its course, whether that's the course's real name): the looked-up
    short name, else the course code until the name turns up."""
    if not course_key:
        return None, True
    if course_key in short_names:
        return short_names[course_key], True
    return course_code or course_key.split("/")[0], False


def _short_names(cur, host: str, keys) -> dict:
    cur.execute("SELECT course_key, short_name FROM course_names "
                "WHERE host = %s AND course_key = ANY(%s) AND short_name IS NOT NULL", (host, sorted(keys)))
    return dict(cur.fetchall())


def _update(cur, table: str, row_id: int, fields: dict):
    # column names come from this module only, never from input
    if fields:
        cur.execute(f"UPDATE {table} SET " + ", ".join(f"{k} = %s" for k in fields) + " WHERE id = %s",
                    (*fields.values(), row_id))


def reconcile(cur, feed_id: int, username: str, host: str, assignments: list) -> dict | None:
    """Bring the user's imported tasks in line with the feed. Runs inside the caller's transaction.
    Returns counts, or None if the feed was switched off meanwhile."""
    now = _now_utc()
    # lock the feed row: a save/remove from the web waits for this to finish, and vice versa
    cur.execute("SELECT 1 FROM ics_feeds WHERE id = %s AND disabled_at IS NULL FOR UPDATE", (feed_id,))
    if cur.fetchone() is None:
        return None

    short_names = _short_names(cur, host, {a.course_key for a in assignments if a.course_key})

    cur.execute(
        "SELECT i.id, i.uid, i.task_id, i.canvas_due_at, i.canvas_title, i.canvas_url, i.course_key, "
        "i.synced_name, i.name_resolved, i.missing_count, t.task_name, t.task_datetime "
        "FROM ics_imports i LEFT JOIN tasks t ON t.id = i.task_id WHERE i.feed_id = %s FOR UPDATE OF i",
        (feed_id,))
    existing = {r[1]: Imported(*r) for r in cur.fetchall()}
    cur.execute("SELECT course_key, color FROM ics_course_colors WHERE feed_id = %s", (feed_id,))
    course_colors = dict(cur.fetchall())

    def color_for(key):
        """The course's color; a course seen for the first time gets the next one this user isn't using."""
        if not key:
            return colors.NO_COLOR
        if key not in course_colors:
            used = {c.lower() for c in course_colors.values()}
            order = colors.COURSE_ORDER
            course_colors[key] = next((c for c in order if c.lower() not in used), order[len(course_colors) % len(order)])
            cur.execute("INSERT INTO ics_course_colors (feed_id, course_key, color) VALUES (%s, %s, %s) "
                        "ON CONFLICT DO NOTHING", (feed_id, key, course_colors[key]))
        return course_colors[key]

    stats = {"added": 0, "moved": 0, "renamed": 0, "deleted": 0, "held": 0}
    in_feed = set()

    # every course this term gets its color up front, in the order their work started, so the course list
    # in the Canvas panel is complete even for courses with nothing left due
    for key in sorted(current_courses(assignments),
                      key=lambda k: min(a.due_utc for a in assignments if a.course_key == k)):
        color_for(key)

    for a in assignments:
        in_feed.add(a.uid)
        r = existing.get(a.uid)
        short, resolved = course_label(short_names, a.course_key, a.course_code)

        if r is None:
            if a.due_utc <= now:
                continue        # already due: no point importing it
            name = ics_feed.task_name(a.title, short)
            color = color_for(a.course_key)
            # same task + reminder rows a typed task gets: a reminder at the due time, and the
            # trigger adds the early one 3h before
            task_id = tasks_db.insert_task(cur, username, name, a.due_time.strftime("%I:%M %p"), "", a.due_date,
                                           color, None, a.due_utc, a.due_utc)
            cur.execute(
                "INSERT INTO ics_imports (feed_id, uid, task_id, canvas_due_at, canvas_title, canvas_url, "
                "course_key, synced_name, name_resolved) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (feed_id, a.uid, task_id, a.due_utc, a.title, a.canvas_url, a.course_key, name, resolved))
            stats["added"] += 1
            continue

        imp = {}
        if r.missing_count:
            imp["missing_count"] = 0
        if r.task_id is None:
            # the user deleted this task: it stays deleted, but its row keeps Canvas's latest details so
            # restoring it (restore() below) brings back the current title and due date
            imp.update({k: v for k, v in (("canvas_due_at", a.due_utc), ("canvas_title", a.title),
                                          ("canvas_url", a.canvas_url), ("course_key", a.course_key))
                        if getattr(r, k) != v})
            _update(cur, "ics_imports", r.id, imp)
            continue

        task = {}
        if a.due_utc != r.canvas_due_at:
            task.update(due_date=a.due_date, task_time=a.due_time, task_datetime=a.due_utc)
            imp["canvas_due_at"] = a.due_utc
        if a.title != r.canvas_title:
            # Canvas renamed it: Canvas wins, even over a rename by the user
            task["task_name"] = ics_feed.task_name(a.title, short)
            imp.update(canvas_title=a.title, synced_name=task["task_name"], name_resolved=resolved)
        elif resolved and not r.name_resolved:
            # the course name turned up after the import: swap the code for it, unless the user renamed the task
            if r.task_name == r.synced_name:
                task["task_name"] = ics_feed.task_name(a.title, short)
                imp["synced_name"] = task["task_name"]
            imp["name_resolved"] = True
        if a.canvas_url != r.canvas_url:
            imp["canvas_url"] = a.canvas_url
        if a.course_key != r.course_key:
            imp["course_key"] = a.course_key

        # task_datetime first: the early-reminder trigger reads it when notify_at changes below
        _update(cur, "tasks", r.task_id, task)
        if "task_datetime" in task:
            tasks_db.shift_reminders(cur, username, r.task_id, a.due_utc - (r.task_datetime or r.canvas_due_at), a.due_utc)
            stats["moved"] += 1
        if "task_name" in task:
            stats["renamed"] += 1
        _update(cur, "ics_imports", r.id, imp)

    # assignments that vanished from the feed: upcoming tasks, and upcoming ones the user deleted (so a
    # gone-for-good assignment drops off their "deleted" list too)
    upcoming = [r for r in existing.values()
                if (r.task_id and r.task_datetime and r.task_datetime > now) or (not r.task_id and r.canvas_due_at > now)]
    doomed = []
    for r in upcoming:
        if r.uid in in_feed:
            continue
        misses = r.missing_count + 1
        _update(cur, "ics_imports", r.id, {"missing_count": misses})
        if misses >= DELETE_AFTER_MISSES:
            doomed.append(r)

    if len(doomed) >= 2 and len(doomed) * 2 > len(upcoming):
        # a feed that suddenly lost most of its assignments is more likely broken than emptied out
        # (dropping deleted markers on a broken feed would bring those assignments back later, too)
        stats["held"] = len(doomed)
        applog.event("ics", f"feed {feed_id} ({username}): {len(doomed)} of {len(upcoming)} upcoming assignments "
                            f"vanished, NOT deleting them (mass-delete guard)", "warn")
    elif doomed:
        # drop the ics_imports rows too, so the assignment comes back if Canvas brings it back
        cur.execute("DELETE FROM ics_imports WHERE id = ANY(%s)", ([r.id for r in doomed],))
        gone = [r.task_id for r in doomed if r.task_id]
        if gone:
            cur.execute("DELETE FROM tasks WHERE id = ANY(%s) AND username = %s", (gone, username))
        stats["deleted"] = len(gone)
    return stats


def restore(username: str, import_id: int) -> str | None:
    """Bring back an imported assignment the user deleted, as Canvas has it now (title, due date) with
    its course's name and color and a fresh reminder. Only upcoming ones. Returns the task name, or None
    if there's nothing to restore."""
    now = _now_utc()
    with _db() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT i.feed_id, i.canvas_due_at, i.canvas_title, i.course_key, f.host, f.tz, c.color "
            "FROM ics_imports i JOIN ics_feeds f ON f.id = i.feed_id "
            "LEFT JOIN ics_course_colors c ON c.feed_id = i.feed_id AND c.course_key = i.course_key "
            "WHERE i.id = %s AND f.username = %s AND i.task_id IS NULL AND i.canvas_due_at > %s FOR UPDATE OF i",
            (import_id, username, now))
        row = cur.fetchone()
        if row is None:
            conn.rollback()
            return None
        feed_id, due_utc, title, course_key, host, tz, color = row
        short, resolved = course_label(_short_names(cur, host, {course_key} if course_key else set()), course_key, None)
        name = ics_feed.task_name(title, short)
        due_date, due_time = ics_feed.to_local(due_utc, tz)
        task_id = tasks_db.insert_task(cur, username, name, due_time.strftime("%I:%M %p"), "", due_date,
                                       color or colors.NO_COLOR, None, due_utc, due_utc)
        _update(cur, "ics_imports", import_id, {"task_id": task_id, "synced_name": name,
                                                "name_resolved": resolved, "missing_count": 0})
        conn.commit()
    return name


# --- one feed ------------------------------------------------------------------------------------------

def _stage(feed_id: int, stage: str):
    """Which step a first import is on, for the Canvas panel's progress bar."""
    with _db() as conn, conn.cursor() as cur:
        cur.execute("UPDATE ics_feeds SET sync_stage = %s WHERE id = %s", (stage, feed_id))
        conn.commit()


def sync_feed(feed_id: int, username: str, url: str, host: str, tz: str, last_hash: str | None):
    started = time.time()
    first = last_hash is None            # new or re-saved link: read the whole term, to find every course
    stage = (lambda s: _stage(feed_id, s)) if first else (lambda s: None)
    stage("fetching")
    try:
        body = ics_feed.fetch(ics_feed.full_history(url) if first else url)
        events = ics_feed.parse_events(body)
    except ics_feed.FeedGone as e:
        return _strike(feed_id, url, username, str(e))
    except ics_feed.FeedTemporary as e:
        applog.event("ics", f"feed {feed_id} ({username}) fetch failed, retrying later: {e}", "warn")
        return _finish(feed_id, url, ok=False, error=str(e)[:200], retry=RETRY_TEMPORARY)

    digest = ics_feed.body_hash(body)
    if digest == last_hash:
        with _db() as conn, conn.cursor() as cur:
            pending = _has_pending(cur, feed_id)
            if not pending:
                _finish(feed_id, url, ok=True, digest=digest, cur=cur)
            conn.commit()
        if not pending:
            return

    assignments = ics_feed.to_assignments(events, host, tz)
    resolve_names(host, current_courses(assignments), on_lookup=lambda: stage("naming"))
    stage("importing")

    with _db() as conn, conn.cursor() as cur:
        stats = reconcile(cur, feed_id, username, host, assignments)
        if stats is None:
            conn.rollback()
            return
        _finish(feed_id, url, ok=True, digest=digest, cur=cur)
        conn.commit()

    changes = ", ".join(f"{n} {k}" for k, n in stats.items() if n)
    applog.event("ics", f"feed {feed_id} ({username}) synced in {time.time() - started:.1f}s: "
                        f"{len(assignments)} assignments" + (f", {changes}" if changes else ", no changes"),
                 color="green" if stats["added"] or stats["moved"] or stats["renamed"] else None)


# --- the loop ------------------------------------------------------------------------------------------

def _heartbeat():
    # the app shows "sync paused" when this goes stale (tasks_db.SYNC_STALE_AFTER)
    with _db() as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO ics_sync_heartbeat (id, beat_at) VALUES (1, now()) "
                    "ON CONFLICT (id) DO UPDATE SET beat_at = now()")
        conn.commit()


def _due_feeds(limit: int, busy: list) -> list:
    """Feeds whose time has come, first imports first, leaving out ones already being synced."""
    with _db() as conn, conn.cursor() as cur:
        cur.execute("SELECT id, username, url, host, tz, last_hash FROM ics_feeds "
                    "WHERE disabled_at IS NULL AND next_sync_at <= now() AND NOT (id = ANY(%s)) "
                    "ORDER BY (last_hash IS NULL) DESC, next_sync_at LIMIT %s",
                    (busy, limit))
        rows = cur.fetchall()
        conn.commit()
    return rows


class _Singleton:
    """Holds a session-level advisory lock on its own connection for as long as the process runs, and
    LISTENs on that connection for "a link was just saved" (NOTIFY ics_sync from tasks_db.save_ics_feed)."""

    def __init__(self):
        self.conn = None

    def held(self) -> bool:
        try:
            if self.conn is not None and not self.conn.closed:
                with self.conn.cursor() as cur:
                    cur.execute("SELECT 1")
                return True
        except psycopg2.Error:
            pass
        try:
            if self.conn is not None:
                self.conn.close()
            self.conn = hasher.dbConnect()      # its own connection, outside the pool, held for the lock
            self.conn.autocommit = True
            with self.conn.cursor() as cur:
                cur.execute("SELECT pg_try_advisory_lock(hashtext(%s))", (LOCK_NAME,))
                if cur.fetchone()[0]:
                    cur.execute("LISTEN ics_sync")
                    return True
            self.conn.close()
            self.conn = None
            applog.event("ics", "another sync worker holds the lock, standing by", "warn")
        except psycopg2.Error as e:
            applog.event("ics", f"can't reach the database: {e}", "error")
            self.conn = None
        return False

    def wait(self, seconds: float):
        """Sleep until a link is saved (NOTIFY) or `seconds` pass."""
        try:
            if select.select([self.conn], [], [], seconds)[0]:
                self.conn.poll()
                self.conn.notifies.clear()
        except Exception:
            time.sleep(1)       # connection trouble: held() reconnects on the next loop


def _run(feed):
    try:
        sync_feed(*feed)
    except Exception as e:
        applog.event("ics", f"feed {feed[0]} ({feed[1]}) sync crashed: {type(e).__name__}: {e}", "error")
        try:
            _finish(feed[0], feed[2], ok=False, error="internal error", retry=RETRY_TEMPORARY)
        except Exception:
            pass


def main():
    applog.set_worker(1, name="ics-sync")
    applog.event("ics", f"sync worker up: {SYNC_THREADS} at a time, each feed every "
                        f"{int(SYNC_EVERY.total_seconds() // 60)} min, wakes on new links, course names via {course_names.VENDOR}")
    lock = _Singleton()
    in_flight = {}          # feed id -> its sync, so a feed is never picked up twice at once
    last_beat = 0.0
    with ThreadPoolExecutor(SYNC_THREADS, thread_name_prefix="ics") as pool:
        while True:
            if not lock.held():
                time.sleep(60)
                continue
            for feed_id in [f for f, job in in_flight.items() if job.done()]:
                del in_flight[feed_id]
            try:
                if time.time() - last_beat >= HEARTBEAT_EVERY:
                    _heartbeat()
                    last_beat = time.time()
                room = SYNC_THREADS * 2 - len(in_flight)     # keep a short queue so free threads never wait
                for feed in (_due_feeds(room, list(in_flight)) if room > 0 else []):
                    in_flight[feed[0]] = pool.submit(_run, feed)
            except Exception as e:
                applog.event("ics", f"couldn't list feeds: {e}", "error")
            # busy: look again soon (slots free up); idle: sleep until a link is saved or POLL_SECONDS pass
            lock.wait(1 if in_flight else POLL_SECONDS)


if __name__ == "__main__":
    main()
