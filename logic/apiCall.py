# this program constructs user metadata that gets appended to user request to API

from datetime import date,datetime
from openai import OpenAI
import time
from textwrap import dedent
import os
import threading



api_key=os.environ.get('API_KEY')
client = OpenAI(api_key=api_key)


sysPrompt="""You are an information extraction engine.

Instructions:
- Extract ONLY these fields from the user input as a JSON object:

    1. task_name [required]: Task title. Summary from user input.
    2. task_time [optional]: 12-hour format (e.g., "4:32 PM"). If input uses relative phrases (e.g., "in 2 hours"), calculate the specific time using the provided user metadata. "Midnight" ALWAYS resolves to 11:59pm. Else, null.
    3. task_description: Preserve ALL detail and instructions from user input, only removing: color, due date, priority. 
    4. due_date [required]: Always resolve to an absolute date. If input has relative date ("in X hours", "tomorrow"), use the appended metadata (provided below) to calculate. Format: 'DD Mon YYYY' (e.g., "01 Jul 2025").
    5. priority [optional]: Integer 1-4. Default to 4 if not mentioned.
    6. color [required]: Return only hex values. Parse from input for any colors and check against provided hex table below titled "COLOR:HEX". Default/fallback: #FFFFFF.  

- COLOR:HEX
Blue: #87CEEB, 
Red: #f05656, 
Green: #6CE5A9, 
Pink: #E89BEE, 
Orange: #ff7f00, 
Purple: #A96CE5

    
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
        model="gpt-5-mini-2025-08-07",
        instructions="warmup ping to handle cold-start latency, respond with 'warmed up' ",
        input="  ",
        text={ "verbosity": "low" },
        reasoning={ "effort": "minimal" }

    )
    
    warmup_endTime=time.time()
    warmupClock = warmup_endTime - warmup_startTime
    print('\t      api WARMUP: ',warmupClock)

def warmupCall_async():
    t = threading.Thread(target=warmupCall, daemon=True)
    t.start()

# pass to api
def postRequest(userInput: dict) -> str:  
    stringInput = str(userInput["task_description"])     
    start_time=time.time()
    userTzData=userInput.get("user_tz_metadata")
    # DEBUG PRINTS
    # print("\n [DEBUG] USER_TZ_METADATA: ",str(userTzData),'\n')
    response = client.responses.create(

            model="gpt-5-mini-2025-08-07",

            instructions=dedent(sysPrompt),

            input= stringInput + " \n [USER TIMEZONE METADATA] \n" + str(userTzData),

            text={ "verbosity": "low" },
            
            reasoning={ "effort": "minimal" }
            
    )

    end_time=time.time()
    internalClock = end_time-start_time
    print('\t     api RESPONSE: ',internalClock)
    # print('api RESPONSE JSON: ',response.output_text)

    return response.output_text
