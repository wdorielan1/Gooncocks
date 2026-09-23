"""
Renders the shareable recap webpage as an HTML string, using the exact same
award data as awards.generate_recap() (via compute_awards()/rank_teams())
so the text recap and the webpage never disagree.

Visual design ported from the "Gooncocks Recap" static mockup Will had
generated separately (peacock mascot art, masthead nav, hero with the
masked logo image, shame banner, award cards, animated ranking chart,
scoreboard grid). The mascot image is expected to live in the
same S3 bucket as this page - see LOGO_URL below.

render_html(week, matchups) returns a complete, self-contained HTML page
(styles inlined, no external dependencies except Google Fonts and the
logo image) ready to upload somewhere public - see lambda_function.py's
_publish_page for the AWS side of that.
"""
import re
from html import escape

from awards import compute_awards, identity, rank_teams

LOGO_URL = "https://stats.gooncocks.com/gooncocks-logo.png"

# Sad/losing peacock artwork that peeks in on the right side of the Cock
# of the Week shame banner - same visual treatment as LOGO_URL's peacock
# in the hero section, just a different (defeated-looking) image and
# scaled down for the shame banner's compact size. Expected at the bucket
# root alongside the logo.
SHAME_ART_URL = "https://stats.gooncocks.com/cock-of-the-week.png"

# Per-manager headshots, if uploaded. Convention: a manager named "Chet"
# maps to photos/chet.jpg - lowercased, apostrophes dropped, everything
# else non-alphanumeric collapsed to a dash. Keyed by manager (a person),
# not by team name, since team names get renamed mid-season and a manager
# doesn't - so a rename never orphans someone's photo. Falls back to the
# team name when no manager is known (e.g. sample data, or manual entries
# that skip manager_a/manager_b). A team/manager with no photo uploaded
# just renders without one (onerror removes the broken-image element
# rather than showing a placeholder icon).
PHOTO_BASE_URL = "https://stats.gooncocks.com/photos/"


def _slugify(name: str) -> str:
    name = name.replace("'", "").replace("’", "")
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _display_name(team, manager):
    """'Chett's Angels — Chet' when the manager is known, else just the
    team name."""
    return f"{team} — {manager}" if manager else team


def _headshot_img(team, manager, css_class):
    key = identity(team, manager)
    if not key:
        return ""
    url = f"{PHOTO_BASE_URL}{_slugify(key)}.jpg"
    return f'<img class="{css_class}" src="{url}" alt="{key}" onerror="this.remove()">'

STYLE_BLOCK = """
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Teko:wght@400;500;600;700&family=Work+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{color-scheme:dark;--bg:#0b1220;--surface:#101a2b;--line:#263044;--text:#eef1f8;--muted:#94a0b3;--gold:#e7a33b;--blue:#3074ec;--red:#d1503f}
  *{box-sizing:border-box}
  html{scroll-behavior:smooth;scroll-padding-top:30px}
  body{margin:0;background:var(--bg);color:var(--text);font-family:'Work Sans',sans-serif;font-size:16px}
  a{color:inherit;text-decoration:none}
  a:focus-visible{outline:2px solid var(--gold);outline-offset:6px}
  .masthead{max-width:1440px;margin:auto;padding:24px 20px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap}
  .brand{display:flex;align-items:center;gap:12px;font-family:Teko,'Arial Narrow',sans-serif;font-size:32px;font-weight:600;line-height:1}
  .brand img{width:52px;height:52px;border-radius:50%;object-fit:cover}
  .brand small{display:block;font-family:'Work Sans',sans-serif;font-size:10px;letter-spacing:1.8px;color:var(--muted);margin-top:7px}
  nav{display:flex;gap:30px;font-size:14px;color:var(--muted)}
  nav a:hover,nav .active{color:var(--gold)}
  .season{font-size:12px;letter-spacing:1px;color:var(--muted)}
  .season span,.slash{margin:0 12px;color:#4a5770}
  main{max-width:1328px;padding:0 20px;margin:auto}
  .edition{display:flex;justify-content:space-between;padding:28px 0 20px;font-size:12px;letter-spacing:1.8px;font-weight:600;flex-wrap:wrap;gap:8px}
  .demo{color:var(--muted);font-size:11px}
  .hero{min-height:450px;position:relative;isolation:isolate;overflow:hidden;background:#060d19;border:1px solid #343647;border-top:3px solid var(--gold)}
  .hero-art{position:absolute;right:-15px;top:-45px;width:520px;height:520px;object-fit:cover;z-index:-2;opacity:.8;mask-image:linear-gradient(90deg,transparent,black 25%);-webkit-mask-image:linear-gradient(90deg,transparent,black 25%)}
  .hero:after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,#09111d 2%,#09111de6 29%,transparent 72%),linear-gradient(0deg,#09111d,transparent 35%);z-index:-1}
  .yardlines{position:absolute;inset:0;z-index:-1;background:repeating-linear-gradient(90deg,transparent 0,transparent 99px,#ffffff08 100px,#ffffff08 101px)}
  .hero-content{padding:32px 28px 52px;position:relative}
  .eyebrow{font-size:12px;letter-spacing:1.9px;font-weight:600;margin:0 0 12px;color:var(--muted)}
  .hero .eyebrow{color:var(--gold);display:flex;align-items:center;gap:12px}
  .crown{font-size:25px}
  h1,h2,h3,p{margin-top:0}
  h1,h2,h3{font-family:Teko,'Arial Narrow',Impact,sans-serif;font-weight:600}
  h1{font-size:72px;line-height:.85;letter-spacing:.5px;margin:16px 0 20px}
  h1 span{color:var(--gold)}
  .champion{font-family:Teko,Impact,sans-serif;font-size:32px;text-transform:uppercase;letter-spacing:1px;line-height:1.1;display:flex;align-items:center;gap:14px}
  .hero-headshot{width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid var(--gold);flex:none}
  .shame-headshot{width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid var(--red);flex:none}
  .award-headshot{width:26px;height:26px;border-radius:50%;object-fit:cover;border:1px solid var(--line);flex:none}
  .bonus-headshot{width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid var(--blue);flex:none}
  .bonus{background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--blue);padding:20px 24px;display:flex;gap:16px;align-items:center;margin:0 0 40px;flex-wrap:wrap}
  .bonus-icon{width:44px;height:44px;border:1px solid #2b4a86;color:var(--blue);background:#122040;display:grid;place-items:center;font-size:20px;flex:none}
  .bonus .eyebrow{color:#7aa8ff;font-size:11px;margin-bottom:6px}
  .bonus h3{font-size:20px;margin:0 0 4px;line-height:1.1}
  .bonus p{font-size:13px;color:var(--muted);margin:0}
  .bonus-stat{margin-left:auto;text-align:right}
  .bonus-stat>span{font-family:Teko,Impact,sans-serif;font-size:34px;line-height:1;color:var(--blue)}
  .bonus-stat small{font-size:10px;color:var(--muted)}
  .hero-copy{font-size:14px;color:#a9b3c5;line-height:1.7;margin:9px 0 22px}
  .hero-bottom{display:flex;align-items:center;gap:24px;flex-wrap:wrap}
  .hero-score{display:flex;align-items:baseline;gap:10px}
  .hero-score>span{font-family:Teko,Impact,sans-serif;font-size:56px;line-height:1;color:var(--gold)}
  small{font-size:11px;letter-spacing:1px;color:var(--muted)}
  .prize{border-left:1px solid #756139;padding-left:24px;display:flex;flex-direction:column}
  .prize>span{font-family:Teko,Impact,sans-serif;font-size:38px;font-weight:600;line-height:1;color:var(--gold)}
  .prize small{color:var(--gold);font-size:10px}
  .hero-foot{position:absolute;bottom:0;left:0;right:0;border-top:1px solid #ffffff12;display:flex;justify-content:space-between;padding:12px 28px;font-size:10px;letter-spacing:2px;color:var(--muted)}
  .hero-foot span span{margin:0 12px;color:var(--gold)}
  .shame{background:linear-gradient(90deg,#271b23,#141823);border:1px solid #523031;border-left:3px solid var(--red);padding:22px 24px;display:flex;gap:20px;align-items:center;margin:20px 0 38px;flex-wrap:wrap;position:relative;isolation:isolate;overflow:hidden}
  .shame-art{position:absolute;right:-35px;top:-30px;width:200px;height:200px;object-fit:cover;z-index:-1;opacity:.35;mask-image:linear-gradient(90deg,transparent,black 45%);-webkit-mask-image:linear-gradient(90deg,transparent,black 45%)}
  .shame-icon{font-size:36px;color:var(--red);border:1px solid #72372f;width:54px;height:54px;display:grid;place-items:center;flex:none}
  .shame .eyebrow{color:#eb7b6d;font-size:11px;margin-bottom:7px}
  .shame h2{font-size:27px;text-transform:uppercase;line-height:1;margin:0 0 6px}
  .shame p:last-child{color:var(--muted);font-size:13px;margin:0}
  .shame-score{margin-left:auto;text-align:right;display:flex;flex-direction:column}
  .shame-score>span{font-family:Teko,Impact,sans-serif;font-size:42px;line-height:1;color:#ed877b}
  .shame-score small{font-size:10px;margin-top:5px}
  .section-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 20px;flex-wrap:wrap}
  .section-heading h2{font-size:28px;letter-spacing:.4px;line-height:1;margin:0}
  .section-heading>span{font-size:10px;letter-spacing:1.5px;color:var(--muted)}
  .section-heading .eyebrow{font-size:10px;margin-bottom:10px}
  .award-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:40px}
  .award{background:var(--surface);border:1px solid var(--line);padding:20px;display:flex;flex-direction:column;position:relative;overflow:hidden}
  .award-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}
  .award-icon{width:36px;height:36px;color:#7aa8ff;background:#1b2c49;display:grid;place-items:center;font-size:20px}
  .award-index{font-family:Teko,sans-serif;color:#45516a;font-size:22px}
  .award h3{font-size:22px;line-height:1;margin-bottom:10px;letter-spacing:.5px}
  .award-team{font-weight:600;font-size:14px;margin-bottom:6px;display:flex;align-items:center;gap:8px}
  .award-context{font-size:12px;color:var(--muted);line-height:1.6;min-height:36px}
  .award-stat{border-top:1px solid var(--line);padding-top:14px;margin-top:8px;display:flex;align-items:baseline;gap:8px}
  .award-stat strong{font-family:Teko,sans-serif;font-size:35px;font-weight:500;line-height:1}
  .award-stat span{font-size:10px;color:var(--muted);letter-spacing:.7px}
  .award-copy{font-size:12px;line-height:1.6;color:var(--muted);margin:12px 0 0}
  .award-detail,.hero-detail,.shame-detail{list-style:none;padding:0;display:grid;gap:5px}
  .award-detail{margin:2px 0 6px;font-size:12px;line-height:1.45;color:#c3cad8}
  .award-detail li,.hero-detail li,.shame-detail li{position:relative;padding-left:13px}
  .award-detail li:before,.hero-detail li:before,.shame-detail li:before{content:'';position:absolute;left:0;top:.62em;width:5px;height:5px;border-radius:50%;background:var(--gold)}
  .hero-detail{margin:10px 0 22px;font-size:14px;line-height:1.5;color:#a9b3c5;max-width:46ch}
  .shame-detail{margin:0;font-size:13px;line-height:1.45;color:var(--muted)}
  .shame-detail li:before{background:#ed877b}
  .panel{padding:26px;background:#0f1929;border:1px solid var(--line);margin-bottom:40px}
  .rankings .section-heading{margin-bottom:22px}
  .chart-row{display:grid;grid-template-columns:25px 160px 1fr 65px;align-items:center;gap:14px;min-height:38px;border-bottom:1px solid #ffffff04}
  .rank{font-family:Teko,sans-serif;color:#63718a;font-size:21px}
  .team-label{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bar-track{height:12px;background:#ffffff03}
  .bar{height:100%;background:var(--bar);width:var(--width)}
  .chart-row:first-child .team-label,.chart-row:first-child .rank,.chart-row:first-child .chart-score{color:var(--gold)}
  .chart-score{font-family:Teko,sans-serif;font-size:22px;text-align:right;font-variant-numeric:tabular-nums}
  .chart-foot{display:flex;justify-content:space-between;font-size:10px;color:var(--muted);padding-top:18px;flex-wrap:wrap;gap:8px}
  .chart-foot i{display:inline-block;background:var(--gold);width:8px;height:8px;margin-right:8px}
  .standings-row{display:grid;grid-template-columns:25px 1fr 80px 100px;align-items:center;gap:14px;min-height:38px;border-bottom:1px solid #ffffff04}
  .standings-row:first-child .standings-name,.standings-row:first-child .rank{color:var(--gold)}
  .standings-record{font-family:Teko,sans-serif;font-size:20px;text-align:center}
  .standings-points{font-family:Teko,sans-serif;font-size:20px;text-align:right;font-variant-numeric:tabular-nums;color:var(--muted)}
  .scoreboard{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:40px}
  .game{background:var(--surface);border:1px solid var(--line);padding:18px}
  .game-header{font-size:10px;letter-spacing:1.5px;color:var(--muted);display:flex;justify-content:space-between;margin-bottom:14px}
  .game-row{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:8px 0;color:var(--muted);font-size:13px}
  .game-row strong{font-family:Teko,sans-serif;font-size:26px;line-height:1;font-weight:500}
  .game-row.winner{color:var(--text)}
  .game-row.winner strong{color:var(--gold)}
  .game-foot{font-size:10px;border-top:1px solid var(--line);padding-top:12px;margin-top:14px;color:var(--muted)}
  footer{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:28px 0 34px;flex-wrap:wrap;border-top:1px solid var(--line)}
  .footer-brand{font-family:Teko,sans-serif;font-size:24px;font-weight:600;letter-spacing:1px}
  .footer-brand span{color:var(--gold);margin-left:10px}
  footer p{font-size:11px;color:var(--muted);line-height:1.8;margin:0}
  footer>span{font-size:10px;letter-spacing:1.5px;color:#627088}
  @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
  @media(max-width:1000px){.season{display:none}.award-grid{grid-template-columns:repeat(2,1fr)}.hero-art{right:-90px}.scoreboard{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:640px){.brand{font-size:26px}.brand img{width:40px;height:40px}nav{width:100%;gap:20px;font-size:12px}.hero{min-height:auto}.hero-art{width:340px;height:340px;right:-140px;top:10px;opacity:.5}h1{font-size:56px;margin:16px 0}.champion{font-size:26px;max-width:230px}.hero-score>span{font-size:44px}.prize{padding-left:16px}.shame-art{width:130px;height:130px;right:-15px;top:-15px}.award-grid{grid-template-columns:1fr;gap:10px}.chart-row{grid-template-columns:18px 110px 1fr 46px;gap:8px}.scoreboard{grid-template-columns:1fr}}
</style>
"""

# Icon, flavor-line copy, and bar-chart colors ported from the approved
# mockup - kept as fixed strings per award category, independent of data.
_AWARD_COPY = {
    "blowout": ("↗", "That wasn't a matchup. That was a statement."),
    "heartbreaker": ("♡", "One more catch. A whole different group chat."),
    "upset": ("ϟ", "The projections have been asked to leave."),
    "bad_beat": ("◎", "Right score. Wrong opponent. Brutal."),
    "fraud": ("⚠", "The record says contender. The points say otherwise."),
    "benchwarmer": ("⌛", "Best seat in the house. Wrong side of the sideline."),
    "start_sit": ("⇄", "One lineup click away from a different week."),
    "waiver": ("⤴", "One man's trash. Another man's starting lineup."),
    "trade": ("⇌", "Somebody got fleeced. The receipts are right here."),
    "injury": ("✚", "Down bad, and the trainer's room is full."),
}
_CHART_COLORS = ["#e7a33b", "#528ae7", "#4b7ac9", "#426bb0", "#3e5e95", "#3b527b", "#3a4867", "#374059", "#343b4c", "#323744"]


def _award_card(idx, title, team, manager, context, value, unit, key, details=None):
    icon, copy = _AWARD_COPY[key]
    if team is None:
        return f"""
      <article class="award">
        <div class="award-top"><span class="award-icon">{icon}</span><span class="award-index">{idx:02d}</span></div>
        <h3>{title}</h3>
        <p class="award-team">No qualifying team</p>
        <div class="award-context">No award for this week.</div>
        <p class="award-copy">Some weeks don't fit the category.</p>
      </article>"""
    headshot = _headshot_img(team, manager, "award-headshot")
    return f"""
      <article class="award">
        <div class="award-top"><span class="award-icon">{icon}</span><span class="award-index">{idx:02d}</span></div>
        <h3>{title}</h3>
        <p class="award-team">{headshot}{_display_name(team, manager)}</p>
        <div class="award-context">{context}</div>{_detail_list(details)}
        <div class="award-stat"><strong>{value}</strong><span>{unit}</span></div>
        <p class="award-copy">{copy}</p>
      </article>"""


def _rank_row_html(entry, idx, max_score):
    pct = max(0.0, entry["score"] / max_score * 100) if max_score else 0
    color = _CHART_COLORS[idx] if idx < len(_CHART_COLORS) else _CHART_COLORS[-1]
    label = _display_name(entry["name"], entry.get("manager"))
    return f"""
      <div class="chart-row">
        <span class="rank">{idx + 1:02d}</span>
        <span class="team-label">{label}</span>
        <div class="bar-track"><div class="bar" style="background:{color};width:{pct:.1f}%"></div></div>
        <span class="chart-score">{entry['score']:.2f}</span>
      </div>"""


def _game_card_html(idx, m, is_sample):
    status = "FINAL" if not is_sample else "FINAL · DEMO"
    winner_label = _display_name(m.winner, m.winner_manager)
    loser_label = _display_name(m.loser, m.loser_manager)
    return f"""
      <article class="game">
        <div class="game-header"><span>MATCHUP 0{idx + 1}</span><span>{status}</span></div>
        <div class="game-row winner"><span>{winner_label}</span><strong>{max(m.team_a_score, m.team_b_score):.2f}</strong></div>
        <div class="game-row"><span>{loser_label}</span><strong>{m.loser_score:.2f}</strong></div>
        <div class="game-foot">{m.margin:.2f}-point margin of victory</div>
      </article>"""


def _bonus_note_html(note):
    """Optional one-off commissioner callout - e.g. a bench-points fact
    that isn't a computed award, just worth mentioning. `note` is a dict
    with 'title', optional 'team'/'manager' (shows a headshot + name if
    given), 'detail' (a sentence), and optional 'value'/'unit' (a stat
    number). Returns '' when note is None, so this is always safe to call."""
    if not note:
        return ""
    team = note.get("team")
    manager = note.get("manager")
    title = note.get("title", "COMMISSIONER'S NOTE")
    detail = note.get("detail", "")
    value = note.get("value")
    unit = note.get("unit", "")
    headshot = _headshot_img(team, manager, "bonus-headshot") if team else ""
    label = _display_name(team, manager) if team else ""
    stat_html = f'<div class="bonus-stat"><span>{value}</span><small>{unit}</small></div>' if value is not None else ""
    return f"""
  <section class="bonus" aria-label="Bonus note">
    <span class="bonus-icon" aria-hidden="true">&#9733;</span>
    {headshot}
    <div><p class="eyebrow">{title}</p><h3>{label}</h3><p>{detail}</p></div>
    {stat_html}
  </section>"""


def _detail_list(lines, css_class="award-detail"):
    """The short 'how it happened' lines under an award (see
    awards.award_details). Names come from Yahoo team names, which league
    members type themselves, so they're escaped."""
    if not lines:
        return ""
    items = "".join(f"<li>{escape(line)}</li>" for line in lines)
    return f'<ul class="{css_class}">{items}</ul>'


def _extra_award_cards(extras, details=None):
    """Cards for the roster/standings-based awards (see
    awards.compute_extra_awards). Categories whose data wasn't available
    this run are left out entirely rather than shown as empty."""
    cards = []

    def card(key, title, award, context, value, unit):
        idx = 7 + len(cards)
        if award is None:
            cards.append(_award_card(idx, title, None, None, None, None, None, key))
        else:
            cards.append(_award_card(idx, title, award["team"], award.get("manager"), context(award), value(award), unit, key,
                                     (details or {}).get(key)))

    if "fraud" in extras:
        card("fraud", "FRAUD ALERT", extras["fraud"],
             lambda a: f"{a['wins']}-{a['losses']}, but scored like a {a['expected_wins']:.1f}-win team",
             lambda a: f"+{a['luck']:.1f}", "WINS OVER EXPECTED")
    if "benchwarmer" in extras:
        card("benchwarmer", "BENCHWARMER DISASTER", extras["benchwarmer"],
             lambda a: f"{a['player']} went off on the bench",
             lambda a: f"{a['points']:.2f}", "BENCH POINTS")
    if "start_sit" in extras:
        card("start_sit", "START/SIT DISASTER", extras["start_sit"],
             lambda a: f"Benched {a['benched']} ({a['benched_points']:.2f}) for {a['started']} ({a['started_points']:.2f})",
             lambda a: f"{a['cost']:.2f}", "POINTS LOST")
    if "waiver" in extras:
        card("waiver", "WAIVER-WIRE STEAL", extras["waiver"],
             lambda a: f"{a['player']}, picked up off {a['source']}",
             lambda a: f"{a['points']:.2f}", "POINTS")
    if "trade" in extras:
        card("trade", "TRADE WINNER", extras["trade"],
             lambda a: f"Won the trade with {a['other_team']}: {a['received_points']:.2f} to {a['gave_points']:.2f} this week",
             lambda a: f"{a['margin']:.2f}", "POINT EDGE")
    if "injury" in extras:
        card("injury", "INJURY EXCUSE", extras["injury"],
             lambda a: "Lost with a banged-up lineup",
             lambda a: f"{a['count']}", "INJURED STARTERS")
    return "".join(cards)


def _standings_row_html(entry, idx):
    record = f"{entry['wins']}-{entry['losses']}"
    return f"""
      <div class="standings-row">
        <span class="rank">{idx + 1:02d}</span>
        <span class="team-label standings-name">{entry['id']}</span>
        <span class="standings-record">{record}</span>
        <span class="standings-points">{entry['points_for']:.2f} PF</span>
      </div>"""


def _standings_section_html(standings, week):
    """Season-long Power Rankings, built from every week recorded so far
    in S3's standings.json (see lambda_function.py's _publish_page).
    `standings` is the already-computed power_rankings() list - pass None
    (demo mode, or before any real week has ever been published) to omit
    the section entirely rather than show an empty table."""
    if not standings:
        return ""
    rows = "".join(_standings_row_html(entry, idx) for idx, entry in enumerate(standings))
    return f"""
  <section id="standings" class="panel">
    <div class="section-heading"><div><p class="eyebrow">SEASON STANDINGS</p><h2>POWER RANKINGS</h2></div><span>THROUGH WEEK {week:02d}</span></div>
    <div role="table" aria-label="Season standings ranked by wins, then total points">{rows}</div>
    <div class="chart-foot"><span><i></i> Current leader</span><span>Wins, then total points scored, breaks ties</span></div>
  </section>"""


def render_html(week, matchups, is_sample=True, bonus_note=None, standings=None, extras=None, details=None):
    details = details or {}
    awards = compute_awards(matchups)
    g, c, b, h = awards["goon"], awards["cock"], awards["blowout"], awards["heartbreaker"]

    demo_tag = '<span class="demo">DEMO EDITION · SAMPLE SCORES</span>' if is_sample else ""

    if awards["upset"]:
        u = awards["upset"]
        upset_card = _award_card(5, "UPSET OF THE WEEK", u["winner"], u.get("winner_manager"), f"Beat {u['loser']}", f"{u['gap']:.2f}", "PROJECTED DEFICIT", "upset", details.get("upset"))
    else:
        upset_card = _award_card(5, "UPSET OF THE WEEK", None, None, None, None, None, "upset")

    if awards["bad_beat"]:
        bb = awards["bad_beat"]
        bad_beat_card = _award_card(
            6, "BAD BEAT", bb["team"], bb.get("manager"), f"{bb['score']:.2f} points. Still took the L.",
            f"{bb['count']}/{len(matchups) * 2 - 1}", "OTHERS OUTSCORED", "bad_beat", details.get("bad_beat"),
        )
    else:
        bad_beat_card = _award_card(6, "BAD BEAT", None, None, None, None, None, "bad_beat")

    blowout_matchup = next(m for m in matchups if m.winner == b["winner"] and m.loser == b["loser"])
    heartbreak_matchup = next(m for m in matchups if m.winner == h["winner"] and m.loser == h["loser"])
    blowout_card = _award_card(3, "BIGGEST BLOWOUT", b["winner"], b.get("winner_manager"), f"Over {b['loser']}", f"{blowout_matchup.margin:.2f}", "POINT MARGIN", "blowout", details.get("blowout"))
    heartbreak_card = _award_card(4, "HEARTBREAKER", h["loser"], h.get("loser_manager"), f"Lost to {h['winner']}", f"{heartbreak_matchup.margin:.2f}", "POINTS SHORT", "heartbreaker", details.get("heartbreaker"))

    rankings = rank_teams(matchups)
    max_score = rankings[0]["score"] if rankings else 1
    rank_rows = "".join(_rank_row_html(entry, idx, max_score) for idx, entry in enumerate(rankings))
    game_cards = "".join(_game_card_html(idx, m, is_sample) for idx, m in enumerate(matchups))
    extra_cards = _extra_award_cards(extras or {}, details)
    # Caption shown under the peacock when the link is texted or posted.
    link_preview = escape(
        f"Goon of the Week: {_display_name(g['team'], g.get('manager'))} ({g['score']:.2f}). "
        f"Cock of the Week: {_display_name(c['team'], c.get('manager'))} ({c['score']:.2f}).",
        quote=True,
    )
    bonus_html = _bonus_note_html(bonus_note)
    standings_section = _standings_section_html(standings, week)
    standings_nav = '<a href="#standings">Power rankings</a>' if standings else ""

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0B1220">
<meta name="description" content="Gooncocks weekly fantasy football recap. The winners, the heartbreaks, and the receipts.">
<title>Gooncocks | Week {week} Recap</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="Gooncocks">
<meta property="og:title" content="Gooncocks | Week {week} Recap">
<meta property="og:description" content="{link_preview}">
<meta property="og:image" content="{LOGO_URL}">
<meta property="og:image:alt" content="The Gooncocks peacock">
<meta name="twitter:card" content="summary">
<link rel="icon" href="{LOGO_URL}">
<link rel="apple-touch-icon" href="{LOGO_URL}">
{STYLE_BLOCK}
</head>
<body>
<header class="masthead">
  <a class="brand" href="#"><img src="{LOGO_URL}" alt="Gooncocks peacock logo"><span>GOONCOCKS<small>FANTASY FOOTBALL LEAGUE</small></span></a>
  <nav aria-label="Recap sections"><a class="active" href="#awards">The recap</a><a href="#rankings">Weekly rankings</a>{standings_nav}<a href="#scoreboard">Scoreboard</a></nav>
  <span class="season">2026 SEASON <span>/</span> WEEK {week:02d}</span>
</header>
<main>
  <div class="edition"><span>THE WEEKLY RECAP <span class="slash">/</span> VOL. {week:02d}</span>{demo_tag}</div>

  <section class="hero" id="awards" aria-labelledby="hero-title">
    <div class="yardlines" aria-hidden="true"></div>
    <img class="hero-art" src="{LOGO_URL}" alt="Crowned blue peacock in a black hoodie holding a football">
    <div class="hero-content">
      <div class="eyebrow"><span class="crown">&#9819;</span> THE CROWN HAS A NEW HOME</div>
      <h1 id="hero-title">GOON OF<br>THE <span>WEEK.</span></h1>
      <div class="champion">{_headshot_img(g['team'], g.get('manager'), 'hero-headshot')}{_display_name(g['team'], g.get('manager'))}</div>
      {_detail_list(details.get("goon"), "hero-detail") or '<p class="hero-copy">Big points. Bigger bragging rights.<br>Everyone else, take notes.</p>'}
      <div class="hero-bottom">
        <div class="hero-score"><span>{g['score']:.2f}</span><small>POINTS</small></div>
        <div class="prize"><span>$50</span><small>WEEKLY WINNER</small></div>
      </div>
    </div>
    <div class="hero-foot"><span>01 <span>/</span> TOP OF THE PECKING ORDER</span><span>{len(rankings)} TEAMS. ONE CROWN.</span></div>
  </section>

  <section class="shame" aria-labelledby="shame-title">
    <img class="shame-art" src="{SHAME_ART_URL}" alt="" aria-hidden="true">
    <div class="shame-icon" aria-hidden="true">&#8595;</div>
    {_headshot_img(c['team'], c.get('manager'), 'shame-headshot')}
    <div><p class="eyebrow" id="shame-title">COCK OF THE WEEK</p><h2>{_display_name(c['team'], c.get('manager'))}</h2>{_detail_list(details.get("cock"), "shame-detail") or "<p>The group chat would like a word.</p>"}</div>
    <div class="shame-score"><span>{c['score']:.2f}</span><small>POINTS &middot; LEAGUE LOW</small></div>
  </section>

  <div class="section-heading"><h2>THIS WEEK'S HARDWARE</h2><span>THE NUMBERS DON'T LIE.</span></div>
  <section class="award-grid" aria-label="Weekly awards">
    {blowout_card}
    {heartbreak_card}
    {upset_card}
    {bad_beat_card}{extra_cards}
  </section>
{bonus_html}
  <section id="rankings" class="panel rankings">
    <div class="section-heading"><div><p class="eyebrow">THE PECKING ORDER</p><h2>EVERY POINT. EVERY TEAM.</h2></div><span>WEEK {week:02d} <span class="slash">/</span> TOTAL POINTS</span></div>
    <div role="img" aria-label="All teams ranked by their weekly scores">{rank_rows}</div>
    <div class="chart-foot"><span><i></i> Goon of the Week</span><span>Weekly scores, not season standings</span></div>
  </section>
{standings_section}
  <section id="scoreboard">
    <div class="section-heading"><div><p class="eyebrow">HEAD TO HEAD</p><h2>THE FINAL WORD</h2></div><span>{len(matchups)} MATCHUPS</span></div>
    <div class="scoreboard">{game_cards}</div>
  </section>

  <footer>
    <a class="footer-brand" href="#">GOONCOCKS<span>&#9819;</span></a>
    <p>Recap computed automatically from Yahoo Fantasy Sports data by an AWS Lambda function.<br>Posted to Discord and hosted at stats.gooncocks.com.</p>
    <span>BUILT FOR THE GROUP CHAT.</span>
  </footer>
</main>
</body>
</html>"""
