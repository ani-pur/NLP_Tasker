
from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from logic import hasher                
from logic import tasks_db as tasks     
from logic import apiCall as api        
import secrets    
import os
from datetime import timedelta


app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY')
app.permanent_session_lifetime = timedelta(hours=2)

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
            print("!! USER FOUND: ",user)
           # api.warmupCall_async()              # [WARMUP]
            return redirect(url_for('index'))
        
        else:
            error = "Invalid password. Please try again."
            # ipAddr=request.remote_addr        # get from header: CF-Connecting-IP; current method will always return cf edge ip     
            # print("!! FAILED LOGIN FROM IP: ",ipAddr)
            print("[!] login attempted")        # will fix all this later i've got exams lol
    return render_template('dual_login.html', error=error)

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
    print(f"Handling request in PID={os.getpid()}")
    if 'username' not in session:
        return redirect(url_for('login'))
    
    rootHit=session['username']
    print(f'{rootHit} hit /')
    api.warmupCall_async() 

    # Automatically choose template based on device type.
    if is_mobile():
        return render_template('mobile_1.html', username=session['username'])
    return render_template('desktop_test.html', username=session['username'])



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
