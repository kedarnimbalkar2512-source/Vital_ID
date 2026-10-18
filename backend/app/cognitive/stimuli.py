"""Test material for the in-app cognitive screens. Generated fresh for every session."""

import secrets

from ..config import get_settings

# Common, concrete, easy-to-picture English nouns in five semantic groups. One word is drawn
# from each group so a list never contains two near-synonyms (similar to standard 5-word recall screens).
WORD_GROUPS = [
    ["apple", "banana", "mango", "orange", "grape", "lemon"],
    ["chair", "table", "bed", "door", "window", "cupboard"],
    ["river", "mountain", "garden", "forest", "beach", "village"],
    ["red", "blue", "green", "yellow", "white", "black"],
    ["dog", "horse", "parrot", "tiger", "cow", "elephant"],
]


def word_recall() -> dict:
    return {"words": [secrets.choice(group) for group in WORD_GROUPS], "study_seconds": 20, "delay_seconds": 60}


def digit_span() -> dict:
    s = get_settings()
    # two sequences per length, 3 .. digit_span_max; no immediate repeats
    trials = []
    for length in range(3, s.digit_span_max + 1):
        for _ in range(2):
            seq: list[str] = []
            while len(seq) < length:
                d = str(secrets.randbelow(10))
                if not seq or seq[-1] != d:
                    seq.append(d)
            trials.append({"length": length, "sequence": "".join(seq)})
    return {"trials": trials, "show_ms_per_digit": 1000}


def orientation(has_city: bool) -> dict:
    questions = [
        {"key": "year", "prompt": "What year is it?"},
        {"key": "month", "prompt": "What month is it?"},
        {"key": "date", "prompt": "What is today's date (day of the month)?"},
        {"key": "day_of_week", "prompt": "What day of the week is it?"},
    ]
    if has_city:
        questions.append({"key": "city", "prompt": "Which city are you in right now?"})
    return {"questions": questions}


def trail() -> dict:
    """Random, non-overlapping positions (percent coordinates) for circles 1..N."""
    n = get_settings().trail_points
    points: list[dict] = []
    while len(points) < n:
        x, y = 8 + secrets.randbelow(85), 8 + secrets.randbelow(85)
        if all((x - p["x"]) ** 2 + (y - p["y"]) ** 2 > 14**2 for p in points):
            points.append({"label": str(len(points) + 1), "x": x, "y": y})
    return {"points": points, "time_allowance_sec": 30}
