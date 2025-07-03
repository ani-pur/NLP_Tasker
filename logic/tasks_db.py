import psycopg2 
import json
import os
# THIS MODULE HANDLES CRUD OPERATIONS
# create 'tasks' table in tasker db with fields corresponding to json + ID (Serial)
# connect to db
def dbConnect():
    return psycopg2.connect(
        dbname = os.environ.get('POSTGRES_DB'),
        user = os.environ.get('POSTGRES_USER'),
        password = os.environ.get('POSTGRES_PASSWORD'),
        host = os.environ.get('POSTGRES_HOST'),
        port = os.environ.get('POSTGRES_PORT')
    )


# json to dict so python can keep shit moving
def parse_api_response(jsonInput: str) -> dict:
    parsedDict = json.loads(jsonInput)
    return parsedDict

# add task to db
def add_task(username: str, jsonInput: str):
        sendToDb = parse_api_response(jsonInput)
        task_name = sendToDb.get('task_name')
        task_time = sendToDb.get('task_time')
        task_description = sendToDb.get('task_description')
        due_date = sendToDb.get('due_date')
        priority = sendToDb.get('priority')
        color = sendToDb.get('color')
        with dbConnect() as conn:
            with conn.cursor() as cur:
                try: 
                    cur.execute(
                         "INSERT INTO tasks (username, " \
                         "task_name, " \
                         "task_time, " \
                         "task_description, " \
                         "due_date, " \
                         "priority, " \
                         "color) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                         (username, task_name, task_time, task_description, due_date, priority, color)
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
                        "SELECT * FROM tasks WHERE username = %s",(username,)
                    )
                    rows = cur.fetchall()
                    return rows
                
                elif sort_order=='reverse':
                    cur.execute(
                            "SELECT * FROM tasks WHERE username = %s ORDER BY due_date DESC;",(username,)
                        )
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