"""Course code -> course name ("CS 4390" -> "Networks"), looked up by an LLM with web search.

Only the sync worker (logic/ics_sync.py) calls this, never a web request, so a slow search never
holds up a page. Results are cached in the course_names table and shared by every user on the same
Canvas host, so after the first few users at a school this hardly ever runs.

Deliberately does NOT import logic/llm_vendors.py: importing that starts the warmup thread and claims
a gunicorn worker number. The clients here are created on first use, with a long timeout.
"""
import json
import os
import re

try:
    from logic.ics_feed import clean_text
except ImportError:      # run as a script from logic/
    from ics_feed import clean_text

# Which vendor does the searching: "gemini" (Google Search grounding) or "openai" (web_search tool).
VENDOR = os.environ.get("COURSE_NAME_VENDOR", "gemini")
GEMINI_MODEL = os.environ.get("COURSE_NAME_GEMINI_MODEL", "gemini-3-flash-preview")
OPENAI_MODEL = os.environ.get("COURSE_NAME_OPENAI_MODEL", "gpt-5.4-mini")
TIMEOUT = 120.0          # seconds; a search round trip, in the background
MAX_SHORT = 24

# Canvas hosts that aren't <school>.instructure.com, so the model knows where to look
KNOWN_SCHOOLS = {
    "elearning.utdallas.edu": "The University of Texas at Dallas (UT Dallas)",
}

PROMPT = """You find official university course titles. Search the web for EVERY course (the school's
course catalog, class schedule or department pages); never answer from memory alone.

School: {school}
Courses (codes joined with "/" are one cross-listed course):
{lines}

For each course give:
- official_name: the catalog title, e.g. "Introduction to Computer Networks".
- short_name: what a student would call it in a to-do list, at most 20 characters, e.g. "Networks",
  "Algorithms", "Operating Systems", "Prob & Stats".
If a search finds nothing reliable for a course, set both to null rather than guessing.

Reply with ONLY this JSON, one entry per course, "key" copied exactly from the list above:
{{"courses": [{{"key": "...", "official_name": "...", "short_name": "..."}}]}}"""


class LookupFailed(Exception):
    pass


_clients = {}


def _school(host: str) -> str:
    if host in KNOWN_SCHOOLS:
        return KNOWN_SCHOOLS[host]
    return f"the school whose Canvas site is {host}"


def _ask_gemini(prompt: str) -> str:
    from google import genai
    from google.genai import types
    if "gemini" not in _clients:
        _clients["gemini"] = genai.Client(
            api_key=os.environ.get("GEMINI_API_KEY"),
            http_options=types.HttpOptions(timeout=int(TIMEOUT * 1000)),
        )
    response = _clients["gemini"].models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            tools=[types.Tool(google_search=types.GoogleSearch())],
            temperature=0.2,
        ),
    )
    return response.text or ""


def _ask_openai(prompt: str) -> str:
    from openai import OpenAI
    if "openai" not in _clients:
        _clients["openai"] = OpenAI(api_key=os.environ.get("OPENAI_API_KEY") or os.environ.get("API_KEY"),
                                    timeout=TIMEOUT, max_retries=1)
    response = _clients["openai"].responses.create(
        model=OPENAI_MODEL,
        tools=[{"type": "web_search"}],
        input=prompt,
    )
    return response.output_text or ""


def lookup(host: str, keys: list[str], vendor: str | None = None) -> dict:
    """{course_key: (official_name, short_name)} for the keys the model found; keys it couldn't find
    are left out. Raises LookupFailed when the call itself fails or the reply can't be read."""
    if not keys:
        return {}
    prompt = PROMPT.format(school=_school(host), lines="\n".join(f"- {k}" for k in keys))
    vendor = vendor or VENDOR
    try:
        reply = _ask_openai(prompt) if vendor == "openai" else _ask_gemini(prompt)
    except Exception as e:
        raise LookupFailed(f"{vendor}: {type(e).__name__}: {str(e)[:150]}") from e

    match = re.search(r"\{.*\}", reply, re.DOTALL)
    try:
        courses = json.loads(match.group(0))["courses"] if match else None
    except (ValueError, KeyError, TypeError):
        courses = None
    if not isinstance(courses, list):
        raise LookupFailed(f"{vendor}: reply had no readable JSON")

    wanted, found = set(keys), {}
    for c in courses:
        if not isinstance(c, dict) or c.get("key") not in wanted:
            continue
        official = clean_text(c.get("official_name") or "", 200) if isinstance(c.get("official_name"), str) else ""
        short = clean_text(c.get("short_name") or "", MAX_SHORT) if isinstance(c.get("short_name"), str) else ""
        if not short and official:
            short = clean_text(official, MAX_SHORT)
        if short:
            found[c["key"]] = (official or None, short)
    return found


if __name__ == "__main__":
    # manual check:  python logic/course_names.py elearning.utdallas.edu "CS 4349" "CE 4390/CS 4390" [--openai]
    import sys
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    print(json.dumps(lookup(args[0], args[1:], "openai" if "--openai" in sys.argv else None), indent=2))
