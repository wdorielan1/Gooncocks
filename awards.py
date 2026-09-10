"""
The recap engine: pure logic, no network calls and no Yahoo-specific code.

Give it a week number and a list of Matchup objects and it hands back a
formatted text recap. Keeping this file free of API calls means we can test
the output format (test_awards.py) without touching Yahoo at all.
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


def generate_recap(week, matchups: List[Matchup]) -> str:
    if not matchups:
        return f"No matchups found for week {week}."

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

    blowout = max(matchups, key=lambda m: m.margin)
    lines.append(
        f"  Blowout of the Week: {blowout.winner} demolished "
        f"{blowout.loser} by {blowout.margin:.2f} points"
    )

    nailbiter = min(matchups, key=lambda m: m.margin)
    lines.append(
        f"  Nail-Biter of the Week: {nailbiter.winner} squeaked past "
        f"{nailbiter.loser} by just {nailbiter.margin:.2f} points"
    )

    all_scores = []
    for m in matchups:
        all_scores.append((m.team_a_name, m.team_a_score))
        all_scores.append((m.team_b_name, m.team_b_score))

    high_team, high_score = max(all_scores, key=lambda t: t[1])
    lines.append(f"  High Score of the Week: {high_team} with {high_score:.2f} points")

    low_team, low_score = min(all_scores, key=lambda t: t[1])
    lines.append(f"  Low Score of the Week: {low_team} with only {low_score:.2f} points")

    # Upset of the week only makes sense when we have projected scores.
    upsets = []
    for m in matchups:
        if m.team_a_projected is None or m.team_b_projected is None:
            continue
        projected_winner = (
            m.team_a_name if m.team_a_projected >= m.team_b_projected else m.team_b_name
        )
        if projected_winner != m.winner:
            proj_gap = abs(m.team_a_projected - m.team_b_projected)
            upsets.append((m, proj_gap))

    if upsets:
        upset_matchup, gap = max(upsets, key=lambda t: t[1])
        lines.append(
            f"  Upset of the Week: {upset_matchup.winner} was projected to lose "
            f"to {upset_matchup.loser} by {gap:.2f} and won anyway"
        )
    else:
        lines.append("  Upset of the Week: n/a (no projected scores available this run)")

    lines.append("")
    lines.append("=" * 60)
    return "\n".join(lines)
