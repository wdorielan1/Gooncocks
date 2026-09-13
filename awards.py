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

  Not implemented yet - need Yahoo endpoints this project doesn't call yet
  (season standings, full rosters with bench points, transaction history):
    - Fraud Alert           - needs season record + points-for (standings)
    - Power Rankings        - needs standings + a blended scoring formula
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


def rank_teams(matchups: List[Matchup]) -> list:
    """Every team's score this week, sorted highest to lowest. Used for the
    webpage's ranking bar chart."""
    all_scores = []
    for m in matchups:
        all_scores.append({"name": m.team_a_name, "score": m.team_a_score})
        all_scores.append({"name": m.team_b_name, "score": m.team_b_score})
    return sorted(all_scores, key=lambda t: t["score"], reverse=True)


def compute_awards(matchups: List[Matchup]) -> dict:
    """Returns a dict with one entry per award category. 'upset' and
    'bad_beat' are None when there isn't enough data to compute them."""
    all_scores = []
    for m in matchups:
        all_scores.append((m.team_a_name, m.team_a_score))
        all_scores.append((m.team_b_name, m.team_b_score))

    goon_team, goon_score = max(all_scores, key=lambda t: t[1])
    cock_team, cock_score = min(all_scores, key=lambda t: t[1])
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
        upset = {"winner": upset_matchup.winner, "loser": upset_matchup.loser, "gap": gap}

    bad_beat = None
    if len(matchups) >= 2:
        def outscored_count(name, score):
            return sum(1 for n, s in all_scores if n != name and s < score)

        losers = [(m.loser, m.loser_score) for m in matchups]
        bb_team, bb_score = max(losers, key=lambda t: outscored_count(t[0], t[1]))
        bad_beat = {"team": bb_team, "score": bb_score, "count": outscored_count(bb_team, bb_score)}

    return {
        "goon": {"team": goon_team, "score": goon_score},
        "cock": {"team": cock_team, "score": cock_score},
        "blowout": {"winner": blowout.winner, "loser": blowout.loser, "margin": blowout.margin},
        "heartbreaker": {"winner": heartbreak.winner, "loser": heartbreak.loser, "margin": heartbreak.margin},
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
