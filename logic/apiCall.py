# this program constructs user metadata that gets appended to user request to API
import httpx
from datetime import date,datetime
from openai import OpenAI, APITimeoutError
import time
from textwrap import dedent
import os
import threading

def currentTime():
    # returns current local time formatted for logs as: [HH:MM:SS AM/PM]
    return f"[{datetime.now().strftime('%a %b %d %Y %I:%M:%S %p')}]"

# using a custom httpx client cuz apparently a good chunk of the API "warmup" is actually just opening sockets and TLS handshakes (which add more time on top of loading the model) ((DISCLAIMER: according to gpt and gemini lol))
# seems to work, has mostly fixed warmup issues in combination with the keep_warm_loop() implementation [defined below in module]

http_client=httpx.Client(limits=httpx.Limits(max_keepalive_connections=20, keepalive_expiry=140.0)) # keepalive_expiry MUST be greater than keep_warm_loop() SLEEP 

api_key=os.environ.get('API_KEY')
client = OpenAI(api_key=api_key,http_client=http_client)

LOG_PAD = "\t\t"        # to pad logs so they're actually readable lol

sysPrompt="""You are an information extraction engine.

Instructions:
- Extract ONLY these fields from the user input as a pretty JSON object:

    1. task_name [required]: Paraphrase a short task title from user input.
    2. task_time [optional]: 12-hour format without seconds (e.g., "4:32 PM"). If input uses relative phrases (e.g., "in 2 hours"), calculate the specific time using the provided user metadata. "Midnight" ALWAYS resolves to 11:59pm. Else, null.
    3. task_description: Preserve ALL detail and instructions from user input, only removing: due date phrases.
    4. due_date [required]: Always resolve to an absolute date. If input has relative date ("in X hours", "tomorrow"), use the appended metadata (provided below) to calculate. Format: 'DD Mon YYYY' (e.g., "01 Jul 2025").


- The user's current date/time is appended after "[USER TIMEZONE METADATA]" at the end of the input. Example:
    [USER TIMEZONE METADATA]
    current date: 2025-06-30
    current time: 11:55 PM
    current day: Monday

- Always use this metadata to resolve any relative time/due date. **FEBRUARY ONLY HAS 28 DAYS**

- Return valid JSON containing ONLY the fields above. 

- Never guess the current time/date, always use the metadata provided."""


def warmupCall():
    warmup_startTime = time.time()
    try:
        # Pass timeout=5.0 (seconds) directly to the request
        emptyResponse = client.responses.create(
            model="gpt-4.1-mini-2025-04-14",
            instructions="warmup ping to handle cold-start latency, respond with 'warmed up'",
            input=" ",
            timeout=5.0 
        )
        
        warmupClock = time.time() - warmup_startTime
        if warmupClock >= 3:
            print(f"{currentTime()} [PID {os.getpid()}] LATE WARMUP: {warmupClock:.2f}s")
            
    except Exception as e:
        # Other errors (DNS, Auth, Rate Limits)
        print(f"{currentTime()} [PID {os.getpid()}] WARMUP FAILED: {e}")



# way better than firing warmup on every in-session index ('/' route) hit
# Warmup cost math (24/7):
#  120s sleep => 30 calls/hour/worker => 720 calls/day/worker
#  ~30-day month => 21,600 calls/month/worker
#  4 workers => 86,400 warmup calls/month total
#
# Token estimate per call (this prompt):
#  input ≈ 20–30 tokens, output ≈ 2–4 tokens ("warmed up")
#  Monthly tokens @ 86,400 calls:
#  input: 1.728M–2.592M tokens
#  output: 0.173M–0.346M tokens
#
# Pricing used: $0.40 / 1M input tokens, $1.60 / 1M output tokens
# Estimated monthly cost:
# - input: ~$0.69–$1.04
# - output: ~$0.28–$0.55
# - total: ~$0.97–$1.59 (≈ ~$1.3/mo)

def keep_warm_loop():
    while True:
        try:
            warmupCall()
        except Exception as e:
            print(LOG_PAD, "Warmup ping failed:", e)

        # MUST BE LOWER THAN HTTPXCLIENT KEEPALIVE EXPIRY
        time.sleep(120)


# When Gunicorn forks a worker, it imports this file
# Each worker fires warmup call and hopefully all children threads per worker can share the warm socket, unless I am understanding ts horribly wrong 
warmup_thread = threading.Thread(target=keep_warm_loop, daemon=True)
warmup_thread.start()

# pass to api
def postRequest(username: str, userInput: dict) -> str:
    """ username only used for printing logs so i know whos adding tasks (can't see contents of task dw if anyone ends up reading for some reason)"""
    
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
    print(currentTime(), username, 'api RESPONSE: ', internalClock)
    # EARLY STAGES DEBUGGING LOL line kept here incase i needa re-enable quickly again to debug (never on prod tho)
    # print('API RESPONSE CONTENT: ',response.output_text)

    return response.output_text
