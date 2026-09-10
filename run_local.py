#!/usr/bin/env python3
"""
Pulls your real Yahoo league and prints a weekly recap.

Needs three environment variables set first (see .env.example / README.md):
  YAHOO_CLIENT_ID
  YAHOO_CLIENT_SECRET
  YAHOO_REFRESH_TOKEN

LEAGUE_KEY and WEEK are optional.
  - If LEAGUE_KEY is not set and you're in more than one league, this
    script lists them (with their keys) and, in an interactive terminal,
    asks you to pick one. In a non-interactive run it just prints the list
    and exits so you (or whoever is running this for you) can set
    LEAGUE_KEY and run it again.
  - If WEEK is not set, Yahoo defaults to the current week.
"""
import os
import sys

from awards import Matchup, generate_recap
from yahoo_client import (
    get_scoreboard,
    get_user_leagues,
    parse_matchups,
    refresh_access_token,
)


def require_env(name):
    value = os.environ.get(name)
    if not value:
        print(f"Missing required environment variable: {name}")
        print("See .env.example / README.md for how to set it.")
        sys.exit(1)
    return value


def pick_league(access_token):
    print("LEAGUE_KEY is not set - looking up your NFL leagues...")
    leagues = get_user_leagues(access_token)
    if not leagues:
        print("No NFL fantasy leagues found on this Yahoo account.")
        sys.exit(1)
    if len(leagues) == 1:
        print(f"Found one league: {leagues[0]['name']} ({leagues[0]['league_key']})")
        return leagues[0]["league_key"]

    print("\nFound multiple leagues:\n")
    for i, lg in enumerate(leagues, start=1):
        print(
            f"  {i}. {lg['name']}  (season {lg['season']}, "
            f"{lg['num_teams']} teams)  key={lg['league_key']}"
        )
    print()

    if not sys.stdin.isatty():
        print("Set LEAGUE_KEY to one of the keys above and run this again.")
        sys.exit(0)

    choice = input("Which one is tonight's league? Enter a number: ").strip()
    try:
        idx = int(choice) - 1
        return leagues[idx]["league_key"]
    except (ValueError, IndexError):
        print("That wasn't one of the listed numbers.")
        sys.exit(1)


def main():
    client_id = require_env("YAHOO_CLIENT_ID")
    client_secret = require_env("YAHOO_CLIENT_SECRET")
    refresh_token = require_env("YAHOO_REFRESH_TOKEN")
    league_key = os.environ.get("LEAGUE_KEY")
    week = os.environ.get("WEEK")

    print("Refreshing Yahoo access token...")
    tokens = refresh_access_token(client_id, client_secret, refresh_token)
    access_token = tokens["access_token"]

    if not league_key:
        league_key = pick_league(access_token)
        print(f"\nUsing league key: {league_key}")
        print("(Set LEAGUE_KEY in your environment to skip this prompt next time.)\n")

    week_note = f", week {week}" if week else " (current week)"
    print(f"Fetching scoreboard for league {league_key}{week_note}...")
    scoreboard_json = get_scoreboard(access_token, league_key, week=week)

    raw_matchups = parse_matchups(scoreboard_json)
    if not raw_matchups:
        print("\nYahoo returned a scoreboard, but no matchups came out of it.")
        print("Raw response for debugging:")
        print(scoreboard_json)
        sys.exit(1)

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

    resolved_week = week or "current"
    print()
    print(generate_recap(week=resolved_week, matchups=matchups))


if __name__ == "__main__":
    main()
