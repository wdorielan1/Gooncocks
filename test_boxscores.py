#!/usr/bin/env python3
"""
Checks the box score pipeline with made-up data - no Yahoo account, no AWS,
no internet: collecting lineups week by week (resuming, rate limits, weeks
Yahoo won't return), the public per-season files, the Lambda's Yahoo
adapter, the page bundling, and the weekly page's clickable games.
Exits non-zero if anything is wrong.
"""
import json
import sys
import time

import league_history
import lambda_function
import webpage
from awards import Matchup

failures = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def team(key, name, score, known):
    return {"team_key": key, "name": name, "manager": known.lower(), "manager_guid": None, "known": known, "score": score}


def game(week, a, b, status="postevent", playoffs=False):
    return {"team_a": a, "team_b": b, "status": status, "week": week, "is_playoffs": playoffs, "is_consolation": False}


A, B, C, D = ("t.1", "Aces", "Sam"), ("t.2", "Bolts", "Will"), ("t.3", "Crows", "Gabe"), ("t.4", "Dogs", "Chris")
season_file = {
    "league_key": "400.l.1", "complete": True, "is_finished": True,
    "weeks": {
        "1": [game(1, team(*A[:2], 120.5, A[2]), team(*B[:2], 99.0, B[2])), game(1, team(*C[:2], 101.0, C[2]), team(*D[:2], 88.0, D[2]))],
        "2": [game(2, team(*B[:2], 110.0, B[2]), team(*C[:2], 111.0, C[2])), game(2, team(*D[:2], 90.0, D[2]), team(*A[:2], 95.5, A[2]))],
        "3": [game(3, team(*A[:2], 0, A[2]), team(*C[:2], 0, C[2]), status="preevent")],
    },
}


class FakeYahoo:
    def __init__(self, fail_week=None, limit_week=None):
        self.calls, self.fail_week, self.limit_week = [], fail_week, limit_week

    def box_week(self, league_key, week, keys):
        self.calls.append(week)
        if week == self.fail_week:
            raise RuntimeError("HTTP 400: roster not available")
        if week == self.limit_week:
            raise RuntimeError("HTTP 999: Request denied")
        return {k: [["QB", "Player " + k, "QB", "KC", 20.0], ["BN", "Bench " + k, "RB", "SF", 3.5]] for k in keys}


# ---- box_weeks: only weeks where every game is final
check("only finished weeks are collected", sorted(league_history.box_weeks(season_file)) == ["1", "2"],
      sorted(league_history.box_weeks(season_file)))

# ---- a full run
yahoo = FakeYahoo()
box, changed = league_history.fetch_boxscores(yahoo, season_file, None, time.time() + 60, log=lambda *a: None)
check("fetches each finished week once", yahoo.calls == [1, 2], yahoo.calls)
check("marks the season complete", box["complete"] and changed)
again = FakeYahoo()
box2, changed2 = league_history.fetch_boxscores(again, season_file, box, time.time() + 60, log=lambda *a: None)
check("a later run asks Yahoo for nothing", again.calls == [] and not changed2, again.calls)

# ---- deadline: stops and resumes
late = FakeYahoo()
part, _ = league_history.fetch_boxscores(late, season_file, None, time.time() - 1, log=lambda *a: None)
check("past the deadline nothing is fetched and it isn't complete", late.calls == [] and not part["complete"])

# ---- a week Yahoo refuses is marked, not retried; a rate limit stops the run
bad = FakeYahoo(fail_week=1)
b1, _ = league_history.fetch_boxscores(bad, season_file, None, time.time() + 60, log=lambda *a: None)
check("refused week is marked unavailable", "unavailable" in b1["weeks"]["1"] and "teams" in b1["weeks"]["2"])
retry = FakeYahoo()
league_history.fetch_boxscores(retry, season_file, b1, time.time() + 60, log=lambda *a: None)
check("unavailable week isn't asked for again", retry.calls == [], retry.calls)
slow = FakeYahoo(limit_week=1)
b2, _ = league_history.fetch_boxscores(slow, season_file, None, time.time() + 60, log=lambda *a: None)
check("rate limit stops the run without marking the week", slow.calls == [1] and "1" not in b2["weeks"] and not b2["complete"],
      (slow.calls, b2["weeks"].keys()))
check("server errors and network trouble count as temporary",
      league_history._temporary(RuntimeError("Yahoo returned HTTP 503: busy")) and league_history._temporary(TimeoutError("timed out"))
      and league_history._temporary(RuntimeError("Yahoo returned HTTP 401: token expired"))
      and not league_history._temporary(RuntimeError("Yahoo returned HTTP 400: bad")) and not league_history._temporary(KeyError("roster")))

# ---- a different league for the year starts over
other = FakeYahoo()
b3, _ = league_history.fetch_boxscores(other, dict(season_file, league_key="400.l.2"), box, time.time() + 60, log=lambda *a: None)
check("saved file from another league is ignored", other.calls == [1, 2] and b3["league_key"] == "400.l.2")

# ---- public file keyed by the history's game ids, "a" = managerA
keys = {}
history = league_history.build_history({"2024": season_file}, "2024", lambda t: t.get("known"), game_keys=keys)
pub = league_history.public_boxscores("2024", box, keys)
final_ids = [m["id"] for m in history["matchups"] if m["status"] == "final"]
check("every final game has a box score", sorted(pub["games"]) == sorted(final_ids), (sorted(pub["games"]), final_ids))
g = next(m for m in history["matchups"] if m["id"] in pub["games"] and m["week"] == 2 and m["managerA"] == "will")
check("side a is managerA's lineup", pub["games"][g["id"]]["a"][0][1] == "Player t.2", pub["games"][g["id"]]["a"])
check("scheduled games have none", all(m["id"] not in pub["games"] for m in history["matchups"] if m["status"] != "final"))
check("public file is small", len(json.dumps(pub)) < 2000, len(json.dumps(pub)))

# ---- the Lambda's Yahoo adapter
lambda_function.get_team_roster = lambda token, key, week: [
    {"player_key": key + ".p1", "name": "Star " + key, "slot": "WR", "position": "WR", "nfl_team": "MIN"},
    {"player_key": key + ".p2", "name": "Sub " + key, "slot": "BN", "position": "TE", "nfl_team": "KC"},
]
asked = []
def fake_points(token, league_key, player_keys, week):
    asked.append(len(player_keys))
    return {k: 10.0 + i for i, k in enumerate(player_keys)}
lambda_function.get_player_points = fake_points
week = lambda_function._YahooHistory("tok").box_week("400.l.1", 3, ["t.%d" % i for i in range(1, 16)])
check("adapter returns every team", sorted(week) == sorted("t.%d" % i for i in range(1, 16)))
check("adapter row shape", week["t.1"][0][:4] == ["WR", "Star t.1", "WR", "MIN"] and isinstance(week["t.1"][0][4], float), week["t.1"][0])
check("points asked for 25 players at a time", sorted(asked) == [5, 25], asked)

# ---- page bundling: the Record Room ships as one file with the pop-up inside
page = lambda_function._record_page_html()
check("records.html has everything inlined",
      'src="js/' not in page and 'src="../shared/' not in page and "window.BoxScore" in page and "data:image/webp;base64" in page)
check("records.html reads the live history", "GOONCOCKS_HISTORY_URL = '/rivalry-history.json'" in page and "GOONCOCKS_HISTORY = {" not in page)
for name, build in (("rivalries.html", lambda_function._rivalry_page_html), ("careers.html", lambda_function._career_page_html)):
    check(name + " has the box score pop-up", "window.BoxScore" in build())

# ---- the weekly page: real games are clickable, the demo isn't
real = [Matchup("Aces", 120.5, "Bolts", 99.0, team_a_manager="Sam", team_b_manager="Will"),
        Matchup("Crows", 101.0, "Dogs", 88.0, team_a_manager="Gabe", team_b_manager="Chris")]
html = webpage.render_html(4, real, is_sample=False)
check("weekly games carry box score data", html.count('class="game" data-box=') == 2 and "&quot;id&quot;: &quot;sam&quot;" in html)
check("weekly page includes the pop-up", "window.BoxScore" in html and "Records</a>" in html)
demo = webpage.render_html(4, real, is_sample=True)
check("demo page has no box scores", "data-box=" not in demo)

print()
if failures:
    print(f"{len(failures)} check(s) failed: {', '.join(failures)}")
    sys.exit(1)
print("All box score checks passed.")
