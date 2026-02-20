# this program constructs user metadata that gets appended to user request to API
import httpx
from datetime import date,datetime
from openai import OpenAI
import time
from textwrap import dedent
import os
import threading

def currentTime():
    # returns current local time formatted for logs as: [HH:MM:SS AM/PM]
    return f"[{datetime.now().strftime('%a %b %d %Y %I:%M:%S %p')}]"


http_client=httpx.Client(limits=httpx.Limits(max_keepalive_connections=20, keepalive_expiry=140.0)) # 20 second overhead for each warmup attempt

api_key=os.environ.get('API_KEY')
client = OpenAI(api_key=api_key,http_client=http_client)

LOG_PAD = "\t\t"        # to pad logs so they're actually readable lol

sysPrompt="""You are an information extraction engine.

Instructions:
- Extract ONLY these fields from the user input as a pretty JSON object:

    1. task_name [required]: Paraphrase a short task title from user input.
    2. task_time [optional]: 12-hour format without seconds (e.g., "4:32 PM"). If input uses relative phrases (e.g., "in 2 hours"), calculate the specific time using the provided user metadata. "Midnight" ALWAYS resolves to 11:59pm. Else, null.
    3. task_description: Preserve ALL detail and instructions from user input, only removing: color, due date, priority. 
    4. due_date [required]: Always resolve to an absolute date. If input has relative date ("in X hours", "tomorrow"), use the appended metadata (provided below) to calculate. Format: 'DD Mon YYYY' (e.g., "01 Jul 2025").
    5. priority [optional]: Integer 1-4. Default to 4 if not mentioned.
    6. color [required]: Return only hex values. Parse from input for any colors and check against provided hex table below titled "COLOR:HEX". Default/fallback: #FFFFFF.  

- COLOR:HEX
Blue: #87CEEB, 
Dark Blue: #00008B,
Red: #f05656, 
Dark Red: #800020,
Green: #6CE5A9, 
Pink: #F8C8DC, 
Orange: #ff7f00, 
Purple: #A96CE5,
Yellow: #FDDA0D,
Dark Yellow: DAA520


    
- The user's current date/time is appended after "[USER TIMEZONE METADATA]" at the end of the input. Example:
    [USER TIMEZONE METADATA]
    current date: 2025-06-30
    current time: 11:55 PM
    current day: Monday

- Always use this metadata to resolve any relative time/due date.

- Return valid JSON containing ONLY the fields above. 

- Never guess the current time/date, always use the metadata provided."""



def warmupCall():
    warmup_startTime=time.time()
    emptyResponse = client.responses.create(
        model="gpt-4.1-mini-2025-04-14",
        instructions="warmup ping to handle cold-start latency, respond with 'warmed up' ",
        input="  ",
        #text={ "verbosity": "low" },
       # reasoning={ "effort": "minimal" }

    )
    
    warmupClock = time.time() - warmup_startTime
    if warmupClock >= 3:
        print(f"{currentTime()} [PID {os.getpid()}] LATE WARMUP: {warmupClock:.2f}s")
    
def keep_warm_loop():
    while True:
        try:
            print(f"warming PID [{os.getpid()}]")
            warmupCall()
        except Exception as e:
            print(LOG_PAD, "Warmup ping failed:", e)
        
        # Sleep for 120 seconds before pinging again
        time.sleep(120)

# When Gunicorn forks a worker, it imports this file
# This hopefully guarantees exactly ONE background thread is spawned PER WORKER
# Each worker fires warmup call and hopefully all children threads per worker can share the warm socket
warmup_thread = threading.Thread(target=keep_warm_loop, daemon=True)
warmup_thread.start()

# pass to api
def postRequest(userInput: dict) -> str:  
    stringInput = "\n ### [USER INPUT BEGINS] ### \n" + str(userInput["task_description"])     
    start_time=time.time()
    userTzData=userInput.get("user_tz_metadata")
    # DEBUG PRINTS
    # print("\n [DEBUG] USER_TZ_METADATA: ",str(userTzData),'\n')
    response = client.responses.create(

            model="gpt-4.1-mini-2025-04-14",

            instructions=dedent(sysPrompt),

            input= stringInput + " \n [USER TIMEZONE METADATA] \n" + str(userTzData),

            #text={ "verbosity": "low" },
            
           # reasoning={ "effort": "minimal" }
            
    )

    end_time=time.time()
    internalClock = end_time-start_time
    print(LOG_PAD, 'api RESPONSE: ', internalClock)
    # print('api RESPONSE JSON: ',response.output_text)

    return response.output_text
