"""
Renders the shareable recap webpage as an HTML string, using the exact same
award data as awards.generate_recap() (via compute_awards()) so the text
recap and the webpage never disagree.

render_html(week, matchups) returns a complete, self-contained HTML page
(styles inlined, no external dependencies except Google Fonts) ready to
upload somewhere public - see s3_publish.py for the AWS side of that.
"""
from awards import compute_awards

STYLE_BLOCK = """
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Teko:wght@400;500;600;700&family=Work+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --ink: #0B1220;
    --surface: #121B2E;
    --surface-2: #182742;
    --line: #263957;
    --chalk: #EEF1F8;
    --muted: #8B96AE;
    --gold: #E7A33B;
    --peacock: #2FB6A3;
    --flag: #D1503F;
  }
  @media (prefers-color-scheme: light) {
    :root:not([data-theme="dark"]) {
      --ink: #F3F5FA; --surface: #FFFFFF; --surface-2: #E7ECF5; --line: #D6DEEC;
      --chalk: #101A2E; --muted: #55617A; --gold: #A9701C; --peacock: #157B6E; --flag: #A93A2C;
    }
  }
  :root[data-theme="light"] {
    --ink: #F3F5FA; --surface: #FFFFFF; --surface-2: #E7ECF5; --line: #D6DEEC;
    --chalk: #101A2E; --muted: #55617A; --gold: #A9701C; --peacock: #157B6E; --flag: #A93A2C;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ink); color: var(--chalk);
    font-family: 'Work Sans', system-ui, -apple-system, sans-serif;
    padding-inline: 20px; padding-block: 40px 64px; overflow-x: hidden;
  }
  .page { max-width: 860px; margin: 0 auto; display: flex; flex-direction: column; gap: clamp(28px, 5vw, 44px); }
  h1, h2, h3 { text-wrap: balance; margin: 0; }
  .eyebrow { font-size: 12px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--gold); }
  .eyebrow.shame { color: var(--flag); }
  .masthead { position: relative; }
  .masthead::before {
    content: ""; position: absolute; top: -60px; left: 50%; translate: -50% 0;
    width: min(720px, 140vw); height: 320px;
    background: radial-gradient(ellipse at center, color-mix(in srgb, var(--peacock) 24%, transparent), transparent 70%);
    pointer-events: none; z-index: 0;
  }
  .masthead-inner { position: relative; z-index: 1; }
  .brand-row { display: flex; align-items: flex-end; gap: 14px; }
  .mark { flex: none; width: clamp(52px, 9vw, 76px); height: clamp(52px, 9vw, 76px); color: var(--peacock); }
  .masthead .eyebrow { display: block; margin-bottom: 6px; }
  .wordmark {
    font-family: 'Teko', system-ui, sans-serif; font-weight: 600;
    font-size: clamp(56px, 13vw, 112px); line-height: 0.85; letter-spacing: 0.01em; color: var(--chalk); margin: 0;
  }
  .masthead-row { margin-top: 14px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px 20px; }
  .week-tag { font-family: 'Teko', system-ui, sans-serif; font-size: 28px; font-weight: 500; letter-spacing: 0.02em; color: var(--muted); }
  .week-tag strong { color: var(--chalk); font-weight: 600; }
  .sample-pill {
    display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600;
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--gold);
    border: 1px solid color-mix(in srgb, var(--gold) 45%, transparent);
    background: color-mix(in srgb, var(--gold) 10%, transparent); border-radius: 999px; padding: 6px 12px 6px 10px; white-space: nowrap;
  }
  .sample-pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--gold); flex: none; }
  .section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
  .section-head h2 { font-family: 'Teko', system-ui, sans-serif; font-size: 30px; font-weight: 600; letter-spacing: 0.02em; color: var(--chalk); }
  .section-head .count { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .duo { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .duo-card { border: 1px solid var(--line); border-radius: 10px; padding: clamp(18px, 3vw, 26px); display: flex; flex-direction: column; gap: 12px; }
  .duo-card.goon { background: linear-gradient(155deg, var(--surface) 0%, var(--surface-2) 100%); border-color: color-mix(in srgb, var(--gold) 35%, var(--line)); }
  .duo-card.cock { background: linear-gradient(155deg, var(--surface) 0%, var(--surface-2) 100%); border-color: color-mix(in srgb, var(--flag) 35%, var(--line)); }
  .duo-card .headline { font-family: 'Teko', system-ui, sans-serif; font-size: clamp(28px, 4.5vw, 38px); font-weight: 600; color: var(--chalk); line-height: 1.02; }
  .duo-card .subtext { font-size: 13.5px; color: var(--muted); line-height: 1.4; }
  .duo-card .readout { margin-top: auto; display: flex; align-items: baseline; gap: 8px; }
  .duo-card .readout .num { font-family: 'Teko', system-ui, sans-serif; font-size: 44px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; }
  .duo-card.goon .readout .num { color: var(--gold); }
  .duo-card.cock .readout .num { color: var(--flag); }
  .duo-card .readout .cap { font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
  .award-grid { margin-top: 12px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
  .plaque { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 18px 20px; display: flex; flex-direction: column; gap: 8px; }
  .plaque .headline { font-family: 'Teko', system-ui, sans-serif; font-size: 26px; font-weight: 600; color: var(--chalk); line-height: 1.05; }
  .plaque .subtext { font-size: 13.5px; color: var(--muted); line-height: 1.4; }
  .plaque .stat { margin-top: auto; padding-top: 8px; font-size: 12px; font-weight: 600; color: var(--gold); font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
  .ledger { border-top: 1px solid var(--line); }
  .matchup { display: grid; grid-template-columns: 1fr auto 12px auto 1fr; align-items: center; gap: 10px; padding: 16px 4px; border-bottom: 1px solid var(--line); }
  .matchup .team { font-size: 15px; font-weight: 500; color: var(--muted); display: flex; align-items: center; gap: 8px; min-width: 0; }
  .matchup .team span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .matchup .team.b { justify-content: flex-end; text-align: right; flex-direction: row-reverse; }
  .matchup .team.win { color: var(--chalk); font-weight: 600; }
  .matchup .tick { width: 6px; height: 6px; border-radius: 50%; background: var(--gold); flex: none; }
  .matchup .team:not(.win) .tick { visibility: hidden; }
  .matchup .score { font-family: 'Teko', system-ui, sans-serif; font-size: 26px; font-weight: 500; color: var(--muted); font-variant-numeric: tabular-nums; min-width: 2.4em; text-align: center; }
  .matchup .score.win { color: var(--gold); font-weight: 600; }
  .matchup .vs { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; color: var(--muted); text-align: center; }
  .roadmap-list { display: flex; flex-direction: column; border-top: 1px solid var(--line); }
  .roadmap-row { display: grid; grid-template-columns: 1fr auto; align-items: baseline; gap: 10px 16px; padding: 13px 2px; border-bottom: 1px solid var(--line); }
  .roadmap-row .name { font-size: 14.5px; font-weight: 600; color: var(--chalk); }
  .roadmap-row .desc { grid-column: 1; font-size: 13px; color: var(--muted); margin-top: -4px; }
  .status-tag { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; padding: 4px 9px; border-radius: 999px; white-space: nowrap; border: 1px solid var(--line); color: var(--muted); }
  .status-tag.data { color: var(--peacock); border-color: color-mix(in srgb, var(--peacock) 45%, var(--line)); }
  .status-tag.manual { color: var(--flag); border-color: color-mix(in srgb, var(--flag) 40%, var(--line)); }
  @media (max-width: 620px) {
    .duo { grid-template-columns: 1fr; }
    .award-grid { grid-template-columns: 1fr; }
    .matchup { grid-template-columns: 1fr auto 1fr; grid-template-areas: "a scorea vs" "b scoreb vs2"; }
    .roadmap-row { grid-template-columns: 1fr; }
  }
  @media (max-width: 460px) {
    .matchup { grid-template-columns: 1fr 1fr; row-gap: 4px; }
    .matchup .vs { display: none; }
    .matchup .team.b { flex-direction: row; justify-content: flex-start; text-align: left; order: 3; }
    .matchup .score.b { order: 4; }
  }
  footer { border-top: 1px solid var(--line); padding-top: 20px; font-size: 12px; color: var(--muted); line-height: 1.6; }
  footer strong { color: var(--muted); font-weight: 600; }
  @media (prefers-reduced-motion: no-preference) { .masthead::before { animation: glow 6s ease-in-out infinite; } }
  @keyframes glow { 0%, 100% { opacity: 0.85; } 50% { opacity: 1; } }
</style>
"""

MARK_SVG = """<svg class="mark" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <polygon points="50,4 58,26 40,26" fill="currentColor"/>
  <polygon points="50,0 66,24 46,28" fill="currentColor" opacity="0.55"/>
  <polygon points="50,0 34,24 54,28" fill="currentColor" opacity="0.55"/>
  <polygon points="28,38 50,24 50,58 28,66" fill="currentColor"/>
  <polygon points="30,40 22,30 32,44" fill="currentColor"/>
  <circle cx="40" cy="42" r="3.4" fill="var(--ink)"/>
</svg>"""

ROADMAP_ROWS = """
  <div class="roadmap-row"><span class="name">Fraud Alert</span><span class="status-tag data">Needs standings</span><span class="desc">Strong record, weak total scoring.</span></div>
  <div class="roadmap-row"><span class="name">Power Rankings</span><span class="status-tag manual">Needs standings + commissioner</span><span class="desc">Record, points, roster strength, recent results, and your call.</span></div>
  <div class="roadmap-row"><span class="name">Benchwarmer Disaster</span><span class="status-tag data">Needs full rosters</span><span class="desc">Most valuable points left on the bench.</span></div>
  <div class="roadmap-row"><span class="name">Start/Sit Disaster</span><span class="status-tag data">Needs full rosters</span><span class="desc">Worst call between a starter and an eligible bench player.</span></div>
  <div class="roadmap-row"><span class="name">Waiver-Wire Steal</span><span class="status-tag data">Needs transaction history</span><span class="desc">Best-performing recent pickup off waivers.</span></div>
  <div class="roadmap-row"><span class="name">Trade Winner</span><span class="status-tag manual">Commissioner call</span><span class="desc">Which manager benefited most from a trade.</span></div>
  <div class="roadmap-row"><span class="name">Injury Excuse</span><span class="status-tag manual">Commissioner call</span><span class="desc">Team most negatively affected by injuries.</span></div>
"""


def _matchup_row_html(m):
    a_win = m.team_a_score >= m.team_b_score
    return f"""
      <div class="matchup">
        <div class="team {'win' if a_win else ''} a"><span class="tick"></span><span>{m.team_a_name}</span></div>
        <div class="score {'win' if a_win else ''} a">{m.team_a_score:.2f}</div>
        <div class="vs">VS</div>
        <div class="score {'' if a_win else 'win'} b">{m.team_b_score:.2f}</div>
        <div class="team {'' if a_win else 'win'} b"><span class="tick"></span><span>{m.team_b_name}</span></div>
      </div>"""


def render_html(week, matchups, is_sample=True):
    awards = compute_awards(matchups)
    g, c, b, h = awards["goon"], awards["cock"], awards["blowout"], awards["heartbreaker"]

    if awards["upset"]:
        u = awards["upset"]
        upset_html = f"""
      <div class="plaque">
        <span class="eyebrow">Upset of the Week</span>
        <div class="headline">{u['winner']}</div>
        <p class="subtext">Projected to lose to {u['loser']} by {u['gap']:.2f} - won anyway.</p>
        <span class="stat">{u['gap']:.2f} PROJECTION BLOWN</span>
      </div>"""
    else:
        upset_html = """
      <div class="plaque">
        <span class="eyebrow">Upset of the Week</span>
        <div class="headline">N/A</div>
        <p class="subtext">No projected scores were available this week.</p>
      </div>"""

    if awards["bad_beat"]:
        bb = awards["bad_beat"]
        bad_beat_html = f"""
      <div class="plaque">
        <span class="eyebrow">Bad Beat</span>
        <div class="headline">{bb['team']}</div>
        <p class="subtext">Scored enough to beat {bb['count']} other team(s) this week - and still lost.</p>
        <span class="stat">{bb['score']:.2f} PTS</span>
      </div>"""
    else:
        bad_beat_html = """
      <div class="plaque">
        <span class="eyebrow">Bad Beat</span>
        <div class="headline">N/A</div>
        <p class="subtext">Need at least two matchups to compare.</p>
      </div>"""

    matchup_rows = "".join(_matchup_row_html(m) for m in matchups)
    sample_pill = '<span class="sample-pill">Sample data · preview</span>' if is_sample else ""

    return f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gooncocks Recap - Week {week}</title>
{STYLE_BLOCK}
</head>
<body>
<div class="page">

  <header class="masthead">
    <div class="masthead-inner">
      <span class="eyebrow">Fantasy Football League</span>
      <div class="brand-row">
        {MARK_SVG}
        <h1 class="wordmark">Gooncocks</h1>
      </div>
      <div class="masthead-row">
        <p class="week-tag"><strong>Week {week}</strong> Recap</p>
        {sample_pill}
      </div>
    </div>
  </header>

  <section class="trophy-case">
    <div class="section-head"><h2>Trophy Case</h2><span class="count">6 awards</span></div>

    <div class="duo">
      <div class="duo-card goon">
        <span class="eyebrow">Goon of the Week</span>
        <div class="headline">{g['team']}</div>
        <p class="subtext">Highest score in the league this week - takes home the $50.</p>
        <div class="readout"><span class="num">{g['score']:.2f}</span><span class="cap">pts</span></div>
      </div>
      <div class="duo-card cock">
        <span class="eyebrow shame">Cock of the Week</span>
        <div class="headline">{c['team']}</div>
        <p class="subtext">Most embarrassing showing of the week - lowest score, no excuses.</p>
        <div class="readout"><span class="num">{c['score']:.2f}</span><span class="cap">pts</span></div>
      </div>
    </div>

    <div class="award-grid">
      <div class="plaque">
        <span class="eyebrow">Biggest Blowout</span>
        <div class="headline">{b['winner']}</div>
        <p class="subtext">Demolished {b['loser']} - the widest margin of the week.</p>
        <span class="stat">{b['margin']:.2f} PT MARGIN</span>
      </div>
      <div class="plaque">
        <span class="eyebrow">Heartbreaker</span>
        <div class="headline">{h['loser']}</div>
        <p class="subtext">Fell to {h['winner']} by the slimmest margin of the week.</p>
        <span class="stat">{h['margin']:.2f} PT MARGIN</span>
      </div>
      {upset_html}
      {bad_beat_html}
    </div>
  </section>

  <section class="scoreboard">
    <div class="section-head"><h2>This Week's Matchups</h2><span class="count">{len(matchups)} games</span></div>
    <div class="ledger">{matchup_rows}
    </div>
  </section>

  <section class="roadmap">
    <div class="section-head"><h2>On The Board</h2><span class="count">not tracked yet</span></div>
    <div class="roadmap-list">{ROADMAP_ROWS}</div>
  </section>

  <footer>
    <strong>Gooncocks Recap</strong> is generated automatically from Yahoo Fantasy Sports data by an AWS Lambda function.
    The mascot mark above is a placeholder for the real Gooncocks peacock, still in the works.
  </footer>

</div>
</body>
</html>"""
