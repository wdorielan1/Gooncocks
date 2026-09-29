#!/usr/bin/env python3
"""
Checks the box score pipeline with made-up data - no Yahoo account, no AWS,
no internet: collecting lineups week by week (resuming, rate limits, weeks
Yahoo won't return), the public per-season files, the Lambda's Yahoo
adapter, the page bundling, and the weekly page's clickable games.
Exits non-zero if anything is wrong.
"""
import io
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
box, changed, _ = league_history.fetch_boxscores(yahoo, season_file, None, time.time() + 60, log=lambda *a: None)
check("fetches each finished week once", yahoo.calls == [1, 2], yahoo.calls)
check("marks the season complete", box["complete"] and changed)
again = FakeYahoo()
box2, changed2, _ = league_history.fetch_boxscores(again, season_file, box, time.time() + 60, log=lambda *a: None)
check("a later run asks Yahoo for nothing", again.calls == [] and not changed2, again.calls)

# ---- deadline: stops and resumes
late = FakeYahoo()
part, _, _ = league_history.fetch_boxscores(late, season_file, None, time.time() - 1, log=lambda *a: None)
check("past the deadline nothing is fetched and it isn't complete", late.calls == [] and not part["complete"])

# ---- a week Yahoo refuses is marked, not retried; a rate limit stops the run
bad = FakeYahoo(fail_week=1)
b1, _, _ = league_history.fetch_boxscores(bad, season_file, None, time.time() + 60, log=lambda *a: None)
check("refused week is marked unavailable", "unavailable" in b1["weeks"]["1"] and "teams" in b1["weeks"]["2"])
retry = FakeYahoo()
league_history.fetch_boxscores(retry, season_file, b1, time.time() + 60, log=lambda *a: None)
check("unavailable week isn't asked for again", retry.calls == [], retry.calls)
slow = FakeYahoo(limit_week=1)
b2, _, busy = league_history.fetch_boxscores(slow, season_file, None, time.time() + 60, log=lambda *a: None)
check("rate limit stops the run without marking the week", busy and slow.calls == [1] and "1" not in b2["weeks"] and not b2["complete"],
      (slow.calls, b2["weeks"].keys()))
check("server errors and network trouble count as temporary",
      league_history._temporary(RuntimeError("Yahoo returned HTTP 503: busy")) and league_history._temporary(TimeoutError("timed out"))
      and league_history._temporary(RuntimeError("Yahoo returned HTTP 401: token expired"))
      and not league_history._temporary(RuntimeError("Yahoo returned HTTP 400: bad")) and not league_history._temporary(KeyError("roster")))

# ---- a different league for the year starts over
other = FakeYahoo()
b3, _, _ = league_history.fetch_boxscores(other, dict(season_file, league_key="400.l.2"), box, time.time() + 60, log=lambda *a: None)
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

# ---- once Yahoo is busy, the Lambda stops asking for every other season too
bucket = {}
real_load, real_put = lambda_function._load_json, lambda_function._put
lambda_function._load_json = lambda s3, b, k, d: json.loads(bucket[k]) if k in bucket else d
lambda_function._put = lambda s3, b, k, body, ct: bucket.__setitem__(k, body)
seasons = {y: dict(season_file, league_key="400.l." + y) for y in ("2021", "2022", "2023")}
limited = FakeYahoo(limit_week=1)
pending = lambda_function._refresh_boxscores(None, "b", limited, seasons, {}, "2024", time.time() + 60)
check("a busy Yahoo is asked only once per run", limited.calls == [1] and sorted(pending) == ["2021", "2022", "2023"],
      (limited.calls, pending))
check("public files still written while busy", all("boxscores/%s.json" % y in bucket for y in seasons))
lambda_function._load_json, lambda_function._put = real_load, real_put

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

# ---------- Trade Lab's in-progress week
check("live week: Yahoo's current week once it has started",
      league_history.live_week_number(4, [{"status": "midevent"}, {"status": "preevent"}]) == 4)
check("live week: the week before once Yahoo has moved on to an unplayed week",
      league_history.live_week_number(5, [{"status": "preevent"}, {"status": "preevent"}]) == 4
      and league_history.live_week_number(1, [{"status": "preevent"}]) == 1)
rosters = {"t.1": [
    {"player_key": "p1", "name": "Jalen Hurts", "slot": "QB", "position": "QB", "nfl_team": "PHI", "editable": 0},
    {"player_key": "p2", "name": "Monday Guy", "slot": "WR", "position": "WR", "nfl_team": "KC", "editable": 1},
    {"player_key": "p3", "name": "Zero Kicker", "slot": "K", "position": "K", "nfl_team": "DAL", "editable": "0"},
    {"player_key": "p4", "name": "Unknown Played", "slot": "BN", "position": "RB", "nfl_team": "NYJ"},
    {"player_key": "p5", "name": "Unknown Not Yet", "slot": "BN", "position": "TE", "nfl_team": "SF"},
]}
live = league_history.live_week("2026", 4, rosters, {"p1": 24.5, "p2": 0.0, "p3": 0.0, "p4": 7.2, "p5": 0.0}, 1790000000.9)
check("live week file: season, week, time and each lineup with who has played",
      live == {"season": 2026, "week": 4, "updated": 1790000000, "teams": {"t.1": [
          ["QB", "Jalen Hurts", "QB", "PHI", 24.5, 1],
          ["WR", "Monday Guy", "WR", "KC", 0.0, 0],        # game hasn't started: left out, not a zero
          ["K", "Zero Kicker", "K", "DAL", 0.0, 1],        # played and scored zero: counts
          ["BN", "Unknown Played", "RB", "NYJ", 7.2, 1],   # Yahoo didn't say: points mean he played
          ["BN", "Unknown Not Yet", "TE", "SF", 0.0, 0]]}}, live)
check("live week: a player with no points from Yahoo never counts",
      league_history.live_week(2026, 4, {"t": [{"player_key": "x", "editable": 0}]}, {}, 0)["teams"]["t"][0][5] == 0)

# the Lambda action, end to end with a fake Yahoo and S3
saved_fns = {n: getattr(lambda_function, n) for n in
             ("get_scoreboard", "parse_matchups", "scoreboard_week", "get_team_roster", "get_player_points",
              "_get_access_token", "_rivalry_store", "_put")}
put_calls = []
try:
    lambda_function.get_scoreboard = lambda token, lk, week=None: {"sb": True}
    lambda_function.parse_matchups = lambda sb: [{"status": "midevent", "team_a": {"team_key": "t.1"}, "team_b": {"team_key": "t.2"}}]
    lambda_function.scoreboard_week = lambda sb: 4
    lambda_function.get_team_roster = lambda token, k, week: [{"player_key": k + ".p", "name": k, "slot": "QB", "position": "QB",
                                                               "nfl_team": "X", "editable": 0 if k == "t.1" else 1}]
    lambda_function.get_player_points = lambda token, lk, keys, week: {k: 10.0 for k in keys}
    lambda_function._get_access_token = lambda: "tok"
    lambda_function._rivalry_store = lambda s3, bucket: type("S", (), {"load": lambda self, k, d: {"current_season": "2026"}})()
    lambda_function._put = lambda s3, bucket, key, body, ctype: put_calls.append((key, json.loads(body)))
    import os
    os.environ.setdefault("S3_BUCKET", "test-bucket")
    os.environ.setdefault("LEAGUE_KEY", "470.l.1")
    out = lambda_function.lambda_handler({"action": "trade_lab_live"}, None)
finally:
    for n, f in saved_fns.items():
        setattr(lambda_function, n, f)
check("trade_lab_live saves boxscores/live.json with who has played",
      out == {"season": 2026, "week": 4, "players_played": 1} and len(put_calls) == 1
      and put_calls[0][0] == "boxscores/live.json" and put_calls[0][1]["teams"]["t.2"][0][5] == 0, (out, put_calls))

# ---------- championships from seasons Yahoo doesn't have
walls = lambda_function._with_extra_champions([
    {"season": "2025", "champion": "Sam", "champion_team": "T", "runner_up": "Gabe", "runner_up_team": "U"}])
check("the Champion Wall gets 2013 (Tamir, runner-up Patrick), newest first",
      [c["season"] for c in walls] == ["2025", "2013"] and walls[1]["champion"] == "Tamir" and walls[1]["runner_up"] == "Patrick", walls)
check("Yahoo's record wins if it has the season",
      lambda_function._with_extra_champions([{"season": "2013", "champion": "Gabe"}]) == [{"season": "2013", "champion": "Gabe"}])
hist = lambda_function._add_extra_standings({"managers": [{"id": "tamir", "name": "Tamir"}, {"id": "patrick", "name": "Patrick"}],
                                             "standings": {"2025": {"finished": True, "teams": 10, "ranks": {"sam": 1}}}})
check("the history file's standings get 2013 for the Record Room and Career Center",
      hist["standings"]["2013"] == {"finished": True, "teams": None, "ranks": {"tamir": 1, "patrick": 2}, "source": "commissioner"}
      and hist["standings"]["2025"]["ranks"] == {"sam": 1}, hist)
kept = lambda_function._add_extra_standings({"managers": [{"id": "tamir", "name": "Tamir"}],
                                             "standings": {"2013": {"finished": True, "ranks": {"gabe": 1}}}})
check("...but never over Yahoo's own standings for that season", kept["standings"]["2013"]["ranks"] == {"gabe": 1})

# ---------- the league's scoring rules from Yahoo's settings
import yahoo_client
settings = {"fantasy_content": {"league": [{"league_key": "470.l.1"}, {"settings": [{
    "stat_categories": {"stats": [{"stat": {"stat_id": 4, "name": "Passing Yards", "display_name": "Pass Yds", "position_type": "O"}},
                                  {"stat": {"stat_id": 11, "name": "Receptions", "display_name": "Rec", "position_type": "O"}}]},
    "stat_modifiers": {"stats": [{"stat": {"stat_id": 11, "value": "0.5"}},
                                 {"stat": {"stat_id": 4, "value": "0.04", "bonuses": [{"bonus": {"target": "300", "points": "3"}}]}}]}}]}]}}
check("scoring rules: every scored stat with its name, points and bonuses",
      yahoo_client.parse_scoring(settings) == [
          {"stat_id": 4, "name": "Passing Yards", "display": "Pass Yds", "position_type": "O", "points": 0.04,
           "bonuses": [{"target": 300.0, "points": 3.0}]},
          {"stat_id": 11, "name": "Receptions", "display": "Rec", "position_type": "O", "points": 0.5, "bonuses": []}],
      yahoo_client.parse_scoring(settings))

# ---------- nflverse stats scored in league scoring, and points against
import nfl_points
R = [{"stat_id": sid, "position_type": pt, "points": pts, "name": n, "bonuses": [{"target": t, "points": b} for t, b in bon]}
     for sid, pt, pts, n, bon in [
         (2, "O", 0.5, "Comp", []), (4, "O", 0.04, "Pass Yds", [(300, 5), (400, 5)]), (5, "O", 4, "Pass TD", []),
         (6, "O", -1, "Int", []), (9, "O", 0.1, "Rush Yds", [(100, 5)]), (10, "O", 6, "Rush TD", []), (11, "O", 1, "Rec", []),
         (12, "O", 0.1, "Rec Yds", []), (13, "O", 6, "Rec TD", []), (18, "O", -2, "Fum Lost", []), (23, "K", 6, "FG 50+", []),
         (29, "K", 1, "PAT", []), (32, "DT", 1, "Sack", []), (33, "DT", 2, "Int", []), (53, "DT", 6, "PA 14-20", []),
         (54, "DT", 4, "PA 21-27", []), (67, "DT", 1, "4 Dwn Stops", [])]]
PCSV = ("player_id,player_display_name,position,season,week,season_type,team,opponent_team,completions,attempts,passing_yards,"
        "passing_tds,passing_interceptions,rushing_yards,rushing_tds,receptions,receiving_yards,receiving_tds,"
        "rushing_fumbles_lost,fg_made_50_59,fg_made_60_,pat_made\n"
        "q1,Josh Allen,QB,2025,1,REG,BUF,BAL,33,46,394,2,0,30,2,0,0,0,0,0,0,0\n"
        "r1,Kenneth Walker III,RB,2025,1,REG,SEA,SF,0,0,0,0,0,104,0,3,20,0,1,0,0,0\n"
        "k1,Brandon Aubrey,K,2025,1,REG,DAL,PHI,0,0,0,0,0,0,0,0,0,0,0,1,1,2\n"
        "q1,Josh Allen,QB,2025,1,POST,BUF,BAL,99,99,999,9,0,0,0,0,0,0,0,0,0,0\n")
TCSV = ("team,season,week,season_type,opponent_team,def_sacks,def_interceptions,def_tds,fumble_recovery_opp,fumble_recovery_tds\n"
        "BAL,2025,1,REG,BUF,3,1,0,0,0\nBUF,2025,1,REG,BAL,2,0,0,1,1\n")
GCSV = "season,game_type,week,away_team,away_score,home_team,home_score\n2025,REG,1,BAL,24,BUF,17\n2025,REG,1,SF,17,LA,14\n"
pts = nfl_points.season_points(2025, R, PCSV, TCSV, GCSV)
by = {p["name"]: p for p in pts["players"]}
check("nflverse: a QB week in league scoring, with the 300-yard bonus (Josh Allen, 60.26)", by["Josh Allen"]["weeks"][1] == [60.26, "BAL"], by["Josh Allen"])
check("nflverse: RB with rushing bonus, catches and a lost fumble", by["Kenneth Walker III"]["weeks"][1] == [10.4 + 5 + 3 + 2 - 2, "SF"], by["Kenneth Walker III"])
check("nflverse: kickers - 50-59 and 60+ both count as 50+", by["Brandon Aubrey"]["weeks"][1] == [14.0, "PHI"])
check("nflverse: playoff games are left out", len(by["Josh Allen"]["weeks"]) == 1)
check("nflverse: defenses score sacks, INTs and points allowed from the final score",
      pts["defenses"]["BAL"][1] == [3 + 2 + 6, "BUF"], pts["defenses"])
R.append({"stat_id": 35, "position_type": "DT", "points": 6, "name": "TD", "bonuses": []})
check("nflverse: a fumble returned for a TD counts as a defensive TD",
      nfl_points.season_points(2025, R, PCSV, TCSV, GCSV)["defenses"]["BUF"][1] == [2 + 4 + 6, "BAL"])
R.pop()
check("nflverse: every one of the league's stats is covered", nfl_points.unsupported(R) == []
      and nfl_points.unsupported([{"stat_id": 999, "position_type": "O", "points": 1, "name": "Odd stat", "bonuses": []}]) == [(999, "Odd stat")])
PBP = io.StringIO("season_type,week,defteam,fourth_down_failed\nREG,1,BAL,1\nREG,1,BAL,0\nREG,1,LA,1\nREG,1,BAL,1\nPOST,1,BAL,1\n")
stops = nfl_points.fourth_down_stops(PBP)
check("nflverse: 4th down stops from play-by-play", stops == {("BAL", 1): 2, ("LAR", 1): 1}, stops)
check("nflverse: stops score for the defense that made them",
      nfl_points.season_points(2025, R, PCSV, TCSV, GCSV, stops)["defenses"]["BAL"][1] == [3 + 2 + 6 + 2, "BUF"])
check("nflverse: team codes match Yahoo's (LA -> LAR)", nfl_points.team_code("LA") == "LAR" and nfl_points.team_code("buf") == "BUF")
pa = nfl_points.points_against(pts)
check("points against: points each defense gave up, by position", pa["BAL"]["QB"] == 60.26 and pa["SF"]["RB"] == 18.4
      and pa["BUF"]["DEF"] == 11.0 and pa["BAL"]["games"] == 1 and pa["BAL"]["weeks"][1]["QB"] == 60.26, pa)
box = {"weeks": {"1": {"teams": {"t.1": [["QB", "Josh Allen", "QB", "BUF", 60.26], ["RB", "Kenneth Walker III", "RB", "SEA", 17.0],
                                         ["DEF", "Baltimore", "DEF", "BAL", 11.0], ["BN", "Nobody Known", "WR", "NYJ", 5.0]]}}}}
ck = nfl_points.check(pts, box)
check("check vs Yahoo: exact matches, misses and players not found",
      ck["by_position"]["QB"]["exact"] == 1 and ck["by_position"]["DEF"]["exact"] == 1
      and ck["by_position"]["RB"]["exact"] == 0 and ck["biggest_misses"][0]["diff"] == 1.4
      and ck["by_position"]["WR"]["not_found"] == 1, ck)
check("names match across sources (suffixes and punctuation)", nfl_points.name_key("Kenneth Walker III") == nfl_points.name_key("Kenneth Walker")
      and nfl_points.name_key("D.J. Moore") == nfl_points.name_key("DJ Moore") and nfl_points.name_key("Ja'Marr Chase") == "jamarr chase")

print()
if failures:
    print(f"{len(failures)} check(s) failed: {', '.join(failures)}")
    sys.exit(1)
print("All box score checks passed.")
