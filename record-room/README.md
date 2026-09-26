# Gooncocks Record Room

Every league record in one place:
- featured cards
- the all-time record book (18 records)
- a spotlight on each record
- its closest challengers
- the records nobody wants
- a banner for every champion

It runs on the league's real Yahoo history (2015, 2017–2026). It's live at
https://stats.gooncocks.com/records.html. The Lambda bundles this folder
into that one file, reading the live `rivalry-history.json` in place of the
snapshot. Opened from this folder, it uses the snapshot in `data/`.

## Open it

Double-click `index.html` (Chrome, Safari or Edge). There's no server and no
build step. Fonts come from Google Fonts; everything else is in this folder.

If a browser blocks local files, serve the folder instead:

```sh
cd record-room
python3 -m http.server 8082   # then open http://localhost:8082
```

## What to try

- **Filters:**
  - **Season** limits every record to one year.
  - **Regular season / Playoffs / Both** changes which games count.
  - **Standard scoring only** leaves out the two high-scoring seasons.
- **Featured cards:** select a card to open that record; **View the matchup**
  shows the game.
- **Record book:**
  - Search by record name or manager.
  - Switch category with the tabs or the **Category** dropdown.
  - **Show 7 more records** adds the extra records.
  - Select a row to open it in the spotlight.
- **Spotlight:**
  - Shows the holder, the mark, when it happened, the details (game, season,
    streak or award list), the previous holder and the exact scope.
  - Games in any list open the matchup, with both lineups (the box score).
  - **Share this record** copies a summary.
- **Challengers:** the top five, plus anyone tied with fifth. Select a row to
  view that performance, then use **Back to the record**.
- **Remembering:** a refresh keeps the filters and the open record. The address
  carries them too, so a link like `#big-margin?season=2023&type=playoff`
  opens that exact view.

## The 18 records

| Core (shown first) | Additional |
| --- | --- |
| Highest weekly score | Most points in a loss |
| Biggest winning margin | Fewest points in a win |
| Closest victory | Highest scoring average in a season |
| Longest winning streak | Best regular-season win % |
| Most championships | Most consecutive championships |
| Most Goon awards | Most Goon awards in a season |
| Most points in a season | Most Cock awards in a season |
| Highest combined score | |
| Most Cock awards * | |
| Lowest weekly score * | |
| Longest losing streak * | |

\* Also shown in "The records nobody wants".

## How the numbers work

- **Which games count:**
  - Only completed games with both scores count.
  - Consolation games never count.
  - "Playoffs" means the championship bracket only.
- **Closest victory:** the smallest *positive* margin. Tied games are left out.
- **Combined score:** each matchup counts once.
- **Streaks:**
  - A loss or tie ends a winning streak; a win or tie ends a losing streak.
  - Streaks carry across seasons, and the page says so when one does.
  - A streak stops at a gap: a season missing from the history (2016), or a
    season that manager didn't play.
- **Championships:**
  - Come from each finished season's final Yahoo standings.
  - The in-progress season has no champion yet.
- **Season records:** season totals, averages and win % use completed seasons
  only. Averages need at least 10 games (2 for playoffs only).
- **Goon / Cock of the Week:**
  - The top and bottom score of each completed regular-season week. Exact ties
    share the award.
  - 2026 is the first season they were actually awarded. Earlier awards are
    rebuilt from the scores and labeled "rebuilt".
- **Scoring eras:**
  - A season is marked high-scoring when its league-wide average is more than
    25% above the typical season (2015 and 2020 averaged about 218 points per
    team-week versus about 160).
  - Points-based records carry a small "2015 scoring" tag.
  - **Standard scoring only** leaves those seasons out of the game records.
- **Ties:**
  - Ties are shown, never broken. Tied holders are listed together, and
    challengers share a rank (T1).
- **Previous holder:**
  - Found by walking the games in time order.
  - Career totals have no single moment the record changed hands, so they show
    the next closest manager instead.
- **Missing data:** when a record has nothing to show for the chosen filters,
  the page says why (for example, "2026 is still in progress").

## Files

| File | Job |
| --- | --- |
| `index.html` | Page markup |
| `css/styles.css` | Styling (desktop, tablet, phone) |
| `js/data.js` | **Data layer.** Loads and checks the history. It's the only file that knows where data comes from. |
| `js/records.js` | **Record math.** All 18 records, defined once. No page code. |
| `js/app.js` | Cards, record book, spotlight, challengers, banners, sharing, saved state |
| `../shared/boxscore.js` | Box score pop-up shared by every page (lineups load when a game is opened) |
| `data/league-history.js` | Snapshot of the real Yahoo history (same format as the Rivalry and Career Centers) |
| `tools/snapshot_history.py` | Refreshes the snapshot from the Lambda's saved season files |
| `assets/gooncocks-logo.webp` | The original Gooncocks badge |

## Box scores

Every matchup pop-up shows both lineups player by player. They come from
`boxscores/<season>.json`, which the Lambda collects from Yahoo. The shared
pop-up script is `../shared/boxscore.js`, used by every page.

Opened straight from this folder, the pop-up says lineups load on the live
site. Yahoo credentials stay with the Lambda and never belong in this page.

The Career Center and Rivalry Center links point at their live pages:
`stats.gooncocks.com/careers.html` and `stats.gooncocks.com/rivalries.html`.
