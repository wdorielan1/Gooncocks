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

  The actual recap, printed only:
    {"action": "recap"}

  The actual recap, published - fetches real Yahoo data, renders the
  webpage, uploads to S3, posts to Discord if configured. This is also
  the default if you omit "action":
    {"action": "publish"}
"""
import json
import os
import re
import traceback

import boto3

from awards import Matchup, generate_recap, compute_awards, compute_extra_awards, power_rankings, week_records
from discord_client import build_teaser, post_message
from sample_data import SAMPLE_MATCHUPS
from webpage import render_html
from yahoo_client import (
    build_authorize_url,
    exchange_code_for_tokens,
    get_player_points,
    get_scoreboard,
    get_team_roster,
    get_transactions,
    get_user_leagues,
    parse_matchups,
    refresh_access_token,
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
    "Jose": "Jose",
    "Samuel": "Sam",
    "Chett": "Chet",
}


def _name_key(value):
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


_MANAGER_LOOKUP = {_name_key(k): v for k, v in MANAGER_NAMES.items()}


def _manager_name(team):
    guid, nickname = team.get("manager_guid"), team.get("manager")
    return _MANAGER_LOOKUP.get(_name_key(guid)) or _MANAGER_LOOKUP.get(_name_key(nickname)) or nickname


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


def _action_recap(event):
    week, matchups, rosters, transactions = _fetch_real_matchups(event)
    bucket = os.environ.get("S3_BUCKET")
    standings = _standings_with_week(boto3.client("s3"), bucket, week, matchups) if bucket else None
    extras = compute_extra_awards(matchups, standings=standings, rosters=rosters, transactions=transactions)
    recap_text = generate_recap(week=week, matchups=matchups, extras=extras)
    print(recap_text)
    return {"recap": recap_text}


def _load_standings(s3, bucket):
    """standings.json holds every week's win/loss + points records that
    have ever been published for real (see week_records() in awards.py) -
    {"weeks": {"1": [...], "2": [...], ...}}. Returns an empty skeleton if
    the file doesn't exist yet (first real publish of the season)."""
    try:
        obj = s3.get_object(Bucket=bucket, Key="standings.json")
        return json.loads(obj["Body"].read().decode("utf-8"))
    except s3.exceptions.NoSuchKey:
        return {"weeks": {}}


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


def _publish_page(week, matchups, is_sample, bonus_note=None, rosters=None, transactions=None):
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
    if not is_sample:
        standings = _standings_with_week(s3, bucket, week, matchups)
        _save_standings(s3, bucket, standings)
        standings_ranked = power_rankings(standings)
        extras = compute_extra_awards(matchups, standings=standings, rosters=rosters, transactions=transactions)

    html = render_html(
        week, matchups, is_sample=is_sample, bonus_note=bonus_note, standings=standings_ranked, extras=extras,
    )
    s3.put_object(Bucket=bucket, Key="recap.html", Body=html.encode("utf-8"), ContentType="text/html")

    website_url = os.environ.get("S3_WEBSITE_URL")
    page_url = f"{website_url.rstrip('/')}/recap.html" if website_url else f"s3://{bucket}/recap.html"
    print(f"Published to {page_url}")

    archive_url = None
    if not is_sample:
        archive_key = f"weeks/week-{week}.html"
        s3.put_object(Bucket=bucket, Key=archive_key, Body=html.encode("utf-8"), ContentType="text/html")
        archive_url = f"{website_url.rstrip('/')}/{archive_key}" if website_url else f"s3://{bucket}/{archive_key}"
        print(f"Archived permanent snapshot at {archive_url}")

    webhook_url = os.environ.get("DISCORD_WEBHOOK_URL")
    if webhook_url:
        teaser = build_teaser(week, compute_awards(matchups), page_url=page_url)
        post_message(webhook_url, teaser)
        print("Posted teaser to Discord.")

    return page_url, archive_url


def _action_publish_demo():
    page_url, _archive_url = _publish_page(1, SAMPLE_MATCHUPS, is_sample=True)
    return {"page_url": page_url}


def _action_publish(event):
    week, matchups, rosters, transactions = _fetch_real_matchups(event)
    page_url, archive_url = _publish_page(
        week, matchups, is_sample=False, bonus_note=event.get("bonus_note"),
        rosters=rosters, transactions=transactions,
    )
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
    if action == "recap":
        return _action_recap(event)
    if action == "publish":
        return _action_publish(event)
    raise RuntimeError(f"Unknown action: {action!r}")
