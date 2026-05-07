import psycopg2
from psycopg2.pool import ThreadedConnectionPool
from contextlib import contextmanager
from datetime import datetime, timedelta
import json
import os
import re

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
        db_pool.putconn(conn)

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


def _build_task_datetime(due_date_str, task_time_str, utc_offset_minutes):
    """Combine due_date + task_time into a single UTC datetime.

    due_date_str: "DD Mon YYYY" e.g. "14 Mar 2026"
    task_time_str: "HH:MM AM/PM" e.g. "5:00 PM" or None
    utc_offset_minutes: from JS Date.getTimezoneOffset() (e.g. 300 for EST=UTC-5)
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

    # convert to UTC: JS getTimezoneOffset() returns minutes to ADD to get UTC
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

    # build normalized UTC datetime for notifications
    task_datetime_utc = _build_task_datetime(due_date, task_time, utc_offset_minutes)

    # compute notify_at
    notify_at = None
    if notif_absolute_time and due_date:
        # absolute reminder: "remind at 2:00 PM" → combine with due_date
        notify_at = _build_task_datetime(due_date, notif_absolute_time, utc_offset_minutes)
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
                    (username, task_name, task_time, task_description, due_date, color, reminder_display, task_datetime_utc)
                )
                task_id = cur.fetchone()[0]

                # insert notification if we have a notify_at time
                if notify_at is not None:
                    cur.execute(
                        "INSERT INTO notifications (username, task_id, notify_at) "
                        "VALUES (%s, %s, %s)",
                        (username, task_id, notify_at)
                    )

                cur.execute(
                    "INSERT INTO sftdata (username, user_input, api_response, user_tz_metadata) VALUES (%s, %s, %s, %s)",
                    (username, userInput, jsonInput, str(user_tz_metadata))
                )
                conn.commit()
            except psycopg2.Error as e:
                print("DB error: ",e)
                conn.rollback()


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
                    "tasks.reminder_display "
                    "FROM tasks "
                    "WHERE tasks.username = %s "
                    "ORDER BY tasks.due_date ASC, tasks.task_time ASC NULLS LAST;",
                    (username,)
                )
                rows = cur.fetchall()
                return rows

            except psycopg2.Error as e:
                print("DB error: ",e)
                conn.rollback()



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
                print("DB error: ",e)
                conn.rollback()



# ADD: edit_task(username, task_id)


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
                print("DB error (save_push_subscription): ", e)
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
                print("DB error (delete_push_subscription): ", e)
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
                print('[!] signup dbwrite fail')
                print("DB error (pendingapprovals): ", e)
                conn.rollback()
                return False
