"""
AWS Lambda entry point. Paste this file, awards.py, and yahoo_client.py into
a Lambda function's code editor (Python 3.x runtime) as separate files in
the same folder - no pip packages needed, everything here is stdlib.

Set these environment variables on the Lambda function's Configuration tab:
  YAHOO_CLIENT_ID
  YAHOO_CLIENT_SECRET
  YAHOO_REFRESH_TOKEN   (only needed once you have one - see the "auth_url"
                         and "exchange" actions below to get it)
  LEAGUE_KEY            (optional - only needed if you're in more than one
                         Yahoo NFL league)
  WEEK                  (optional - defaults to Yahoo's current week)

Drive it with the "Test" button in the Lambda console, using a test event
(JSON) shaped like one of these:

  One-time setup, step A - get the login link:
    {"action": "auth_url"}

  One-time setup, step B - after you open that link, log in, and Yahoo
  shows you a short code, trade it in for a refresh token:
    {"action": "exchange", "code": "PASTE_THE_CODE_HERE"}
  Copy the refresh_token from the response into the YAHOO_REFRESH_TOKEN
  environment variable, then you're set up for good.

  See your leagues (only needed if you belong to more than one):
    {"action": "leagues"}

  The actual recap - this is also the default if you omit "action":
    {"action": "recap"}

The recap text is printed (check the "Function Logs" / execution results
panel under the Test button - that's where the nicely-formatted, multi-line
recap shows up) and also returned as JSON for anything that consumes this
programmatically later (e.g. a Discord webhook).
"""
import os

from awards import Matchup, generate_recap
from yahoo_client import (
    build_authorize_url,
    exchange_code_for_tokens,
    get_scoreboard,
    get_user_leagues,
    parse_matchups,
    refresh_access_token,
)


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


def _action_leagues():
    access_token = _get_access_token()
    leagues = get_user_leagues(access_token)
    for lg in leagues:
        print(f"  {lg['name']}  (season {lg['season']}, {lg['num_teams']} teams)  key={lg['league_key']}")
    return {"leagues": leagues}


def _action_recap(event):
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
        )
        for m in raw_matchups
    ]

    recap_text = generate_recap(week=week or "current", matchups=matchups)
    print(recap_text)
    return {"recap": recap_text}


def lambda_handler(event, context):
    event = event or {}
    action = event.get("action", "recap")
    if action == "auth_url":
        return _action_auth_url()
    if action == "exchange":
        return _action_exchange(event)
    if action == "leagues":
        return _action_leagues()
    if action == "recap":
        return _action_recap(event)
    raise RuntimeError(f"Unknown action: {action!r}")
