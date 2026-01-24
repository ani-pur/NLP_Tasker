import psycopg2 
import json
import os
import re

def dbConnect():
    return psycopg2.connect(
        dbname = os.environ.get('POSTGRES_DB'),
        user = os.environ.get('POSTGRES_USER'),
        password = os.environ.get('POSTGRES_PASSWORD'),
        host = os.environ.get('POSTGRES_HOST'),
        port = os.environ.get('POSTGRES_PORT')
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

# add task to db
def add_task(username: str, jsonInput: str, task_data: dict):# added task_data and user_tz_metadata parameter for logging
    sendToDb = parse_api_response(jsonInput)
    task_name = sendToDb.get('task_name')
    task_time = sendToDb.get('task_time')
    task_description = sendToDb.get('task_description')
    due_date = sendToDb.get('due_date')
    priority = sendToDb.get('priority')
    color = sendToDb.get('color')
    userInput = task_data.get('task_description')
    user_tz_metadata = str(task_data.get('user_tz_metadata', ''))	# user task submission timestamp
    # debug
    print("[DEBUG] tasks_db tz status: ",user_tz_metadata)
    
    with dbConnect() as conn:
        with conn.cursor() as cur:
            try: 
                cur.execute(
                    "INSERT INTO tasks (username, "
                    "task_name, "
                    "task_time, "
                    "task_description, "
                    "due_date, "
                    "priority, "
                    "color) VALUES (%s, %s, "
                    "to_timestamp(NULLIF(btrim(%s), ''), 'HH12:MI AM')::time, "
                    "%s, %s, %s, %s)",
                    (username, task_name, task_time, task_description, due_date, priority, color)
                )

                cur.execute(
        "INSERT INTO sftdata (username, user_input, api_response, user_tz_metadata) VALUES (%s, %s, %s, %s)",(username, userInput, jsonInput, user_tz_metadata)
        )
                conn.commit()
            except psycopg2.Error as e:
                print("DB error: ",e)


# fetch tasks from db
def get_all_tasks(username, sort_order):
    with dbConnect() as conn:
        with conn.cursor() as cur:
            try: 
                if sort_order=='default':
                    cur.execute(
                        "SELECT "
                        "id, "
                        "username, "
                        "task_name, "
                        "to_char(task_time, 'HH12:MI AM') AS task_time, "
                        "task_description, "
                        "due_date, "
                        "priority, "
                        "color "
                        "FROM tasks "
                        "WHERE username = %s "
                        "ORDER BY due_date ASC, tasks.task_time ASC NULLS LAST;",
                        (username,)
                    )
                    rows = cur.fetchall()
                    return rows

                
                elif sort_order=='custom':     
                    cur.execute(
                        "SELECT "
                        "id, "
                        "username, "
                        "task_name, "
                        "to_char(task_time, 'HH12:MI AM') AS task_time, "
                        "task_description, "
                        "due_date, "
                        "priority, "
                        "color "
                        "FROM tasks "
                        "WHERE username = %s "
                        "ORDER BY due_date ASC, tasks.task_time ASC NULLS LAST;",
                        (username,)
                    )
                    rows = cur.fetchall()
                    return rows

            except psycopg2.Error as e:
                print("DB error: ",e)

    
# delete_task(username, task_id)
def delete_task(username, task_id):
    with dbConnect() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    "DELETE FROM tasks WHERE username = %s AND id = %s ",(username,task_id)
                )
                conn.commit()
                return True
            except psycopg2.Error as e:
                print("DB error: ",e)




# ADD: edit_task(username, task_id)


# add pending signup request
def add_pending_approval(username: str, password_hash: str, email: str | None = None):
    with dbConnect() as conn:
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
