import psycopg2
from psycopg2.pool import ThreadedConnectionPool
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import json
import os
import re
from logic import applog

# Initialize shared db connection pool (max 20 connections per worker)
db_pool = ThreadedConnectionPool(
    minconn=1,
    maxconn=20,
    dbname=os.environ.get('POSTGRES_DB'),
    user=os.environ.get('POSTGRES_USER'),
    password=os.environ.get('POSTGRES_PASSWORD'),
    host=os.environ.get('POSTGRES_HOST'),
    port=os.environ.get('POSTGRES_PORT'),
    keepalives=1,
    keepalives_idle=60,
    keepalives_interval=10,
    keepalives_count=5,
)

# checkout pool connection
@contextmanager
def get_db_connection():
    conn = db_pool.getconn()
    try:
        yield conn
    finally:
        # a connection that broke (DB restart, network drop) is thrown away instead of going back
        # into the pool, where every later checkout would fail on it
        db_pool.putconn(conn, close=bool(conn.closed))


def utc_now():
    """Naive UTC, the convention task_datetime and notify_at values are written in."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


# the early reminder the trg_set_early_notify_at trigger (db/init/01_schema.sql) sets before every task
EARLY_REMINDER = timedelta(hours=3)


def insert_task(cur, username, task_name, task_time, task_description, due_date, color,
                reminder_display, task_datetime, notify_at):
    """INSERT one task plus its reminder (when notify_at is known) inside the caller's transaction;
    returns the new task id. Shared by add_task (typed tasks) and the Canvas sync (logic/ics_sync.py).
    task_time is text like "5:00 PM" or None."""
    cur.execute(
        "INSERT INTO tasks (username, "
        "task_name, "
        "task_time, "
        "task_description, "
        "due_date, "
        "color, "
        "reminder_display, "
        "task_datetime) VALUES (%s, %s, "
        "to_timestamp(NULLIF(btrim(%s), ''), 'HH12:MI AM')::time, "
        "%s, %s, %s, %s, %s) RETURNING tasks.id",
        (username, task_name, task_time, task_description, due_date, color, reminder_display, task_datetime)
    )
    task_id = cur.fetchone()[0]
    if notify_at is not None:
        cur.execute(
            "INSERT INTO notifications (username, task_id, notify_at) "
            "VALUES (%s, %s, %s)",
            (username, task_id, notify_at)
        )
    return task_id


def shift_reminders(cur, username, task_id, delta, new_task_datetime):
    """A task's due time moved by delta: move its reminders with it, keeping their lead time. Call it
    AFTER updating tasks.task_datetime (the early-reminder trigger reads it). A reminder that ends up
    still ahead is re-armed; one that lands in the past is not, or it would fire the moment it's saved.
    Comparing against a naive UTC "now" matches how notify_at values are written."""
    early_ahead = new_task_datetime is not None and new_task_datetime - EARLY_REMINDER > utc_now()
    cur.execute(
        "UPDATE notifications SET "
        "notify_at = notify_at + %(delta)s, "
        "sent = CASE WHEN notify_at + %(delta)s > %(now)s THEN FALSE ELSE sent END, "
        "early_sent = CASE WHEN %(early_ahead)s THEN FALSE ELSE early_sent END "
        "WHERE username = %(username)s AND task_id = %(task_id)s",
        {"delta": delta, "now": utc_now(), "early_ahead": early_ahead, "username": username, "task_id": task_id}
    )

# json to dict
def parse_api_response(jsonInput: str) -> dict:
    if not jsonInput or not jsonInput.strip():
        raise ValueError("Empty API response")

    # Extract the first JSON object from the response (helps when changing models, some models respond with sum bullshit before/after the expected json, others are smarter and return just a simple json)
    match = re.search(r"\{.*\}", jsonInput, re.DOTALL)
    if not match:
        raise ValueError(f"No JSON object found in API response: {jsonInput!r}")

    cleaned = match.group(0)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON after sanitization: {cleaned!r}") from e


def _build_task_datetime(due_date_str, task_time_str, utc_offset_minutes, tz_name=None):
    """Combine due_date + task_time into a single UTC datetime.

    due_date_str: "DD Mon YYYY" e.g. "14 Mar 2026"
    task_time_str: "HH:MM AM/PM" e.g. "5:00 PM" or None
    utc_offset_minutes: from JS Date.getTimezoneOffset() (e.g. 300 for EST=UTC-5)
    tz_name: the browser's IANA timezone, e.g. "America/Chicago", or None
    """
    if not due_date_str:
        return None

    # parse due_date
    local_dt = datetime.strptime(due_date_str, "%d %b %Y")

    # parse task_time or default to 23:59
    if task_time_str and task_time_str.strip():
        try:
            t = datetime.strptime(task_time_str.strip(), "%I:%M %p")
            local_dt = local_dt.replace(hour=t.hour, minute=t.minute)
        except ValueError:
            local_dt = local_dt.replace(hour=23, minute=59)
    else:
        local_dt = local_dt.replace(hour=23, minute=59)

    # convert to UTC. Preferred: the timezone name, which gives the offset that applies ON THE DUE DATE.
    # utc_offset_minutes is the browser's offset right now, so across a clock change (DST) it is an
    # hour off and the reminders with it.
    if isinstance(tz_name, str) and tz_name:
        try:
            return local_dt.replace(tzinfo=ZoneInfo(tz_name)).astimezone(timezone.utc).replace(tzinfo=None)
        except Exception:
            pass    # unknown or malformed name (it comes from the browser): fall back to the offset below

    # fallback: JS getTimezoneOffset() returns minutes to ADD to get UTC
    # e.g. EST (UTC-5) returns 300, IST (UTC+5:30) returns -330
    if utc_offset_minutes is not None:
        local_dt = local_dt + timedelta(minutes=utc_offset_minutes)

    return local_dt


DEFAULT_NOTIF_OFFSET_HOURS = 3.0

# add task to db
def add_task(username: str, jsonInput: str, task_data: dict, color: str = '#FFFFFF',
             notif_time_offset=0, notif_absolute_time=None, reminder_display=None):
    sendToDb = parse_api_response(jsonInput)
    task_name = sendToDb.get('task_name')
    task_time = sendToDb.get('task_time')
    task_description = sendToDb.get('task_description')
    due_date = sendToDb.get('due_date')

    userInput = task_data.get('task_description')
    user_tz_metadata = task_data.get('user_tz_metadata', {})
    utc_offset_minutes = user_tz_metadata.get('utc_offset_minutes') if isinstance(user_tz_metadata, dict) else None
    tz_name = user_tz_metadata.get('user timezone: ') if isinstance(user_tz_metadata, dict) else None

    # build normalized UTC datetime for notifications
    task_datetime_utc = _build_task_datetime(due_date, task_time, utc_offset_minutes, tz_name)

    # compute notify_at
    notify_at = None
    if notif_absolute_time and due_date:
        # absolute reminder: "remind at 2:00 PM" → combine with due_date
        notify_at = _build_task_datetime(due_date, notif_absolute_time, utc_offset_minutes, tz_name)
    elif task_datetime_utc is not None:
        # relative reminder: offset hours before task time
        offset_hours = notif_time_offset if notif_time_offset is not None else DEFAULT_NOTIF_OFFSET_HOURS
        try:
            notify_at = task_datetime_utc - timedelta(hours=float(offset_hours))
        except (ValueError, TypeError):
            notify_at = task_datetime_utc - timedelta(hours=DEFAULT_NOTIF_OFFSET_HOURS)

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            try:
                task_id = insert_task(cur, username, task_name, task_time, task_description, due_date,
                                      color, reminder_display, task_datetime_utc, notify_at)

                cur.execute(
                    "INSERT INTO sftdata (username, user_input, api_response, user_tz_metadata) VALUES (%s, %s, %s, %s)",
                    (username, userInput, jsonInput, str(user_tz_metadata))
                )
                conn.commit()
                return task_id
            except psycopg2.Error as e:
                applog.event('db', f"add_task failed for {username}: {e}", 'error')
                conn.rollback()
                return None


# fetch tasks from db
def get_all_tasks(username, sort_order):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    "SELECT "
                    "tasks.id, "
                    "tasks.username, "
                    "tasks.task_name, "
                    "to_char(tasks.task_time, 'HH12:MI AM') AS task_time, "
                    "tasks.task_description, "
                    "tasks.due_date, "
                    "tasks.color, "
                    "tasks.reminder_display, "
                    # templates read rows by position, so new columns only ever go on the end
                    "(ics_imports.id IS NOT NULL) AS is_imported, "     # [8] from a Canvas feed: dates are locked
                    "ics_imports.canvas_url "                            # [9] the assignment's page in Canvas
                    "FROM tasks "
                    "LEFT JOIN ics_imports ON ics_imports.task_id = tasks.id "
                    "WHERE tasks.username = %s "
                    "ORDER BY tasks.due_date ASC, tasks.task_time ASC NULLS LAST;",
                    (username,)
                )
                rows = cur.fetchall()
                return rows

            except psycopg2.Error as e:
                applog.event('db', f"get_all_tasks failed for {username}: {e}", 'error')
                conn.rollback()



# edit an existing task's fields directly (no LLM re-extraction).
# Accepts the same field shape the frontend already builds for add, minus the
# NL parsing: caller passes already-resolved name/desc/time/date/color.
# Recomputes task_datetime (UTC) and shifts any linked notification's notify_at
# by the same delta so the reminder keeps its original lead time.
def edit_task(username, task_id, task_name, task_time, task_description,
              due_date, color, utc_offset_minutes=None, tz_name=None):
    new_task_datetime = _build_task_datetime(due_date, task_time, utc_offset_minutes, tz_name)

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            try:
                # grab the old datetime first so we can shift the notification by the delta
                cur.execute(
                    "SELECT task_datetime, EXISTS (SELECT 1 FROM ics_imports WHERE ics_imports.task_id = tasks.id) "
                    "FROM tasks WHERE username = %s AND id = %s",
                    (username, task_id)
                )
                row = cur.fetchone()
                if row is None:
                    return False
                old_task_datetime, imported = row

                if imported:
                    # Canvas owns an imported task's due date: whatever date/time the client sent is
                    # ignored, so its reminders stay where they are. Name, description, color are editable.
                    cur.execute(
                        "UPDATE tasks SET task_name = %s, task_description = %s, color = %s "
                        "WHERE username = %s AND id = %s",
                        (task_name, task_description, color, username, task_id)
                    )
                    conn.commit()
                    return True

                cur.execute(
                    "UPDATE tasks SET "
                    "task_name = %s, "
                    "task_time = to_timestamp(NULLIF(btrim(%s), ''), 'HH12:MI AM')::time, "
                    "task_description = %s, "
                    "due_date = %s, "
                    "color = %s, "
                    "task_datetime = %s "
                    "WHERE username = %s AND id = %s",
                    (task_name, task_time, task_description, due_date, color,
                     new_task_datetime, username, task_id)
                )

                # keep the reminder's lead time: shift notify_at by however much the
                # task moved. Only possible when both old + new datetimes are known.
                if old_task_datetime is not None and new_task_datetime is not None:
                    shift_reminders(cur, username, task_id, new_task_datetime - old_task_datetime,
                                    new_task_datetime)

                conn.commit()
                return True
            except psycopg2.Error as e:
                applog.event('db', f"edit_task failed for {username} task {task_id}: {e}", 'error')
                conn.rollback()
                return False


# delete_task(username, task_id)
def delete_task(username, task_id):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    "DELETE FROM tasks WHERE tasks.username = %s AND tasks.id = %s ",(username,task_id)
                )
                conn.commit()
                return True
            except psycopg2.Error as e:
                applog.event('db', f"delete_task failed for {username} task {task_id}: {e}", 'error')
                conn.rollback()



# --- Canvas calendar feed (the sync itself runs in logic/ics_sync.py) ---

# the sync worker stamps ics_sync_heartbeat every ~30s; a slow LLM lookup can stretch one loop to a few minutes
SYNC_STALE_AFTER = '5 minutes'

# the feed the Canvas panel is about: the live one, else one Canvas stopped serving (so the panel can say so)
_CURRENT_FEED = ("FROM ics_feeds f WHERE f.username = %s AND (f.disabled_at IS NULL OR f.disabled_reason = 'dead') "
                 "ORDER BY (f.disabled_at IS NULL) DESC, f.id DESC LIMIT 1")


def get_ics_feed(username: str):
    """What the settings panel shows. Never includes the URL (it's a login token)."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute("SELECT EXISTS (SELECT 1 FROM ics_sync_heartbeat WHERE beat_at > now() - %s::interval)",
                            (SYNC_STALE_AFTER,))
                sync_running = cur.fetchone()[0]
                cur.execute(
                    "SELECT f.id, f.host, f.last_success_at, f.last_error, f.disabled_reason, f.next_sync_at, f.sync_stage, "
                    "(SELECT count(*) FROM ics_imports i JOIN tasks t ON t.id = i.task_id WHERE i.feed_id = f.id) "
                    + _CURRENT_FEED,
                    (username,)
                )
                row = cur.fetchone()
                courses, deleted = [], []
                if row:
                    # each course with its color, named like its tasks are (the course name, else its code)
                    cur.execute(
                        "SELECT c.course_key, c.color, n.short_name FROM ics_course_colors c "
                        "LEFT JOIN course_names n ON n.host = %s AND n.course_key = c.course_key "
                        "WHERE c.feed_id = %s ORDER BY coalesce(n.short_name, c.course_key)",
                        (row[1], row[0])
                    )
                    courses = [{"key": key, "color": color, "name": short or key.split('/')[0],
                                "code": key.replace('/', ' / ')} for key, color, short in cur.fetchall()]
                    # upcoming Canvas assignments the user deleted, with Canvas's latest title + due date
                    cur.execute(
                        "SELECT i.id, i.canvas_title, coalesce(n.short_name, split_part(i.course_key, '/', 1)), i.canvas_due_at, c.color "
                        "FROM ics_imports i LEFT JOIN course_names n ON n.host = %s AND n.course_key = i.course_key "
                        "LEFT JOIN ics_course_colors c ON c.feed_id = i.feed_id AND c.course_key = i.course_key "
                        "WHERE i.feed_id = %s AND i.task_id IS NULL AND i.canvas_due_at > %s ORDER BY i.canvas_due_at",
                        (row[1], row[0], utc_now())
                    )
                    deleted = [{"id": i, "title": title, "course": course, "due": due.isoformat() + "Z", "color": color}
                               for i, title, course, due, color in cur.fetchall()]
                conn.commit()
            except psycopg2.Error as e:
                applog.event('db', f"get_ics_feed failed for {username}: {e}", 'error')
                conn.rollback()
                return None
    if row is None:
        return {"state": "none", "sync_running": sync_running}
    _, host, last_success_at, last_error, disabled_reason, next_sync_at, sync_stage, task_count = row
    if disabled_reason == 'dead':
        # Canvas refused it: a link that never worked was mistyped/old, one that did was reset
        state = "rejected" if last_success_at is None else "dead"
    elif last_error:
        state = "retrying"      # last attempt failed; the worker tries again on its own
    elif last_success_at is None:
        state = "pending"       # saved, first sync hasn't happened yet
    else:
        state = "ok"
    return {
        "state": state,
        "host": host,
        "last_synced": last_success_at.isoformat() if last_success_at else None,
        "next_sync": next_sync_at.isoformat() if next_sync_at and disabled_reason is None else None,
        # first import in progress: which step, and since when (saving sets next_sync_at to the save time)
        "stage": sync_stage if state == "pending" else None,
        "queued_at": next_sync_at.isoformat() if state == "pending" and next_sync_at else None,
        "task_count": task_count,
        "sync_running": sync_running,
        "courses": courses,
        "deleted": deleted,
    }


def set_course_color(username: str, course_key: str, color: str):
    """Give one of the user's Canvas courses a new color. Its tasks follow, except ones the user
    recolored by hand (their color no longer matches the course's old one); so do future imports.
    Returns how many tasks changed, or None if there's no such course."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    "SELECT c.feed_id, c.color FROM ics_course_colors c "
                    "WHERE c.course_key = %s AND c.feed_id = (SELECT f.id " + _CURRENT_FEED + ") FOR UPDATE",
                    (course_key, username)
                )
                row = cur.fetchone()
                if row is None:
                    conn.rollback()
                    return None
                feed_id, old = row
                cur.execute(
                    "UPDATE tasks t SET color = %s FROM ics_imports i "
                    "WHERE i.task_id = t.id AND i.feed_id = %s AND i.course_key = %s AND lower(t.color) = lower(%s)",
                    (color, feed_id, course_key, old)
                )
                changed = cur.rowcount
                cur.execute("UPDATE ics_course_colors SET color = %s WHERE feed_id = %s AND course_key = %s",
                            (color, feed_id, course_key))
                conn.commit()
                return changed
            except psycopg2.Error as e:
                applog.event('db', f"set_course_color failed for {username}: {e}", 'error')
                conn.rollback()
                return None


SAVE_COOLDOWN = '10 seconds'     # between link saves by one user: each save triggers a full-term fetch


def save_ics_feed(username: str, url: str, host: str, tz: str) -> str:
    """Save (or replace) the user's feed and wake the worker to sync it now. Returns:
      "saved"      stored; the worker is on it
      "unchanged"  the same, working link again: nothing to redo
      "too_soon"   another save within SAVE_COOLDOWN (each one costs a full-term fetch from Canvas)
      "taken"      another Tasker account already has this link (a link is one person's Canvas login)
      "error"      the database said no
    A feed from a host this user had before is brought back rather than created again, so its imports
    carry on and nothing gets imported twice. Switching to a different host retires the old feed; its
    tasks stay."""
    reset = ("url = %s, tz = %s, disabled_at = NULL, disabled_reason = NULL, last_hash = NULL, last_success_at = NULL, "
             "last_error = NULL, fail_count = 0, sync_stage = NULL, next_sync_at = now(), saved_at = now()")
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            try:
                # the live feed row also serializes this user's saves
                cur.execute("SELECT id, host, url, last_error FROM ics_feeds "
                            "WHERE username = %s AND disabled_at IS NULL FOR UPDATE", (username,))
                live = cur.fetchone()
                if live and live[1] == host and live[2] == url and live[3] is None:
                    conn.rollback()
                    return "unchanged"
                cur.execute("SELECT EXISTS (SELECT 1 FROM ics_feeds WHERE username = %s AND saved_at > now() - %s::interval)",
                            (username, SAVE_COOLDOWN))
                if cur.fetchone()[0]:
                    conn.rollback()
                    return "too_soon"
                cur.execute("SELECT EXISTS (SELECT 1 FROM ics_feeds WHERE url = %s AND username <> %s AND disabled_at IS NULL)",
                            (url, username))
                if cur.fetchone()[0]:
                    conn.rollback()
                    return "taken"
                if live and live[1] == host:
                    cur.execute(f"UPDATE ics_feeds SET {reset} WHERE id = %s", (url, tz, live[0]))
                else:
                    if live:
                        cur.execute("UPDATE ics_feeds SET disabled_at = now(), disabled_reason = 'user', url = '' "
                                    "WHERE id = %s", (live[0],))
                    cur.execute("SELECT id FROM ics_feeds WHERE username = %s AND host = %s "
                                "ORDER BY id DESC LIMIT 1 FOR UPDATE", (username, host))
                    old = cur.fetchone()
                    if old:
                        cur.execute(f"UPDATE ics_feeds SET {reset} WHERE id = %s", (url, tz, old[0]))
                    else:
                        cur.execute("INSERT INTO ics_feeds (username, url, host, tz, saved_at) VALUES (%s, %s, %s, %s, now())",
                                    (username, url, host, tz))
                # wake the sync worker now instead of at its next 30s check (delivered on commit)
                cur.execute("NOTIFY ics_sync")
                conn.commit()
                return "saved"
            except psycopg2.IntegrityError as e:
                # lost a race: the same link saved by someone else (ics_feeds_one_live_url), or this
                # user's own double-click (ics_feeds_one_live_per_user)
                conn.rollback()
                return "taken" if "one_live_url" in str(e) else "too_soon"
            except psycopg2.Error as e:
                applog.event('db', f"save_ics_feed failed for {username}: {e}", 'error')
                conn.rollback()
                return "error"


def remove_ics_feed(username: str) -> bool:
    """Stop syncing. The imported tasks stay; the stored link is wiped."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    "UPDATE ics_feeds SET disabled_at = COALESCE(disabled_at, now()), disabled_reason = 'user', url = '' "
                    "WHERE username = %s AND (disabled_at IS NULL OR disabled_reason = 'dead')",
                    (username,)
                )
                conn.commit()
                return True
            except psycopg2.Error as e:
                applog.event('db', f"remove_ics_feed failed for {username}: {e}", 'error')
                conn.rollback()
                return False


# --- Push Subscription CRUD ---

def save_push_subscription(username: str, endpoint: str, p256dh: str, auth: str):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    "INSERT INTO push_subscriptions (username, endpoint, p256dh, auth) "
                    "VALUES (%s, %s, %s, %s) "
                    "ON CONFLICT (username, endpoint) DO UPDATE SET p256dh = %s, auth = %s",
                    (username, endpoint, p256dh, auth, p256dh, auth)
                )
                conn.commit()
                return True
            except psycopg2.Error as e:
                applog.event('db', f"save_push_subscription failed for {username}: {e}", 'error')
                conn.rollback()
                return False


def delete_push_subscription(username: str, endpoint: str):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    "DELETE FROM push_subscriptions WHERE push_subscriptions.username = %s AND push_subscriptions.endpoint = %s",
                    (username, endpoint)
                )
                conn.commit()
                return True
            except psycopg2.Error as e:
                applog.event('db', f"delete_push_subscription failed for {username}: {e}", 'error')
                conn.rollback()
                return False


# add pending signup request
def add_pending_approval(username: str, password_hash: str, email: str | None = None):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    "INSERT INTO pendingapprovals (username, password_hash, email) "
                    "VALUES (%s, %s, %s)",
                    (username, password_hash, email)
                )
                conn.commit()
                return True

            except psycopg2.Error as e:
                applog.event('db', f"add_pending_approval failed for {username!r}: {e}", 'error')
                conn.rollback()
                return False
