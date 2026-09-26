"""
League history for the Rivalry Center: finds every Yahoo season of this
league, pulls each week's scoreboard, and builds the one matchup list the
Rivalry Center page reads (rivalry-history.json, format in
rivalry-center/README.md).

Finding old seasons: Yahoo only links seasons together when the league was
"renewed", which this league wasn't every year. So besides following that
chain (which always wins for the years it covers), this looks at every NFL
league on the commissioner's Yahoo account, for the years the chain
doesn't reach. A league counts when at least MIN_SHARED_ACCOUNTS of this
season's managers played in it on the same Yahoo accounts, or, for old
accounts, at least MIN_SHARED_NAMES of them by MANAGER_NAMES nickname.
Each person counts once.

Everything is saved to S3 as it goes (rivalry/index.json and one
rivalry/seasons/<year>.json per season), so a run that hits the Lambda
time limit picks up where it stopped. Finished seasons are fetched once
and never again. The current season is refreshed each time.

Yahoo and S3 access are passed in, so this file has no AWS or network code
of its own.
"""
import hashlib
import re
import time

INDEX_VERSION = 2  # bump when discovery rules change, so saved indexes are rebuilt
INDEX_KEY = "rivalry/index.json"
SEASON_KEY = "rivalry/seasons/{}.json"
PUBLIC_KEY = "rivalry-history.json"
MIN_SHARED_ACCOUNTS = 4
MIN_SHARED_NAMES = 7
PHOTO_BASE_URL = "https://stats.gooncocks.com/photos/"


def _slug(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


class Store:
    """Reads/writes JSON in S3. load(key, default) / save(key, obj)."""

    def __init__(self, load, save):
        self.load, self.save = load, save


# ---------------------------------------------------------------- discovery

def _overlap(season, current_guids, known_name):
    """(accounts, names): how many different current managers are in this
    league on the same Yahoo account, and how many different MANAGER_NAMES
    people show up by nickname."""
    accounts = {t.get("manager_guid") for t in season["teams"]} & current_guids
    names = {known_name(t) for t in season["teams"]} - {None}
    return len(accounts), len(names)


_NAME_WORDS = re.compile(r"[a-z]+")


def _name_likeness(a, b):
    words = lambda s: set(_NAME_WORDS.findall(str(s or "").lower())) - {"fantasy", "football", "league", "the", "of"}
    return len(words(a) & words(b))


def discover_seasons(yahoo, league_key, known_name, include=(), exclude=(), log=print):
    """{season: {"league_key", "name", "is_finished", "teams": [...standings...]}}
    for every season of this league Yahoo still has. `yahoo` provides
    league_season(key) and all_leagues(); `known_name(team)` returns the
    MANAGER_NAMES name for a Yahoo team, or None."""
    current = yahoo.league_season(league_key)
    current_guids = {t["manager_guid"] for t in current["teams"] if t.get("manager_guid")}
    found = {str(current["season"]): dict(current, league_key=league_key, how="current league", fixed=True)}
    exclude = set(exclude)

    def consider(key, how, forced=False):
        if not key or key in exclude or any(s["league_key"] == key for s in found.values()):
            return
        try:
            season = yahoo.league_season(key)
        except Exception as exc:  # an old league Yahoo won't open: skip it, keep going
            log(f"  skipped {key}: {exc}")
            return
        year = str(season["season"])
        accounts, names = _overlap(season, current_guids, known_name)
        label = f"{year} {season['name']!r} ({key})"
        shared = f"{accounts} same Yahoo accounts, {names} known nicknames"
        if not forced and accounts < MIN_SHARED_ACCOUNTS and names < MIN_SHARED_NAMES:
            log(f"  {label}: not this league ({shared})")
            return
        prior = found.get(year)
        score = (accounts, names, _name_likeness(season["name"], current["name"]))
        by_hand = how == "added by hand"
        if prior and not by_hand and (prior.get("fixed") or (not forced and prior.get("score", (0, 0, 0)) >= score)):
            log(f"  {label}: not used, {year} is already {prior['name']!r} ({shared})")
            return
        found[year] = dict(season, league_key=key, how=how, score=score, fixed=forced)
        log(f"  {label}: {how} ({shared})")

    # 1. Yahoo's renewal chain.
    renew = current.get("renew")
    while renew:
        key = renew.replace("_", ".l.", 1)
        before = len(found)
        consider(key, "renewed league", forced=True)
        season = next((s for s in found.values() if s["league_key"] == key), None)
        renew = season.get("renew") if season and len(found) > before else None

    # 2. Every NFL league on this Yahoo account, all seasons.
    try:
        leagues = yahoo.all_leagues()
    except Exception as exc:
        log(f"  couldn't list past leagues on this Yahoo account: {exc}")
        leagues = []
    this_year = int(current["season"])
    for lg in sorted(leagues, key=lambda x: str(x.get("season")), reverse=True):
        if str(lg.get("season") or "").isdigit() and int(lg["season"]) < this_year:
            consider(lg.get("league_key"), "matched by managers")

    # 3. Anything added by hand.
    for key in include:
        consider(key, "added by hand", forced=True)
    return found


# ------------------------------------------------------------ season games

def _week_done(games):
    return all(g.get("status") == "postevent" for g in games)


def fetch_season(yahoo, league_key, saved, deadline, is_current, log=print):
    """Fills in `saved` (this season's file, or None) with every week's
    matchups, skipping weeks already stored as final. Stops early at
    `deadline` (time.time() value) with complete=False so a later run
    resumes."""
    info = saved or {"league_key": league_key, "weeks": {}}
    info["league_key"] = league_key
    weeks = info["weeks"]

    if is_current or not info.get("end_week"):
        sb = yahoo.scoreboard(league_key, None)
        meta = yahoo.meta(sb)
        info["end_week"] = int(meta.get("end_week") or 17)
        info["is_finished"] = str(meta.get("is_finished") or "0") == "1"
        current_week = int(meta.get("current_week") or info["end_week"])
        info["last_week"] = info["end_week"] if info["is_finished"] else current_week
        weeks[str(yahoo.week_of(sb) or current_week)] = yahoo.matchups(sb)

    for week in range(1, info["last_week"] + 1):
        stored = weeks.get(str(week))
        if stored is not None and _week_done(stored):
            continue
        if time.time() > deadline:
            info["complete"] = False
            return info
        weeks[str(week)] = yahoo.matchups(yahoo.scoreboard(league_key, week))

    info["complete"] = info["is_finished"] and all(
        str(w) in weeks and _week_done(weeks[str(w)]) for w in range(1, info["last_week"] + 1)
    )
    return info


# ------------------------------------------------------------ public file

def _label_rounds(rows):
    """Names championship-bracket rounds from the week order: the last
    playoff week holds the Championship (both teams won the week before)
    and the Third Place game (both lost), the week before is the
    Semifinal, then Quarterfinal."""
    weeks = sorted({r["week"] for r in rows if r["gameType"] == "playoff"})
    if not weeks:
        return
    names = {weeks[-1]: None}
    if len(weeks) >= 2:
        names[weeks[-2]] = "Semifinal"
    if len(weeks) >= 3:
        names[weeks[-3]] = "Quarterfinal"
    prev_winners, prev_losers = set(), set()
    if len(weeks) >= 2:
        for r in rows:
            if r["week"] == weeks[-2] and r["gameType"] == "playoff" and r["status"] == "final":
                win_a = r["scoreA"] >= r["scoreB"]
                prev_winners.add(r["managerA"] if win_a else r["managerB"])
                prev_losers.add(r["managerB"] if win_a else r["managerA"])
    finals = [r for r in rows if r["week"] == weeks[-1] and r["gameType"] == "playoff"]
    for r in rows:
        if r["gameType"] != "playoff":
            continue
        if r["week"] != weeks[-1]:
            r["round"] = names.get(r["week"], "Playoffs")
            continue
        pair = {r["managerA"], r["managerB"]}
        if len(finals) == 1 or (prev_winners and pair <= prev_winners):
            r["round"] = "Championship"
        elif prev_losers and pair <= prev_losers:
            r["round"] = "Third Place"
        else:
            r["round"] = "Playoffs"


def account_names(seasons, known_name, extra_teams=()):
    """{Yahoo account (hashed): MANAGER_NAMES name} for every account that
    shows up at least once under a listed nickname. People change their
    Yahoo nickname over the years; this links their other seasons to them."""
    def teams():
        for season in seasons.values():
            for games in season["weeks"].values():
                for g in games:
                    yield g["team_a"]
                    yield g["team_b"]
        yield from extra_teams

    names = {}
    for t in teams():
        name, account = known_name(t), t.get("manager_guid")
        if name and account:
            names.setdefault(account, name)
    return names


def linked(known_name, names):
    """known_name, extended to recognize those linked Yahoo accounts."""
    return lambda team: known_name(team) or names.get(team.get("manager_guid"))


def build_history(seasons, current_season, known_name, league_name=""):
    """The Rivalry Center's history file from the stored season files.
    `seasons` is {year: season file}. People are matched across seasons by
    MANAGER_NAMES (Yahoo guid or nickname); anyone not listed is matched by
    their Yahoo account alone and shown by nickname. Yahoo account IDs
    never leave this function - former managers get an opaque ID."""
    people = {}   # id -> {"name", "seasons": set()}
    by_guid = {}

    def person(team):
        name = known_name(team)
        if name:
            pid = _slug(name)
        else:
            account = team.get("manager_guid") or team.get("manager") or team.get("team_key") or team.get("name")
            pid = by_guid.get(account) or "x" + hashlib.sha1(str(account).encode()).hexdigest()[:8]
            by_guid[account] = pid
            nickname = team.get("manager")
            name = nickname if nickname and nickname != "--hidden--" else (team.get("name") or "Former manager")
        entry = people.setdefault(pid, {"name": name, "seasons": set()})
        entry["name"] = name  # seasons run oldest to newest, so the latest nickname wins
        return pid

    teams, matchups = {}, []
    for year in sorted(seasons, key=int):
        rows = []
        for week_key, games in sorted(seasons[year]["weeks"].items(), key=lambda kv: int(kv[0])):
            for g in games:
                a, b = g["team_a"], g["team_b"]
                pa, pb = person(a), person(b)
                if pa == pb:
                    continue
                for pid, t in ((pa, a), (pb, b)):
                    people[pid]["seasons"].add(int(year))
                    teams.setdefault(str(year), {})[pid] = t.get("name") or ""
                final = g.get("status") == "postevent" and a.get("score") is not None and b.get("score") is not None
                week = g.get("week") or int(week_key)
                rows.append({
                    "id": f"{year}-w{int(week):02d}-{pa}-{pb}",
                    "season": int(year), "week": int(week),
                    "gameType": "consolation" if g.get("is_consolation") else "playoff" if g.get("is_playoffs") else "regular",
                    "round": None,
                    "status": "final" if final else "scheduled",
                    "managerA": pa, "managerB": pb,
                    "scoreA": round(float(a["score"]), 2) if final else None,
                    "scoreB": round(float(b["score"]), 2) if final else None,
                })
        _label_rounds(rows)
        matchups.extend(rows)

    current = int(current_season)
    managers = sorted(
        ({"id": pid, "name": p["name"], "active": current in p["seasons"]} for pid, p in people.items()),
        key=lambda m: (not m["active"], m["name"].lower()),
    )
    years = sorted({m["season"] for m in matchups})
    return {
        "source": "yahoo",
        "label": f"Yahoo league history, {years[0]}-{years[-1]}." if years else "Yahoo league history.",
        "league": league_name,
        "photoBaseUrl": PHOTO_BASE_URL,
        "managers": managers,
        "teams": teams,
        "matchups": matchups,
    }


def champions(index, name_of):
    """[{season, champion, champion_team, runner_up, runner_up_team}] from
    each finished season's final standings, newest first - the landing
    page's Champion Wall format."""
    out = []
    for year, season in sorted(index.get("seasons", {}).items(), key=lambda kv: kv[0], reverse=True):
        ranked = {t["rank"]: t for t in season.get("teams", []) if t.get("rank")}
        if not season.get("is_finished") or season.get("skipped") or 1 not in ranked:
            continue
        champ, runner = ranked[1], ranked.get(2)
        out.append({
            "season": str(year),
            "champion": name_of(champ), "champion_team": champ.get("team"),
            "runner_up": name_of(runner) if runner else None,
            "runner_up_team": runner.get("team") if runner else None,
        })
    return out
