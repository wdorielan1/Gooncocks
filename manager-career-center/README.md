# Gooncocks Manager Career Center (standalone preview)

One page with three views: a **League overview** leaderboard, full **Manager
profiles**, and **Compare careers**. It runs on the league's real Yahoo history
(2015–2026). It is **not deployed** and nothing on the live site links to it. The
Lambda deploy only ships files from the repo root and `rivalry-center/`, so this
folder never reaches AWS.

## Open it

Double-click `index.html` (Chrome, Safari or Edge). There's no server and no
build step. Fonts come from Google Fonts. Everything else is in this folder.

If a browser blocks local files, serve the folder instead:

```sh
cd manager-career-center
python3 -m http.server 8081   # then open http://localhost:8081
```

## What to try

- **Overview:**
  - Change **Season** to see one year.
  - Type in **Search managers**.
  - Select column headers to sort, and select again to reverse.
  - Select a row to preview it, then use **Open full profile** or **Compare careers**.
- **Profile:**
  - Switch managers with the **Manager** dropdown.
  - Select a season row to open its playoff path, best and worst weeks, and
    winnings.
  - **Share profile** copies a summary.
  - **Back to all managers** returns to the list.
- **Compare:**
  - Pick any two managers; the same one can't be picked twice.
  - **Swap** trades sides.
- Refreshing keeps the view, managers, season, search and sort.

## Files

| File | Job |
| --- | --- |
| `index.html` | Page markup |
| `css/styles.css` | Styling (desktop, tablet, phone) |
| `js/data.js` | **Data layer.** Loads and checks the history. The only file that knows where data comes from. |
| `js/career.js` | Career math: records, titles, awards, winnings, bests, milestones. No page code. |
| `js/app.js` | Views, controls, sharing, saved state |
| `data/league-history.js` | **Snapshot of the real Yahoo history** (same format as the Rivalry Center) |
| `data/payouts.js` | **Payout rules by season.** Edit this to correct any year. |
| `tools/snapshot_history.py` | Refreshes the snapshot from the Lambda's saved season files |
| `assets/gooncocks-logo.webp` | The original Gooncocks badge, for the header |

Every number comes from the one history file plus the payout rules. Nothing is
typed into the page by hand.

## How the numbers work

- **Games:** only completed games count.
  - Regular season, championship playoffs and consolation games are kept
    apart. Playoff records leave out consolation games.
  - A tie counts as half a win in win percentages.
- **Championship, runner-up and third place:** taken from Yahoo's final
  standings for each finished season, not guessed from the bracket.
- **Goon / Cock of the Week:** the highest and lowest score of each completed
  regular-season week, for every year. Money for Goon of the Week only started
  in 2026. Exact ties would share the award and split the $50.
- **Who's on the leaderboard:** the league's 10 current managers. Former
  managers and one-season fill-ins stay in the Manager and Versus dropdowns
  under "Former managers". Managers listed in `EXCLUDED_MANAGERS` in
  `lambda_function.py` are left out of every record.
- **Win-% leader card:** needs at least 40 regular-season games (10 when one
  season is selected). Ties show as joint leaders.
- **Winnings are estimates** from `data/payouts.js`, not payment records:
  - **Usual years:** 2nd place doubles their buy-in, 3rd gets their buy-in
    back, and 1st takes the rest of the pot (buy-in × teams).
  - **Confirmed buy-ins:** 2025 $150, 2024 $200, and 2023, 2022 and 2021 $150.
  - **Earlier years** assume $150. Those seasons are marked "Estimated".
  - **2026:** $225 buy-in, $1,200 / $400 for 1st / 2nd, no 3rd-place payout,
    and $50 per Goon of the Week.
  - "Net" subtracts the buy-ins for every season played.
- **"Unavailable"** is shown when the data can't support a number. It never
  shows as 0.

## Refreshing the data

```sh
python3 manager-career-center/tools/snapshot_history.py
```

This reads the Lambda's saved season files from the S3 bucket (read-only, no
Yahoo credentials) and rebuilds the history with the same code the Lambda uses.

When this page goes live on stats.gooncocks.com, uncomment the
`GOONCOCKS_HISTORY_URL` line in `index.html`. It will then read the live
`/rivalry-history.json`, which the Lambda updates every Tuesday. **Never put
Yahoo keys, secrets or tokens in these browser files.**
