# this program constructs user metadata that gets appended to user request to API

from datetime import date,datetime
from openai import OpenAI
import time
from textwrap import dedent
import os
import threading


# hardcoded key for testing
#api_key=""
api_key=os.environ.get('API_KEY')
client = OpenAI(api_key=api_key)
# !! REPLACE WITH ENV VARS !!

sysPrompt="""You are an information extraction engine.

Instructions:
- Extract ONLY these fields from the user input as a JSON object:

    1. task_name [required]: Task title. Paraphrase from user input
    2. task_time [optional]: 12-hour format (e.g., "4:32 PM"). If input uses relative phrases (e.g., "in 2 hours"), calculate the specific time using the provided user metadata. "Midnight" ALWAYS resolves to 11:59pm. Else, null.
    3. task_description: preserve ALL detail from user input.
    4. due_date [required]: Always resolve to an absolute date. If input uses relative date/time ("in 5 hours", "tomorrow"), use the appended metadata (see below) to calculate. Format: 'DD Mon YYYY' (e.g., "01 Jul 2025").
    5. priority [optional]: Integer 1-4. Default to 4 if not mentioned. Exams/university assignments = high priority (1).
    6. color [optional]: Return hex value. Default #FFFFFF if not given. Blue: #0000ff, Red: #f05656, Green: #93C47D, Pink: #ffc0cb, Orange: #ff7f00


- The user's current date/time is appended after "[USER TIMEZONE METADATA]" at the end of the input. Example:
    [USER TIMEZONE METADATA]
    current date: 2025-06-30
    current time: 11:55 PM
    current day: Monday

- Always use this metadata to resolve any relative time/due date.

- Return valid JSON containing ONLY the fields above. If a field is not provided or cannot be determined, return null for that field.

- Never guess the current time/date — always use the metadata provided."""

# construct user metadata that is passed to api
def initializeUserTzData():
    todaysDate = str(date.today())
    timeRn = datetime.now()
    strTime = timeRn.strftime(" %I:%M %p ")
    strDay = timeRn.strftime(" %A ")

    metadata = { "todaysDate (yyyy/mm/dd): ":todaysDate,
              "current time: ":strTime,
              "current day: ":strDay }
    
    print(str(metadata))
    return str(metadata)



def warmupCall():
    warmup_startTime=time.time()
    emptyResponse = client.responses.create(
        model="gpt-5-nano-2025-08-07",
        instructions="warmup request to handle cold-start latency, respond with 'warmed up' ",
        input="  ",
        text={ "verbosity": "low" },
        reasoning={ "effort": "minimal" }

    )
    print('api WARMUP RESPONSE: ',emptyResponse.output_text)
    warmup_endTime=time.time()
    warmupClock = warmup_endTime - warmup_startTime
    print('api WARMUP time: ',warmupClock)

def warmupCall_async():
    t = threading.Thread(target=warmupCall, daemon=True)
    t.start()

# pass to api
def postRequest(userInput: dict) -> str:  
    # userInput is dict
    stringInput = str(userInput["task_description"])     
    start_time=time.time()
    userTzData=initializeUserTzData()
    response = client.responses.create(

            model="gpt-5-nano-2025-08-07",

            instructions=dedent(sysPrompt),

            input= stringInput + " \n [USER TIMEZONE METADATA] \n" + userTzData,

            text={ "verbosity": "low" },
            
            reasoning={ "effort": "minimal" }
            
    )

    end_time=time.time()
    internalClock = end_time-start_time
    print('api response time: ',internalClock)
    print('api RESPONSE JSON: ',response.output_text)

    return response.output_text
