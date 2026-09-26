"""
AWS Lambda entry point. Paste this file, awards.py, sample_data.py,
webpage.py, discord_client.py, and yahoo_client.py into a Lambda function's
code editor (Python 3.x runtime) as separate files in the same folder - no
pip packages needed, everything here is stdlib plus boto3 (already included
in Lambda's Python runtime).

Set these environment variables on the Lambda function's Configuration tab:
  YAHOO_CLIENT_ID
  YAHOO_CLIENT_SECRET
  YAHOO_REFRESH_TOKEN   (only needed once you have one - see the "auth_url"
                         and "exchange" actions below to get it)
  LEAGUE_KEY            (optional - only needed if you're in more than one
                         Yahoo NFL league)
  WEEK                  (optional - defaults to Yahoo's current week)
  S3_BUCKET             (the bucket the recap webpage gets uploaded to)
  S3_WEBSITE_URL        (that bucket's static website endpoint, from its
                         Properties tab - optional, used to build the link
                         printed/returned after publishing)
  DISCORD_WEBHOOK_URL   (optional - if set, "publish" actions also post a
                         short teaser + page link to Discord)

Drive it with the "Test" button in the Lambda console, using a test event
(JSON) shaped like one of these:

  One-time setup, step A - get the login link:
    {"action": "auth_url"}

  One-time setup, step B - after you open that link, log in, and Yahoo
  shows you a short code, trade it in for a refresh token:
    {"action": "exchange", "code": "PASTE_THE_CODE_HERE"}
  Copy the refresh_token from the response into the YAHOO_REFRESH_TOKEN
  environment variable, then you're set up for good.

  Demo mode - runs the recap engine on made-up data, no Yahoo access
  needed at all (useful while a real Fantasy Sports API application is
  pending approval with Yahoo):
    {"action": "demo"}

  Publish demo - same made-up data, but also renders the webpage and
  uploads it to S3 (and posts to Discord if DISCORD_WEBHOOK_URL is set) -
  use this to prove the whole pipeline works before Yahoo approves you:
    {"action": "publish_demo"}

  See your leagues (only needed if you belong to more than one):
    {"action": "leagues"}

  See each team's Yahoo manager nickname + guid, and which name it maps
  to via MANAGER_NAMES below (used to fill that mapping in):
    {"action": "managers"}

  Find every past champion and runner-up by walking back through the
  league's previous Yahoo seasons; saves history.json for the landing
  page's Champion Wall:
    {"action": "history"}

  Build the Rivalry Center's history (stats.gooncocks.com/rivalries.html):
  finds every Yahoo season of this league - through Yahoo's renewal
  chain and by matching managers across every NFL league on this Yahoo
  account - and pulls every week's scores. Saves progress as it goes, so
  if the run ends with "run again to continue", just run it again. After
  that, each weekly publish keeps it current on its own. It also refreshes
  the Champion Wall from each finished season's final standings, publishes
  the Career Center (careers.html) and Record Room (records.html), and
  collects every game's lineups (box scores) with whatever time is left -
  keep running it until it says "Done".
    {"action": "rivalry_history"}
  Options: "rediscover": true searches for seasons again; "include":
  ["423.l.12345"] adds a league by hand; "exclude": [...] drops one.

  The actual recap, printed only:
    {"action": "recap"}

  The actual recap, published - fetches real Yahoo data, renders the
  webpage, uploads to S3, posts to Discord if configured. This is also
  the default if you omit "action":
    {"action": "publish"}
  Re-publish an old week quietly (no Discord post), e.g. after a page
  design change:
    {"action": "publish", "week": 2, "discord": false}
"""
import base64
import datetime
import hashlib
import json
import os
import re
import time
import traceback
from concurrent.futures import ThreadPoolExecutor

import boto3

from awards import (
    Matchup, award_details, compute_awards, compute_extra_awards, generate_recap, identity, power_rankings, week_records,
)
import league_history
from discord_client import build_teaser, post_message
from sample_data import SAMPLE_MATCHUPS
from webpage import render_html
from yahoo_client import (
    build_authorize_url,
    exchange_code_for_tokens,
    get_league_history,
    get_player_points,
    get_scoreboard,
    get_team_roster,
    get_transactions,
    get_league_season,
    get_user_leagues,
    parse_matchups,
    refresh_access_token,
    scoreboard_meta,
    scoreboard_week,
)


# Yahoo manager guid or Yahoo nickname -> the name shown on the page, used
# for headshots (photos/<name>.jpg) and season standings, so all three stay
# matched through team renames. Nickname keys ignore case/spaces/punctuation.
# Anyone not listed falls back to their Yahoo nickname - run the "managers"
# action to see everyone's nickname and guid.
MANAGER_NAMES = {
    "wilzer": "Will",
    "MUBAPAT": "Patrick",
    "The Great CNoz": "Chris",
    "Matt": "Matt",
    "Tamir": "Tamir",
    "gabriel": "Gabe",
    "brandon": "Brandon",
    "B": "Brandon",  # Brandon's Yahoo nickname in earlier seasons
    "Jose": "Jose",
    "Samuel": "Sam",
    "Chett": "Chet",
    # Former managers - listed so the Rivalry Center and Champion Wall show
    # their real name. Anyone not in this season's league stays out of the
    # Who Owns Who grid and only appears under "Former managers".
    "adix": "Adix",
}


def _name_key(value):
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


_MANAGER_LOOKUP = {_name_key(k): v for k, v in MANAGER_NAMES.items()}

# Yahoo nicknames of managers who don't belong in the league's history at
# all (picked up from the wrong league). Their games are left out of every
# record, for them and for their opponents.
EXCLUDED_MANAGERS = {"Alexandra Dequarto"}
_EXCLUDED = {_name_key(n) for n in EXCLUDED_MANAGERS}


def _excluded(team):
    return _name_key(team.get("manager")) in _EXCLUDED


def _known_manager_name(team):
    """The MANAGER_NAMES name for a Yahoo team, or None if it isn't listed."""
    guid, nickname = team.get("manager_guid"), team.get("manager")
    return _MANAGER_LOOKUP.get(_name_key(guid)) or _MANAGER_LOOKUP.get(_name_key(nickname))


def _manager_name(team):
    return _known_manager_name(team) or team.get("manager")


def _require_env(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _get_access_token():
    client_id = _require_env("YAHOO_CLIENT_ID")
    client_secret = _require_env("YAHOO_CLIENT_SECRET")
    refresh_token = _require_env("YAHOO_REFRESH_TOKEN")
    tokens = refresh_access_token(client_id, client_secret, refresh_token)
    return tokens["access_token"]


def _action_auth_url():
    client_id = _require_env("YAHOO_CLIENT_ID")
    url = build_authorize_url(client_id)
    print("Open this URL, log into Yahoo, and click 'Agree':")
    print(url)
    print("Yahoo will show you a short code - use it with the 'exchange' action.")
    return {"authorize_url": url}


def _action_exchange(event):
    code = event.get("code")
    if not code:
        raise RuntimeError('The "exchange" action needs a "code" field in the test event.')
    client_id = _require_env("YAHOO_CLIENT_ID")
    client_secret = _require_env("YAHOO_CLIENT_SECRET")
    tokens = exchange_code_for_tokens(client_id, client_secret, code)
    refresh_token = tokens.get("refresh_token")
    if not refresh_token:
        print(f"Yahoo did not return a refresh_token. Full response: {tokens}")
        raise RuntimeError("No refresh_token in Yahoo's response - see the logs above.")
    print("Success! Put this in the YAHOO_REFRESH_TOKEN environment variable:")
    print(refresh_token)
    return {"refresh_token": refresh_token}


def _action_demo():
    """Runs the recap engine on made-up data - no Yahoo access needed at
    all. Proves the whole Lambda pipeline (import, generate_recap, print)
    works while real Yahoo access is still pending approval."""
    recap_text = generate_recap(week=1, matchups=SAMPLE_MATCHUPS)
    print(recap_text)
    return {"recap": recap_text}


def _action_leagues():
    access_token = _get_access_token()
    leagues = get_user_leagues(access_token)
    for lg in leagues:
        print(f"  {lg['name']}  (season {lg['season']}, {lg['num_teams']} teams)  key={lg['league_key']}")
    return {"leagues": leagues}


def _fetch_real_matchups(event):
    """Shared by _action_recap and _action_publish: gets this week's real
    matchups from Yahoo. Raises RuntimeError (with details already printed)
    if LEAGUE_KEY is ambiguous or Yahoo's response can't be parsed."""
    access_token = _get_access_token()
    league_key = event.get("league_key") or os.environ.get("LEAGUE_KEY")
    week = event.get("week") or os.environ.get("WEEK")

    if not league_key:
        leagues = get_user_leagues(access_token)
        if len(leagues) == 1:
            league_key = leagues[0]["league_key"]
        else:
            print("More than one league found - set LEAGUE_KEY (or pass league_key in the test event):")
            for lg in leagues:
                print(f"  {lg['name']}  key={lg['league_key']}")
            raise RuntimeError("LEAGUE_KEY not set and multiple leagues found - see the logs above.")

    scoreboard_json = get_scoreboard(access_token, league_key, week=week)
    raw_matchups = parse_matchups(scoreboard_json)
    if week:
        week = int(week)
    else:
        week = scoreboard_week(scoreboard_json)
        # Yahoo flips its "current week" to the next, unplayed one shortly
        # after Monday night, so the weekly scheduled run (no week given)
        # would otherwise publish a week of all-zero scores.
        if week and week > 1 and any(m.get("status") in ("preevent", "midevent") for m in raw_matchups):
            week -= 1
            print(f"Week {week + 1} isn't finished yet - using week {week}.")
            scoreboard_json = get_scoreboard(access_token, league_key, week=week)
            raw_matchups = parse_matchups(scoreboard_json)
    if not raw_matchups:
        print("Yahoo returned a scoreboard, but no matchups came out of it. Raw response:")
        print(scoreboard_json)
        raise RuntimeError("No matchups parsed - see the raw response in the logs above.")

    matchups = [
        Matchup(
            team_a_name=m["team_a"]["name"],
            team_a_score=m["team_a"]["score"] or 0.0,
            team_b_name=m["team_b"]["name"],
            team_b_score=m["team_b"]["score"] or 0.0,
            team_a_projected=m["team_a"]["projected"],
            team_b_projected=m["team_b"]["projected"],
            team_a_manager=_manager_name(m["team_a"]),
            team_b_manager=_manager_name(m["team_b"]),
        )
        for m in raw_matchups
    ]
    rosters, transactions = _fetch_roster_data(access_token, league_key, week, raw_matchups)
    return week, matchups, rosters, transactions


def _fetch_roster_data(access_token, league_key, week, raw_matchups):
    """Rosters (with each player's points that week) and the season's
    transactions, for the bench/lineup/waiver/trade/injury awards. A Yahoo
    response this code doesn't expect only skips those awards (logged
    below) - it never blocks the weekly publish."""
    rosters = transactions = None
    try:
        rosters = []
        for m in raw_matchups:
            a_won = (m["team_a"]["score"] or 0.0) >= (m["team_b"]["score"] or 0.0)
            for team, won in ((m["team_a"], a_won), (m["team_b"], not a_won)):
                rosters.append({
                    "team_key": team["team_key"], "team": team["name"], "manager": _manager_name(team), "won": won,
                    "players": get_team_roster(access_token, team["team_key"], week),
                })
        keys = [p["player_key"] for r in rosters for p in r["players"] if p["player_key"]]
        points = get_player_points(access_token, league_key, keys, week)
        for r in rosters:
            for p in r["players"]:
                p["points"] = points.get(p["player_key"], 0.0)
    except Exception:
        traceback.print_exc()
        print("Skipped the bench/lineup/injury awards this run - see the error above.")
        rosters = None
    try:
        transactions = get_transactions(access_token, league_key)
    except Exception:
        traceback.print_exc()
        print("Skipped the waiver/trade awards this run - see the error above.")
    return rosters, transactions


def _action_managers(event):
    access_token = _get_access_token()
    league_key = event.get("league_key") or _require_env("LEAGUE_KEY")
    week = event.get("week") or os.environ.get("WEEK")
    raw_matchups = parse_matchups(get_scoreboard(access_token, league_key, week=week))
    rows = []
    for m in raw_matchups:
        for team in (m["team_a"], m["team_b"]):
            row = {
                "team": team["name"],
                "nickname": team.get("manager"),
                "guid": team.get("manager_guid"),
                "maps_to": _manager_name(team),
            }
            rows.append(row)
            print(f"  {row['team']:<24} nickname={row['nickname']!r:<18} guid={row['guid']}  ->  {row['maps_to']}")
    return {"managers": rows}


def _action_history(event):
    access_token = _get_access_token()
    league_key = event.get("league_key") or _require_env("LEAGUE_KEY")
    champions = []
    for season in get_league_history(access_token, league_key):
        ranked = {t["rank"]: t for t in season["teams"] if t["rank"]}
        if not season["is_finished"] or 1 not in ranked:
            print(f"  {season['season']}: season not finished yet")
            continue
        champ, runner = ranked[1], ranked.get(2)
        entry = {
            "season": str(season["season"]),
            "champion": _manager_name(champ), "champion_team": champ["team"],
            "runner_up": _manager_name(runner) if runner else None,
            "runner_up_team": runner["team"] if runner else None,
        }
        champions.append(entry)
        print(f"  {entry['season']}: {entry['champion']} ({entry['champion_team']}), runner-up {entry['runner_up']}")
    if not champions:
        print("No finished seasons found - this looks like the league's first season on Yahoo.")

    bucket = os.environ.get("S3_BUCKET")
    if bucket:
        s3 = boto3.client("s3")
        _put(s3, bucket, "history.json", json.dumps(champions), "application/json")
        landing = _load_json(s3, bucket, "landing.json", None)
        if landing is not None:
            landing["champions"] = champions
            _put(s3, bucket, "landing.json", json.dumps(landing), "application/json")
        print("Saved to history.json - the landing page's Champion Wall now uses it.")
    return {"champions": champions}


# ---------------------------------------------------------------- Rivalry Center

RIVALRY_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rivalry-center")
RIVALRY_PAGE_KEY = "rivalries.html"
CAREER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "manager-career-center")
CAREER_PAGE_KEY = "careers.html"
RECORD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "record-room")
RECORD_PAGE_KEY = "records.html"


class _YahooHistory:
    """What league_history needs from Yahoo. Each team's MANAGER_NAMES name
    is resolved here, and its Yahoo account ID replaced with a one-way hash,
    before anything is saved (the history files live in the public bucket)."""

    def __init__(self, access_token):
        self.token = access_token

    def _clean(self, team):
        team = dict(team)
        team["known"] = _known_manager_name(team)
        guid = team.get("manager_guid")
        if guid and guid.startswith("--"):
            guid = None  # Yahoo sends "--hidden--" instead of other managers' accounts
        team["manager_guid"] = hashlib.sha1(guid.encode("utf-8")).hexdigest()[:16] if guid else None
        team.pop("projected", None)
        return team

    def league_season(self, key):
        season = get_league_season(self.token, key)
        season["teams"] = [self._clean(t) for t in season["teams"]]
        return season

    def all_leagues(self):
        return get_user_leagues(self.token, all_seasons=True)

    def scoreboard(self, key, week):
        return get_scoreboard(self.token, key, week=week)

    def meta(self, scoreboard_json):
        return scoreboard_meta(scoreboard_json)

    def week_of(self, scoreboard_json):
        return scoreboard_week(scoreboard_json)

    def matchups(self, scoreboard_json):
        return [dict(m, team_a=self._clean(m["team_a"]), team_b=self._clean(m["team_b"]))
                for m in parse_matchups(scoreboard_json)]

    def box_week(self, league_key, week, team_keys):
        """{team key: [[slot, name, position, NFL team, points], ...]} for
        every team that played that week: one roster call per team plus
        one points call per 25 players, a few at a time."""
        with ThreadPoolExecutor(max_workers=3) as pool:  # gentle: Yahoo rate limits bursts
            rosters = dict(zip(team_keys, pool.map(lambda k: get_team_roster(self.token, k, week), team_keys)))
            keys = sorted({p["player_key"] for r in rosters.values() for p in r if p.get("player_key")})
            points = {}
            for part in pool.map(lambda batch: get_player_points(self.token, league_key, batch, week),
                                 [keys[i:i + 25] for i in range(0, len(keys), 25)]):
                points.update(part)
        return {
            key: [[p.get("slot") or "", p.get("name") or "", p.get("position") or "", p.get("nfl_team") or "",
                   points.get(p.get("player_key"))] for p in roster]
            for key, roster in rosters.items()
        }


def _history_name(team):
    return team.get("known") or _known_manager_name(team)


def _deadline(context, reserve=15):
    """When to stop starting new Yahoo calls, leaving time to save."""
    remaining = context.get_remaining_time_in_millis() / 1000 if context else 600
    return time.time() + max(5, remaining - reserve)


def _bundle_page(folder, logo, data_files=()):
    """One of the standalone page folders (rivalry-center/, manager-career-
    center/) as a single file: styles, scripts and logo inlined, and the
    block between its DATA markers swapped for the live history file (plus
    any data files it still needs, like the payout rules)."""
    def read(path, mode="r"):
        with open(os.path.join(folder, path), mode, **({} if "b" in mode else {"encoding": "utf-8"})) as f:
            return f.read()
    page = read("index.html")
    page = page.replace('<link rel="stylesheet" href="css/styles.css">', "<style>\n" + read("css/styles.css") + "\n</style>")
    start, end = page.index("<!-- DATA"), page.index("<!-- /DATA -->") + len("<!-- /DATA -->")
    data = "".join("<script>\n" + read(f) + "\n</script>\n" for f in data_files)
    page = page[:start] + data + "<script>window.GOONCOCKS_HISTORY_URL = '/" + league_history.PUBLIC_KEY + "';</script>" + page[end:]
    page = re.sub(r'<script src="((?:js|\.\./shared)/[\w.-]+)"></script>', lambda m: "<script>\n" + read(m.group(1)) + "\n</script>", page)
    image = "data:image/webp;base64," + base64.b64encode(read(logo, "rb")).decode("ascii")
    return page.replace(f'src="{logo}"', f'src="{image}"')


def _rivalry_page_html():
    """rivalries.html, built from rivalry-center/."""
    return _bundle_page(RIVALRY_DIR, "assets/peacock.webp")


def _career_page_html():
    """careers.html, built from manager-career-center/ (with its payout rules)."""
    return _bundle_page(CAREER_DIR, "assets/gooncocks-logo.webp", data_files=("data/payouts.js",))


def _record_page_html():
    """records.html, built from record-room/."""
    return _bundle_page(RECORD_DIR, "assets/gooncocks-logo.webp")


def _refresh_boxscores(s3, bucket, yahoo, seasons, game_keys, current, deadline):
    """Collects lineups for finished weeks (newest seasons first) until
    `deadline`, and republishes each season's public box score file that
    changed. Returns the seasons still missing weeks."""
    store = _rivalry_store(s3, bucket)
    pending, busy = [], False
    for year in sorted(seasons, key=int, reverse=True):
        saved = store.load(league_history.BOX_KEY.format(year), None)
        if (saved and saved.get("complete") and saved.get("league_key") == seasons[year]["league_key"]
                and year != current):
            box, changed = saved, False
        elif busy:
            box, changed = saved or {"league_key": seasons[year]["league_key"], "weeks": {}, "complete": False}, False
        else:
            box, changed, busy = league_history.fetch_boxscores(yahoo, seasons[year], saved, deadline)
            if busy:
                print("  Yahoo is limiting how fast we can ask, so lineups stop here for this run."
                      " Wait 30-60 minutes, then run it again.")
        if changed or (saved is None and box["weeks"]):
            store.save(league_history.BOX_KEY.format(year), box)
            got = sum(1 for w in box["weeks"].values() if "teams" in w)
            print(f"  {year} box scores: {got} weeks saved" + ("" if box["complete"] or year == current else " so far"))
        # Rewritten every run so the game IDs always match the history file.
        _put(s3, bucket, league_history.BOX_PUBLIC_KEY.format(year),
             json.dumps(league_history.public_boxscores(year, box, game_keys), separators=(",", ":")),
             "application/json")
        if not box["complete"] and year != current:
            pending.append(year)
    return pending


def _rivalry_store(s3, bucket):
    return league_history.Store(
        lambda key, default: _load_json(s3, bucket, key, default),
        lambda key, obj: _put(s3, bucket, key, json.dumps(obj, separators=(",", ":")), "application/json"),
    )


def _refresh_rivalry(s3, bucket, yahoo, league_key, deadline, rediscover=False, include=(), exclude=()):
    """Finds the league's seasons (first run, a new season, or when asked),
    fetches whatever weeks are missing, and republishes the history file
    and rivalries.html. Returns a summary for the action's output."""
    store = _rivalry_store(s3, bucket)
    index = store.load(league_history.INDEX_KEY, None)
    if (index is None or rediscover or include or exclude or index.get("league_key") != league_key
            or index.get("version") != league_history.INDEX_VERSION):
        print("Looking for every season of this league on Yahoo...")
        found = league_history.discover_seasons(yahoo, league_key, _history_name, include=include, exclude=exclude)
        index = {"version": league_history.INDEX_VERSION, "league_key": league_key,
                 "current_season": max(found, key=int), "seasons": found}
        store.save(league_history.INDEX_KEY, index)

    current = index["current_season"]
    order = [current] + sorted((y for y in index["seasons"] if y != current), key=int, reverse=True)
    seasons, pending, skipped = {}, [], []
    for year in order:
        key = league_history.SEASON_KEY.format(year)
        league = index["seasons"][year]["league_key"]
        saved = store.load(key, None)
        if saved and saved.get("league_key") != league:
            saved = None  # saved from a different league than the one now picked for this year
        if saved and saved.get("complete") and year != current:
            seasons[year] = saved
            continue
        if time.time() > deadline:
            pending.append(year)
            if saved:
                seasons[year] = saved
            continue
        try:
            info = league_history.fetch_season(yahoo, league, saved, deadline, year == current)
        except Exception as exc:
            print(f"  {year}: skipped - Yahoo wouldn't return this league's scores ({exc})")
            skipped.append(year)
            continue
        store.save(key, info)
        seasons[year] = info
        if not info.get("complete") and year != current:
            pending.append(year)
        print(f"  {year}: {sum(len(g) for g in info['weeks'].values())} matchups saved"
              + ("" if info.get("complete") or year == current else " so far"))

    standings_teams = [t for season in index["seasons"].values() for t in season.get("teams", [])]
    resolve = league_history.linked(_history_name, league_history.account_names(seasons, _history_name, standings_teams))
    game_keys = {}
    history = league_history.build_history(seasons, current, resolve, index["seasons"][current].get("name") or "",
                                           standings=index["seasons"], excluded=_excluded, game_keys=game_keys)
    _put(s3, bucket, league_history.PUBLIC_KEY, json.dumps(history, separators=(",", ":")), "application/json")
    _put(s3, bucket, RIVALRY_PAGE_KEY, _rivalry_page_html(), "text/html")
    _put(s3, bucket, CAREER_PAGE_KEY, _career_page_html(), "text/html")
    _put(s3, bucket, RECORD_PAGE_KEY, _record_page_html(), "text/html")
    for year in skipped:
        index["seasons"][year]["skipped"] = True
    box_pending = _refresh_boxscores(s3, bucket, yahoo, seasons, game_keys, current, deadline)
    return index, history, pending + [y for y in box_pending if y not in pending], resolve


def _action_rivalry_history(event, context=None):
    bucket = _require_env("S3_BUCKET")
    league_key = event.get("league_key") or _require_env("LEAGUE_KEY")
    s3 = boto3.client("s3")
    yahoo = _YahooHistory(_get_access_token())
    index, history, pending, resolve = _refresh_rivalry(
        s3, bucket, yahoo, league_key, _deadline(context), rediscover=bool(event.get("rediscover")),
        include=event.get("include") or [], exclude=event.get("exclude") or [],
    )

    finals = [m for m in history["matchups"] if m["status"] == "final"]
    years = sorted({m["season"] for m in finals})
    print(f"\nSeasons found: {', '.join(sorted(index['seasons'], key=int))}")
    for year in sorted(index["seasons"], key=int):
        s = index["seasons"][year]
        count = sum(1 for m in finals if m["season"] == int(year))
        note = "skipped, Yahoo wouldn't return scores" if s.get("skipped") else f"{count} final games"
        print(f"  {year}: {s.get('name')!r} ({s['league_key']}, {s.get('how', '')}) - {note}")
    print("\nNicknames not linked to anyone on MANAGER_NAMES, by season:")
    unlinked = False
    for year in sorted(index["seasons"], key=int):
        rows = [f"{t.get('manager')} ({t.get('team')})" for t in index["seasons"][year].get("teams", []) if not resolve(t)]
        if rows:
            unlinked = True
            print(f"  {year}: {', '.join(rows)}")
    if not unlinked:
        print("  none - every team in every season is linked to a manager")
    former = [m["name"] for m in history["managers"] if not m["active"]]
    if former:
        print("Managers not in this season's league (add their Yahoo nickname to MANAGER_NAMES"
              f" if any of them is a current manager on an old account): {', '.join(former)}")

    _put(s3, bucket, "landing.html", _landing_page_html(), "text/html")  # picks up nav changes right away
    champs = league_history.champions(index, lambda t: resolve(t) or t.get("manager"))
    if champs:
        _put(s3, bucket, "history.json", json.dumps(champs), "application/json")
        landing = _load_json(s3, bucket, "landing.json", None)
        if landing is not None:
            landing["champions"] = champs
            _put(s3, bucket, "landing.json", json.dumps(landing), "application/json")
        for c in champs:
            print(f"  Champion {c['season']}: {c['champion']} (runner-up {c['runner_up']})")

    if pending:
        print(f"\nNot finished - still missing scores or lineups from {', '.join(sorted(pending))}."
              " Run this again to continue (each run picks up where the last one stopped).")
    else:
        print(f"\nDone. {len(finals)} games from {years[0] if years else '-'} to {years[-1] if years else '-'}, with"
              f" lineups, are live at https://stats.gooncocks.com/{RIVALRY_PAGE_KEY},"
              f" https://stats.gooncocks.com/{CAREER_PAGE_KEY} and https://stats.gooncocks.com/{RECORD_PAGE_KEY}")
    return {
        "seasons": sorted(index["seasons"], key=int), "final_games": len(finals),
        "still_missing": pending, "former_managers": former, "champions": champs,
        "page": f"https://stats.gooncocks.com/{RIVALRY_PAGE_KEY}",
        "careers_page": f"https://stats.gooncocks.com/{CAREER_PAGE_KEY}",
        "records_page": f"https://stats.gooncocks.com/{RECORD_PAGE_KEY}",
    }


def _update_rivalry_week(league_key, context):
    """After a weekly publish: pull this season's newly finished weeks into
    the Rivalry Center (usually one or two Yahoo calls). Does nothing until
    rivalry_history has been run once."""
    bucket = _require_env("S3_BUCKET")
    s3 = boto3.client("s3")
    if _load_json(s3, bucket, league_history.INDEX_KEY, None) is None:
        print('Rivalry Center not set up yet - run {"action": "rivalry_history"} once to turn it on.')
        return
    _index, _history, pending, _resolve = _refresh_rivalry(s3, bucket, _YahooHistory(_get_access_token()), league_key, _deadline(context, 10))
    print("Updated the Rivalry Center." + (f" Older seasons still missing: {', '.join(pending)}." if pending else ""))


def _action_recap(event):
    week, matchups, rosters, transactions = _fetch_real_matchups(event)
    bucket = os.environ.get("S3_BUCKET")
    standings = _standings_with_week(boto3.client("s3"), bucket, week, matchups) if bucket else None
    extras = compute_extra_awards(matchups, standings=standings, rosters=rosters, transactions=transactions)
    recap_text = generate_recap(week=week, matchups=matchups, extras=extras)
    print(recap_text)
    return {"recap": recap_text}


def _load_json(s3, bucket, key, default):
    try:
        obj = s3.get_object(Bucket=bucket, Key=key)
        return json.loads(obj["Body"].read().decode("utf-8"))
    except s3.exceptions.NoSuchKey:
        return default


def _put(s3, bucket, key, body, content_type):
    # Short cache so the landing page picks up each Tuesday's publish quickly.
    s3.put_object(
        Bucket=bucket, Key=key, Body=body.encode("utf-8") if isinstance(body, str) else body,
        ContentType=content_type, CacheControl="max-age=300",
    )


def _load_standings(s3, bucket):
    """standings.json holds every week's win/loss + points records that
    have ever been published for real (see week_records() in awards.py) -
    {"weeks": {"1": [...], "2": [...], ...}}. Returns an empty skeleton if
    the file doesn't exist yet (first real publish of the season)."""
    return _load_json(s3, bucket, "standings.json", {"weeks": {}})


def _landing_page_html():
    """landing.html is written as a page fragment (so the same file also
    previews as a Claude artifact); wrap it into a full document for S3."""
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "landing.html"), encoding="utf-8") as f:
        page = f.read()
    split = page.find("<header")
    head, body = (page[:split], page[split:]) if split != -1 else ("", page)
    return (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<meta name="theme-color" content="#0b1220">\n'
        f"{head}</head>\n<body>\n{body}\n</body>\n</html>\n"
    )


def _landing_data(week, matchups, standings, champions, previous):
    """What landing.html renders: the latest finished week's headline
    matchup, season standings, every archived week's Goon, and past
    champions. Re-publishing an older week keeps the newest week's
    headline in place."""
    weeks = []
    for key, records in standings.get("weeks", {}).items():
        if str(key).isdigit() and records:
            top = max(records, key=lambda r: r["points_for"])
            weeks.append({"week": int(key), "goon": top["id"], "score": round(top["points_for"], 2)})
    weeks.sort(key=lambda w: w["week"])
    latest = weeks[-1]["week"] if weeks else int(week)

    if int(week) == latest:
        b = compute_awards(matchups)["blowout"]
        m = next(m for m in matchups if m.winner == b["winner"] and m.loser == b["loser"])
        blowout = {
            "winner": identity(m.winner, m.winner_manager), "winner_score": round(max(m.team_a_score, m.team_b_score), 2),
            "loser": identity(m.loser, m.loser_manager), "loser_score": round(m.loser_score, 2), "margin": round(m.margin, 2),
        }
    else:
        blowout = previous.get("blowout") if previous.get("week") == latest else None

    today = datetime.date.today()
    return {
        "updated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "season": today.year if today.month >= 3 else today.year - 1,
        "week": latest,
        "blowout": blowout,
        "standings": [
            {"name": e["id"], "wins": e["wins"], "losses": e["losses"], "points_for": round(e["points_for"], 2)}
            for e in power_rankings(standings)
        ],
        "weeks": weeks,
        "champions": champions,
    }


# Artwork shipped inside the Lambda zip and copied to the bucket root on
# every publish: the peacock banner (landing hero + recap headline) and
# the Goon / Cock of the Week card art.
ART_FILES = ("landing-hero.webp", "goon-art.webp", "cock-art.webp")


def _upload_art(s3, bucket):
    here = os.path.dirname(os.path.abspath(__file__))
    for name in ART_FILES:
        with open(os.path.join(here, name), "rb") as f:
            _put(s3, bucket, name, f.read(), "image/webp")


def _publish_landing(s3, bucket, week, matchups, standings):
    previous = _load_json(s3, bucket, "landing.json", {})
    champions = _load_json(s3, bucket, "history.json", [])
    data = _landing_data(week, matchups, standings, champions, previous)
    _put(s3, bucket, "landing.json", json.dumps(data), "application/json")
    _put(s3, bucket, "landing.html", _landing_page_html(), "text/html")
    print("Updated the landing page (landing.html + landing.json).")


def _standings_with_week(s3, bucket, week, matchups):
    standings = _load_standings(s3, bucket)
    weeks = standings.setdefault("weeks", {})
    # Left behind by runs from before the week number was resolved.
    weeks.pop("current", None)
    # Weeks saved before MANAGER_NAMES existed are keyed by Yahoo nickname;
    # rename them so nobody shows up twice in the power rankings.
    for records in weeks.values():
        for rec in records:
            rec["id"] = _MANAGER_LOOKUP.get(_name_key(rec["id"]), rec["id"])
    weeks[str(week)] = week_records(matchups)
    return standings


def _save_standings(s3, bucket, standings):
    s3.put_object(
        Bucket=bucket, Key="standings.json",
        Body=json.dumps(standings).encode("utf-8"), ContentType="application/json",
    )


def _publish_page(week, matchups, is_sample, bonus_note=None, rosters=None, transactions=None, notify=True):
    """Renders the webpage, uploads it to S3, and posts a Discord teaser
    if DISCORD_WEBHOOK_URL is set. Returns the page's public URL.

    recap.html always holds the latest week - that's what stats.gooncocks.com
    shows by default, and it gets overwritten every publish. For a real
    (non-demo) publish, this also saves a permanent snapshot at
    weeks/week-<N>.html that never gets overwritten by a later week, so old
    recaps stay linkable/shareable after a new one goes up. It also
    updates standings.json with this week's win/loss + points (overwriting
    just this week's entry, so re-publishing the same week to fix a
    mistake never double-counts it) and feeds the resulting season-long
    Power Rankings into the page."""
    bucket = _require_env("S3_BUCKET")
    s3 = boto3.client("s3")

    standings_ranked = extras = None
    published_weeks = []
    is_latest = True
    if not is_sample:
        standings = _standings_with_week(s3, bucket, week, matchups)
        _save_standings(s3, bucket, standings)
        standings_ranked = power_rankings(standings)
        extras = compute_extra_awards(matchups, standings=standings, rosters=rosters, transactions=transactions)
        published_weeks = sorted(int(k) for k in standings["weeks"] if str(k).isdigit())
        latest = published_weeks[-1]
        is_latest = int(week) >= latest

    try:
        details = award_details(
            matchups, compute_awards(matchups), extras, rosters=rosters, standings=None if is_sample else standings,
        )
    except Exception:
        traceback.print_exc()
        print("Skipped the award detail lines this run - see the error above.")
        details = {}

    try:
        _upload_art(s3, bucket)
    except Exception:
        traceback.print_exc()
        print("Skipped uploading the page artwork this run - see the error above.")

    html = render_html(
        week, matchups, is_sample=is_sample, bonus_note=bonus_note, standings=standings_ranked, extras=extras,
        details=details, weeks=published_weeks,
    )
    website_url = os.environ.get("S3_WEBSITE_URL")
    page_url = f"{website_url.rstrip('/')}/recap.html" if website_url else f"s3://{bucket}/recap.html"
    if is_latest:
        _put(s3, bucket, "recap.html", html, "text/html")
        print(f"Published to {page_url}")
    else:
        print(f"Week {week} is older than week {latest}, so the main recap page keeps showing week {latest}.")

    archive_url = None
    if not is_sample:
        archive_key = f"weeks/week-{week}.html"
        _put(s3, bucket, archive_key, html, "text/html")
        archive_url = f"{website_url.rstrip('/')}/{archive_key}" if website_url else f"s3://{bucket}/{archive_key}"
        print(f"Archived permanent snapshot at {archive_url}")

    if not is_sample:
        try:
            _publish_landing(s3, bucket, week, matchups, standings)
        except Exception:
            traceback.print_exc()
            print("Skipped updating the landing page this run - see the error above.")

    webhook_url = os.environ.get("DISCORD_WEBHOOK_URL")
    if webhook_url and is_latest and notify:
        teaser = build_teaser(week, compute_awards(matchups), page_url=page_url)
        post_message(webhook_url, teaser)
        print("Posted teaser to Discord.")

    return page_url, archive_url


def _action_publish_demo():
    page_url, _archive_url = _publish_page(1, SAMPLE_MATCHUPS, is_sample=True)
    return {"page_url": page_url}


def _action_publish(event, context=None):
    week, matchups, rosters, transactions = _fetch_real_matchups(event)
    page_url, archive_url = _publish_page(
        week, matchups, is_sample=False, bonus_note=event.get("bonus_note"),
        rosters=rosters, transactions=transactions, notify=event.get("discord", True),
    )
    try:
        _update_rivalry_week(event.get("league_key") or _require_env("LEAGUE_KEY"), context)
    except Exception:
        traceback.print_exc()
        print("Skipped updating the Rivalry Center this run - see the error above.")
    return {"page_url": page_url, "archive_url": archive_url}


def _action_publish_manual(event):
    """Publishes real matchups passed directly in the test event - no
    Yahoo access needed, no code changes needed. Expected shape:
        {
          "action": "publish_manual",
          "week": 1,
          "matchups": [
            {"team_a": "wilzer", "score_a": 145.2, "team_b": "DJ Killzer Willzer", "score_b": 132.1,
             "proj_a": 158.72, "proj_b": 156.05,
             "manager_a": "Will", "manager_b": "Chet"},
            ...
          ],
          "bonus_note": {
            "title": "BENCHWARMER ALERT",
            "team": "Hurts 2 Cook em", "manager": "Will",
            "detail": "Jalen Coker went off on the bench.",
            "value": "38.80", "unit": "BENCH POINTS"
          }
        }
    proj_a/proj_b are optional - Upset of the Week is skipped without them.
    manager_a/manager_b are optional too - when set, the webpage displays
    and matches headshots by manager instead of by team name, so a
    mid-season team rename doesn't lose someone's photo or history.
    bonus_note is optional too - a one-off commissioner callout that isn't
    a computed award (e.g. a notable bench stat). Only "title" and "detail"
    are required inside it; "team"/"manager" adds a headshot + name,
    "value"/"unit" adds a highlighted stat number. Leave it out entirely
    for a normal week with nothing extra to call out.
    """
    week = event.get("week", 1)
    raw_matchups = event.get("matchups")
    if not raw_matchups:
        raise RuntimeError('The "publish_manual" action needs a "matchups" list in the test event.')

    matchups = [
        Matchup(
            team_a_name=m["team_a"],
            team_a_score=float(m["score_a"]),
            team_b_name=m["team_b"],
            team_b_score=float(m["score_b"]),
            team_a_projected=float(m["proj_a"]) if m.get("proj_a") is not None else None,
            team_b_projected=float(m["proj_b"]) if m.get("proj_b") is not None else None,
            team_a_manager=m.get("manager_a"),
            team_b_manager=m.get("manager_b"),
        )
        for m in raw_matchups
    ]
    page_url, archive_url = _publish_page(week, matchups, is_sample=False, bonus_note=event.get("bonus_note"))
    return {"page_url": page_url, "archive_url": archive_url}


def lambda_handler(event, context):
    event = event or {}
    # Yahoo's Fantasy Sports API access is approved, so the weekly
    # EventBridge schedule (which always calls this with an empty event,
    # unlike a manual Test run) now defaults to a real "publish" instead
    # of "publish_demo".
    action = event.get("action", "publish")
    if action == "auth_url":
        return _action_auth_url()
    if action == "exchange":
        return _action_exchange(event)
    if action == "demo":
        return _action_demo()
    if action == "publish_demo":
        return _action_publish_demo()
    if action == "publish_manual":
        return _action_publish_manual(event)
    if action == "leagues":
        return _action_leagues()
    if action == "managers":
        return _action_managers(event)
    if action == "history":
        return _action_history(event)
    if action == "rivalry_history":
        return _action_rivalry_history(event, context)
    if action == "recap":
        return _action_recap(event)
    if action == "publish":
        return _action_publish(event, context)
    raise RuntimeError(f"Unknown action: {action!r}")
