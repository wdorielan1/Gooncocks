# Gooncocks Rivalry Center (standalone preview)

A self-contained head-to-head page for the league. It is **not deployed** and
nothing else in the repo uses it. The Lambda deploy only ships files from the
repo root, so this folder never reaches AWS or gooncocks.com.

## Open it

Double-click `index.html`, or drag it into Chrome, Safari or Edge. No server
and no build step. Fonts load from Google Fonts. Everything else is in this
folder.

If a browser blocks local files, serve the folder instead:

```sh
cd rivalry-center
python3 -m http.server 8080   # then open http://localhost:8080
```

## What's in the folder

| File | Job |
| --- | --- |
| `index.html` | Page markup |
| `css/styles.css` | All styling (desktop, tablet, phone) |
| `js/data.js` | **Data layer.** Loads and checks the history. The only file that knows where data comes from. |
| `js/rivalry.js` | Rivalry math: records, streaks, margins, spotlights, the grid. No page code. |
| `js/app.js` | Controls and rendering |
| `data/demo-history.js` | **Demo history.** Made up, not from Yahoo. |
| `tools/make_demo_history.py` | Rebuilds the demo history (fixed seed, same output every run) |
| `assets/peacock.webp` | Header logo |

Every number on the page is calculated from the one matchup list in the
history file. No stat is typed into the page.

## Rules the page uses

- Only games marked `final` count. Scheduled games are ignored.
- **All games** means regular season plus championship playoffs.
  Consolation games are left out unless "Include consolation games" is on.
  The toggle is off for "Regular season".
- A game with identical scores is a tie for both managers.
- **Closest rivalry**: the smallest gap between the two managers' win totals,
  with at least 6 meetings (2 when one season is selected). Ties go to more
  meetings, then the closer average score.
- **Most one-sided**: the highest share of games won by one manager, with the
  same minimum. Ties go to more meetings, then the bigger average margin.
- **Playoff grudge**: championship-playoff games only in the chosen seasons.
  The pair that met most often, with at least 2 meetings. Ties go to the more
  lopsided record, then the most recent meeting.
- **Grid colors** show the row manager's record against the column manager.
  Gold is a winning record, blue is losing, grey is even and hatched means
  no meetings. The brighter shade means one side won 65% or more.

Selections are saved in the browser (localStorage), so a refresh keeps them.

## Swapping in real Yahoo history

The page expects one object with this shape:

```js
{
  "source": "yahoo",                  // "demo" shows the demo badge
  "label": "…",
  "league": "SPU Peacocks Fantasy Football",
  "photoBaseUrl": "https://stats.gooncocks.com/photos/",   // <id>.jpg; letters show if missing
  "managers": [ { "id": "will", "name": "Will" }, … ],     // stable IDs, never team names
  "teams": { "2025": { "will": "Cook em till it Hurtz", … }, … },
  "matchups": [
    {
      "id": "2024-w16-will-gabe",
      "season": 2024,
      "week": 16,
      "gameType": "playoff",           // "regular" | "playoff" | "consolation"
      "round": "Semifinal",            // optional: Quarterfinal, Semifinal, Championship, Third Place…
      "status": "final",               // "final" | "scheduled"
      "managerA": "will", "managerB": "gabe",
      "scoreA": 143.08, "scoreB": 143.50
    }
  ]
}
```

Then either:

1. Replace `data/demo-history.js` with a file that sets
   `window.GOONCOCKS_HISTORY = { … }`, or
2. Save the object as JSON (for example `data/history.json`). Then uncomment
   the `GOONCOCKS_HISTORY_URL` line in `index.html`. JSON loading needs the
   page served over http (see above), not opened as a file.

The export should be built on the server side. The existing Lambda already
has the Yahoo refresh token and a `history` action that follows the league's
past seasons. A future action could walk each season's scoreboard, map each
team to its manager's Yahoo GUID, pick an ID, and mark games as playoff or
consolation using Yahoo's `is_playoffs` and `is_consolation` flags. It would
then write this JSON to S3. **Never put Yahoo keys, secrets or tokens in these
browser files.**

Rows that don't match the shape (an unknown manager, missing scores on a
final game, and so on) are skipped with a console warning, so the page still
loads.
