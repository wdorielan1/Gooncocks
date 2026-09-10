# Yahoo Fantasy Weekly Recap

A small Python project that pulls your Yahoo Fantasy Football league and
prints a weekly recap (matchup scores + fun awards like Blowout of the Week,
Nail-Biter, High/Low Score, and Upset of the Week) to your terminal.

No web app, no database, no deployment required to use this locally - just
Python and a Yahoo Developer app.

## Files

- `awards.py` - the recap engine (pure logic, no network calls)
- `test_awards.py` - prints a recap from made-up sample data, so you can see
  the output format without any Yahoo credentials at all
- `yahoo_client.py` - talks to the real Yahoo Fantasy Sports API
- `get_refresh_token.py` - one-time script to log into Yahoo and get a
  refresh token
- `run_local.py` - the real thing: fetches your league and prints a recap
- `.env.example` - template for the environment variables you'll need

## Setup, in order

### 1. See the format works

```bash
pip install -r requirements.txt
python3 test_awards.py
```

This prints a recap using fake data. No internet connection or Yahoo account
needed - it's just here to prove the output format before you touch any real
credentials.

### 2. Create a Yahoo app, and apply for Fantasy Sports API access

Heads up: Yahoo now gates Fantasy Sports API access behind a manual
approval process, separate from the app you create below. Apply at
<https://sports.yahoo.com/developer/access/>, describing what you're
building, what data you need (read-only league scoreboard data), and that
it's for personal/single-league use. Yahoo's team reviews applications
manually - there's no published turnaround time, so plan for this to take
a while. Do this early; everything else in this README can be finished
while you wait.

Go to <https://developer.yahoo.com/apps/> and create an app with:

- **Application Name**: anything, e.g. "Fantasy Recap"
- **Redirect URI(s)**: the literal text `oob` (this tells Yahoo you're a
  desktop/script app rather than a website, so it shows you a code to copy
  instead of redirecting a browser somewhere)
- **API Permissions**: check **Fantasy Sports**, and select **Read** access
  (you don't need Read/Write)

Save it. Yahoo will show you a **Client ID (Consumer Key)** and a **Client
Secret (Consumer Secret)** - you'll need both.

### 3. Get a refresh token

```bash
export YAHOO_CLIENT_ID=your_client_id
export YAHOO_CLIENT_SECRET=your_client_secret

python3 get_refresh_token.py url
```

This prints a Yahoo login link. Open it, log in, click "Agree", and Yahoo
will show you a short code on screen. Then run:

```bash
python3 get_refresh_token.py exchange PASTE_THE_CODE_HERE
```

This prints your refresh token. Yahoo refresh tokens don't expire just from
sitting unused, so you only need to do this once.

### 4. Set your environment and run it for real

```bash
export YAHOO_CLIENT_ID=your_client_id
export YAHOO_CLIENT_SECRET=your_client_secret
export YAHOO_REFRESH_TOKEN=the_refresh_token_from_step_3

python3 run_local.py
```

If you're only in one Yahoo NFL league, that's it. If you're in more than
one, `run_local.py` will list them with their league keys - set `LEAGUE_KEY`
to skip that step next time:

```bash
export LEAGUE_KEY=nfl.l.123456
python3 run_local.py
```

By default it uses the current week. To get a specific week's recap:

```bash
export WEEK=3
python3 run_local.py
```

### 5. If Yahoo's response trips up the parser

Yahoo's Fantasy Sports API returns unusually-shaped JSON (documented at the
top of `yahoo_client.py`), and the exact nesting can vary a bit by league
setup. If `run_local.py` errors out, it's not a sign anything is fundamentally
wrong - it usually just means one small spot in `parse_matchups()` or
`get_user_leagues()` needs adjusting for what your specific league's response
looks like. Share the error (and the "Raw response for debugging" output, if
printed) and it can be fixed.

## Running this in AWS Lambda instead

`lambda_function.py` is a ready-to-paste Lambda handler covering the same
steps as above, driven by the console's Test button instead of a local
terminal - handy if your environment can't run Python locally, or you'd
rather this ran on a schedule eventually. Paste `lambda_function.py`,
`awards.py`, `sample_data.py`, and `yahoo_client.py` into the Lambda code
editor as separate files, set the same environment variables under
Configuration, and use test events like `{"action": "auth_url"}`,
`{"action": "exchange", "code": "..."}`, and `{"action": "recap"}`. See the
docstring at the top of `lambda_function.py` for the full list of actions,
including `{"action": "demo"}`, which runs the recap engine on made-up
data - no Yahoo access needed - so you can confirm the whole pipeline
works while a real Fantasy Sports API application is pending approval.

## What's next (not done yet)

- Posting the recap to Discord automatically
- Running the Lambda function on a schedule (e.g. EventBridge) instead of
  triggering it by hand
