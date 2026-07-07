from flask import Flask, render_template, request, redirect, url_for, session, jsonify, send_from_directory, make_response
from logic import hasher
from logic import tasks_db as tasks
from logic import apiCall as api
import secrets
import os
from datetime import timedelta,datetime
import threading
import subprocess
import sys
import json
import urllib.request


app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY')
app.permanent_session_lifetime = timedelta(weeks=1)

VAPID_PUBLIC_KEY = os.environ.get('VAPID_PUBLIC_KEY', '')

LOG_PAD = "\t\t"        # to pad logs so they're actually readable lol


def currentTime():
    # returns current local time formatted for logs as: [HH:MM:SS AM/PM]
    return f"[{datetime.now().strftime('%a %b %d %Y %I:%M:%S %p')}]"


# Detects if the incoming request is from a mobile device by checking the user-agent header for mobile keywords
def is_mobile():
    user_agent = request.headers.get('User-Agent', '').lower()
    mobile_keywords = ['iphone', 'android', 'mobile']
    return any(keyword in user_agent for keyword in mobile_keywords)  #bless python
    

def fetch_real_ip():
    cf_ip = request.headers.get('CF-Connecting-IP')        # usually ipv6
    if cf_ip:
        return cf_ip
    return None

def discord_ping(username, email):
    def _send():
        url = os.environ.get("DISCORD_WEBHOOK_URL")
        if not url:
            return
            
        payload = json.dumps({"content": f"[!] Account request: [{username}] [{email}]"}).encode('utf-8')
        
        # Added User-Agent to bypass Discord's anti-bot 403 block
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "TaskerApp/1.0" 
        }
        
        req = urllib.request.Request(url, data=payload, headers=headers)
        
        try:
            urllib.request.urlopen(req, timeout=5)
            print("\t webhook triggered")
        except Exception as e:
            print(f"\t [!] Webhook failed: {e}")

    threading.Thread(target=_send, daemon=True).start()


# PWA ENDPOINTS 
@app.get("/pwa/manifest.webmanifest")
def pwa_manifest():
    return send_from_directory("static","manifest.webmanifest")

@app.get("/pwa/icon-192.png")
def pwa_icon_192():
    return send_from_directory("static", "icon-192.png")

@app.get("/pwa/icon-512.png")
def pwa_icon_512():
    return send_from_directory("static", "icon-512.png")

@app.get("/sw.js")
def service_worker():
    response = make_response(send_from_directory("static", "sw.js"))
    response.headers['Service-Worker-Allowed'] = '/'
    response.headers['Content-Type'] = 'application/javascript'
    return response

@app.route('/info', methods=['GET'])
def info():

    ipAddr = fetch_real_ip() or request.remote_addr
    log_block = (
        f"IP: {ipAddr}\n"
        f"{2*LOG_PAD}Full Path: {request.full_path}\n"
        f"{2*LOG_PAD}User-Agent: {request.headers.get('User-Agent')}\n"
        f"{2*LOG_PAD}Referer: {request.headers.get('Referer')}\n"
        )
    print(currentTime(),log_block)
    return render_template('mixed.html')

# LOGIN ROUTE
@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        input_pass = request.form.get('password', '').strip()
        input_username = request.form.get('username', '').strip()
        user = hasher.verify_login(input_username, input_pass)
        if user:
            session.permanent = True
            session['username'] = user
            print(currentTime(),"[!] USER LOGGED IN: ",user)
            return redirect(url_for('index'))

        else:
            error = "Invalid password. Please try again."
            ipAddr= fetch_real_ip() or request.remote_addr
            print(currentTime(),"[!] FAILED LOGIN FROM IP: ",ipAddr, "Attempted username: ",input_username)

    return render_template('dual_login.html', error=error)


# needs lots of cleanup, will do later
@app.route('/signup', methods=['GET','POST'])
def signup():
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '').strip()
        email = request.form.get('email', '').strip()

        if not username or not password:
            return jsonify({"ok": False, "error": "Username and password are required"}), 400

        if len(username) < 3 or len(username) > 50:
            return jsonify({"ok": False, "error": "Username must be between 3 and 50 characters"}), 400

        if email and '@' not in email:
            return jsonify({"ok": False, "error": "Invalid email address"}), 400

        hashedPass = hasher.hash_password(password)
        success = tasks.add_pending_approval(username, hashedPass, email)
        

        
        if not success:
            return jsonify({
                "ok": False,
                "error": "Username already exists or request failed"
            }), 409

        ip = fetch_real_ip() or request.remote_addr
        print(currentTime(),f"[++] Approval Request received and written to db [IP: {ip}]")
        discord_ping(username, email)        # trigger webhook
        # run notifier script, couldn't be asked to integrate as function; will do someday
        try:
            r = subprocess.Popen(
                [sys.executable, "logic/emailHandler.py", "--notifyAdmin", username, email],
                
            )
            print("email stdout:", r.stdout)
        except subprocess.CalledProcessError as e:
            print("email failed with", e.returncode)
            print("stdout:\n", e.stdout)
            print("stderr:\n", e.stderr)

        return jsonify({"ok": True}), 200

    return render_template('signup.html')




# PASSWORD RESET ROUTES

# Step 1: User submits email, we look up user and fire off a reset email if they exist
# Always shows the same message regardless of whether the email was found (prevents enumeration)
@app.route('/forgot-password', methods=['GET', 'POST'])
def forgot_password():
    message = None
    if request.method == 'POST':
        email = request.form.get('email', '').strip()
        print(currentTime(), "[RESET] Password reset requested for email:", email)

        user = hasher.get_user_by_email(email)
        if user:
            username = user[0]
            token = hasher.generate_reset_token(username)
            reset_url = request.host_url.rstrip('/') + f"/reset-password?token={token}"

            # fire reset email via subprocess (same pattern as signup notification)
            try:
                r = subprocess.Popen(
                    [sys.executable, "logic/emailHandler.py", "--resetPassword", username, email, reset_url],
                )
                print(currentTime(), "[RESET] Reset email fired for user:", username)
            except subprocess.CalledProcessError as e:
                print(currentTime(), "[RESET] Email subprocess failed:", e)
        else:
            print(currentTime(), "[RESET] No user found for email:", email)

        # generic message regardless of outcome
        message = "If an account with that email exists, a reset link has been sent."

    return render_template('forgot_password.html', message=message)


# Step 2: User clicks reset link from email, enters new password + confirmation
# Token is validated (one-time use, 15-min expiry) before allowing password update
@app.route('/reset-password', methods=['GET', 'POST'])
def reset_password():
    error = None

    if request.method == 'GET':
        token = request.args.get('token', '')
        if not token:
            return redirect(url_for('forgot_password'))
        return render_template('reset_password.html', token=token, error=error)

    # POST: validate inputs and token, then update password
    token = request.form.get('token', '')
    password = request.form.get('password', '').strip()
    confirm_password = request.form.get('confirm_password', '').strip()

    if not password or not confirm_password:
        error = "Both fields are required."
        return render_template('reset_password.html', token=token, error=error)

    if password != confirm_password:
        error = "Passwords do not match."
        return render_template('reset_password.html', token=token, error=error)

    if len(password) < 6:
        error = "Password must be at least 6 characters."
        return render_template('reset_password.html', token=token, error=error)

    # verify token: checks unused + within 15-min window, marks as used
    username = hasher.verify_reset_token(token)
    if username is None:
        print(currentTime(), "[RESET] Invalid/expired token attempted")
        error = "This reset link is invalid or has expired."
        return render_template('reset_password.html', token=token, error=error)

    hasher.update_password(username, password)
    print(currentTime(), "[RESET] Password updated for user:", username)
    return redirect(url_for('login'))


@app.route('/logout')
def logout():
    session.pop('username', None)
    return redirect(url_for('login'))

# root route
@app.route('/')
def index():
    if 'username' not in session:
        return redirect(url_for('info'))

    rootHit = session['username']
    print(currentTime(),f'{rootHit} hit /')

    # UI switching
    ui_version = session.get('ui_version', 3)  # default = v3

    # Mobile UI
    if is_mobile():
        if ui_version == 5:
            return render_template('mobile_2.html', username=session['username'])
        elif ui_version == 6:
            return render_template('mobile_3.html', username=session['username'])
        else:
            return render_template('mobile_1.html', username=session['username'])

    if ui_version == 2:
        return render_template('desktop_v2.html', username=session['username'])
    elif ui_version == 5:
        return render_template('desktop_v5.html', username=session['username'])
    elif ui_version == 6:
        return render_template('desktop_v6.html', username=session['username'])

    return render_template('desktop_v3.html', username=session['username'])


# CALENDAR VIEW
# Single responsive template for both desktop + mobile; it just consumes the
# existing /tasks JSON endpoint, so no new backend data plumbing is needed.
@app.route('/calendar')
def calendar():
    if 'username' not in session:
        return redirect(url_for('info'))
    print(currentTime(), f"{session['username']} hit /calendar")
    return render_template('calendar.html', username=session['username'])


# UI SWITCHING
@app.route('/switch/<int:switch_id>', methods=['GET'])
def switch_ui(switch_id):
    if 'username' not in session:
        return redirect(url_for('login'))

    if switch_id in (2, 3, 5, 6):
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


        # color + reminder parsed on frontend, passed alongside tz metadata
        color = task_data.get('color', '#FFFFFF')
        notif_time_offset = task_data.get('notif_time_offset', 0)
        notif_absolute_time = task_data.get('notif_absolute_time')
        reminder_display = task_data.get('reminder_display')

        # api call, response JSON from api call to be passed to tasks module
        apiResponse = api.postRequest(username, task_data)

        new_task = tasks.add_task(username, apiResponse, task_data, color=color,
                                  notif_time_offset=notif_time_offset,
                                  notif_absolute_time=notif_absolute_time,
                                  reminder_display=reminder_display)
        return jsonify(new_task), 201

@app.route('/tasks/<int:task_id>', methods=['PUT'])
def edit_task(task_id):
    if 'username' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    username = session['username']

    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid task data'}), 400

    # direct field edit (no LLM re-extraction): frontend sends resolved fields.
    task_name = (data.get('task_name') or '').strip()
    task_description = (data.get('task_description') or '').strip()
    if not task_name:
        return jsonify({'error': 'Task name is required'}), 400
    if len(task_description) > 200:
        return jsonify({'error': 'Description too long (max 200 characters)'}), 410

    task_time = data.get('task_time')              # "H:MM AM/PM" or null
    due_date = data.get('due_date')                # "DD Mon YYYY" or null
    color = data.get('color', '#FFFFFF')
    tz = data.get('user_tz_metadata', {})
    utc_offset_minutes = tz.get('utc_offset_minutes') if isinstance(tz, dict) else None

    success = tasks.edit_task(username, task_id, task_name, task_time,
                              task_description, due_date, color, utc_offset_minutes)
    if success:
        return jsonify({'message': 'Task updated successfully.'})
    return jsonify({'error': 'Task not found.'}), 404


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

# --- Push Notification Endpoints ---

@app.get('/push/vapid-public-key')
def vapid_public_key():
    if 'username' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    return jsonify({'public_key': VAPID_PUBLIC_KEY})

@app.post('/push/subscribe')
def push_subscribe():
    if 'username' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    username = session['username']
    data = request.get_json()
    if not data or not data.get('endpoint') or not data.get('keys'):
        return jsonify({'error': 'Invalid subscription data'}), 400

    endpoint = data['endpoint']
    p256dh = data['keys'].get('p256dh', '')
    auth = data['keys'].get('auth', '')

    if not p256dh or not auth:
        return jsonify({'error': 'Missing p256dh or auth keys'}), 400

    success = tasks.save_push_subscription(username, endpoint, p256dh, auth)
    if success:
        return jsonify({'ok': True}), 201
    return jsonify({'error': 'Failed to save subscription'}), 500

@app.post('/push/unsubscribe')
def push_unsubscribe():
    if 'username' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    username = session['username']
    data = request.get_json()
    if not data or not data.get('endpoint'):
        return jsonify({'error': 'Missing endpoint'}), 400

    tasks.delete_push_subscription(username, data['endpoint'])
    return jsonify({'ok': True})


@app.errorhandler(404)
def not_found(e):
    bad_path = request.path
    method = request.method
    ip = fetch_real_ip() or request.remote_addr
    print(f"{currentTime()} [404] {ip} {method} {bad_path}")
    return ("Not Found", 404)

@app.errorhandler(405)
def method_not_allowed(e):
    bad_path = request.path
    method = request.method
    ip = fetch_real_ip() or request.remote_addr
    print(f"{currentTime()} [405] {ip} {method} {bad_path}")
    return ("Method Not Allowed", 405)



if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0')
