"""The task color palette: the one place it's defined.

Flask hands it to the default theme's templates (desktop_v6, mobile_3: see the context processor in
main.py and templates/_palette.html), and the Canvas sync gives courses colors from it. Colors are
stored on tasks as "#rrggbb" hex. Any hex works, not just these (the color picker has a custom
option); the palette is the quick picks.
"""
import re

# name -> hex, in the order the swatches show. The first seven are the original palette: their hex values
# must never change, existing tasks are stored with them.
#   typed: the word sets the color when it ends a typed task ("call mom tomorrow, teal") and is stripped
#   from the text. Off for words that turn up in tasks for other reasons ("buy limes", "brown rice").
PALETTE = [
    {"name": "blue",    "hex": "#87CEEB", "typed": True},
    {"name": "red",     "hex": "#f05656", "typed": True},
    {"name": "green",   "hex": "#6CE5A9", "typed": True},
    {"name": "pink",    "hex": "#F8C8DC", "typed": True},
    {"name": "orange",  "hex": "#ff7f00", "typed": True},
    {"name": "purple",  "hex": "#A96CE5", "typed": True},
    {"name": "yellow",  "hex": "#FDDA0D", "typed": True},
    {"name": "teal",    "hex": "#2DD4BF", "typed": True},
    {"name": "navy",    "hex": "#3B82F6", "typed": False},
    {"name": "indigo",  "hex": "#818CF8", "typed": True},
    {"name": "magenta", "hex": "#E879F9", "typed": True},
    {"name": "lime",    "hex": "#A3E635", "typed": False},
    {"name": "brown",   "hex": "#B07D62", "typed": False},
    {"name": "gray",    "hex": "#94A3B8", "typed": False},
]
NO_COLOR = "#FFFFFF"     # "no color": the templates draw it as a soft neutral

# the order Canvas courses get colors in: far-apart hues first, red last (it reads as urgent)
COURSE_ORDER = [c["hex"] for name in ("blue", "green", "purple", "orange", "teal", "pink", "yellow", "indigo",
                                      "magenta", "lime", "navy", "brown", "gray", "red")
                for c in PALETTE if c["name"] == name]

_HEX = re.compile(r"#[0-9a-fA-F]{6}")


def clean_color(value) -> str:
    """A color from the browser, as stored: "#rrggbb", or NO_COLOR for anything else. The templates put
    colors into style attributes, so nothing but a plain hex value gets saved."""
    return value if isinstance(value, str) and _HEX.fullmatch(value) else NO_COLOR
