from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from logic import hasher
from logic import tasks_db as tasks
from logic import apiCall as api
import secrets
import os
from datetime import timedelta,datetime
import subprocess
import sys


app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY')
app.permanent_session_lifetime = timedelta(weeks=1)


def currentTime():
    # returns current local time formatted for logs as: [HH:MM:SS AM/PM]
    return f"[{datetime.now().strftime('%I:%M:%S %p')}]"

    

def fetch_real_ip():
    cf_ip = request.headers.get('CF-Connecting-IP')        # usually ipv6
    if cf_ip:
        return cf_ip
    return None

# LOGIN ROUTE
@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        input_pass = request.form.get('password', '').strip()
        user = hasher.verify_login(input_pass)
        if user:
            session.permanent = True
            session['username'] = user
            print(currentTime(),"[!] USER LOGGED IN: ",user)
            return redirect(url_for('index'))

        else:
            error = "Invalid password. Please try again."
            ipAddr= fetch_real_ip()
            if ipAddr is not None:
                print(currentTime(),"[!] FAILED LOGIN FROM IP: ",ipAddr)
            else:
                ipv4=request.remote_addr
                print(currentTime(),"<!> FAILED LOGIN, IPV4: ",ipv4)        # hotfix for testing

    return render_template('dual_login.html', error=error)


# needs lots of cleanup, will do later
@app.route('/signup', methods=['GET','POST'])
def signup():
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '').strip()
        email = request.form.get('email', '').strip()

        if not username or not password:
            return render_template('signup.html',error='Username and password are required')

        if len(username) < 3 or len(username) > 50:
            return render_template(
                'signup.html',
                error='Username must be between 3 and 50 characters')

        if email and '@' not in email:
            return render_template(
                'signup.html',
                error='Invalid email address')

        hashedPass = hasher.hash_password(password)
        success = tasks.add_pending_approval(username, hashedPass, email)
        ipAddr=fetch_real_ip()
        if ipAddr is None:
            ipv4=request.remote_addr
            print(ipv4,end=" ")
        else:
            print(ipAddr,end=" ")

        
        if not success:
            print('[!] signup dbwrite fail')
            return render_template('signup.html',error='Username already exists or request failed')
        
        print(currentTime(),'[++] Approval Request received and written to db')
        
        # run notifier script, couldn't be asked to integrate as function; will do someday
        try:
            r = subprocess.run(
                [sys.executable, "logic/emailHandler.py", "--notifyAdmin", username, email],
                check=True,
                capture_output=True,
                text=True
            )
            print("email stdout:", r.stdout)
        except subprocess.CalledProcessError as e:
            print("email failed with", e.returncode)
            print("stdout:\n", e.stdout)
            print("stderr:\n", e.stderr)

        return jsonify({"ok": True}), 200

    return render_template('signup.html')


# Detects if the incoming request is from a mobile device by checking the user-agent header for mobile keywords
def is_mobile():
    user_agent = request.headers.get('User-Agent', '').lower()
    mobile_keywords = ['iphone', 'android', 'mobile']
    return any(keyword in user_agent for keyword in mobile_keywords)  #bless python

@app.route('/logout')
def logout():
    session.pop('username', None)
    return redirect(url_for('login'))


@app.route('/')
def index():
    print(currentTime(),f"Handling request in PID={os.getpid()}")

    if 'username' not in session:
        return redirect(url_for('login'))

    rootHit = session['username']
    print(currentTime(),f'{rootHit} hit /')

    # API warmup
    api.warmupCall_async()

    # Mobile UI
    if is_mobile():
        return render_template('mobile_1.html', username=session['username'])

    # UI switching
    ui_version = session.get('ui_version', 3)  # default = v3

    if ui_version == 2:
        return render_template('desktop_v2.html', username=session['username'])

    return render_template('desktop_v3.html', username=session['username'])


# UI SWITCHING
@app.route('/switch/<int:switch_id>', methods=['GET'])
def switch_ui(switch_id):
    if 'username' not in session:
        return redirect(url_for('login'))

    if switch_id in (2, 3):
        session['ui_version'] = switch_id

    return redirect(url_for('index'))



@app.route('/tasks', methods=['GET', 'POST'])
def handle_tasks():
    if 'username' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    username = session['username']
    if request.method == 'GET':
        sort_order='default'
        taskList = tasks.get_all_tasks(username, sort_order)
        return jsonify(taskList)
    elif request.method == 'POST':
        task_data = request.get_json()          # task ingest from desktop.html
        descriptionLenCheck = task_data.get('task_description', '')
        if len(descriptionLenCheck) > 200 or len(descriptionLenCheck)<10:
            return jsonify({'error': 'Description too long (max 200 characters)'}), 410
        if not task_data:
            return jsonify({'error': 'Invalid task data'}), 400


        # api call, response JSON from api call to be passed to tasks module
        apiResponse = api.postRequest(task_data)

        new_task = tasks.add_task(username, apiResponse, task_data)
        return jsonify(new_task), 201

@app.route('/tasks/<int:task_id>', methods=['DELETE'])
def delete_task(task_id):
    if 'username' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    username = session['username']

    success = tasks.delete_task(username, task_id)
    if success:
        return jsonify({'message': 'Task deleted successfully.'})
    else:
        return jsonify({'error': 'Task not found.'}), 404



if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0')
