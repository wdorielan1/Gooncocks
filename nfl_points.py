"""
Fantasy points in the league's own scoring for every NFL player and team
defense, from nflverse's free public stats (github.com/nflverse), and the
"points against" table built from them: how many points each NFL defense
gives up to each position.

The scoring rules come from Yahoo (yahoo_client.get_league_scoring), so
this module only knows how to read each Yahoo stat out of nflverse's
columns (4th down stops come from its play-by-play file). Stats nflverse
doesn't have are listed in `unsupported` and score 0, and check() compares
the result with Yahoo's own weekly points for players on league rosters,
so any gap shows up.
"""
import csv
import gzip
import io
import re
import urllib.request

BASE = "https://github.com/nflverse/nflverse-data/releases/download"
PLAYER_URL = BASE + "/stats_player/stats_player_week_{season}.csv"
TEAM_URL = BASE + "/stats_team/stats_team_week_{season}.csv"
GAMES_URL = BASE + "/schedules/games.csv"
PBP_URL = BASE + "/pbp/play_by_play_{season}.csv.gz"
POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"]

# nflverse team codes that differ from Yahoo's.
TEAM_CODES = {"LA": "LAR", "WSH": "WAS"}


def _num(row, *cols):
    total = 0.0
    for c in cols:
        try:
            total += float(row.get(c) or 0)
        except ValueError:
            pass
    return total


# Yahoo stat id -> the value of that stat in an nflverse player-week row.
PLAYER_STATS = {
    2: lambda r: _num(r, "completions"),
    3: lambda r: _num(r, "attempts") - _num(r, "completions"),  # incomplete passes
    4: lambda r: _num(r, "passing_yards"),
    5: lambda r: _num(r, "passing_tds"),
    6: lambda r: _num(r, "passing_interceptions"),
    7: lambda r: _num(r, "sacks_suffered"),
    8: lambda r: _num(r, "carries"),
    9: lambda r: _num(r, "rushing_yards"),
    10: lambda r: _num(r, "rushing_tds"),
    11: lambda r: _num(r, "receptions"),
    12: lambda r: _num(r, "receiving_yards"),
    13: lambda r: _num(r, "receiving_tds"),
    14: lambda r: _num(r, "punt_return_yards", "kickoff_return_yards"),
    15: lambda r: _num(r, "special_teams_tds"),
    16: lambda r: _num(r, "passing_2pt_conversions", "rushing_2pt_conversions", "receiving_2pt_conversions"),
    17: lambda r: _num(r, "sack_fumbles", "rushing_fumbles", "receiving_fumbles"),
    18: lambda r: _num(r, "sack_fumbles_lost", "rushing_fumbles_lost", "receiving_fumbles_lost"),
    19: lambda r: _num(r, "fg_made_0_19"),
    20: lambda r: _num(r, "fg_made_20_29"),
    21: lambda r: _num(r, "fg_made_30_39"),
    22: lambda r: _num(r, "fg_made_40_49"),
    23: lambda r: _num(r, "fg_made_50_59", "fg_made_60_"),
    24: lambda r: _num(r, "fg_missed_0_19"),
    25: lambda r: _num(r, "fg_missed_20_29"),
    26: lambda r: _num(r, "fg_missed_30_39"),
    27: lambda r: _num(r, "fg_missed_40_49"),
    28: lambda r: _num(r, "fg_missed_50_59", "fg_missed_60_"),
    29: lambda r: _num(r, "pat_made"),
    30: lambda r: _num(r, "pat_missed"),
    57: lambda r: _num(r, "fumble_recovery_tds"),
    78: lambda r: _num(r, "targets"),
}

# Yahoo stat id -> the value for a team defense, from nflverse's team-week
# row plus the points its opponent scored.
DEF_STATS = {
    32: lambda r, pa: _num(r, "def_sacks"),
    33: lambda r, pa: _num(r, "def_interceptions"),
    34: lambda r, pa: _num(r, "fumble_recovery_opp"),
    # Defensive TDs, plus fumble-return TDs after taking the ball away
    # (nflverse counts those separately from def_tds).
    35: lambda r, pa: _num(r, "def_tds") + min(_num(r, "fumble_recovery_tds"), _num(r, "fumble_recovery_opp")),
    36: lambda r, pa: _num(r, "def_safeties"),
    37: lambda r, pa: _num(r, "def_punt_blocks", "def_fg_blocks", "def_pat_blocks"),
    48: lambda r, pa: _num(r, "punt_return_yards", "kickoff_return_yards"),
    49: lambda r, pa: _num(r, "special_teams_tds"),
    50: lambda r, pa: 1.0 if pa == 0 else 0.0,
    51: lambda r, pa: 1.0 if 1 <= pa <= 6 else 0.0,
    52: lambda r, pa: 1.0 if 7 <= pa <= 13 else 0.0,
    53: lambda r, pa: 1.0 if 14 <= pa <= 20 else 0.0,
    54: lambda r, pa: 1.0 if 21 <= pa <= 27 else 0.0,
    55: lambda r, pa: 1.0 if 28 <= pa <= 34 else 0.0,
    56: lambda r, pa: 1.0 if pa >= 35 else 0.0,
    67: lambda r, pa: _num(r, "_fourth_down_stops"),  # from play-by-play, added by season_points
    68: lambda r, pa: _num(r, "def_tackles_for_loss"),
    82: lambda r, pa: _num(r, "def_2pt_made"),
}


def unsupported(rules):
    """The scored stats nflverse can't provide: [(stat_id, name)]."""
    out = []
    for r in rules:
        table = DEF_STATS if r["position_type"] == "DT" else PLAYER_STATS
        if r["stat_id"] not in table and r["points"]:
            out.append((r["stat_id"], r["name"]))
    return out


def _score(value, rule):
    pts = value * rule["points"]
    for b in rule["bonuses"]:
        if value >= b["target"]:
            pts += b["points"]
    return pts


def player_points(row, rules):
    return round(sum(_score(PLAYER_STATS[r["stat_id"]](row), r) for r in rules
                     if r["position_type"] in ("O", "K") and r["stat_id"] in PLAYER_STATS), 2)


def def_points(row, points_allowed, rules):
    return round(sum(_score(DEF_STATS[r["stat_id"]](row, points_allowed), r) for r in rules
                     if r["position_type"] == "DT" and r["stat_id"] in DEF_STATS), 2)


def team_code(code):
    code = (code or "").upper()
    return TEAM_CODES.get(code, code)


def _csv(text):
    return csv.DictReader(io.StringIO(text))


def fetch(url, opener=urllib.request.urlopen):
    req = urllib.request.Request(url, headers={"User-Agent": "GooncocksFantasy/1.0"})
    with opener(req, timeout=60) as resp:
        return resp.read().decode("utf-8")


def fourth_down_stops(lines):
    """{(defense team, week): 4th down stops} from nflverse play-by-play
    CSV lines (read as a stream - the full-season file is large)."""
    stops = {}
    for row in csv.DictReader(lines):
        if row.get("season_type") in ("REG", None, "") and row.get("fourth_down_failed") == "1" and row.get("defteam"):
            key = (team_code(row["defteam"]), int(row["week"]))
            stops[key] = stops.get(key, 0) + 1
    return stops


def fetch_fourth_down_stops(season, opener=urllib.request.urlopen):
    req = urllib.request.Request(PBP_URL.format(season=season), headers={"User-Agent": "GooncocksFantasy/1.0"})
    with opener(req, timeout=120) as resp:
        with gzip.open(resp, "rt", encoding="utf-8", newline="") as lines:
            return fourth_down_stops(lines)


def season_points(season, rules, player_csv, team_csv, games_csv, stops=None):
    """Every player's and defense's regular-season weekly points (stops:
    fourth_down_stops' result, for leagues that score them):
    {"players": [{"id", "name", "position", "team", "weeks": {week: [pts, opp]}}],
     "defenses": {team: {week: [pts, opp]}}}."""
    allowed = {}  # (team, week) -> points its opponent scored
    for g in _csv(games_csv):
        if g.get("season") != str(season) or g.get("game_type") not in ("REG", None, "") or not g.get("home_score"):
            continue
        wk, home, away = int(g["week"]), team_code(g["home_team"]), team_code(g["away_team"])
        allowed[(home, wk)] = int(float(g["away_score"]))
        allowed[(away, wk)] = int(float(g["home_score"]))
    players = {}
    for r in _csv(player_csv):
        if r.get("season_type") not in ("REG", None, "") or r.get("position") not in POSITIONS[:5]:
            continue
        p = players.setdefault(r["player_id"], {"id": r["player_id"], "name": r.get("player_display_name") or r.get("player_name"),
                                                "position": r["position"], "team": team_code(r["team"]), "weeks": {}})
        p["team"] = team_code(r["team"])  # the latest team he played for
        p["weeks"][int(r["week"])] = [player_points(r, rules), team_code(r.get("opponent_team"))]
    defenses = {}
    for r in _csv(team_csv):
        if r.get("season_type") not in ("REG", None, ""):
            continue
        team, wk = team_code(r["team"]), int(r["week"])
        if (team, wk) not in allowed:
            continue
        r["_fourth_down_stops"] = (stops or {}).get((team, wk), 0)
        defenses.setdefault(team, {})[wk] = [def_points(r, allowed[(team, wk)], rules), team_code(r.get("opponent_team"))]
    return {"season": int(season), "players": list(players.values()), "defenses": defenses}


def points_against(points):
    """Fantasy points each NFL defense gives up, by position: {team: {"QB":
    avg per game, ..., "DEF": avg, "games": n, "weeks": {week: {"QB": pts,
    ...}}}}. DEF is the points opposing fantasy defenses scored against that
    team's offense. The weeks let a page average any range (e.g. last 4)."""
    sums = {}   # (defense team, week, pos) -> points scored against it
    games = {}  # defense team -> set(weeks)
    for p in points["players"]:
        for wk, (pts, opp) in p["weeks"].items():
            if opp:
                key = (opp, wk, p["position"])
                sums[key] = sums.get(key, 0.0) + pts
                games.setdefault(opp, set()).add(wk)
    for team, weeks in points["defenses"].items():
        for wk, (pts, opp) in weeks.items():
            if opp:
                # Points `team`'s defense scored are points `opp`'s offense gave up.
                sums[(opp, wk, "DEF")] = sums.get((opp, wk, "DEF"), 0.0) + pts
                games.setdefault(opp, set()).add(wk)
    out = {}
    for team, weeks in games.items():
        n = len(weeks)
        out[team] = {pos: round(sum(sums.get((team, wk, pos), 0.0) for wk in weeks) / n, 2) for pos in POSITIONS}
        out[team]["games"] = n
        out[team]["weeks"] = {wk: {pos: round(sums.get((team, wk, pos), 0.0), 2) for pos in POSITIONS} for wk in sorted(weeks)}
    return out


_SUFFIX = re.compile(r"\b(jr|sr|ii|iii|iv|v)\b\.?")


def name_key(name):
    s = re.sub(r"[.'’]", "", (name or "").lower())  # "D.J." -> "dj", "Ja'Marr" -> "jamarr"
    s = re.sub(r"[^a-z ]", " ", _SUFFIX.sub("", s))
    return " ".join(s.split())


def check(points, box):
    """Compares these points with Yahoo's for players on league rosters.
    `box` is the private box score file ({"weeks": {week: {"teams": {key:
    [[slot, name, pos, nfl, pts], ...]}}}}). Returns per-position counts of
    exact matches (within 0.05), the average miss, and the biggest misses."""
    ours = {}
    for p in points["players"]:
        for wk, (pts, _opp) in p["weeks"].items():
            ours[(name_key(p["name"]), p["position"], wk)] = pts
    for team, weeks in points["defenses"].items():
        for wk, (pts, _opp) in weeks.items():
            ours[(team, "DEF", wk)] = pts
    by_pos, misses = {}, []
    for wk, w in (box.get("weeks") or {}).items():
        for lineup in ((w or {}).get("teams") or {}).values():
            for slot, name, pos, nfl, yahoo in lineup:
                pos = (pos or "").split(",")[0]
                if pos not in POSITIONS or not isinstance(yahoo, (int, float)):
                    continue
                key = (team_code(nfl), "DEF", int(wk)) if pos == "DEF" else (name_key(name), pos, int(wk))
                mine = ours.get(key)
                s = by_pos.setdefault(pos, {"compared": 0, "exact": 0, "not_found": 0, "total_miss": 0.0})
                if mine is None:
                    if yahoo:
                        s["not_found"] += 1
                    continue
                s["compared"] += 1
                miss = round(mine - yahoo, 2)
                if abs(miss) <= 0.05:
                    s["exact"] += 1
                else:
                    misses.append({"week": int(wk), "name": name, "pos": pos, "yahoo": yahoo, "ours": mine, "diff": miss})
                s["total_miss"] += abs(miss)
    for s in by_pos.values():
        s["avg_miss"] = round(s.pop("total_miss") / s["compared"], 2) if s["compared"] else None
    misses.sort(key=lambda m: -abs(m["diff"]))
    return {"by_position": by_pos, "biggest_misses": misses[:15]}
