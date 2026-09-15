"""
The recap engine: pure logic, no network calls and no Yahoo-specific code.

compute_awards() does the actual scoring/award logic once; generate_recap()
(plain text) and webpage.py's render_html() (the shareable page) both build
on top of it, so the two outputs can never disagree with each other.

Award categories, and what they need:

  Computed here today, from scoreboard data alone (team score + projected
  score - nothing else):
    - Goon of the Week      - highest score of the week ($50 stakes)
    - Cock of the Week      - lowest score of the week (most embarrassing)
    - Biggest Blowout       - largest winning margin
    - Heartbreaker          - smallest losing margin
    - Upset of the Week     - projected loser who won anyway
    - Bad Beat              - loser who outscored the most other teams

  Season-long, computed from every week's matchups accumulated in S3's
  standings.json (see week_records()/power_rankings() below, and
  lambda_function.py's _publish_page for where that file gets read/written):
    - Power Rankings        - ranked by wins, then total points scored

  Not implemented yet - need Yahoo endpoints this project doesn't call yet
  (full rosters with bench points, transaction history):
    - Fraud Alert           - needs season record + points-for (standings
                              exist now via power_rankings(), just not
                              wired into a "Fraud Alert" comparison yet)
    - Benchwarmer Disaster  - needs full roster + bench player points
    - Start/Sit Disaster    - needs full roster + bench player points
    - Waiver-Wire Steal     - needs transaction history + player stats

  Not realistically automatable - these are judgment calls even with more
  data, and are left to the commissioner:
    - Trade Winner          - which manager benefited from a trade
    - Injury Excuse         - "most negatively affected" is a judgment call
"""
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class Matchup:
    team_a_name: str
    team_a_score: float
    team_b_name: str
    team_b_score: float
    # Projected scores are optional - Yahoo doesn't always hand them back,
    # and the "Upset of the Week" award just gets skipped without them.
    team_a_projected: Optional[float] = None
    team_b_projected: Optional[float] = None
    # Manager (person) names are optional too, and separate from team_*_name
    # on purpose: team names get renamed mid-season, but a manager is the
    # same person every week. When set, webpage.py displays and looks up
    # headshots by manager rather than by the current team name, so a
    # rename doesn't orphan someone's photo or make old recaps confusing.
    team_a_manager: Optional[str] = None
    team_b_manager: Optional[str] = None

    @property
    def margin(self) -> float:
        return abs(self.team_a_score - self.team_b_score)

    @property
    def winner(self) -> str:
        return self.team_a_name if self.team_a_score >= self.team_b_score else self.team_b_name

    @property
    def loser(self) -> str:
        return self.team_b_name if self.team_a_score >= self.team_b_score else self.team_a_name

    @property
    def loser_score(self) -> float:
        return min(self.team_a_score, self.team_b_score)

    @property
    def winner_manager(self) -> Optional[str]:
        return self.team_a_manager if self.team_a_score >= self.team_b_score else self.team_b_manager

    @property
    def loser_manager(self) -> Optional[str]:
        return self.team_b_manager if self.team_a_score >= self.team_b_score else self.team_a_manager


def rank_teams(matchups: List[Matchup]) -> list:
    """Every team's score this week, sorted highest to lowest. Used for the
    webpage's ranking bar chart."""
    all_scores = []
    for m in matchups:
        all_scores.append({"name": m.team_a_name, "score": m.team_a_score, "manager": m.team_a_manager})
        all_scores.append({"name": m.team_b_name, "score": m.team_b_score, "manager": m.team_b_manager})
    return sorted(all_scores, key=lambda t: t["score"], reverse=True)


def identity(team_name: str, manager: Optional[str] = None) -> str:
    """Stable identity for a team across weeks/renames: the manager's name
    if given, otherwise the team name. Used everywhere a person needs to
    be tracked consistently through a mid-season team rename - photo
    lookups (webpage.py) and season standings (below) both key off this,
    so a rename never splits someone's history or orphans their photo."""
    return manager or team_name


def week_records(matchups: List[Matchup]) -> list:
    """One record per team for a single week: identity, whether they won,
    and points for/against. This is the per-week building block that gets
    stored (one entry per week) in S3's standings.json - see
    power_rankings() for turning several weeks of these into a ranked
    table. An exact tie counts as a win for team_a, matching how
    Matchup.winner/loser already resolve ties elsewhere in this file."""
    records = []
    for m in matchups:
        a_id = identity(m.team_a_name, m.team_a_manager)
        b_id = identity(m.team_b_name, m.team_b_manager)
        a_won = m.team_a_score >= m.team_b_score
        records.append({"id": a_id, "win": a_won, "points_for": m.team_a_score, "points_against": m.team_b_score})
        records.append({"id": b_id, "win": not a_won, "points_for": m.team_b_score, "points_against": m.team_a_score})
    return records


def power_rankings(standings: dict) -> list:
    """Turns {"weeks": {"1": [...week_records()...], "2": [...], ...}}
    (S3's standings.json, loaded by lambda_function.py) into a season
    standings table ranked by wins, then total points scored as the
    tiebreaker. Each entry: {"id", "wins", "losses", "points_for",
    "points_against"}. This is a straightforward win/loss ranking, not a
    fancier blended power score (median score, all-play record, etc.) -
    good enough for "who's actually winning," can be upgraded later."""
    totals = {}
    for records in standings.get("weeks", {}).values():
        for rec in records:
            t = totals.setdefault(rec["id"], {"wins": 0, "losses": 0, "points_for": 0.0, "points_against": 0.0})
            t["wins"] += 1 if rec["win"] else 0
            t["losses"] += 0 if rec["win"] else 1
            t["points_for"] += rec["points_for"]
            t["points_against"] += rec["points_against"]
    ranked = sorted(totals.items(), key=lambda kv: (-kv[1]["wins"], -kv[1]["points_for"]))
    return [{"id": k, **v} for k, v in ranked]


def compute_awards(matchups: List[Matchup]) -> dict:
    """Returns a dict with one entry per award category. 'upset' and
    'bad_beat' are None when there isn't enough data to compute them."""
    all_scores = []
    for m in matchups:
        all_scores.append((m.team_a_name, m.team_a_score, m.team_a_manager))
        all_scores.append((m.team_b_name, m.team_b_score, m.team_b_manager))

    goon_team, goon_score, goon_manager = max(all_scores, key=lambda t: t[1])
    cock_team, cock_score, cock_manager = min(all_scores, key=lambda t: t[1])
    blowout = max(matchups, key=lambda m: m.margin)
    heartbreak = min(matchups, key=lambda m: m.margin)

    upsets = []
    for m in matchups:
        if m.team_a_projected is None or m.team_b_projected is None:
            continue
        projected_winner = (
            m.team_a_name if m.team_a_projected >= m.team_b_projected else m.team_b_name
        )
        if projected_winner != m.winner:
            upsets.append((m, abs(m.team_a_projected - m.team_b_projected)))
    upset = None
    if upsets:
        upset_matchup, gap = max(upsets, key=lambda t: t[1])
        upset = {
            "winner": upset_matchup.winner,
            "winner_manager": upset_matchup.winner_manager,
            "loser": upset_matchup.loser,
            "gap": gap,
        }

    # Bad Beat only counts if the losing team strictly outscored more than
    # half of the *other* teams in the league - otherwise no one had a real
    # claim to bad luck, and the award is honestly skipped that week.
    bad_beat = None
    if len(matchups) >= 2:
        def outscored_count(name, score):
            return sum(1 for n, s, _mgr in all_scores if n != name and s < score)

        other_team_count = len(all_scores) - 1
        candidates = [
            (m.loser, m.loser_score, m.loser_manager, outscored_count(m.loser, m.loser_score))
            for m in matchups
        ]
        candidates = [c for c in candidates if c[3] > other_team_count / 2]
        if candidates:
            bb_team, bb_score, bb_manager, bb_count = max(candidates, key=lambda t: (t[3], t[1]))
            bad_beat = {"team": bb_team, "manager": bb_manager, "score": bb_score, "count": bb_count}

    return {
        "goon": {"team": goon_team, "manager": goon_manager, "score": goon_score},
        "cock": {"team": cock_team, "manager": cock_manager, "score": cock_score},
        "blowout": {
            "winner": blowout.winner, "winner_manager": blowout.winner_manager,
            "loser": blowout.loser, "margin": blowout.margin,
        },
        "heartbreaker": {
            "winner": heartbreak.winner,
            "loser": heartbreak.loser, "loser_manager": heartbreak.loser_manager,
            "margin": heartbreak.margin,
        },
        "upset": upset,
        "bad_beat": bad_beat,
    }


def generate_recap(week, matchups: List[Matchup]) -> str:
    if not matchups:
        return f"No matchups found for week {week}."

    awards = compute_awards(matchups)

    lines = []
    lines.append("=" * 60)
    lines.append(f"  WEEK {week} RECAP")
    lines.append("=" * 60)
    lines.append("")

    lines.append("MATCHUPS")
    lines.append("-" * 60)
    for m in matchups:
        lines.append(
            f"  {m.team_a_name:<22} {m.team_a_score:>6.2f}  vs  "
            f"{m.team_b_score:<6.2f} {m.team_b_name}"
        )
    lines.append("")

    lines.append("AWARDS")
    lines.append("-" * 60)

    g = awards["goon"]
    lines.append(f"  Goon of the Week: {g['team']} put up {g['score']:.2f} points - takes home the $50")

    c = awards["cock"]
    lines.append(f"  Cock of the Week: {c['team']} limped to {c['score']:.2f} points - most embarrassing showing of the week")

    b = awards["blowout"]
    lines.append(f"  Biggest Blowout: {b['winner']} demolished {b['loser']} by {b['margin']:.2f} points")

    h = awards["heartbreaker"]
    lines.append(f"  Heartbreaker: {h['loser']} fell to {h['winner']} by just {h['margin']:.2f} points")

    if awards["upset"]:
        u = awards["upset"]
        lines.append(f"  Upset of the Week: {u['winner']} was projected to lose to {u['loser']} by {u['gap']:.2f} and won anyway")
    else:
        lines.append("  Upset of the Week: n/a (no projected scores available this run)")

    if awards["bad_beat"]:
        bb = awards["bad_beat"]
        lines.append(f"  Bad Beat: {bb['team']} scored {bb['score']:.2f} - enough to beat {bb['count']} other team(s) this week - and still lost")
    else:
        lines.append("  Bad Beat: n/a (need at least two matchups to compare)")

    lines.append("")
    lines.append("=" * 60)
    return "\n".join(lines)
