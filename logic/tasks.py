import json
import os
from datetime import datetime

def _get_tasks_file(username):
    """
    Build and return the file path for a given user's tasks file.
    """
    return f"{username}_tasks.json"

def _initialize_tasks_file(username):
    """
    Ensure that the user's tasks file exists.
    If not, create it with a default empty tasks structure.
    """
    file_path = _get_tasks_file(username)
    if not os.path.exists(file_path):
        with open(file_path, 'w') as file:
            json.dump({"tasks": []}, file, indent=4)
    return file_path

def load_tasks(username):
    """
    Load the tasks for the given username.
    If the file does not exist, it will be initialized.
    Returns a dictionary with a "tasks" list.
    """
    file_path = _initialize_tasks_file(username)
    with open(file_path, 'r') as file:
        data = json.load(file)
    # Ensure a proper structure exists.
    if "tasks" not in data:
        data = {"tasks": []}
    return data

def save_tasks(username, data):
    """
    Save the tasks data for the given username back to the JSON file.
    """
    file_path = _get_tasks_file(username)
    with open(file_path, 'w') as file:
        json.dump(data, file, indent=4)

def _get_next_task_id(tasks):
    """
    Determine the next available task ID based on the current list of tasks.
    """
    if not tasks:
        return 1
    max_id = max(task.get("id", 0) for task in tasks)
    return max_id + 1

def get_all_tasks(username, sort_order='asc'):
    """
    Retrieve all tasks for the given user.
    Tasks are sorted by their due_date (expected format: "mm-dd-yyyy").
    The sort_order parameter can be 'asc' (ascending) or 'desc' (descending).
    """
    data = load_tasks(username)
    tasks = data.get("tasks", [])

    def sort_key(task):
        try:
            return datetime.strptime(task["due_date"], "%m-%d-%Y")
        except Exception:
            # If due_date is missing or malformed, push it to the end.
            return datetime.max

    tasks.sort(key=sort_key, reverse=(sort_order == 'desc'))
    return tasks

def get_task(username, task_id):
    """
    Retrieve a single task by its unique task_id for the given user.
    Returns the task if found, or None otherwise.
    """
    data = load_tasks(username)
    tasks = data.get("tasks", [])
    for task in tasks:
        if task.get("id") == task_id:
            return task
    return None

def add_task(username, task_data):
    """
    Add a new task for the given user.
    task_data should be a dictionary containing:
      - task_name (str)
      - task_time (str) e.g., "10am-11am" or "all day"
      - task_description (str)
      - color (str)
      - due_date (str in mm-dd-yyyy format)
      - status (str)
    This function assigns a unique id and saves the task.
    """
    data = load_tasks(username)
    tasks = data.get("tasks", [])
    new_id = _get_next_task_id(tasks)
    task_data["id"] = new_id
    tasks.append(task_data)
    data["tasks"] = tasks
    save_tasks(username, data)
    return task_data

def update_task(username, task_id, updated_fields):
    """
    Update an existing task for the given user.
    updated_fields is a dictionary with the fields to be updated.
    Returns the updated task if successful, or None if not found.
    """
    data = load_tasks(username)
    tasks = data.get("tasks", [])
    for idx, task in enumerate(tasks):
        if task.get("id") == task_id:
            tasks[idx].update(updated_fields)
            save_tasks(username, data)
            return tasks[idx]
    return None

def delete_task(username, task_id):
    """
    Delete the task with the specified task_id for the given user.
    Returns True if the task was successfully deleted, or False if not found.
    """
    data = load_tasks(username)
    tasks = data.get("tasks", [])
    new_tasks = [task for task in tasks if task.get("id") != task_id]
    if len(new_tasks) == len(tasks):
        # Task with task_id not found
        return False
    data["tasks"] = new_tasks
    save_tasks(username, data)
    return True
