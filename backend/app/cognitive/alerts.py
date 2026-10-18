"""Explainable decline rules (brief section 7):
- baseline_drop: baseline = mean of the first 3 tests of a type; alert if the mean of the last 3 is
  at least 20% below it.
- downward_trend: the last 4+ tests of a type never go up and fall by at least 10% overall.
Scores are compared as percentages of each test's maximum."""

from dataclasses import dataclass

from ..config import get_settings


@dataclass
class Finding:
    rule: str
    baseline_pct: float
    recent_pct: float
    drop_pct: float


def evaluate(series_pct: list[float]) -> Finding | None:
    s = get_settings()
    nb, nr = s.cognitive_baseline_tests, s.cognitive_recent_tests
    if len(series_pct) >= nb + nr:
        baseline = sum(series_pct[:nb]) / nb
        recent = sum(series_pct[-nr:]) / nr
        if baseline > 0:
            drop = (baseline - recent) / baseline * 100
            if drop >= s.cognitive_drop_threshold_pct:
                return Finding("baseline_drop", round(baseline, 1), round(recent, 1), round(drop, 1))
    k = s.cognitive_trend_min_tests
    if len(series_pct) >= k:
        window = series_pct[-k:]
        non_increasing = all(b <= a for a, b in zip(window, window[1:]))
        if non_increasing and window[0] > 0:
            drop = (window[0] - window[-1]) / window[0] * 100
            if drop >= s.cognitive_trend_min_drop_pct:
                return Finding("downward_trend", round(window[0], 1), round(window[-1], 1), round(drop, 1))
    return None
