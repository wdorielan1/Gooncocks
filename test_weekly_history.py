#!/usr/bin/env python3
"""
Checks Rivalry Watch and New Record Broken with made-up league history -
no Yahoo, no AWS, no internet: how rivalries are ranked, when a record
counts as broken (all-time vs standard scoring), which record gets
featured, the awards page banners and the landing page's next-week pick.
Exits non-zero if anything is wrong.
"""
import json
import sys

import lambda_function
import webpage
import weekly_history as wh
from awards import Matchup

failures = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


MANAGERS = ["ann", "bo", "cy", "di", "ed", "fay"]


def game(season, week, a, sa, b, sb, kind="regular", status="final"):
    return {"id": f"{season}-w{week:02d}-{a}-{b}", "season": season, "week": week, "gameType": kind, "round": None,
            "status": status, "managerA": a, "managerB": b,
            "scoreA": sa if status == "final" else None, "scoreB": sb if status == "final" else None}


def history(games):
    return {"managers": [{"id": m, "name": m.capitalize(), "active": True} for m in MANAGERS], "matchups": games}


# ---------------------------------------------------------------- rivalries
games = []
# ann vs bo: 3-3 (dead even), big margins
for i, (x, y) in enumerate([(120, 80), (80, 120), (130, 90), (90, 130), (140, 100), (100, 140)]):
    games.append(game(2020 + i, 1, "ann", x, "bo", y))
# cy vs di: 3-3 too, but closer games
for i, (x, y) in enumerate([(101, 100), (100, 101), (102, 100), (100, 102), (103, 100), (100, 103)]):
    games.append(game(2020 + i, 2, "cy", x, "di", y))
# ed vs fay: 1-0 (too few meetings), and a consolation game that must not count
games.append(game(2020, 3, "ed", 100, "fay", 99))
games.append(game(2021, 3, "ed", 50, "fay", 150, kind="consolation"))
h = history(games)

ranked = wh.pick_rivalry(h, [("ann", "bo"), ("cy", "di"), ("ed", "fay")])
check("closest rivalry first, tie broken by smaller average margin", [(s["a"], s["b"]) for s in ranked][:2] == [("cy", "di"), ("ann", "bo")],
      [(s["a"], s["b"]) for s in ranked])
check("fewer than 3 meetings goes last", ranked[-1]["a"] == "ed")
check("consolation games don't count", ranked[-1]["meetings"] == 1 and ranked[-1]["wins_a"] == 1, ranked[-1])
s = wh.series(h, "cy", "di")
check("series math", s["wins_a"] == 3 and s["wins_b"] == 3 and s["leader"] is None and abs(s["avg_margin"] - 2) < 1e-9, s)
check("no pairs, no pick", wh.pick_rivalry(h, []) == [])
card = wh.rivalry_card(h, ranked[0], 7)
check("rivalry card", card["a"]["name"] == "Cy" and card["meetings"] == 6 and card["last"]["season"] == 2025 and card["week"] == 7, card)

# ---------------------------------------------------------------- records
rec_games = []
# 2019-2023, typical scoring (~100); 2021 is a high-scoring season (~200)
for season, base in ((2019, 100), (2020, 100), (2021, 200), (2022, 100), (2023, 100)):
    for week in (1, 2):
        rec_games.append(game(season, week, "ann", base + week, "bo", base - 10))
        rec_games.append(game(season, week, "cy", base + 5, "di", base - 20))
# 2024 week 1: ann scores 180, above the standard record (123) but below 2021's all-time (206)
rec_games.append(game(2024, 1, "ann", 180, "bo", 90))
rec_games.append(game(2024, 1, "cy", 100, "di", 95))
h2 = history(rec_games)
check("high-scoring seasons detected", wh.high_seasons(h2) == {2021}, wh.high_seasons(h2))
events = wh.record_events(h2)
hw = [e for e in events if e["record"] == "high-week" and e["season"] == 2024]
check("a record above the standard book but below all-time is a standard record",
      len(hw) == 1 and hw[0]["scope"] == "standard" and hw[0]["value"] == 180, hw)
check("high-scoring seasons never set standard records",
      not any(e["season"] == 2021 and e["scope"] == "standard" for e in events))
check("the first game ever breaks nothing", not any(e["season"] == 2019 and e["week"] == 1 for e in events))
latest = wh.latest_record(h2)
check("latest record is from the latest week that broke one", (latest["season"], latest["week"]) == (2024, 1), latest and latest["season"])
check("biggest break featured, others counted",
      latest["ratio"] == max(e["ratio"] for e in events if (e["season"], e["week"]) == (2024, 1))
      and latest["more"] == len([e for e in events if (e["season"], e["week"]) == (2024, 1)]) - 1, latest)
low = [e for e in events if e["record"] == "low-week"]
check("lowest score is flagged as unwanted", all(e["unwanted"] for e in low))
check("no games, no record", wh.latest_record(history([])) is None)

# ---------------------------------------------------------------- awards page banners
real = history(games + rec_games)
week_games = [Matchup("Team C", 101, "Team D", 100, team_a_manager="Cy", team_b_manager="Di"),
              Matchup("Team A", 120, "Team B", 80, team_a_manager="Ann", team_b_manager="Bo")]
webpage._season = lambda today=None: 2024
html = webpage.render_html(1, week_games, is_sample=False, history=real)
check("both banners render", 'class="bn rw"' in html and 'class="bn nr' in html)
check("rivalry banner picks the closest rivalry this week", "rivalries.html#cy-vs-di" in html)
check("record banner opens a box score", html.count('data-box=') >= len(week_games) + 1)
rec = wh.latest_record(real)
check("record banner links to that record in the Record Room",
      f'records.html#{rec["record"]}?type=both{"&amp;std=1" if rec["scope"] == "standard" else ""}' in html, rec["record"])
plain = webpage.render_html(1, week_games, is_sample=False)
check("no history, page unchanged", 'class="bn-row"' not in plain)
check("demo page has no banners", 'class="bn-row"' not in webpage.render_html(1, week_games, is_sample=True, history=real))
check("a broken history file never breaks the page", 'class="bn-row"' not in
      webpage.render_html(1, week_games, is_sample=False, history={"managers": [], "matchups": [{"bad": 1}]}))
check("art has a fallback background", "rivalry-art.webp) center/cover,linear-gradient" in html)

# ---------------------------------------------------------------- landing page, next week
upcoming = history(games + [game(2025, 9, "ann", None, "bo", None, status="scheduled"),
                            game(2025, 9, "cy", None, "di", None, status="scheduled"),
                            game(2025, 9, "ed", None, "fay", None, kind="consolation", status="scheduled")])
pairs = lambda_function._next_week_pairs(upcoming, 8, None)
check("next week's games come from the history, consolation left out", sorted(pairs) == [("ann", "bo"), ("cy", "di")], pairs)
nxt = lambda_function._next_rivalry(upcoming, 8, None)
check("next week's pick", nxt and nxt["week"] == 9 and nxt["a"]["id"] == "cy", nxt)
check("no next week, banner hidden", lambda_function._next_rivalry(upcoming, 9, None) is None)
check("no history, banner hidden", lambda_function._next_rivalry(None, 8, None) is None)
json.dumps(nxt)  # must be JSON for landing.json
landing = open("landing.html", encoding="utf-8").read()
check("landing page hides the banner until it has a pick", 'id="rivalryWatch" class="rwh-sec" hidden' in landing
      and "renderRivalry(d.next_rivalry)" in landing)

print()
if failures:
    print(f"{len(failures)} check(s) failed: {', '.join(failures)}")
    sys.exit(1)
print("All Rivalry Watch and record checks passed.")
