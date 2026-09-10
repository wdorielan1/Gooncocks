"""
Made-up matchup data used by test_awards.py (local, no Lambda) and by the
"demo" action in lambda_function.py (proves the whole Lambda pipeline works
without needing real Yahoo access yet).
"""
from awards import Matchup

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
