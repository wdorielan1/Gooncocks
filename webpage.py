"""
Renders the shareable recap webpage as an HTML string, using the exact same
award data as awards.generate_recap() (via compute_awards()/rank_teams())
so the text recap and the webpage never disagree.

render_html(week, matchups) returns a complete, self-contained HTML page
(styles inlined, no external dependencies except Google Fonts) ready to
upload somewhere public - see lambda_function.py's _publish_page for the
AWS side of that.
"""
from awards import compute_awards, rank_teams

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
    padding-inline: 20px; padding-block: 32px 64px; overflow-x: hidden;
  }
  .page { max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: clamp(28px, 5vw, 44px); }
  h1, h2, h3 { text-wrap: balance; margin: 0; }
  .eyebrow { font-size: 12px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--gold); }
  .eyebrow.shame { color: var(--flag); }

  /* ---------- masthead ---------- */
  .masthead-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px 20px; }
  .brand-row { display: flex; align-items: center; gap: 10px; }
  .mark { flex: none; width: 30px; height: 30px; color: var(--peacock); }
  .wordmark { font-family: 'Teko', system-ui, sans-serif; font-weight: 600; font-size: 26px; letter-spacing: 0.02em; color: var(--chalk); }
  .week-tag { font-family: 'Teko', system-ui, sans-serif; font-size: 22px; font-weight: 500; color: var(--muted); }
  .week-tag strong { color: var(--chalk); font-weight: 600; }
  .sample-pill {
    display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600;
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--gold);
    border: 1px solid color-mix(in srgb, var(--gold) 45%, transparent);
    background: color-mix(in srgb, var(--gold) 10%, transparent); border-radius: 999px; padding: 6px 12px 6px 10px; white-space: nowrap;
  }
  .sample-pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--gold); flex: none; }

  /* ---------- hero: Goon of the Week ---------- */
  .hero {
    position: relative;
    border: 1px solid color-mix(in srgb, var(--gold) 30%, var(--line));
    border-radius: 14px;
    padding: clamp(28px, 6vw, 52px) clamp(24px, 5vw, 44px);
    overflow: hidden;
    background: var(--surface);
  }
  /* faint yard-line field texture */
  .hero::before {
    content: "";
    position: absolute; inset: 0;
    background-image: repeating-linear-gradient(
      90deg, transparent, transparent 68px,
      color-mix(in srgb, var(--chalk) 6%, transparent) 68px,
      color-mix(in srgb, var(--chalk) 6%, transparent) 70px
    );
    z-index: 0;
  }
  /* giant peacock watermark */
  .hero .hero-mark {
    position: absolute; right: -6%; top: 50%; translate: 0 -50%;
    width: clamp(220px, 45vw, 380px); height: auto;
    color: var(--peacock); opacity: 0.10; z-index: 0; pointer-events: none;
  }
  .hero::after {
    content: "";
    position: absolute; inset: 0;
    background: radial-gradient(ellipse 70% 60% at 20% 30%, color-mix(in srgb, var(--gold) 14%, transparent), transparent 70%);
    z-index: 0;
  }
  .hero-content { position: relative; z-index: 1; }
  .prize-badge {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--gold); color: var(--ink);
    font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
    padding: 7px 14px; border-radius: 999px; margin-bottom: 14px;
  }
  .hero h1.headline {
    font-family: 'Teko', system-ui, sans-serif; font-weight: 600;
    font-size: clamp(48px, 9vw, 92px); line-height: 0.92; letter-spacing: 0.01em; color: var(--chalk);
  }
  .hero h1.headline::after { content: "."; color: var(--gold); }
  .hero .hero-subtext { margin-top: 10px; font-size: 15px; color: var(--muted); max-width: 44ch; }
  .hero .hero-foot { margin-top: 22px; display: flex; align-items: baseline; gap: 10px; }
  .hero .hero-foot .num {
    font-family: 'Teko', system-ui, sans-serif; font-size: 40px; font-weight: 600; color: var(--gold);
    font-variant-numeric: tabular-nums; line-height: 1;
  }
  .hero .hero-foot .cap { font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }

  /* ---------- cock of the week (secondary banner) ---------- */
  .cock-banner {
    display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
    background: var(--surface); border: 1px solid color-mix(in srgb, var(--flag) 32%, var(--line));
    border-radius: 10px; padding: 18px 22px;
  }
  .cock-banner .headline { font-family: 'Teko', system-ui, sans-serif; font-size: 30px; font-weight: 600; color: var(--chalk); }
  .cock-banner .subtext { font-size: 13px; color: var(--muted); margin-top: 2px; }
  .cock-banner .num { font-family: 'Teko', system-ui, sans-serif; font-size: 34px; font-weight: 600; color: var(--flag); font-variant-numeric: tabular-nums; }
  .cock-banner .cap { font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); text-align: right; }

  /* ---------- section heads ---------- */
  .section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
  .section-head h2 { font-family: 'Teko', system-ui, sans-serif; font-size: 26px; font-weight: 600; letter-spacing: 0.02em; color: var(--chalk); }
  .section-head .count { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }

  /* ---------- award grid ---------- */
  .award-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
  .plaque { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 18px 20px; display: flex; flex-direction: column; gap: 8px; }
  .plaque .headline { font-family: 'Teko', system-ui, sans-serif; font-size: 24px; font-weight: 600; color: var(--chalk); line-height: 1.05; }
  .plaque .subtext { font-size: 13px; color: var(--muted); line-height: 1.4; }
  .plaque .stat { margin-top: auto; padding-top: 8px; font-size: 12px; font-weight: 600; color: var(--gold); font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }

  /* ---------- ranking bar chart ---------- */
  .rank-list { display: flex; flex-direction: column; gap: 10px; }
  .rank-row { display: grid; grid-template-columns: 130px 1fr 56px; align-items: center; gap: 12px; }
  .rank-name { font-size: 13px; color: var(--chalk); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rank-track { height: 12px; background: var(--surface-2); border-radius: 999px; overflow: hidden; }
  .rank-fill { height: 100%; border-radius: 999px; }
  .rank-score { font-family: 'Teko', system-ui, sans-serif; font-size: 17px; font-weight: 600; color: var(--muted); text-align: right; font-variant-numeric: tabular-nums; }

  /* ---------- scoreboard ---------- */
  .ledger { border-top: 1px solid var(--line); }
  .matchup { display: grid; grid-template-columns: 1fr auto 12px auto 1fr; align-items: center; gap: 10px; padding: 14px 4px; border-bottom: 1px solid var(--line); }
  .matchup .team { font-size: 14px; font-weight: 500; color: var(--muted); display: flex; align-items: center; gap: 8px; min-width: 0; }
  .matchup .team span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .matchup .team.b { justify-content: flex-end; text-align: right; flex-direction: row-reverse; }
  .matchup .team.win { color: var(--chalk); font-weight: 600; }
  .matchup .tick { width: 6px; height: 6px; border-radius: 50%; background: var(--gold); flex: none; }
  .matchup .team:not(.win) .tick { visibility: hidden; }
  .matchup .score { font-family: 'Teko', system-ui, sans-serif; font-size: 24px; font-weight: 500; color: var(--muted); font-variant-numeric: tabular-nums; min-width: 2.4em; text-align: center; }
  .matchup .score.win { color: var(--gold); font-weight: 600; }
  .matchup .vs { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; color: var(--muted); text-align: center; }

  /* ---------- roadmap ---------- */
  .roadmap-list { display: flex; flex-direction: column; border-top: 1px solid var(--line); }
  .roadmap-row { display: grid; grid-template-columns: 1fr auto; align-items: baseline; gap: 10px 16px; padding: 12px 2px; border-bottom: 1px solid var(--line); }
  .roadmap-row .name { font-size: 14px; font-weight: 600; color: var(--chalk); }
  .roadmap-row .desc { grid-column: 1; font-size: 12.5px; color: var(--muted); margin-top: -4px; }
  .status-tag { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; padding: 4px 9px; border-radius: 999px; white-space: nowrap; border: 1px solid var(--line); color: var(--muted); }
  .status-tag.data { color: var(--peacock); border-color: color-mix(in srgb, var(--peacock) 45%, var(--line)); }
  .status-tag.manual { color: var(--flag); border-color: color-mix(in srgb, var(--flag) 40%, var(--line)); }

  @media (max-width: 620px) {
    .award-grid { grid-template-columns: 1fr; }
    .matchup { grid-template-columns: 1fr auto 1fr; grid-template-areas: "a scorea vs" "b scoreb vs2"; }
    .roadmap-row { grid-template-columns: 1fr; }
    .cock-banner .cap { text-align: left; }
    .hero .hero-mark { opacity: 0.07; }
  }
  @media (max-width: 460px) {
    .matchup { grid-template-columns: 1fr 1fr; row-gap: 4px; }
    .matchup .vs { display: none; }
    .matchup .team.b { flex-direction: row; justify-content: flex-start; text-align: left; order: 3; }
    .matchup .score.b { order: 4; }
    .rank-row { grid-template-columns: 84px 1fr 46px; }
  }

  footer { border-top: 1px solid var(--line); padding-top: 20px; font-size: 12px; color: var(--muted); line-height: 1.6; }
  footer strong { color: var(--muted); font-weight: 600; }
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

# A bigger, fanned-tail version of the mark, used as a large faded
# background watermark in the hero. Placeholder until the real Gooncocks
# logo artwork is available to embed directly.
HERO_MARK_SVG = """<svg class="hero-mark" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <polygon points="100,10 130,70 70,70" fill="currentColor"/>
  <polygon points="100,0 20,60 55,95 100,45" fill="currentColor" opacity="0.5"/>
  <polygon points="100,0 180,60 145,95 100,45" fill="currentColor" opacity="0.5"/>
  <polygon points="60,75 100,45 140,75 130,150 70,150" fill="currentColor"/>
  <circle cx="82" cy="88" r="6" fill="var(--ink)"/>
  <polygon points="60,95 30,80 55,105" fill="currentColor"/>
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


def _rank_row_html(entry, idx, total, max_score):
    pct = (entry["score"] / max_score * 100) if max_score else 0
    # Fade from full gold (top team) toward muted grey (bottom team).
    blend = 100 - (idx / max(total - 1, 1)) * 65
    color = f"color-mix(in srgb, var(--gold) {blend:.0f}%, var(--muted))"
    return f"""
      <div class="rank-row">
        <div class="rank-name">{entry['name']}</div>
        <div class="rank-track"><div class="rank-fill" style="width:{pct:.1f}%;background:{color}"></div></div>
        <div class="rank-score">{entry['score']:.1f}</div>
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

    rankings = rank_teams(matchups)
    max_score = rankings[0]["score"] if rankings else 1
    rank_rows = "".join(
        _rank_row_html(entry, idx, len(rankings), max_score) for idx, entry in enumerate(rankings)
    )

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

  <div class="masthead-row">
    <div class="brand-row">
      {MARK_SVG}
      <span class="wordmark">Gooncocks</span>
    </div>
    <div class="masthead-row" style="gap:10px 14px">
      <p class="week-tag"><strong>Week {week}</strong> Recap</p>
      {sample_pill}
    </div>
  </div>

  <section class="hero">
    {HERO_MARK_SVG}
    <div class="hero-content">
      <span class="prize-badge">$50 Winner</span>
      <span class="eyebrow" style="display:block;margin-bottom:6px">Goon of the Week</span>
      <h1 class="headline">{g['team']}</h1>
      <p class="hero-subtext">Highest score in the league this week - takes home the $50, no arguments.</p>
      <div class="hero-foot">
        <span class="num">{g['score']:.2f}</span>
        <span class="cap">points</span>
      </div>
    </div>
  </section>

  <section class="cock-banner">
    <div>
      <span class="eyebrow shame">Cock of the Week</span>
      <div class="headline">{c['team']}</div>
      <p class="subtext">Most embarrassing showing of the week - no excuses.</p>
    </div>
    <div>
      <div class="num">{c['score']:.2f}</div>
      <div class="cap">points</div>
    </div>
  </section>

  <section class="trophy-case">
    <div class="section-head"><h2>More Awards</h2><span class="count">4 categories</span></div>
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

  <section class="rankings">
    <div class="section-head"><h2>Score Rankings</h2><span class="count">{len(rankings)} teams</span></div>
    <div class="rank-list">{rank_rows}
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
    The peacock mark is a placeholder for the real Gooncocks logo, still being finalized.
  </footer>

</div>
</body>
</html>"""
