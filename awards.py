"""
The recap engine: pure logic, no network calls and no Yahoo-specific code.

Give it a week number and a list of Matchup objects and it hands back a
formatted text recap. Keeping this file free of API calls means we can test
the output format (test_awards.py) without touching Yahoo at all.

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

    all_scores = []
    for m in matchups:
        all_scores.append((m.team_a_name, m.team_a_score))
        all_scores.append((m.team_b_name, m.team_b_score))

    # Goon of the Week - highest score, takes home the $50.
    goon_team, goon_score = max(all_scores, key=lambda t: t[1])
    lines.append(f"  Goon of the Week: {goon_team} put up {goon_score:.2f} points - takes home the $50")

    # Cock of the Week - lowest score, most embarrassing showing.
    cock_team, cock_score = min(all_scores, key=lambda t: t[1])
    lines.append(f"  Cock of the Week: {cock_team} limped to {cock_score:.2f} points - most embarrassing showing of the week")

    # Biggest Blowout - largest winning margin.
    blowout = max(matchups, key=lambda m: m.margin)
    lines.append(
        f"  Biggest Blowout: {blowout.winner} demolished "
        f"{blowout.loser} by {blowout.margin:.2f} points"
    )

    # Heartbreaker - smallest losing margin (the closest game, told from
    # the loser's side).
    heartbreak = min(matchups, key=lambda m: m.margin)
    lines.append(
        f"  Heartbreaker: {heartbreak.loser} fell to {heartbreak.winner} "
        f"by just {heartbreak.margin:.2f} points"
    )

    # Upset of the Week - only makes sense when we have projected scores.
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

    # Bad Beat - among this week's losers, whoever's score would have beaten
    # the most other teams in the league, but still lost their own matchup.
    if len(matchups) >= 2:
        def outscored_count(name, score):
            return sum(1 for other_name, other_score in all_scores if other_name != name and other_score < score)

        losers = [(m.loser, m.loser_score) for m in matchups]
        bad_beat_team, bad_beat_score = max(losers, key=lambda t: outscored_count(t[0], t[1]))
        count = outscored_count(bad_beat_team, bad_beat_score)
        lines.append(
            f"  Bad Beat: {bad_beat_team} scored {bad_beat_score:.2f} - enough to beat "
            f"{count} other team(s) this week - and still lost"
        )
    else:
        lines.append("  Bad Beat: n/a (need at least two matchups to compare)")

    lines.append("")
    lines.append("=" * 60)
    return "\n".join(lines)
