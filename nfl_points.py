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


def _n(v):
    return int(v) if float(v).is_integer() else round(v, 1)


def stat_line(row, position):
    """A short box-score line for a player's week, e.g. "24/35, 287 yds,
    2 TD, 1 INT; 6 car, 44 yds, 1 TD" for a QB."""
    g = lambda *c: _num(row, *c)
    rush = f"{_n(g('carries'))} car, {_n(g('rushing_yards'))} yds" + (f", {_n(g('rushing_tds'))} TD" if g("rushing_tds") else "")
    rec = f"{_n(g('receptions'))} rec, {_n(g('receiving_yards'))} yds" + (f", {_n(g('receiving_tds'))} TD" if g("receiving_tds") else "")
    parts = []
    if position == "QB":
        parts.append(f"{_n(g('completions'))}/{_n(g('attempts'))}, {_n(g('passing_yards'))} yds, "
                     f"{_n(g('passing_tds'))} TD, {_n(g('passing_interceptions'))} INT")
        if g("carries") or g("rushing_yards") or g("rushing_tds"):
            parts.append(rush)
    elif position == "RB":
        parts.append(rush)
        if g("receptions") or g("targets"):
            parts.append(rec)
    elif position in ("WR", "TE"):
        parts.append(rec)
        if g("carries") or g("rushing_yards") or g("rushing_tds"):
            parts.append(rush)
    elif position == "K":
        parts.append(f"FG {_n(g('fg_made'))}/{_n(g('fg_att'))}" + (f" (long {_n(g('fg_long'))})" if g("fg_made") else "")
                     + f", PAT {_n(g('pat_made'))}/{_n(g('pat_att'))}")
    if position != "K":
        if g("special_teams_tds"):
            parts.append(f"{_n(g('special_teams_tds'))} return TD")
        lost = g("sack_fumbles_lost", "rushing_fumbles_lost", "receiving_fumbles_lost")
        if lost:
            parts.append(f"{_n(lost)} fumble lost")
    return "; ".join(parts)


def def_line(row, points_allowed):
    g = lambda *c: _num(row, *c)
    bits = [f"{_n(g('def_sacks'))} sacks", f"{_n(g('def_interceptions'))} INT", f"{_n(g('fumble_recovery_opp'))} FR"]
    tds = g("def_tds") + min(g("fumble_recovery_tds"), g("fumble_recovery_opp")) + g("special_teams_tds")
    if tds:
        bits.append(f"{_n(tds)} TD")
    return ", ".join(bits) + f"; {points_allowed} pts allowed"


# The average-stat columns shown per position (label, nflverse columns
# summed), like Yahoo's Points Against page.
_OFF = [("Pass Yds", ("passing_yards",)), ("Pass TD", ("passing_tds",)), ("Int", ("passing_interceptions",)),
        ("Rush Att", ("carries",)), ("Rush Yds", ("rushing_yards",)), ("Rush TD", ("rushing_tds",)),
        ("Rec", ("receptions",)), ("Rec Yds", ("receiving_yards",)), ("Rec TD", ("receiving_tds",)), ("Tgt", ("targets",)),
        ("Ret TD", ("special_teams_tds",)),
        ("2PT", ("passing_2pt_conversions", "rushing_2pt_conversions", "receiving_2pt_conversions")),
        ("Fum Lost", ("sack_fumbles_lost", "rushing_fumbles_lost", "receiving_fumbles_lost"))]
STAT_COLS = {
    "QB": _OFF, "RB": _OFF, "WR": _OFF, "TE": _OFF,
    "K": [("FG 0-19", ("fg_made_0_19",)), ("FG 20-29", ("fg_made_20_29",)), ("FG 30-39", ("fg_made_30_39",)),
          ("FG 40-49", ("fg_made_40_49",)), ("FG 50+", ("fg_made_50_59", "fg_made_60_")), ("FG Miss", ("fg_missed",)),
          ("PAT", ("pat_made",))],
    "DEF": [("Sack", ("def_sacks",)), ("Int", ("def_interceptions",)), ("Fum Rec", ("fumble_recovery_opp",)),
            ("TD", ("_def_tds",)), ("Safety", ("def_safeties",)), ("Blk Kick", ("def_punt_blocks", "def_fg_blocks", "def_pat_blocks")),
            ("Pts Allow", ("_points_allowed",))],
}
# How much a player was used in a game, to tell who a team's starters are.
USAGE = {"QB": ("attempts",), "RB": ("carries", "targets"), "WR": ("targets",), "TE": ("targets",), "K": ("fg_att", "pat_att")}
STARTERS = {"QB": 1, "RB": 2, "WR": 3, "TE": 1, "K": 1}


def stat_values(row, position):
    return [_n(_num(row, *cols)) for _label, cols in STAT_COLS[position]]


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
    {"players": [{"id", "name", "position", "team",
                  "weeks": {week: [pts, opp, stat line, stat columns, usage]}}],
     "defenses": {team: {week: [pts, opp, stat line, stat columns]}},
     "schedule": {team: {week: opponent}}} - the schedule has every
    regular-season week, played or not (a missing week is a bye)."""
    allowed = {}   # (team, week) -> points its opponent scored
    schedule = {}  # team -> {week: opponent}, future weeks too
    for g in _csv(games_csv):
        if g.get("season") != str(season) or g.get("game_type") not in ("REG", None, ""):
            continue
        wk, home, away = int(g["week"]), team_code(g["home_team"]), team_code(g["away_team"])
        schedule.setdefault(home, {})[wk] = away
        schedule.setdefault(away, {})[wk] = home
        if not g.get("home_score"):
            continue
        allowed[(home, wk)] = int(float(g["away_score"]))
        allowed[(away, wk)] = int(float(g["home_score"]))
    players = {}
    for r in _csv(player_csv):
        if r.get("season_type") not in ("REG", None, "") or r.get("position") not in POSITIONS[:5]:
            continue
        p = players.setdefault(r["player_id"], {"id": r["player_id"], "name": r.get("player_display_name") or r.get("player_name"),
                                                "position": r["position"], "team": team_code(r["team"]), "weeks": {}})
        p["team"] = team_code(r["team"])  # the latest team he played for
        p["weeks"][int(r["week"])] = [player_points(r, rules), team_code(r.get("opponent_team")), stat_line(r, r["position"]),
                                      stat_values(r, r["position"]), _n(_num(r, *USAGE[r["position"]]))]
    defenses = {}
    for r in _csv(team_csv):
        if r.get("season_type") not in ("REG", None, ""):
            continue
        team, wk = team_code(r["team"]), int(r["week"])
        if (team, wk) not in allowed:
            continue
        r["_fourth_down_stops"] = (stops or {}).get((team, wk), 0)
        r["_points_allowed"] = allowed[(team, wk)]
        r["_def_tds"] = _num(r, "def_tds") + min(_num(r, "fumble_recovery_tds"), _num(r, "fumble_recovery_opp")) + _num(r, "special_teams_tds")
        defenses.setdefault(team, {})[wk] = [def_points(r, allowed[(team, wk)], rules), team_code(r.get("opponent_team")),
                                             def_line(r, allowed[(team, wk)]), stat_values(r, "DEF")]
    return {"season": int(season), "players": list(players.values()), "defenses": defenses, "schedule": schedule}


def kickoffs(season, games_csv):
    """Every regular-season game's kickoff, in Eastern time as nflverse
    lists it: {team: {week: "YYYY-MM-DD HH:MM"}}."""
    out = {}
    for g in _csv(games_csv):
        if g.get("season") != str(season) or g.get("game_type") not in ("REG", None, "") or not g.get("gameday"):
            continue
        when = g["gameday"] + (" " + g["gametime"] if g.get("gametime") else "")
        for team in (g["home_team"], g["away_team"]):
            out.setdefault(team_code(team), {})[int(g["week"])] = when
    return out


def player_weeks(points):
    """Just each player's weekly points, small enough for a web page to
    load whole: {"players": [[name key, name, position, team, {week: pts}]],
    "defenses": {team: {week: pts}}}. The name key is name_key(name), for
    matching Yahoo's names."""
    return {"players": [[name_key(p["name"]), p["name"], p["position"], p["team"],
                         {wk: round(w[0], 2) for wk, w in p["weeks"].items()}]
                        for p in points["players"] if p["weeks"]],
            "defenses": {team: {wk: round(w[0], 2) for wk, w in weeks.items()}
                         for team, weeks in points["defenses"].items()}}


def starters(points):
    """Each team's likely starters, from its most recent game: {team: {"QB":
    [name], "RB": [2 names], "WR": [3], "TE": [1], "K": [1]}}, by usage
    (pass attempts, carries + targets, targets, kicks)."""
    last = {}  # team -> latest week it played
    for p in points["players"]:
        for wk in p["weeks"]:
            last[p["team"]] = max(last.get(p["team"], 0), wk)
    picks = {}
    for p in points["players"]:
        wk = last.get(p["team"])
        w = p["weeks"].get(wk)
        if w is not None:
            picks.setdefault(p["team"], {}).setdefault(p["position"], []).append((w[4] if len(w) > 4 else 0, p["name"]))
    return {team: {pos: [n for _u, n in sorted(v, key=lambda x: -x[0])[:STARTERS[pos]]] for pos, v in by_pos.items()}
            for team, by_pos in picks.items()}


def points_against(points):
    """Fantasy points each NFL defense gives up, by position: {team: {"QB":
    avg per game, ..., "DEF": avg, "games": n, "weeks": {week: {"QB": pts,
    ...}}, "who": {week: {"QB": [[name, team, pts, stat line], ...]}}}}.
    DEF is the points opposing fantasy defenses scored against that team's
    offense. The weeks let a page average any range (e.g. last 4); "who"
    names the players behind each week's points, most first."""
    sums = {}   # (defense team, week, pos) -> points scored against it
    games = {}  # defense team -> set(weeks)
    who = {}    # (defense team, week, pos) -> [[name, team, pts, line]]
    stats = {}  # (defense team, week, pos) -> summed stat columns

    def add_stats(key, values):
        cur = stats.setdefault(key, [0] * len(values))
        for i, v in enumerate(values):
            cur[i] += v
    for p in points["players"]:
        for wk, w in p["weeks"].items():
            pts, opp = w[0], w[1]
            if opp:
                key = (opp, wk, p["position"])
                sums[key] = sums.get(key, 0.0) + pts
                games.setdefault(opp, set()).add(wk)
                if pts:
                    who.setdefault(key, []).append([p["name"], p["team"], pts, w[2] if len(w) > 2 else ""])
                if len(w) > 3:
                    add_stats(key, w[3])
    for team, weeks in points["defenses"].items():
        for wk, w in weeks.items():
            pts, opp = w[0], w[1]
            if opp:
                # Points `team`'s defense scored are points `opp`'s offense gave up.
                sums[(opp, wk, "DEF")] = sums.get((opp, wk, "DEF"), 0.0) + pts
                games.setdefault(opp, set()).add(wk)
                who.setdefault((opp, wk, "DEF"), []).append([team + " D/ST", team, pts, w[2] if len(w) > 2 else ""])
                if len(w) > 3:
                    add_stats((opp, wk, "DEF"), w[3])
    out = {}
    for team, weeks in games.items():
        n = len(weeks)
        out[team] = {pos: round(sum(sums.get((team, wk, pos), 0.0) for wk in weeks) / n, 2) for pos in POSITIONS}
        out[team]["games"] = n
        out[team]["weeks"] = {wk: {pos: round(sums.get((team, wk, pos), 0.0), 2) for pos in POSITIONS} for wk in sorted(weeks)}
        out[team]["who"] = {wk: {pos: sorted(who.get((team, wk, pos), []), key=lambda x: -x[2])[:6] for pos in POSITIONS}
                            for wk in sorted(weeks)}
        out[team]["stats"] = {wk: {pos: [round(v, 1) for v in stats.get((team, wk, pos), [0] * len(STAT_COLS[pos]))]
                                   for pos in POSITIONS} for wk in sorted(weeks)}
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
        for wk, w in p["weeks"].items():
            ours[(name_key(p["name"]), p["position"], wk)] = w[0]
    for team, weeks in points["defenses"].items():
        for wk, w in weeks.items():
            ours[(team, "DEF", wk)] = w[0]
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
