#!/usr/bin/env python3
"""
Prints a sample recap using made-up data - no Yahoo account, no internet
connection, and no environment variables needed. Run this first to confirm
the recap format looks right before touching any real API credentials.
"""
from awards import generate_recap
from sample_data import SAMPLE_MATCHUPS
from awards import compute_awards
from discord_client import build_teaser

if __name__ == "__main__":
    print(generate_recap(week=1, matchups=SAMPLE_MATCHUPS))

    # The Discord post: each award on its own lines, manager with team name.
    teaser = build_teaser(3, compute_awards(SAMPLE_MATCHUPS), page_url="https://example.com/recap.html")
    print("\n" + teaser)
    parts = teaser.split("\n\n")
    assert parts[0] == "🦚 **Gooncocks · Week 3 Recap**", parts
    assert parts[1].startswith("🏆 **Goon of the Week**\n") and parts[1].endswith(" pts · +$50"), parts
    assert parts[2].startswith("🐓 **Cock of the Week**\n") and parts[2].endswith(" pts"), parts
    assert parts[3] == "Full recap:\nhttps://example.com/recap.html", parts
    odd = {"goon": {"team": "*Goon_Squad*", "manager": "Will", "score": 150.0},
           "cock": {"team": "Bench", "manager": None, "score": 60.5}}
    assert "**Will** (*\\*Goon\\_Squad\\**)" in build_teaser(1, odd), build_teaser(1, odd)
    assert "🐓 **Cock of the Week**\n**Bench**\n60.50 pts" in build_teaser(1, odd), build_teaser(1, odd)
    print("\nDiscord teaser checks passed.")
