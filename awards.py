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
    - Fraud Alert           - most wins above what their scores earned
                              (all-play record: beating every team you
                              outscored that week)

  From weekly rosters + player points + league transactions (see
  compute_extra_awards() - lambda_function.py fetches that data):
    - Benchwarmer Disaster  - highest-scoring player left on a bench
    - Start/Sit Disaster    - biggest bench-vs-starter swap a manager missed
    - Waiver-Wire Steal     - top-scoring starter picked up off waivers/FA
    - Trade Winner          - trade whose incoming players outscored the
                              outgoing ones by the most this week
    - Injury Excuse         - losing team with the most injured starters
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


def fraud_alert(standings: dict, matchups: List[Matchup]) -> Optional[dict]:
    """The team whose actual wins most exceed their all-play expected wins
    (each week, the share of the league they outscored). Needs at least
    half a win of luck to be worth calling out; None otherwise."""
    tally = {}
    for records in standings.get("weeks", {}).values():
        if len(records) < 2:
            continue
        for rec in records:
            beaten = sum(1 for other in records if other is not rec and other["points_for"] < rec["points_for"])
            t = tally.setdefault(rec["id"], {"wins": 0, "games": 0, "expected": 0.0})
            t["wins"] += 1 if rec["win"] else 0
            t["games"] += 1
            t["expected"] += beaten / (len(records) - 1)
    if not tally:
        return None
    fraud_id, t = max(tally.items(), key=lambda kv: kv[1]["wins"] - kv[1]["expected"])
    luck = t["wins"] - t["expected"]
    if luck < 0.5:
        return None
    team, manager = fraud_id, None
    for m in matchups:
        for name, mgr in ((m.team_a_name, m.team_a_manager), (m.team_b_name, m.team_b_manager)):
            if identity(name, mgr) == fraud_id:
                team, manager = name, mgr
    return {
        "team": team, "manager": manager, "wins": t["wins"], "losses": t["games"] - t["wins"],
        "expected_wins": t["expected"], "luck": luck,
    }


_FLEX_CODES = {"Q": "QB", "W": "WR", "R": "RB", "T": "TE"}
_INJURY_STATUSES = {"Q", "D", "O", "IR", "IR-R", "IR-NR", "PUP-R", "PUP-P", "NFI-R", "NFI-A", "DTD"}


def _can_play(slot: str, eligible: list) -> bool:
    """Whether a player with these eligible positions could fill a lineup
    slot - including flex slots like W/R/T, in case Yahoo's eligible list
    only names the base position."""
    if slot in eligible:
        return True
    return "/" in slot and any(_FLEX_CODES.get(code) in eligible for code in slot.split("/"))


def _is_starter(player: dict) -> bool:
    return player.get("slot") not in (None, "BN", "IR")


def lineup_awards(rosters: list) -> dict:
    """Benchwarmer Disaster, Start/Sit Disaster and Injury Excuse from each
    team's roster. `rosters` is [{"team_key", "team", "manager", "won",
    "players": [{"player_key", "name", "slot", "eligible", "status",
    "points"}]}] - slot is the lineup spot ("BN" for bench)."""
    bench_best = start_sit = injury = None
    for r in rosters:
        bench = [p for p in r["players"] if p.get("slot") == "BN"]
        starters = [p for p in r["players"] if _is_starter(p)]
        for b in bench:
            if b["points"] > 0 and (bench_best is None or b["points"] > bench_best["points"]):
                bench_best = {"team": r["team"], "manager": r["manager"], "player": b["name"], "points": b["points"]}
            for s in starters:
                cost = b["points"] - s["points"]
                if cost > 0 and _can_play(s["slot"], b.get("eligible") or []) and (start_sit is None or cost > start_sit["cost"]):
                    start_sit = {
                        "team": r["team"], "manager": r["manager"], "benched": b["name"], "benched_points": b["points"],
                        "started": s["name"], "started_points": s["points"], "cost": cost,
                    }
        if not r["won"]:
            hurt = [s for s in starters if s.get("status") in _INJURY_STATUSES]
            if hurt:
                candidate = {
                    "team": r["team"], "manager": r["manager"], "count": len(hurt),
                    "players": [p["name"] for p in hurt], "points": sum(p["points"] for p in hurt),
                }
                if injury is None or (candidate["count"], -candidate["points"]) > (injury["count"], -injury["points"]):
                    injury = candidate
    return {"benchwarmer": bench_best, "start_sit": start_sit, "injury": injury}


def waiver_steal(rosters: list, transactions: list) -> Optional[dict]:
    """Top-scoring starter this week who is still on the team that picked
    him up off waivers or free agency. `transactions` is
    yahoo_client.get_transactions() output."""
    acquired = {}
    for tx in sorted(transactions, key=lambda t: t["timestamp"]):
        for p in tx["players"]:
            if p["type"] == "add" and p.get("destination_team_key"):
                acquired[p["player_key"]] = (p["destination_team_key"], p.get("source_type"))
    best = None
    for r in rosters:
        for p in r["players"]:
            added = acquired.get(p["player_key"])
            if _is_starter(p) and added and added[0] == r["team_key"] and p["points"] > 0:
                if best is None or p["points"] > best["points"]:
                    source = "waivers" if added[1] == "waivers" else "free agency"
                    best = {"team": r["team"], "manager": r["manager"], "player": p["name"], "points": p["points"], "source": source}
    return best


def trade_winner(rosters: list, transactions: list) -> Optional[dict]:
    """Across this season's trades, the side whose incoming players outscored
    what they gave up by the most this week."""
    points = {p["player_key"]: p["points"] for r in rosters for p in r["players"]}
    teams = {r["team_key"]: r for r in rosters}
    best = None
    for tx in transactions:
        if tx["type"] != "trade":
            continue
        received = {}
        for p in tx["players"]:
            received.setdefault(p.get("destination_team_key"), []).append(points.get(p["player_key"], 0.0))
        sides = [k for k in received if k in teams]
        if len(sides) != 2:
            continue
        a, b = sides
        a_pts, b_pts = sum(received[a]), sum(received[b])
        winner, loser, got, gave = (a, b, a_pts, b_pts) if a_pts >= b_pts else (b, a, b_pts, a_pts)
        if got - gave > 0 and (best is None or got - gave > best["margin"]):
            best = {
                "team": teams[winner]["team"], "manager": teams[winner]["manager"],
                "other_team": teams[loser]["team"], "received_points": got, "gave_points": gave, "margin": got - gave,
            }
    return best


def compute_extra_awards(matchups: List[Matchup], standings: Optional[dict] = None,
                         rosters: Optional[list] = None, transactions: Optional[list] = None) -> dict:
    """Awards that need more than one week's scoreboard. A key is present
    only when its data was available; its value is None when nobody
    qualified this week."""
    extras = {}
    if standings:
        extras["fraud"] = fraud_alert(standings, matchups)
    if rosters:
        extras.update(lineup_awards(rosters))
        extras["waiver"] = waiver_steal(rosters, transactions or [])
        extras["trade"] = trade_winner(rosters, transactions or [])
    return extras


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


def _extra_award_lines(extras: dict) -> list:
    lines = []
    if "fraud" in extras:
        f = extras["fraud"]
        lines.append(
            f"  Fraud Alert: {f['team']} is {f['wins']}-{f['losses']} but scored like a {f['expected_wins']:.1f}-win team"
            if f else "  Fraud Alert: n/a (every record is earned so far)"
        )
    if "benchwarmer" in extras:
        b = extras["benchwarmer"]
        lines.append(f"  Benchwarmer Disaster: {b['team']} left {b['player']} ({b['points']:.2f}) on the bench" if b else "  Benchwarmer Disaster: n/a")
    if "start_sit" in extras:
        s = extras["start_sit"]
        lines.append(
            f"  Start/Sit Disaster: {s['team']} benched {s['benched']} ({s['benched_points']:.2f}) for {s['started']} ({s['started_points']:.2f}) - cost {s['cost']:.2f}"
            if s else "  Start/Sit Disaster: n/a (every lineup call was right)"
        )
    if "waiver" in extras:
        w = extras["waiver"]
        lines.append(f"  Waiver-Wire Steal: {w['team']} got {w['points']:.2f} from {w['player']} off {w['source']}" if w else "  Waiver-Wire Steal: n/a")
    if "trade" in extras:
        t = extras["trade"]
        lines.append(
            f"  Trade Winner: {t['team']} over {t['other_team']}, {t['received_points']:.2f} to {t['gave_points']:.2f} this week"
            if t else "  Trade Winner: n/a (no trades paying off this week)"
        )
    if "injury" in extras:
        i = extras["injury"]
        lines.append(f"  Injury Excuse: {i['team']} lost with {i['count']} banged-up starter(s): {', '.join(i['players'])}" if i else "  Injury Excuse: n/a")
    return lines


def generate_recap(week, matchups: List[Matchup], extras: Optional[dict] = None) -> str:
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

    lines.extend(_extra_award_lines(extras or {}))

    lines.append("")
    lines.append("=" * 60)
    return "\n".join(lines)
