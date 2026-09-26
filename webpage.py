"""
Renders the shareable recap webpage as an HTML string, using the exact same
award data as awards.generate_recap() (via compute_awards()/rank_teams())
so the text recap and the webpage never disagree.

Layout follows the "sports network" mockup Will picked: a score ticker
across the top, a "<Goon> takes the crown" hero next to the season's
pecking order, gold Goon / red Cock of the Week cards, the rest of the
awards as rows with expandable receipts, every matchup, and weekly
scoring next to season standings. The artwork lives in the same S3
bucket as the page - see the *_URL constants below.

render_html(week, matchups) returns a complete, self-contained HTML page
(styles inlined, no external dependencies except Google Fonts and the
images) ready to upload somewhere public - see lambda_function.py's
_publish_page for the AWS side of that.
"""
import datetime
import math
import re
from html import escape

from awards import compute_awards, identity, rank_teams

SITE_URL = "https://stats.gooncocks.com"
HOME_URL = "https://gooncocks.com"
LOGO_URL = f"{SITE_URL}/gooncocks-logo.png"

# The crowned-peacock banner art. lambda_function.py uploads it to the
# bucket root on every publish (it's the landing page's hero too).
HERO_ART_URL = f"{SITE_URL}/landing-hero.webp"

# Goon / Cock of the Week card art (a partying king peacock, and a sad
# one on the locker-room bench). Uploaded alongside the hero art.
GOON_ART_URL = f"{SITE_URL}/goon-art.webp"
COCK_ART_URL = f"{SITE_URL}/cock-art.webp"

# Per-manager headshots, if uploaded. Convention: a manager named "Chet"
# maps to photos/chet.jpg - lowercased, apostrophes dropped, everything
# else non-alphanumeric collapsed to a dash. Keyed by manager (a person),
# not by team name, since team names get renamed mid-season and a manager
# doesn't - so a rename never orphans someone's photo. Falls back to the
# team name when no manager is known (e.g. sample data). Anyone without a
# photo gets a letter badge instead (the image removes itself on error).
PHOTO_BASE_URL = f"{SITE_URL}/photos/"


def _slugify(name: str) -> str:
    name = name.replace("'", "").replace("’", "")
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _who(team, manager):
    """The name shown on the page: the manager when known, else the team.
    Names come from Yahoo, where league members type them, so escaped."""
    return escape(identity(team, manager) or "")


def _avatar(team, manager, tone="blue", size=""):
    """A round letter badge, covered by the manager's headshot when one has
    been uploaded. tone picks the badge color: gold (winner), blue, red,
    or dark (on a gold background)."""
    key = identity(team, manager) or "?"
    photo = f'<img src="{PHOTO_BASE_URL}{_slugify(key)}.jpg" alt="" loading="lazy" onerror="this.remove()">'
    return f'<span class="av av-{tone} {size}" aria-hidden="true">{escape(key[:1].upper())}{photo}</span>'


def _season(today=None):
    today = today or datetime.date.today()
    return today.year if today.month >= 3 else today.year - 1


STYLE_BLOCK = """
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Archivo+Black&family=Work+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{color-scheme:dark;--bg:#07101f;--panel:#0b1629;--panel2:#0e1b33;--line:#1d2c4a;--line2:#2a3d63;--text:#f2f4f9;--muted:#9aa6bd;--dim:#6c7a95;--gold:#f6c343;--gold2:#e2a92a;--blue:#1f5bd8;--red:#b3262d;--red2:#7c161b;--display:Anton,Impact,'Arial Narrow',sans-serif}
  *{box-sizing:border-box}
  html{scroll-behavior:smooth;scroll-padding-top:16px}
  body{margin:0;background:var(--bg);color:var(--text);font-family:'Work Sans',system-ui,sans-serif;font-size:15px;line-height:1.45;overflow-x:hidden}
  a{color:inherit;text-decoration:none}
  a:focus-visible,summary:focus-visible{outline:2px solid var(--gold);outline-offset:3px}
  h1,h2,h3,p{margin:0}
  h1,h2,h3{font-family:var(--display);font-weight:400;letter-spacing:.5px;text-transform:uppercase}
  .wrap{max-width:1180px;margin:0 auto;padding:0 20px}
  .kicker{font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;display:flex;align-items:center;gap:10px}
  .kicker:after{content:'';flex:1;max-width:90px;height:2px;background:currentColor;opacity:.8}
  .num{font-family:var(--display);font-variant-numeric:tabular-nums;letter-spacing:.3px}

  /* avatars */
  .av{position:relative;flex:none;display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;font:700 12px/1 'Work Sans',sans-serif;overflow:hidden;color:#fff;background:var(--blue)}
  .av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .av-gold{background:var(--gold);color:#1a1405}
  .av-dark{background:#0b1629;color:#fff;box-shadow:0 0 0 3px #0b1629}
  .av-red{background:#fff;color:var(--red)}
  .av-lg{width:64px;height:64px;font:400 34px/1 var(--display)}

  /* masthead */
  .top{border-bottom:1px solid var(--line);background:#060e1c}
  .top .wrap{display:flex;align-items:center;gap:24px;min-height:84px}
  .brand{display:flex;align-items:center;gap:14px;margin-right:auto}
  .brand img{width:58px;height:58px;border-radius:50%;object-fit:cover;border:2px solid var(--gold);background:var(--blue)}
  .brand b{display:block;font:400 34px/1 var(--display);letter-spacing:1px}
  .brand small{display:block;font-size:10px;font-weight:700;letter-spacing:3.4px;color:var(--muted);margin-top:4px}
  .nav{display:flex;align-items:center;gap:28px;font-size:14px;font-weight:500;color:#cfd6e4}
  .nav a{padding:6px 0;border-bottom:2px solid transparent}
  .nav a:hover{color:var(--gold)}
  .nav a.on{color:#fff;border-color:var(--gold)}
  .wk{position:relative}
  .wk summary{list-style:none;cursor:pointer;background:var(--gold);color:#141005;font:400 16px/1 var(--display);letter-spacing:1px;padding:10px 18px;border-radius:100px;white-space:nowrap}
  .wk summary::-webkit-details-marker{display:none}
  .wk summary:after{content:'';display:inline-block;width:6px;height:6px;border:solid #141005;border-width:0 2px 2px 0;transform:rotate(45deg);margin:0 0 3px 9px}
  .wk-menu{position:absolute;right:0;top:calc(100% + 8px);z-index:20;min-width:160px;max-height:320px;overflow:auto;background:var(--panel2);border:1px solid var(--line2);border-radius:10px;padding:6px;box-shadow:0 14px 40px #0009}
  .wk-menu a{display:block;padding:9px 12px;border-radius:6px;font-weight:600;font-size:14px}
  .wk-menu a:hover{background:#ffffff10}
  .wk-menu a.on{color:var(--gold)}
  .home-mini{display:none}

  /* score ticker */
  .strip{display:flex;border-bottom:1px solid var(--line);background:#081223;overflow:hidden}
  .strip-tag{flex:none;display:flex;flex-direction:column;justify-content:center;padding:0 18px;background:var(--gold);color:#141005;font:400 19px/1 var(--display);letter-spacing:1px;white-space:nowrap}
  .strip-tag small{font:700 9px/1 'Work Sans',sans-serif;letter-spacing:1.8px;margin-top:5px}
  .strip-view{flex:1;min-width:0;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 28px,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(90deg,transparent,#000 28px,#000 calc(100% - 28px),transparent)}
  .strip-track{display:flex;width:max-content;animation:ticker var(--dur,35s) linear infinite}
  .strip:hover .strip-track,.strip:focus-within .strip-track{animation-play-state:paused}
  .strip-set,.strip-more{display:flex}
  @keyframes ticker{to{transform:translateX(-50%)}}
  .sg{flex:none;width:210px;padding:11px 18px 12px;border-left:1px solid var(--line)}
  .sg-row{display:flex;align-items:center;gap:9px;font-size:13px;color:#d6dcea}
  .sg-row+.sg-row{margin-top:6px}
  .sg-row span:not(.av){flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sg-row b{font:400 17px/1 var(--display);letter-spacing:.3px}
  .sg-row.win b{color:var(--gold)}
  @media(prefers-reduced-motion:reduce){.strip-track{animation:none}.strip-view{overflow-x:auto;scrollbar-width:none;-webkit-mask-image:none;mask-image:none}.strip-more,.strip-set[aria-hidden]{display:none}}

  .demo{background:#2a1f05;color:var(--gold);text-align:center;font-size:12px;font-weight:700;letter-spacing:2px;padding:8px}

  /* hero + pecking order */
  .lead{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:22px;margin-top:22px}
  .hero{position:relative;isolation:isolate;overflow:hidden;min-height:420px;border:1px solid var(--line2);border-radius:4px;background:#07101f;display:flex;align-items:center}
  .hero-art{position:absolute;right:0;top:0;width:66%;height:100%;object-fit:cover;object-position:62% 18%;z-index:-2;filter:saturate(1.05) brightness(.9)}
  .hero:before{content:'';position:absolute;inset:0;z-index:-1;background:linear-gradient(90deg,#07101f 34%,#07101fcc 50%,#07101f33 72%,transparent),linear-gradient(0deg,#07101fb0,transparent 40%)}
  .hero-body{padding:34px 34px 38px;max-width:620px}
  .hero .kicker{color:var(--gold)}
  .hero h1{font-size:clamp(48px,7.2vw,92px);line-height:.9;margin:18px 0 16px;overflow-wrap:anywhere}
  .hero h1.long{font-size:clamp(40px,5.4vw,70px)}
  .hero h1 span{color:var(--gold)}
  .hero-sub{font-size:18px;line-height:1.4;color:#e4e8f1;max-width:31ch}
  .btn{display:inline-flex;align-items:center;gap:10px;margin-top:24px;background:var(--gold);color:#141005;font-weight:700;font-size:14px;padding:12px 20px;border-radius:3px}
  .btn:hover{background:#ffd460}
  .arrow{display:inline-block;width:14px;height:10px;background:currentColor;clip-path:polygon(0 42%,70% 42%,70% 10%,100% 50%,70% 90%,70% 58%,0 58%)}
  .pecking{display:flex;flex-direction:column}
  .pecking h2{font-size:30px;line-height:1;margin-bottom:12px}
  .mini{width:100%;border-collapse:collapse;font-size:14px}
  .mini th{font-size:9px;letter-spacing:1.6px;color:var(--muted);font-weight:700;text-align:left;padding:0 10px 8px}
  .mini th:last-child,.mini td:last-child{text-align:right}
  .mini td{padding:9px 10px;border-top:1px solid var(--line);background:var(--panel)}
  .mini td:first-child{width:34px;color:var(--muted);font-weight:700}
  .mini tr:first-child td:first-child{color:var(--gold)}
  .mini .nm{display:flex;align-items:center;gap:10px;font-weight:600}
  .mini td:last-child{font:400 17px/1 var(--display)}
  .ghost{display:flex;justify-content:center;align-items:center;gap:8px;margin-top:12px;border:1px solid var(--line2);padding:11px;font-size:13px;font-weight:600;border-radius:3px}
  .ghost:hover{border-color:var(--gold);color:var(--gold)}

  /* goon / cock */
  .duo{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
  .big{position:relative;isolation:isolate;overflow:hidden;min-height:330px;display:flex;align-items:center;border:1px solid var(--line2);border-radius:4px;background:#0a1426}
  .goon{background:radial-gradient(ellipse at 78% 35%,#6b4c0f,#241a08 45%,#0a1426 75%)}
  .cock{background:radial-gradient(ellipse at 20% 85%,#4a1116,#0a1426 55%)}
  .big-art{position:absolute;right:0;top:0;width:68%;height:100%;object-fit:cover;object-position:75% 30%;z-index:-2;mask-image:linear-gradient(90deg,transparent,#000 24%);-webkit-mask-image:linear-gradient(90deg,transparent,#000 24%)}
  .big:before{content:'';position:absolute;inset:0;z-index:-1;background:linear-gradient(90deg,#0a1426e6 26%,#0a142680 44%,transparent 62%)}
  .big-text{position:relative;padding:24px 26px;max-width:60%}
  .big-word,.big-of{display:block;font-family:var(--display);font-weight:400;line-height:.86;text-transform:uppercase}
  .big-word{font-size:clamp(70px,8vw,96px);letter-spacing:1px}
  .big-of{font-size:clamp(32px,3.8vw,46px);margin-top:4px}
  .goon .big-word,.goon .big-of{background:linear-gradient(180deg,#ffe07a,#f0b631 55%,#c98a17);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 3px 0 #0006)}
  .cock .big-word,.cock .big-of{color:#ece5d3;text-shadow:0 3px 0 #0007}
  .big-name{font:400 clamp(38px,4.6vw,56px)/1 'Archivo Black',var(--display);text-transform:uppercase;color:#f3f3f3;margin-top:14px;overflow-wrap:anywhere;text-shadow:0 3px 0 #0007}
  .big-name.n-md{font-size:clamp(32px,3.7vw,44px)}
  .big-name.n-lg{font-size:clamp(25px,2.8vw,34px)}
  .big-pts{font:400 clamp(20px,2.3vw,28px)/1.1 'Archivo Black',var(--display);margin-top:6px}
  .goon .big-pts{color:var(--gold)}
  .cock .big-pts{color:#ec2f3b}
  .big-tag{margin-top:8px;font-size:15px}
  .goon .big-tag{font-weight:700;letter-spacing:1px;text-transform:uppercase}
  .cock .big-tag{font-weight:500;font-size:16px}
  .big .rc summary{text-align:left;margin-top:10px}
  .big .rc ul{max-width:36ch}

  /* sections */
  .sec{margin-top:44px}
  .sec-head{display:flex;align-items:center;gap:18px}
  .sec-head h2{font-size:34px;line-height:1}
  .sec-head:after{content:'';flex:1;height:1px;background:var(--line2)}
  .sec-sub{font-size:11px;font-weight:700;letter-spacing:3px;color:#8fb0ff;margin:6px 0 16px}

  /* award rows */
  .awards{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .aw{display:grid;grid-template-columns:44px minmax(0,1.1fr) minmax(0,1fr);gap:4px 14px;padding:16px 18px;background:var(--panel);border:1px solid var(--line);border-radius:3px}
  .ico{width:36px;height:36px;color:var(--gold)}
  .ico svg{width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
  .aw h3{font-family:'Work Sans',sans-serif;font-weight:700;font-size:12px;letter-spacing:2.2px;margin-bottom:8px}
  .aw-who{display:flex;align-items:center;gap:9px;font-weight:600;font-size:14px}
  .aw-who>span:not(.av){min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .aw-stat{margin-left:auto;padding-left:10px;text-align:left}
  .aw-stat b{display:block;font:400 28px/1 var(--display);letter-spacing:.3px}
  .aw-stat small{display:block;font-size:9px;font-weight:700;letter-spacing:1.4px;color:var(--muted);margin-top:4px;white-space:nowrap}
  .aw-side{border-left:1px solid var(--line);padding-left:14px;font-size:13px;color:#d9deea;display:flex;flex-direction:column;justify-content:center}
  .rc summary{list-style:none;cursor:pointer;margin-top:8px;align-self:flex-end;font-size:12px;font-weight:600;color:#9fbaff;text-align:right}
  .rc summary::-webkit-details-marker{display:none}
  .rc summary:after{content:' +';color:var(--gold);font-weight:700}
  .rc[open] summary:after{content:' \\2212'}
  .rc ul{list-style:none;margin:8px 0 0;padding:10px 0 0;border-top:1px dashed var(--line2);display:grid;gap:5px;font-size:12.5px;color:#c9d1e2}
  .rc li{position:relative;padding-left:13px}
  .rc li:before{content:'';position:absolute;left:0;top:.6em;width:5px;height:5px;border-radius:50%;background:var(--gold)}
  .empties{display:grid;grid-template-columns:1fr 1fr;margin-top:10px;background:var(--panel);border:1px solid var(--line);border-radius:3px}
  .aw-empty{display:flex;align-items:center;gap:16px;padding:14px 18px;font-size:13px;color:#cfd6e4}
  .aw-empty+.aw-empty{border-left:1px solid var(--line)}
  .aw-empty .ico{width:30px;height:30px}
  .aw-empty h3{font-family:'Work Sans',sans-serif;font-weight:700;font-size:12px;letter-spacing:2.2px;min-width:130px}

  .bonus{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-top:10px;padding:16px 20px;background:var(--panel);border:1px solid var(--line);border-left:3px solid #8fb0ff;border-radius:3px}
  .bonus .kicker{color:#8fb0ff;font-size:11px}
  .bonus h3{font-size:22px;margin:4px 0 2px}
  .bonus p{font-size:13px;color:var(--muted)}
  .bonus-stat{margin-left:auto;text-align:right}
  .bonus-stat b{display:block;font:400 30px/1 var(--display);color:#8fb0ff}
  .bonus-stat small{font-size:10px;letter-spacing:1px;color:var(--muted)}

  /* matchups */
  .games{display:grid;gap:6px}
  .game{display:grid;grid-template-columns:70px minmax(0,1fr) minmax(0,1fr) minmax(0,1.1fr);align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:3px;min-height:54px}
  .g-status{font-size:11px;font-weight:700;letter-spacing:2px;color:var(--muted);text-align:center;border-right:1px solid var(--line);align-self:stretch;display:grid;place-items:center}
  .g-team{display:flex;align-items:center;gap:10px;padding:8px 16px;min-width:0}
  .g-team .nm{min-width:0;font-weight:600;font-size:14px;line-height:1.2;overflow:hidden;text-overflow:ellipsis}
  .g-team .nm small{display:block;font-size:11px;font-weight:500;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .g-team b{font:400 24px/1 var(--display);letter-spacing:.3px;margin-left:auto}
  .g-team.win b{color:var(--gold)}
  .g-team.lose{flex-direction:row;border-left:1px solid var(--line)}
  .g-team.lose b{margin:0 6px 0 0;color:#e4e8f1}
  .g-meta{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:8px 16px;border-left:1px solid var(--line);font-size:12.5px;color:#cfd6e4;align-self:stretch}
  .badge{background:var(--gold);color:#141005;font:400 12px/1 var(--display);letter-spacing:1px;padding:5px 8px}

  /* tables */
  .tables{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  .tables.solo{grid-template-columns:1fr}
  .tcard{background:var(--panel);border:1px solid var(--line);border-radius:3px;padding:18px 18px 14px}
  .thead{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:12px}
  .thead h2{font-size:30px;line-height:1}
  .thead span{font-size:10px;font-weight:700;letter-spacing:1.8px;color:var(--muted)}
  .tbl{width:100%;border-collapse:collapse;font-size:14px}
  .tbl th{font-size:9px;font-weight:700;letter-spacing:1.6px;color:var(--muted);text-align:left;padding:6px 10px;border-bottom:1px solid var(--line2)}
  .tbl td{padding:6px 10px;border-bottom:1px solid #ffffff0a}
  .tbl td:first-child,.tbl th:first-child{width:36px;text-align:center;color:var(--muted);font-weight:700}
  .tbl .nm{display:flex;align-items:center;gap:10px;font-weight:500}
  .tbl .r{text-align:right;font:400 16px/1 var(--display);letter-spacing:.3px}
  .tbl th.r{font:700 9px/1 'Work Sans',sans-serif;letter-spacing:1.6px}
  .tbl .c{text-align:center}
  .tbl tr.hi td{background:var(--gold);color:#141005}
  .tbl tr.lo td{background:#3a1015;color:#ff9b9b;border-bottom-color:var(--red)}

  /* week nav + footer */
  .weeknav{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:18px;margin:40px 0 0}
  .wn{border:1px solid var(--line2);padding:12px 18px;font:400 16px/1 var(--display);letter-spacing:1.5px;display:inline-flex;align-items:center;gap:10px;border-radius:3px;white-space:nowrap}
  a.wn:hover{border-color:var(--gold);color:var(--gold)}
  .wn.off{visibility:hidden}
  .wn .arrow.back{transform:scaleX(-1)}
  .wn-mid{display:flex;align-items:center;gap:14px;font-size:11px;font-weight:700;letter-spacing:2.4px;color:#cfd6e4;justify-content:center}
  .wn-mid:before,.wn-mid:after{content:'';flex:1;height:1px;background:var(--line2)}
  .wn-mid:hover{color:var(--gold)}
  footer{margin-top:40px;border-top:1px solid var(--line);background:#060e1c}
  footer .wrap{display:flex;align-items:center;justify-content:center;gap:28px;padding:28px 20px 36px;flex-wrap:wrap}
  .f-brand b{display:block;font:400 34px/1 var(--display);letter-spacing:1px}
  .f-brand small{display:block;font-size:9px;font-weight:700;letter-spacing:3.4px;color:var(--muted);margin-top:4px;text-align:center}
  .f-note{border-left:1px solid var(--line2);padding-left:28px;font-size:10px;font-weight:700;letter-spacing:2px;color:var(--muted);line-height:1.6}

  @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
  @media(max-width:1000px){
    .nav a:not(.keep){display:none}
    .lead{grid-template-columns:1fr}
    .duo{grid-template-columns:1fr}
    .big-art{width:58%;object-position:100% 30%}
    .awards{grid-template-columns:1fr}
    .tables{grid-template-columns:1fr}
    .game{grid-template-columns:62px minmax(0,1fr) minmax(0,1fr)}
    .g-meta{grid-column:2/-1;border-left:0;border-top:1px solid var(--line);padding:8px 16px}
    .g-status{grid-row:span 2}
  }
  @media(max-width:640px){
    body{font-size:14px}
    .wrap{padding:0 16px}
    .top .wrap{min-height:66px;gap:12px}
    .brand{gap:10px}
    .brand img{width:42px;height:42px}
    .brand{min-width:0}
    .brand b{font-size:24px}
    .brand small{font-size:8px;letter-spacing:2px;white-space:nowrap}
    .nav{gap:12px;flex:none}
    .nav a.keep{font-size:13px}
    .wk summary{font-size:14px;padding:9px 14px}
    .strip-tag{padding:0 12px;font-size:16px}
    .sg{width:186px;padding:10px 14px 11px}
    .hero{min-height:470px;align-items:flex-end}
    .hero-art{width:100%;object-position:58% 12%}
    .hero:before{background:linear-gradient(0deg,#07101f 30%,#07101fb3 52%,#07101f1a 80%)}
    .hero-body{padding:24px 20px 26px}
    .hero h1{margin:14px 0 12px}
    .hero-sub{font-size:16px}
    .duo{grid-template-columns:1fr}
    .big{min-height:300px}
    .big-art{width:78%;mask-image:linear-gradient(90deg,transparent,#000 30%);-webkit-mask-image:linear-gradient(90deg,transparent,#000 30%)}
    .goon .big-art{object-position:30% 30%}
    .cock .big-art{object-position:22% 40%}
    .big:before{background:linear-gradient(90deg,#0a1426f2 30%,#0a1426a6 50%,#0a142620 72%)}
    .big-text{padding:20px 18px;max-width:64%}
    .big-word{font-size:66px}
    .big-of{font-size:31px}
    .big-name{font-size:36px;margin-top:12px}
    .big-name.n-md{font-size:29px}
    .big-name.n-lg{font-size:23px}
    .big-pts{font-size:19px}
    .big-tag,.cock .big-tag{font-size:12.5px}
    .av-lg{width:54px;height:54px;font-size:28px}
    .sec{margin-top:36px}
    .sec-head h2{font-size:28px}
    .aw{grid-template-columns:36px minmax(0,1fr);padding:14px}
    .ico{width:30px;height:30px}
    .aw-side{grid-column:1/-1;border-left:0;border-top:1px solid var(--line);padding:10px 0 0;margin-top:6px}
    .empties{grid-template-columns:1fr}
    .aw-empty+.aw-empty{border-left:0;border-top:1px solid var(--line)}
    .aw-empty h3{min-width:0;flex:1}
    .game{grid-template-columns:minmax(0,1fr)}
    .g-status{grid-column:auto;grid-row:auto;border-right:0;padding:10px 14px 0;place-items:center start;font-size:10px}
    .g-team{padding:6px 14px;gap:10px}
    .g-team .nm{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .g-team .nm small{display:inline;margin-left:6px}
    .g-team b{font-size:22px}
    .g-team.lose{border-left:0}
    .g-team.lose b{order:3;margin-left:auto;margin-right:0}
    .g-meta{grid-column:auto;padding:8px 14px 10px;margin-top:4px}
    .tcard{padding:14px 10px 10px}
    .thead h2{font-size:25px}
    .tbl td,.tbl th{padding:6px 6px}
    .weeknav{grid-template-columns:1fr 1fr;gap:10px}
    .wn-mid{grid-column:1/-1;grid-row:1}
    .wn{justify-content:center}
    .f-note{border-left:0;padding-left:0;text-align:center}
  }
  @media(max-width:470px){.brand span{display:none}.brand img{width:38px;height:38px}.nav{gap:14px}}
  @media(max-width:400px){.aw-stat b{font-size:24px}}
</style>
"""

# Line icons for each award, drawn to a 24x24 box.
_ICONS = {
    "blowout": '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 21h8M9 18h6"/>',
    "heartbreaker": '<path d="M12 20s-8-4.6-8-10.2A4.3 4.3 0 0 1 12 7.5a4.3 4.3 0 0 1 8 2.3C20 15.4 12 20 12 20z"/><path d="M12 7.5l-1.5 3.5 3 2.2-2 3.3"/>',
    "upset": '<path d="M4 20h16M6 20v-5M10 20V11M14 20V7M18 20V4"/>',
    "bad_beat": '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',
    "fraud": '<path d="M4 5c5 1.5 11 1.5 16 0v6c0 5-3.6 8.5-8 9.5-4.4-1-8-4.5-8-9.5z"/><path d="M7.5 10.5c1-.8 2.2-.8 3 0M13.5 10.5c1-.8 2.2-.8 3 0M9 15.5c1.8 1 4.2 1 6 0"/>',
    "benchwarmer": '<path d="M3 9h18M4 9V6h16v3M5 9v9M19 9v9M3 13h18M7 13v5M17 13v5"/>',
    "start_sit": '<path d="M5 5l14 14M19 5L5 19"/>',
    "waiver": '<path d="M14 3H6v18h8M14 3l5 5v4M14 3v5h5"/><path d="M18 15v6M15 18h6"/>',
    "trade": '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
    "injury": '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
}


def _icon(key):
    return f'<span class="ico" aria-hidden="true"><svg viewBox="0 0 24 24">{_ICONS[key]}</svg></span>'


def _detail_list(lines, css_class=None):
    """The short 'how it happened' lines under an award (see
    awards.award_details). Names come from Yahoo team/player data, so
    they're escaped."""
    if not lines:
        return ""
    items = "".join(f"<li>{escape(line)}</li>" for line in lines)
    cls = f' class="{css_class}"' if css_class else ""
    return f"<ul{cls}>{items}</ul>"


def _receipts(lines):
    if not lines:
        return ""
    return f'<details class="rc"><summary>See the receipts</summary>{_detail_list(lines)}</details>'


def _award_row(key, title, team, manager, value, unit, context, lines):
    return f"""
      <article class="aw">
        {_icon(key)}
        <div>
          <h3>{title}</h3>
          <div class="aw-who">{_avatar(team, manager, "gold")}<span>{_who(team, manager)}</span>
            <div class="aw-stat"><b>{value}</b><small>{unit}</small></div></div>
        </div>
        <div class="aw-side"><p>{context}</p>{_receipts(lines)}</div>
      </article>"""


def _empty_row(key, title):
    return f'<div class="aw-empty">{_icon(key)}<h3>{title}</h3><p>No qualifying team</p></div>'


def _find(matchups, winner, loser):
    return next(m for m in matchups if m.winner == winner and m.loser == loser)


def _award_rows(matchups, awards, extras, details):
    """(rows, empties): one row per award someone won, in the mockup's
    order, and a compact 'No qualifying team' line for each category that
    was checked but nobody earned. Categories whose data wasn't available
    this run (e.g. rosters) are left out entirely."""
    rows, empties = [], []

    def add(key, title, award, build):
        if award is None:
            empties.append(_empty_row(key, title))
        else:
            team, manager, value, unit, context = build(award)
            rows.append(_award_row(key, title, team, manager, value, unit, context, details.get(key)))

    b, h = awards["blowout"], awards["heartbreaker"]
    bm, hm = _find(matchups, b["winner"], b["loser"]), _find(matchups, h["winner"], h["loser"])
    add("blowout", "BIGGEST BLOWOUT", b, lambda a: (
        a["winner"], a.get("winner_manager"), f"{bm.margin:.2f}", "POINT MARGIN",
        f"{_who(a['winner'], a.get('winner_manager'))} ran away from {_who(bm.loser, bm.loser_manager)}."))
    add("heartbreaker", "HEARTBREAKER", h, lambda a: (
        a["loser"], a.get("loser_manager"), f"{hm.margin:.2f}", "POINTS SHORT",
        f"{_who(hm.winner, hm.winner_manager)} escaped with the win."))

    def upset(a):
        m = _find(matchups, a["winner"], a["loser"])
        return (a["winner"], a.get("winner_manager"), f"{a['gap']:.2f}", "PROJECTED DEFICIT",
                f"{_who(a['winner'], a.get('winner_manager'))} beat the projections. And {_who(m.loser, m.loser_manager)}.")
    add("upset", "UPSET OF THE WEEK", awards["upset"], upset)
    add("bad_beat", "BAD BEAT", awards["bad_beat"], lambda a: (
        a["team"], a.get("manager"), f"{a['count']}/{len(matchups) * 2 - 1}", "TEAMS OUTSCORED",
        f"{a['score']:.2f} points. Still took the L."))

    if "fraud" in extras:
        add("fraud", "FRAUD ALERT", extras["fraud"], lambda a: (
            a["team"], a.get("manager"), f"+{a['luck']:.1f}", "WINS OVER EXPECTED",
            f"{a['wins']}-{a['losses']}, but scored like a {a['expected_wins']:.1f}-win team."))
    if "benchwarmer" in extras:
        add("benchwarmer", "BENCHWARMER DISASTER", extras["benchwarmer"], lambda a: (
            a["team"], a.get("manager"), f"{a['points']:.2f}", "BENCH POINTS",
            f"{escape(a['player'])} watched from the bench."))
    if "start_sit" in extras:
        add("start_sit", "START/SIT DISASTER", extras["start_sit"], lambda a: (
            a["team"], a.get("manager"), f"{a['cost']:.2f}", "POINTS LOST",
            f"{escape(a['benched'])} sat. {escape(a['started'])} started."))
    if "waiver" in extras:
        add("waiver", "WAIVER-WIRE STEAL", extras["waiver"], lambda a: (
            a["team"], a.get("manager"), f"{a['points']:.2f}", "POINTS",
            f"{escape(a['player'])} delivered off {a['source']}."))
    if "trade" in extras:
        add("trade", "TRADE WINNER", extras["trade"], lambda a: (
            a["team"], a.get("manager"), f"{a['margin']:.2f}", "POINT EDGE",
            f"Won the trade with {escape(a['other_team'])}."))
    if "injury" in extras:
        add("injury", "INJURY EXCUSE", extras["injury"], lambda a: (
            a["team"], a.get("manager"), f"{a['count']}", "INJURED STARTERS",
            "A crowded trainer's room. A rough week."))
    return "".join(rows), "".join(empties)


def _bonus_note_html(note):
    """Optional one-off commissioner callout - e.g. a bench-points fact
    that isn't a computed award, just worth mentioning. `note` is a dict
    with 'title', optional 'team'/'manager' (shows a headshot + name if
    given), 'detail' (a sentence), and optional 'value'/'unit' (a stat
    number). Returns '' when note is None, so this is always safe to call."""
    if not note:
        return ""
    team, manager = note.get("team"), note.get("manager")
    title = escape(note.get("title", "COMMISSIONER'S NOTE"))
    avatar = _avatar(team, manager, "blue", "av-lg") if team else ""
    label = _who(team, manager) if team else ""
    value = note.get("value")
    stat = (f'<div class="bonus-stat"><b>{escape(str(value))}</b><small>{escape(note.get("unit", ""))}</small></div>'
            if value is not None else "")
    return f"""
    <section class="bonus" aria-label="Commissioner's note">
      {avatar}
      <div><p class="kicker">{title}</p><h3>{label}</h3><p>{escape(note.get("detail", ""))}</p></div>
      {stat}
    </section>"""


def _ticker_html(matchups, week, status):
    """The scrolling score ticker under the header. The games repeat enough
    to fill a wide screen, then the whole run is doubled so the scroll can
    loop seamlessly (the copies are hidden from screen readers)."""
    games = "".join(_strip_game(m) for m in matchups)
    repeats = max(1, math.ceil(2000 / (max(len(matchups), 1) * 200)))
    extra = f'<div class="strip-more" aria-hidden="true">{games * (repeats - 1)}</div>' if repeats > 1 else ""
    duration = len(matchups) * repeats * 6
    return f"""<div class="strip" role="region" aria-label="Week {week} final scores">
  <span class="strip-tag">WEEK {week:02d}<small>{status}</small></span>
  <div class="strip-view"><div class="strip-track" style="--dur:{duration}s">
    <div class="strip-set">{games}{extra}</div><div class="strip-set" aria-hidden="true">{games * repeats}</div>
  </div></div>
</div>"""


def _strip_game(m):
    sides = sorted(
        [(m.team_a_name, m.team_a_manager, m.team_a_score), (m.team_b_name, m.team_b_manager, m.team_b_score)],
        key=lambda s: -s[2],
    )
    rows = "".join(
        f'<div class="sg-row{" win" if i == 0 else ""}">{_avatar(t, mgr, "gold" if i == 0 else "blue")}'
        f"<span>{_who(t, mgr)}</span><b>{score:.2f}</b></div>"
        for i, (t, mgr, score) in enumerate(sides)
    )
    return f'<div class="sg">{rows}</div>'


def _game_row(m, status, badge):
    badge_html = f'<span class="badge">{badge}</span>' if badge else ""
    return f"""
      <div class="game">
        <span class="g-status">{status}</span>
        <div class="g-team win">{_avatar(m.winner, m.winner_manager, "gold")}<span class="nm">{_who(m.winner, m.winner_manager)}{_team_line(m.winner, m.winner_manager)}</span><b>{max(m.team_a_score, m.team_b_score):.2f}</b></div>
        <div class="g-team lose"><b>{m.loser_score:.2f}</b>{_avatar(m.loser, m.loser_manager, "blue")}<span class="nm">{_who(m.loser, m.loser_manager)}{_team_line(m.loser, m.loser_manager)}</span></div>
        <div class="g-meta"><span>{m.margin:.2f}-point margin</span>{badge_html}</div>
      </div>"""


def _team_line(team, manager):
    """The team name under a manager's name, when they're different."""
    return f"<small>{escape(team)}</small>" if manager and team and team != manager else ""


def _pecking_html(standings, rankings):
    """Top five of the season standings beside the hero; falls back to
    this week's scores when there are no standings yet (demo mode)."""
    if standings:
        rows = "".join(
            f'<tr><td>{i + 1}</td><td><span class="nm">{_avatar(e["id"], None)}{escape(e["id"])}</span></td>'
            f'<td>{e["wins"]} - {e["losses"]}</td></tr>'
            for i, e in enumerate(standings[:5])
        )
        head = "<th>#</th><th>MANAGER</th><th>RECORD</th>"
    else:
        rows = "".join(
            f'<tr><td>{i + 1}</td><td><span class="nm">{_avatar(e["name"], e.get("manager"))}{_who(e["name"], e.get("manager"))}</span></td>'
            f'<td>{e["score"]:.2f}</td></tr>'
            for i, e in enumerate(rankings[:5])
        )
        head = "<th>#</th><th>MANAGER</th><th>PTS</th>"
    return f"""
    <aside class="pecking" aria-labelledby="pecking-title">
      <h2 id="pecking-title">THE PECKING ORDER</h2>
      <table class="mini"><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table>
      <a class="ghost" href="#standings">Full standings <i class="arrow"></i></a>
    </aside>"""


def _tables_html(week, rankings, standings):
    n = len(rankings)
    weekly = "".join(
        f'<tr class="{"hi" if i == 0 else "lo" if i == n - 1 and n > 1 else ""}"><td>{i + 1}</td>'
        f'<td><span class="nm">{_avatar(e["name"], e.get("manager"), "dark" if i == 0 else "blue")}{_who(e["name"], e.get("manager"))}</span></td>'
        f'<td class="r">{e["score"]:.2f}</td></tr>'
        for i, e in enumerate(rankings)
    )
    weekly_card = f"""
      <section class="tcard" aria-labelledby="weekly-title">
        <div class="thead"><h2 id="weekly-title">WEEKLY SCORING</h2><span>WEEK {week:02d} ONLY</span></div>
        <table class="tbl"><thead><tr><th>#</th><th>MANAGER</th><th class="r">PTS</th></tr></thead><tbody>{weekly}</tbody></table>
      </section>"""
    if not standings:
        return f'<div class="tables solo" id="standings">{weekly_card}</div>'
    season = "".join(
        f'<tr class="{"hi" if i == 0 else ""}"><td>{i + 1}</td>'
        f'<td><span class="nm">{_avatar(e["id"], None, "dark" if i == 0 else "blue")}{escape(e["id"])}</span></td>'
        f'<td class="r c">{e["wins"]} - {e["losses"]}</td><td class="r">{e["points_for"]:.2f}</td></tr>'
        for i, e in enumerate(standings)
    )
    return f"""
    <div class="tables" id="standings">{weekly_card}
      <section class="tcard" aria-labelledby="season-title">
        <div class="thead"><h2 id="season-title">SEASON STANDINGS</h2><span>THROUGH WEEK {week:02d}</span></div>
        <table class="tbl"><thead><tr><th>#</th><th>MANAGER</th><th class="r c">W - L</th><th class="r">PF</th></tr></thead><tbody>{season}</tbody></table>
      </section>
    </div>"""


def _name_size(award):
    """Steps the Goon/Cock name down a size for longer names so it stays
    beside the art instead of running under it."""
    n = len(identity(award["team"], award.get("manager")) or "")
    return "" if n <= 5 else " n-md" if n <= 8 else " n-lg"


def _week_url(w):
    return f"/weeks/week-{w}.html"


def _week_links(week, weeks):
    links = []
    for w in sorted(set(weeks) | {week}, reverse=True):
        current = ' class="on"' if w == week else ""
        links.append(f'<a href="{_week_url(w)}"{current}>Week {w:02d}</a>')
    return "".join(links)


def _week_step(week, weeks, step):
    """The previous/next week button. It's rendered hidden when that week
    hasn't been published yet; the script at the bottom of the page
    reveals it later from landing.json, so old archive pages pick up the
    next week without being re-published."""
    w = week + step
    label = f"WEEK {w:02d}"
    arrow = '<i class="arrow back"></i>' if step < 0 else '<i class="arrow"></i>'
    inner = f"{arrow} {label}" if step < 0 else f"{label} {arrow}"
    if w in weeks:
        return f'<a class="wn" href="{_week_url(w)}" data-step="{step}">{inner}</a>'
    return f'<a class="wn off" data-step="{step}" data-week="{w}" aria-hidden="true" tabindex="-1">{inner}</a>'


# Keeps the week menu and previous/next buttons current on every page,
# including old archived weeks, from the landing.json the Lambda rewrites
# on each publish. Without it (or if the fetch fails) the page still works
# with whatever weeks existed when it was published.
_WEEK_SCRIPT = """
<script>
(function(){
  var cur = __WEEK__;
  fetch('/landing.json', {cache: 'no-cache'}).then(function(r){ return r.ok ? r.json() : null; }).then(function(d){
    if (!d || !d.weeks || !d.weeks.length) return;
    var have = d.weeks.map(function(w){ return w.week; });
    if (have.indexOf(cur) < 0) have.push(cur);
    have.sort(function(a, b){ return b - a; });
    var menu = document.getElementById('wkMenu');
    menu.innerHTML = '';
    have.forEach(function(w){
      var a = document.createElement('a');
      a.href = '/weeks/week-' + w + '.html';
      a.textContent = 'Week ' + (w < 10 ? '0' : '') + w;
      if (w === cur) a.className = 'on';
      menu.appendChild(a);
    });
    document.querySelectorAll('.wn[data-week]').forEach(function(el){
      var w = Number(el.getAttribute('data-week'));
      if (have.indexOf(w) < 0) return;
      el.href = '/weeks/week-' + w + '.html';
      el.classList.remove('off');
      el.removeAttribute('aria-hidden');
      el.removeAttribute('tabindex');
    });
  }).catch(function(){});
})();
</script>"""


def render_html(week, matchups, is_sample=True, bonus_note=None, standings=None, extras=None, details=None,
                weeks=None):
    """`weeks` is every week number published so far this season (for the
    week menu and previous/next buttons); `standings` is power_rankings()
    output, or None to leave the season tables out."""
    details = details or {}
    extras = extras or {}
    week = int(week)
    weeks = sorted({int(w) for w in (weeks or [])} | ({week} if not is_sample else set()))
    awards = compute_awards(matchups)
    g, c = awards["goon"], awards["cock"]
    rankings = rank_teams(matchups)
    status = "DEMO" if is_sample else "FINAL"
    season = _season()

    goon_name = _who(g["team"], g.get("manager"))
    cock_name = _who(c["team"], c.get("manager"))
    goon_lines = details.get("goon") or []
    hero_sub = f"{g['score']:.2f} points. $50 richer. "
    hero_sub += escape(goon_lines[0]) + "." if goon_lines else "Plenty to say in the group chat."
    headline_class = ' class="long"' if len(identity(g["team"], g.get("manager"))) > 9 else ""

    b, h = awards["blowout"], awards["heartbreaker"]
    blowout_m, closest_m = _find(matchups, b["winner"], b["loser"]), _find(matchups, h["winner"], h["loser"])
    games = "".join(
        _game_row(m, status, "BIGGEST BLOWOUT" if m is blowout_m else "CLOSEST GAME" if m is closest_m else "")
        for m in sorted(matchups, key=lambda m: -max(m.team_a_score, m.team_b_score))
    )
    award_rows, empty_rows = _award_rows(matchups, awards, extras, details)
    empties = f'<div class="empties">{empty_rows}</div>' if empty_rows else ""

    # Caption shown under the peacock when the link is texted or posted.
    link_preview = escape(
        f"Goon of the Week: {identity(g['team'], g.get('manager'))} ({g['score']:.2f}). "
        f"Cock of the Week: {identity(c['team'], c.get('manager'))} ({c['score']:.2f}).",
        quote=True,
    )
    demo_banner = '<div class="demo">DEMO EDITION &middot; SAMPLE SCORES</div>' if is_sample else ""
    week_menu = f'<div class="wk-menu" id="wkMenu">{_week_links(week, weeks)}</div>'
    week_nav = "" if is_sample else f"""
  <nav class="weeknav wrap" aria-label="Other weeks">
    {_week_step(week, weeks, -1)}
    <a class="wn-mid" href="{HOME_URL}/#archive">{season} SEASON ARCHIVE</a>
    {_week_step(week, weeks, 1)}
  </nav>"""
    script = "" if is_sample else _WEEK_SCRIPT.replace("__WEEK__", str(week))

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#07101f">
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
<header class="top">
  <div class="wrap">
    <a class="brand" href="{HOME_URL}"><img src="{LOGO_URL}" alt="Gooncocks peacock logo"><span><b>GOONCOCKS</b><small>SPU FANTASY FOOTBALL</small></span></a>
    <nav class="nav" aria-label="Recap sections">
      <a class="on" href="#top">This Week</a><a href="#awards">Awards</a><a href="#matchups">Matchups</a><a href="#standings">Standings</a><a class="keep" href="{SITE_URL}/rivalries.html">Rivalries</a><a class="keep" href="{HOME_URL}">Home</a>
      <details class="wk"><summary>WEEK {week:02d}</summary>{week_menu}</details>
    </nav>
  </div>
</header>
{demo_banner}
{_ticker_html(matchups, week, status)}

<main class="wrap" id="top">
  <div class="lead">
    <section class="hero" aria-labelledby="hero-title">
      <img class="hero-art" src="{HERO_ART_URL}" alt="Crowned blue peacock in a Gooncocks hoodie holding a football">
      <div class="hero-body">
        <p class="kicker">THE WEEKLY RECAP &middot; WEEK {week:02d}</p>
        <h1 id="hero-title"{headline_class}>{goon_name} TAKES<br>THE <span>CROWN.</span></h1>
        <p class="hero-sub">{hero_sub}</p>
        <a class="btn" href="#awards">This week's awards <i class="arrow"></i></a>
      </div>
    </section>
    {_pecking_html(standings, rankings)}
  </div>

  <div class="duo">
    <article class="big goon" aria-labelledby="goon-title">
      <img class="big-art" src="{GOON_ART_URL}" alt="Crowned peacock in a royal robe and sunglasses, holding a gold trophy">
      <div class="big-text">
        <h3 id="goon-title"><span class="big-word">GOON</span><span class="big-of">OF THE WEEK</span></h3>
        <p class="big-name{_name_size(g)}">{goon_name}</p>
        <p class="big-pts">{g['score']:.2f} POINTS</p>
        <p class="big-tag">$50 and bragging rights</p>
        {_receipts(goon_lines[1:])}
      </div>
    </article>
    <article class="big cock" aria-labelledby="cock-title">
      <img class="big-art" src="{COCK_ART_URL}" alt="Dejected peacock slumped on a locker-room bench next to a Cock of the Week trophy">
      <div class="big-text">
        <h3 id="cock-title"><span class="big-word">COCK</span><span class="big-of">OF THE WEEK</span></h3>
        <p class="big-name{_name_size(c)}">{cock_name}</p>
        <p class="big-pts">{c['score']:.2f} POINTS</p>
        <p class="big-tag">Mute the chat. It won't help.</p>
        {_receipts(details.get("cock"))}
      </div>
    </article>
  </div>

  <section class="sec" id="awards" aria-labelledby="awards-title">
    <div class="sec-head"><h2 id="awards-title">AROUND THE LEAGUE</h2></div>
    <p class="sec-sub">THE REST OF THIS WEEK'S HARDWARE</p>
    <div class="awards">{award_rows}
    </div>
    {empties}{_bonus_note_html(bonus_note)}
  </section>

  <section class="sec" id="matchups" aria-labelledby="matchups-title">
    <div class="sec-head"><h2 id="matchups-title">THE FINAL WORD</h2></div>
    <p class="sec-sub">WEEK {week:02d} MATCHUPS</p>
    <div class="games">{games}
    </div>
  </section>

  <div class="sec">{_tables_html(week, rankings, standings)}</div>
</main>
{week_nav}
<footer>
  <div class="wrap">
    <a class="f-brand" href="{HOME_URL}"><b>GOONCOCKS</b><small>SPU FANTASY FOOTBALL</small></a>
    <p class="f-note">POWERED BY<br>YAHOO FANTASY</p>
  </div>
</footer>
{script}
</body>
</html>"""
