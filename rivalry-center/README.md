# Gooncocks Rivalry Center

Live at **https://stats.gooncocks.com/rivalries.html**. The Lambda builds
that page from this folder: it inlines the CSS, scripts and logo, and swaps
the demo data for the real Yahoo history in `rivalry-history.json`.

- Run `{"action": "rivalry_history"}` once in the Lambda console. It finds
  every season of the league on Yahoo and saves all the scores. If it
  ends with "Run this again to continue", run it again.
- After that, each weekly `publish` adds the newest week on its own.
- The deploy ships `index.html`, `css/`, `js/` and `assets/` with the
  Lambda code. `data/` and `tools/` stay local.

Opened straight from this folder, the page still runs on the demo data,
which is handy for trying out design changes.

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

The live file is built by `league_history.py` in the Lambda. People are
matched across seasons through `MANAGER_NAMES` in `lambda_function.py`, by
Yahoo nickname or account ID. Anyone not listed there shows up under
"Former managers". Games are marked playoff or consolation from Yahoo's
`is_playoffs` and `is_consolation` flags, and round names come from the week
order. Yahoo account IDs are hashed before anything is saved. **Never put
Yahoo keys, secrets or tokens in these browser files.**

Rows that don't match the shape (an unknown manager, missing scores on a
final game, and so on) are skipped with a console warning, so the page still
loads.
