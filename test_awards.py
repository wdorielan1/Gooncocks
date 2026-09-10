#!/usr/bin/env python3
"""
Prints a sample recap using made-up data - no Yahoo account, no internet
connection, and no environment variables needed. Run this first to confirm
the recap format looks right before touching any real API credentials.
"""
from awards import Matchup, generate_recap

SAMPLE_MATCHUPS = [
    Matchup(
        "Gridiron Gurus", 142.36, "Waiver Wire Warriors", 58.14,
        team_a_projected=110.0, team_b_projected=115.0,
    ),
    Matchup(
        "Fumble Dynasty", 101.22, "Hail Mary Heroes", 100.98,
        team_a_projected=95.0, team_b_projected=112.0,
    ),
    Matchup(
        "Bench Press Bandits", 87.50, "Zero Points Given", 121.40,
        team_a_projected=100.0, team_b_projected=98.0,
    ),
]

if __name__ == "__main__":
    print(generate_recap(week=1, matchups=SAMPLE_MATCHUPS))
