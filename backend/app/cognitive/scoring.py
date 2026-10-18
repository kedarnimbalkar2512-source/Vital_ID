"""Server-side scoring of the cognitive screens. Scores are screening signals, never diagnoses."""

from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from ..config import get_settings

MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def _edit_distance(a: str, b: str) -> int:
    """Optimal string alignment distance: insertions, deletions, substitutions and adjacent swaps."""
    d = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a) + 1):
        d[i][0] = i
    for j in range(len(b) + 1):
        d[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            cost = a[i - 1] != b[j - 1]
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
    return d[-1][-1]


def _same_word(target: str, answer: str) -> bool:
    t, a = target.strip().lower(), answer.strip().lower()
    if not a:
        return False
    if t == a or t.rstrip("s") == a.rstrip("s"):
        return True
    return len(t) >= 4 and _edit_distance(t, a) <= 1  # forgive a single typo on longer words


def score_word_recall(raw: dict) -> tuple[float, float, dict]:
    words = [w for w in raw.get("words", []) if isinstance(w, str)]
    recalled = [r for r in raw.get("recalled", []) if isinstance(r, str)]
    if not words:
        raise HTTPException(422, "word_recall needs `words`")
    matched = []
    for w in words:
        if any(_same_word(w, r) for r in recalled):
            matched.append(w)
    return len(matched), len(words), {"matched": matched}


def score_digit_span(raw: dict) -> tuple[float, float, dict]:
    trials = raw.get("trials", [])
    best = 0
    for t in trials:
        seq, resp = str(t.get("sequence", "")), "".join(ch for ch in str(t.get("response", "")) if ch.isdigit())
        if seq and seq == resp:
            best = max(best, len(seq))
    return best, get_settings().digit_span_max, {"longest_correct": best}


def _month_ok(expected: int, answer: str) -> bool:
    a = answer.strip().lower()
    if a.isdigit():
        return int(a) == expected
    name = MONTHS[expected - 1]
    return len(a) >= 3 and name.startswith(a[:3])


def score_orientation(raw: dict, patient_city: str | None, now: datetime | None = None) -> tuple[float, float, dict]:
    now = now or datetime.now(ZoneInfo(get_settings().app_timezone))
    ans = {k: str(v or "") for k, v in (raw.get("answers") or {}).items()}
    checks = {
        "year": ans.get("year", "").strip() == str(now.year),
        "month": _month_ok(now.month, ans.get("month", "")),
        # accept yesterday/tomorrow for the date, as standard orientation screens do
        "date": ans.get("date", "").strip().isdigit() and abs(int(ans["date"].strip()) - now.day) <= 1,
        "day_of_week": DAYS[now.weekday()].startswith(ans.get("day_of_week", "").strip().lower()[:3] or "#"),
    }
    if patient_city:
        checks["city"] = _same_word(patient_city, ans.get("city", "")) or patient_city.strip().lower() in ans.get("city", "").lower()
    score = sum(1 for ok in checks.values() if ok)
    return score, len(checks), {"checks": checks, "evaluated_at": now.isoformat()}


def score_trail(raw: dict, duration_sec: float | None) -> tuple[float, float, dict]:
    """Trail-making (part A style): tap 1..N in order. One point lost per wrong tap and per
    10 seconds beyond the time allowance."""
    s = get_settings()
    n = int(raw.get("n") or s.trail_points)
    clicks = [str(c) for c in raw.get("clicks", [])]
    expected, errors = 1, 0
    for c in clicks:
        if c == str(expected):
            expected += 1
        else:
            errors += 1
    completed = expected - 1
    allowance = float(raw.get("time_allowance_sec") or 30)
    over = max(0.0, float(duration_sec or 0) - allowance)
    time_penalty = int(over // 10)
    unfinished = n - completed
    score = max(0, n - errors - time_penalty - unfinished)
    return score, n, {"errors": errors, "time_penalty": time_penalty, "completed": completed}


def score(test_type: str, raw: dict, duration_sec: float | None, patient_city: str | None) -> tuple[float, float, dict]:
    if test_type == "word_recall":
        return score_word_recall(raw)
    if test_type == "digit_span":
        return score_digit_span(raw)
    if test_type == "orientation":
        return score_orientation(raw, patient_city)
    if test_type == "trail":
        return score_trail(raw, duration_sec)
    raise HTTPException(422, f"Scoring for {test_type} is not available")
