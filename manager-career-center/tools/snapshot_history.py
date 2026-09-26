#!/usr/bin/env python3
"""
Refreshes data/league-history.js with the league's real Yahoo history, so
the Career Center can be opened straight from this folder.

It reads the season files the Lambda's rivalry_history action saved in the
S3 bucket (public, read-only) and builds the history with the same code the
Lambda uses (league_history.py + MANAGER_NAMES from lambda_function.py). No
Yahoo credentials are needed or used.

    python3 manager-career-center/tools/snapshot_history.py
"""
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, REPO)

import league_history  # noqa: E402
import lambda_function  # noqa: E402

BUCKET_URL = "https://gooncocks-recap-891823750306-us-east-2-an.s3.us-east-2.amazonaws.com"


def fetch(key):
    with urllib.request.urlopen(f"{BUCKET_URL}/{key}", timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    index = fetch(league_history.INDEX_KEY)
    seasons = {}
    for year, info in index["seasons"].items():
        try:
            saved = fetch(league_history.SEASON_KEY.format(year))
        except Exception as exc:
            print(f"  {year}: no saved scores ({exc})")
            continue
        if saved.get("league_key") == info["league_key"]:
            seasons[year] = saved
    standings_teams = [t for s in index["seasons"].values() for t in s.get("teams", [])]
    resolve = league_history.linked(
        lambda_function._history_name,
        league_history.account_names(seasons, lambda_function._history_name, standings_teams),
    )
    current = index["current_season"]
    history = league_history.build_history(
        seasons, current, resolve, index["seasons"][current].get("name") or "", standings=index["seasons"],
    )
    history["label"] = history["label"].rstrip(".") + " (snapshot)."
    out = os.path.join(HERE, "..", "data", "league-history.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write("/* Real Yahoo league history, copied from the Lambda's saved season files by\n"
                "   tools/snapshot_history.py. Re-run that script to refresh it. */\n")
        f.write("window.GOONCOCKS_HISTORY = ")
        json.dump(history, f, separators=(",", ":"), ensure_ascii=False)
        f.write(";\n")
    finals = sum(1 for m in history["matchups"] if m["status"] == "final")
    print(f"Wrote {finals} final games, {len(history['managers'])} managers, "
          f"seasons {', '.join(sorted(history['teams']))} to {os.path.normpath(out)}")


if __name__ == "__main__":
    main()
