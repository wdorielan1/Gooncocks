"""
Rivalry Watch and New Record Broken, from the league history file
(rivalry-history.json, built by league_history.py).

Pure functions, no AWS or Yahoo calls:

  pick_rivalry(history, pairs)  - of the given matchups (a week's games),
      the one with the closest all-time rivalry.
  latest_record(history)        - the most recent league record broken,
      with what it broke.

Only final games count, and consolation games never do. Seasons whose
scores ran far above the typical season (2015, 2020) are "high-scoring";
a record is either all-time, or a standard-scoring record that leaves those
seasons out.
"""

MIN_MEETINGS = 3
HIGH_SCORING = 1.25   # a season averaging 25%+ above the typical season


def _finals(history):
    games = [g for g in history.get("matchups", [])
             if g.get("status") == "final" and g.get("gameType") != "consolation"
             and isinstance(g.get("scoreA"), (int, float)) and isinstance(g.get("scoreB"), (int, float))]
    return sorted(games, key=lambda g: (g["season"], g["week"], g["id"]))


def names(history):
    return {m["id"]: m["name"] for m in history.get("managers", [])}


def high_seasons(history):
    """Seasons whose regular-season average score is more than 25% above
    the typical (median) season."""
    scores = {}
    for g in _finals(history):
        if g["gameType"] == "regular":
            scores.setdefault(g["season"], []).extend([g["scoreA"], g["scoreB"]])
    avgs = {s: sum(v) / len(v) for s, v in scores.items() if v}
    if not avgs:
        return set()
    ordered = sorted(avgs.values())
    median = ordered[len(ordered) // 2]
    return {s for s, a in avgs.items() if a > median * HIGH_SCORING}


# ------------------------------------------------------------ rivalries

def series(history, a, b, finals=None):
    """Everything about a and b's all-time head-to-head."""
    games = [g for g in (finals if finals is not None else _finals(history))
             if {g["managerA"], g["managerB"]} == {a, b}]
    out = {"a": a, "b": b, "meetings": len(games), "wins_a": 0, "wins_b": 0, "ties": 0,
           "points_a": 0.0, "points_b": 0.0, "margin_total": 0.0, "playoff_a": 0, "playoff_b": 0,
           "last": None}
    for g in games:
        mine, theirs = (g["scoreA"], g["scoreB"]) if g["managerA"] == a else (g["scoreB"], g["scoreA"])
        out["points_a"] += mine
        out["points_b"] += theirs
        out["margin_total"] += abs(mine - theirs)
        key = "a" if mine > theirs else "b" if theirs > mine else None
        if key:
            out["wins_" + key] += 1
            if g["gameType"] == "playoff":
                out["playoff_" + key] += 1
        else:
            out["ties"] += 1
        out["last"] = g
    n = out["meetings"]
    out["avg_margin"] = out["margin_total"] / n if n else None
    out["pct_a"] = (out["wins_a"] + out["ties"] / 2) / n if n else None
    out["closeness"] = abs(out["pct_a"] - 0.5) if n else None
    out["leader"] = a if out["wins_a"] > out["wins_b"] else b if out["wins_b"] > out["wins_a"] else None
    return out


def pick_rivalry(history, pairs):
    """`pairs` is a week's matchups as (manager id, manager id). Returns
    every pair's series, closest rivalry first: win percentage nearest
    50/50, then the smaller average margin, then the most meetings. Pairs
    that have met fewer than MIN_MEETINGS times go last. Empty when there
    are no pairs."""
    finals = _finals(history)
    ranked = [series(history, a, b, finals) for a, b in pairs if a and b and a != b]

    def key(s):
        if not s["meetings"]:
            return (2, 1, 0, 0)
        return (0 if s["meetings"] >= MIN_MEETINGS else 1, s["closeness"], s["avg_margin"], -s["meetings"])
    return sorted(ranked, key=key)


# ------------------------------------------------------------ records

# (id, name, "max"/"min", candidates(game) -> [(value, holder ids, side id or None)])
def _sides(g):
    return [(g["scoreA"], [g["managerA"]], g["managerA"]), (g["scoreB"], [g["managerB"]], g["managerB"])]


def _winner(g):
    if g["scoreA"] == g["scoreB"]:
        return []
    w = g["managerA"] if g["scoreA"] > g["scoreB"] else g["managerB"]
    return [(round(abs(g["scoreA"] - g["scoreB"]), 2), [w], w)]


RECORDS = [
    ("high-week", "Highest weekly score", "max", _sides),
    ("combined", "Highest combined score", "max",
     lambda g: [(round(g["scoreA"] + g["scoreB"], 2), [g["managerA"], g["managerB"]], None)]),
    ("big-margin", "Biggest winning margin", "max", _winner),
    ("close-win", "Closest victory", "min", _winner),
    ("low-week", "Lowest weekly score", "min", _sides),
]


def record_events(history):
    """Every time a league record fell, oldest first. Each week's best
    candidate is compared with the record as it stood before that week.
    A record is broken on the all-time book, or (when the game is in a
    standard-scoring season) on the standard-scoring book."""
    high = high_seasons(history)
    weeks = {}
    for g in _finals(history):
        weeks.setdefault((g["season"], g["week"]), []).append(g)
    events = []
    for rid, name, direction, candidates in RECORDS:
        better = (lambda x, y: x > y + 1e-9) if direction == "max" else (lambda x, y: x < y - 1e-9)
        books = {"all-time": None, "standard": None}
        for (season, week), games in sorted(weeks.items()):
            cands = [(v, holders, side, g) for g in games for v, holders, side in candidates(g)]
            if not cands:
                continue
            best = cands[0]
            for c in cands[1:]:
                if better(c[0], best[0]):
                    best = c
            value, holders, side, game = best
            standard = season not in high
            scope = None
            for book in ("all-time", "standard"):
                if book == "standard" and not standard:
                    continue
                old = books[book]
                if old is not None and better(value, old["value"]) and scope is None:
                    scope = (book, old)
            if scope:
                book, old = scope
                change = abs(value - old["value"])
                events.append({
                    "record": rid, "name": name, "direction": direction, "scope": book,
                    "value": value, "holders": holders, "side": side, "game": game,
                    "season": season, "week": week,
                    "old": {k: old[k] for k in ("value", "holders", "season", "week")},
                    "change": round(change, 2), "ratio": change / old["value"] if old["value"] else 0,
                    "unwanted": rid == "low-week",
                })
            entry = {"value": value, "holders": holders, "season": season, "week": week}
            if books["all-time"] is None or better(value, books["all-time"]["value"]):
                books["all-time"] = entry
            if standard and (books["standard"] is None or better(value, books["standard"]["value"])):
                books["standard"] = entry
    return sorted(events, key=lambda e: (e["season"], e["week"]))


def latest_record(history):
    """The most recently broken record: the latest week that broke any, and
    of that week's, the biggest break (by how far past the old record it
    went). `more` counts the others that fell the same week. None if no
    record has ever been broken."""
    events = record_events(history)
    if not events:
        return None
    last = (events[-1]["season"], events[-1]["week"])
    same = [e for e in events if (e["season"], e["week"]) == last]
    top = max(same, key=lambda e: e["ratio"])
    return dict(top, more=len(same) - 1, others=[e for e in same if e is not top])


def rivalry_card(history, s, week, game=None):
    """A picked rivalry as plain data for a banner: both managers, the
    all-time series, and (when given) this week's game. Side "a" is the
    left (blue) side."""
    who = names(history)
    last = s["last"]
    card = {
        "week": week,
        "a": {"id": s["a"], "name": who.get(s["a"], s["a"])},
        "b": {"id": s["b"], "name": who.get(s["b"], s["b"])},
        "wins_a": s["wins_a"], "wins_b": s["wins_b"], "ties": s["ties"], "meetings": s["meetings"],
        "avg_margin": round(s["avg_margin"], 2) if s["avg_margin"] is not None else None,
        "playoff_a": s["playoff_a"], "playoff_b": s["playoff_b"],
        "leader": who.get(s["leader"]) if s["leader"] else None,
        "last": None,
    }
    if last:
        a_score, b_score = (last["scoreA"], last["scoreB"]) if last["managerA"] == s["a"] else (last["scoreB"], last["scoreA"])
        card["last"] = {"season": last["season"], "week": last["week"], "score_a": a_score, "score_b": b_score}
    return card
