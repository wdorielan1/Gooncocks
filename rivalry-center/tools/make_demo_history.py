#!/usr/bin/env python3
"""
Generates data/demo-history.js: made-up but internally consistent league
history so every Rivalry Center feature can be tested before real Yahoo
history is loaded. Nothing here comes from Yahoo.

Each season: a 14-week round-robin regular season, a 6-team championship
bracket (weeks 15-17, top two seeds get byes, plus a third-place game) and
a consolation bracket for seeds 7-10 (weeks 15-16). The current season has
two completed weeks and one scheduled week, so completion filtering is
exercised too.

Run from anywhere:  python3 rivalry-center/tools/make_demo_history.py
The seed is fixed, so the output is the same every run.
"""
import json
import os
import random

SEED = 2026
FIRST_SEASON, LAST_FULL_SEASON, CURRENT_SEASON = 2019, 2025, 2026

MANAGERS = [
    ("will", "Will"), ("gabe", "Gabe"), ("sam", "Sam"), ("chet", "Chet"), ("chris", "Chris"),
    ("jose", "Jose"), ("matt", "Matt"), ("patrick", "Patrick"), ("tamir", "Tamir"), ("brandon", "Brandon"),
]

# Demo team names. They change between seasons on purpose: the page keys
# everything off manager IDs, never team names.
TEAM_NAMES = {
    "will": ["Will Power", "Allen Wrench", "Cook em till it Hurtz"],
    "gabe": ["Gabe's Gamblers", "Waiver Wire Wizard", "Clinched"],
    "sam": ["Sam I Am", "Sammy Sosa", "Three Rings Sam"],
    "chet": ["Chet Faker", "Chett's Angels", "Bench Press"],
    "chris": ["Chris Cross", "Run CMC", "Wide Deceiver"],
    "jose": ["Jose Can You See", "Josey Wales", "Hot Sauce"],
    "matt": ["Mattress Firm", "Matt Ryan's Hope", "Pikliz Six"],
    "patrick": ["Patrick Swayze", "Mahomes Alone", "DJ Moore Like a DJ"],
    "tamir": ["Tamir Rice Bowl", "Tua Legit", "Jibril"],
    "brandon": ["Brandon's Bunch", "Bijan Mustard", "Let's Go Brandon"],
}

# Small head-to-head nudges so the demo has some storylines to find.
PAIR_EDGE = {("jose", "matt"): 9, ("sam", "gabe"): 4, ("will", "gabe"): 2, ("tamir", "brandon"): 5}


def round_robin(ids):
    """Circle-method schedule: 9 rounds where everyone plays everyone once."""
    ids = list(ids)
    rounds = []
    for _ in range(len(ids) - 1):
        rounds.append([(ids[i], ids[-1 - i]) for i in range(len(ids) // 2)])
        ids = [ids[0]] + [ids[-1]] + ids[1:-1]
    return rounds


def main():
    rng = random.Random(SEED)
    ids = [m for m, _ in MANAGERS]
    base = {m: rng.uniform(-1, 1) for m in ids}
    matchups, teams = [], {}

    def score(season, m, opp, strength):
        league_mean = 108 + (season - FIRST_SEASON) * 3.2
        edge = PAIR_EDGE.get((m, opp), 0) - PAIR_EDGE.get((opp, m), 0)
        return round(max(58.0, rng.gauss(league_mean + strength[m] * 9 + edge / 2, 21)), 2)

    def play(season, week, game_type, rnd, a, b, strength, status="final"):
        gid = f"{season}-w{week:02d}-{a}-{b}"
        row = {"id": gid, "season": season, "week": week, "gameType": game_type, "round": rnd,
               "status": status, "managerA": a, "managerB": b, "scoreA": None, "scoreB": None}
        if status == "final":
            row["scoreA"], row["scoreB"] = score(season, a, b, strength), score(season, b, a, strength)
        matchups.append(row)
        return row

    def winner(row):
        return row["managerA"] if row["scoreA"] >= row["scoreB"] else row["managerB"]

    for season in range(FIRST_SEASON, CURRENT_SEASON + 1):
        strength = {m: base[m] * 0.6 + rng.uniform(-1, 1) for m in ids}
        era = min(2, (season - FIRST_SEASON) // 3)
        teams[str(season)] = {m: TEAM_NAMES[m][era] for m in ids}
        order = ids[:]
        rng.shuffle(order)
        rounds = round_robin(order)
        weeks = rounds + rounds[:5]  # 14 regular-season weeks

        if season == CURRENT_SEASON:
            for week, pairs in enumerate(weeks[:3], start=1):
                for a, b in pairs:
                    play(season, week, "regular", None, a, b, strength, "final" if week <= 2 else "scheduled")
            continue

        record = {m: [0, 0.0] for m in ids}
        for week, pairs in enumerate(weeks, start=1):
            for a, b in pairs:
                row = play(season, week, "regular", None, a, b, strength)
                record[winner(row)][0] += 1
                record[row["managerA"]][1] += row["scoreA"]
                record[row["managerB"]][1] += row["scoreB"]
        seeds = sorted(ids, key=lambda m: (-record[m][0], -record[m][1]))

        # Championship bracket: seeds 1-2 bye, 3v6 and 4v5 in week 15.
        q1 = play(season, 15, "playoff", "Quarterfinal", seeds[2], seeds[5], strength)
        q2 = play(season, 15, "playoff", "Quarterfinal", seeds[3], seeds[4], strength)
        alive = sorted([winner(q1), winner(q2)], key=seeds.index)
        s1 = play(season, 16, "playoff", "Semifinal", seeds[0], alive[1], strength)
        s2 = play(season, 16, "playoff", "Semifinal", seeds[1], alive[0], strength)
        losers = [m for s in (s1, s2) for m in (s["managerA"], s["managerB"]) if m != winner(s)]
        play(season, 17, "playoff", "Championship", winner(s1), winner(s2), strength)
        play(season, 17, "playoff", "Third Place", losers[0], losers[1], strength)

        # Consolation bracket for seeds 7-10 (excluded from records by default).
        c1 = play(season, 15, "consolation", "Consolation", seeds[6], seeds[9], strength)
        c2 = play(season, 15, "consolation", "Consolation", seeds[7], seeds[8], strength)
        play(season, 16, "consolation", "Consolation", winner(c1), winner(c2), strength)

    data = {
        "source": "demo",
        "label": "Demo data. Illustrative history, not loaded from Yahoo.",
        "league": "SPU Peacocks Fantasy Football",
        "photoBaseUrl": "https://stats.gooncocks.com/photos/",
        "managers": [{"id": m, "name": n} for m, n in MANAGERS],
        "teams": teams,
        "matchups": matchups,
    }
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "demo-history.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write("/* DEMO DATA - generated by tools/make_demo_history.py. Not from Yahoo.\n"
                "   Replace with a normalized Yahoo export (same shape) - see README.md. */\n")
        f.write("window.GOONCOCKS_HISTORY = ")
        json.dump(data, f, separators=(",", ":"))
        f.write(";\n")
    print(f"Wrote {len(matchups)} matchups across {len(teams)} seasons to {os.path.normpath(out)}")


if __name__ == "__main__":
    main()
