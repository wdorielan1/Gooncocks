#!/usr/bin/env python3
"""
Checks the Trade Lab API with a fake Yahoo and an in-memory store - no
AWS, no Yahoo account, no internet. Covers sign-in, sessions and CSRF,
ownership (including forged requests), roster checks, archiving traded
players, concurrent edits, note validation, and Yahoo outages.
Exits non-zero if anything is wrong.
"""
import contextlib
import io
import json
import sys
import urllib.parse

import trade_lab
from trade_lab import SESSION_COOKIE, STATE_COOKIE, TradeLab
from trade_lab_store import Conflict, MemoryStore

failures = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


LEAGUE = "470.l.960265"
ORIGIN = "https://stats.gooncocks.com"
ENV = {"LEAGUE_KEY": LEAGUE, "SITE_ORIGIN": ORIGIN}
WILL, SAM, OUTSIDER = f"{LEAGUE}.t.1", f"{LEAGUE}.t.2", "470.l.999.t.4"


def player(key, name, pos):
    return {"player_key": key, "name": name, "position": pos, "eligible": [pos], "nfl_team": "KC",
            "headshot": f"https://s.yimg.com/{key}.png"}


class FakeYahoo:
    def __init__(self):
        self.rosters = {
            WILL: [player("470.p.1", "Amon-Ra St. Brown", "WR"), player("470.p.2", "Jared Goff", "QB")],
            SAM: [player("470.p.3", "Breece Hall", "RB"), player("470.p.4", "Tee Higgins", "WR")],
        }
        self.accounts = {"code-will": ("guid-will", [WILL, "470.l.555.t.9"]), "code-sam": ("guid-sam", [SAM]),
                         "code-outsider": ("guid-out", [OUTSIDER])}
        self.down, self.calls = False, 0
        self.tokens_seen = []

    def authorize_url(self, state, redirect_uri):
        return "https://api.login.yahoo.com/oauth2/request_auth?" + urllib.parse.urlencode(
            {"state": state, "redirect_uri": redirect_uri, "scope": trade_lab.SCOPE})

    def exchange(self, code, redirect_uri):
        if code not in self.accounts:
            raise RuntimeError("Yahoo returned HTTP 400: invalid_grant")
        token = "SECRET-ACCESS-" + code
        self.tokens_seen.append(token)
        return {"access_token": token, "refresh_token": "SECRET-REFRESH-" + code,
                "xoauth_yahoo_guid": self.accounts[code][0]}

    def login_teams(self, access_token, game_key):
        return self.accounts[access_token.replace("SECRET-ACCESS-", "")]

    def league_teams(self, league_key):
        if self.down:
            raise RuntimeError("Yahoo returned HTTP 503")
        return [{"team_key": WILL, "name": "Hubita", "manager": "wilzer"},
                {"team_key": SAM, "name": "Saquon's", "manager": "Samuel"}]

    def roster(self, team_key):
        self.calls += 1
        if self.down:
            raise RuntimeError("Yahoo returned HTTP 999: Request denied")
        return list(self.rosters[team_key])

    def positions(self, league_key):
        return ["QB", "WR", "WR", "RB", "RB", "TE", "W/R/T", "K", "DEF", "BN", "IR"]


class Clock:
    t = 1_800_000_000.0

    def __call__(self):
        return self.t


def new_app():
    clock = Clock()
    return TradeLab(MemoryStore(clock), FakeYahoo(), ENV, clock), clock


def event(method, path, cookies=None, body=None, query=None, headers=None):
    h = {"origin": ORIGIN}
    h.update(headers or {})
    return {"rawPath": trade_lab.PREFIX + path, "requestContext": {"http": {"method": method}},
            "cookies": [f"{k}={v}" for k, v in (cookies or {}).items()], "headers": h,
            "queryStringParameters": query or {}, "body": json.dumps(body) if body is not None else None}


def parse_cookies(resp):
    out = {}
    for c in resp.get("cookies", []):
        name, _, rest = c.partition("=")
        out[name] = (rest.split(";")[0], c)
    return out


def sign_in(app, code):
    r = app.handle(event("GET", "/login"))
    state = urllib.parse.parse_qs(urllib.parse.urlparse(r["headers"]["Location"]).query)["state"][0]
    state_cookie = parse_cookies(r)[STATE_COOKIE][0]
    r = app.handle(event("GET", "/callback", cookies={STATE_COOKIE: state_cookie}, query={"state": state, "code": code}))
    sid = parse_cookies(r).get(SESSION_COOKIE, ("", ""))[0]
    me = json.loads(app.handle(event("GET", "/me", cookies={SESSION_COOKIE: sid}))["body"])
    return {SESSION_COOKIE: sid}, me.get("csrf"), r


def body(resp):
    return json.loads(resp["body"])


def save(app, cookies, csrf, items, headers=None):
    h = {"x-csrf-token": csrf or ""}
    h.update(headers or {})
    return app.handle(event("PUT", "/listings", cookies=cookies, body={"items": items}, headers=h))


# ---------------------------------------------------------------- sign-in
app, clock = new_app()
r = app.handle(event("GET", "/login"))
loc = r["headers"]["Location"]
cookie = parse_cookies(r)[STATE_COOKIE][1]
check("login redirects to Yahoo with a state and only the fantasy-read scope",
      r["statusCode"] == 302 and "state=" in loc and "scope=fspt-r" in loc)
check("state cookie is Secure, HttpOnly, SameSite=Lax, host-only",
      all(x in cookie for x in ("Secure", "HttpOnly", "SameSite=Lax", "Path=/")) and "Domain" not in cookie
      and cookie.startswith("__Host-"))
state = urllib.parse.parse_qs(urllib.parse.urlparse(loc).query)["state"][0]
r = app.handle(event("GET", "/callback", cookies={STATE_COOKIE: "someone-elses"}, query={"state": state, "code": "code-will"}))
check("callback with a mismatched state is refused", r["statusCode"] == 302 and "signin=expired" in r["headers"]["Location"]
      and SESSION_COOKIE not in parse_cookies(r))
r = app.handle(event("GET", "/callback", cookies={STATE_COOKIE: state}, query={"state": state, "code": "code-will"}))
check("a real callback signs in", "signin=ok" in r["headers"]["Location"] and parse_cookies(r)[SESSION_COOKIE][0])
session_cookie = parse_cookies(r)[SESSION_COOKIE][1]
check("session cookie is Secure, HttpOnly, SameSite=Lax", all(x in session_cookie for x in ("Secure", "HttpOnly", "SameSite=Lax")))
r2 = app.handle(event("GET", "/callback", cookies={STATE_COOKIE: state}, query={"state": state, "code": "code-will"}))
check("a state can only be used once", "signin=expired" in r2["headers"]["Location"])
everything = json.dumps(list(app.store._items.values())) + json.dumps(r)
check("Yahoo tokens are never stored or sent to the browser", "SECRET-" not in everything)
will, will_csrf, _ = sign_in(app, "code-will")
me = body(app.handle(event("GET", "/me", cookies=will)))
check("/me identifies the verified team and manager name", me["team_key"] == WILL and me["manager"] == "Will" and me["can_edit"], me)
check("a league manager's other leagues are ignored", me["team_key"] == WILL)
r = app.handle(event("GET", "/callback", cookies={STATE_COOKIE: "x"}, query={"state": "x", "error": "access_denied"}))
check("cancelled sign-in goes back to the page", "signin=cancelled" in r["headers"]["Location"])
check("Yahoo's error code is passed to the page, cleaned", r["headers"]["Location"].endswith("&reason=access_denied"))
r = app.handle(event("GET", "/callback", cookies={STATE_COOKIE: "x"}, query={"state": "x", "error": "<b>bad</b> & more"}))
check("an odd error code can't inject into the page URL", r["headers"]["Location"].endswith("&reason=bbadbmore"), r["headers"]["Location"])

# every sign-in outcome is logged with a reason, never a state, code or token
log = io.StringIO()
with contextlib.redirect_stdout(log):
    app.handle(event("GET", "/callback", query={"state": "STATE-abc", "code": "CODE-xyz"}))
    app.handle(event("GET", "/callback", cookies={STATE_COOKIE: "STATE-other"}, query={"state": "STATE-abc", "code": "CODE-xyz"}))
    sign_in(app, "code-will")
    sign_in(app, "code-unknown")
logged = log.getvalue()
check("sign-in logs say why it failed", "no state cookie came back" in logged and "state cookie didn't match" in logged
      and "sign-in: ok" in logged and "invalid_grant" in logged, logged)
check("sign-in logs never contain states, codes or tokens",
      not any(x in logged for x in ("STATE-", "CODE-", "SECRET-", "code-will", "code-unknown")), logged)

# ---------------------------------------------------------------- signed-out and outsiders
r = save(app, {}, "", [{"player_key": "470.p.1", "status": "available", "wants": ["RB"]}])
check("signed out cannot save", r["statusCode"] == 401, r["statusCode"])
outsider, out_csrf, rr = sign_in(app, "code-outsider")
check("non-league account signs in to browse", "signin=not-in-league" in rr["headers"]["Location"] and out_csrf)
r = save(app, outsider, out_csrf, [{"player_key": "470.p.1", "status": "available", "wants": ["RB"]}])
check("non-league account cannot save", r["statusCode"] == 403 and body(r)["error"] == "not_in_league", r["body"])
r = app.handle(event("GET", "/listings"))
check("anyone can browse listings", r["statusCode"] == 200)

# ---------------------------------------------------------------- CSRF and origin
r = save(app, will, "wrong-token", [{"player_key": "470.p.1", "status": "available", "wants": ["RB"]}])
check("a missing/wrong CSRF token is refused", r["statusCode"] == 403 and body(r)["error"] == "bad_csrf")
r = save(app, will, will_csrf, [{"player_key": "470.p.1", "status": "available", "wants": ["RB"]}],
         headers={"origin": "https://evil.example"})
check("a request from another site is refused", r["statusCode"] == 403 and body(r)["error"] == "bad_origin")

# ---------------------------------------------------------------- create, edit, remove own
r = save(app, will, will_csrf, [{"player_key": "470.p.1", "status": "available", "wants": ["RB"], "note": "Open to a package"},
                                {"player_key": "470.p.2", "status": "listening", "wants": ["RB", "TE"]}])
check("a manager can list several of his players at once", r["statusCode"] == 200 and len(body(r)["listings"]) == 2, r["body"])
pub = body(app.handle(event("GET", "/listings")))["listings"]
arsb = next(l for l in pub if l["player_key"] == "470.p.1")
check("public listing shows player, manager, status, wants, note",
      arsb["name"] == "Amon-Ra St. Brown" and arsb["manager"] == "Will" and arsb["status"] == "available"
      and arsb["wants"] == ["RB"] and arsb["note"] == "Open to a package" and arsb["version"] == 1)
r = save(app, will, will_csrf, [{"player_key": "470.p.1", "status": "listening", "wants": ["RB", "WR"], "note": "", "version": 1}])
check("a manager can edit his listing", r["statusCode"] == 200 and body(r)["listings"][0]["version"] == 2)
r = app.handle(event("DELETE", "/listings/470.p.2", cookies=will, query={"version": "1"}, headers={"x-csrf-token": will_csrf}))
check("a manager can remove his listing", r["statusCode"] == 200)
check("removed listing is gone", "470.p.2" not in [l["player_key"] for l in body(app.handle(event("GET", "/listings")))["listings"]])

# ---------------------------------------------------------------- other managers' listings, forged requests
sam, sam_csrf, _ = sign_in(app, "code-sam")
r = save(app, sam, sam_csrf, [{"player_key": "470.p.1", "status": "available", "wants": ["QB"], "version": 2}])
check("a manager cannot edit another manager's listing", r["statusCode"] == 403 and body(r)["error"] == "not_on_roster")
r = app.handle(event("DELETE", "/listings/470.p.1", cookies=sam, query={"version": "2"}, headers={"x-csrf-token": sam_csrf}))
check("a manager cannot remove another manager's listing", r["statusCode"] == 403 and body(r)["error"] == "not_yours")
r = save(app, sam, sam_csrf, [{"player_key": "470.p.2", "status": "available", "wants": ["QB"]}])
check("a manager cannot list another team's player", r["statusCode"] == 403 and body(r)["players"] == ["470.p.2"])
r = save(app, sam, sam_csrf, [{"player_key": "470.p.3", "status": "available", "wants": ["WR"], "team_key": WILL}])
listing = next(l for l in body(app.handle(event("GET", "/listings")))["listings"] if l["player_key"] == "470.p.3")
check("a forged team_key in the body is ignored", r["statusCode"] == 200 and listing["team_key"] == SAM and listing["manager"] == "Sam")
r = save(app, sam, will_csrf, [{"player_key": "470.p.4", "status": "available", "wants": ["WR"]}])
check("another session's CSRF token doesn't work", r["statusCode"] == 403)
unchanged = next(l for l in body(app.handle(event("GET", "/listings")))["listings"] if l["player_key"] == "470.p.1")
check("Will's listing untouched by all of that", unchanged["version"] == 2 and unchanged["team_key"] == WILL)

# ---------------------------------------------------------------- validation
r = save(app, will, will_csrf, [{"player_key": "470.p.2", "status": "available", "wants": ["RB"], "note": "x" * 201}])
check("notes over 200 characters are refused", r["statusCode"] == 400 and body(r)["error"] == "note_too_long")
r = save(app, will, will_csrf, [{"player_key": "470.p.2", "status": "for sale", "wants": ["RB"]}])
check("unknown status is refused", r["statusCode"] == 400)
r = save(app, will, will_csrf, [{"player_key": "470.p.2", "status": "available", "wants": ["W/R/T"]}])
check("wanted positions must be the league's real positions (no flex/bench)", r["statusCode"] == 400 and body(r)["error"] == "bad_wants")
r = save(app, will, will_csrf, [{"player_key": "470.p.2", "status": "available", "wants": [],
                                 "note": "  <img src=x onerror=alert(1)>‮\n  swap?  "}])
saved = body(r)["listings"][0]["note"]
check("notes are stored as plain text (tags kept as text, control characters removed)",
      r["statusCode"] == 200 and saved == "<img src=x onerror=alert(1)> swap?", repr(saved))
check("notes are clean_note'd the same way", trade_lab.clean_note("a\x00b\tc") == "ab c")

# ---------------------------------------------------------------- concurrency
r = save(app, will, will_csrf, [{"player_key": "470.p.1", "status": "available", "wants": ["RB"], "version": 1}])
check("a stale edit is refused, not overwritten", r["statusCode"] == 409 and body(r)["results"][0]["error"] == "conflict"
      and body(r)["results"][0]["current"]["version"] == 2)
r = save(app, will, will_csrf, [{"player_key": "470.p.1", "status": "available", "wants": ["RB"], "version": 2},
                                {"player_key": "470.p.2", "status": "available", "wants": ["RB"], "version": 99}])
res = {x["player_key"]: x["ok"] for x in body(r)["results"]}
check("one conflicting player doesn't block or undo the others", r["statusCode"] == 409 and res == {"470.p.1": True, "470.p.2": False}, res)
sam_listing = next(l for l in body(app.handle(event("GET", "/listings")))["listings"] if l["player_key"] == "470.p.3")
check("Sam's listing unaffected by Will's saves", sam_listing["version"] == 1)
store = MemoryStore()
store.put("L", "a", {"x": 1}, 1, expect=0)
try:
    store.put("L", "a", {"x": 2}, 2, expect=0)
    raced = False
except Conflict:
    raced = True
check("two simultaneous creates of one listing: only the first wins", raced and store.get("L", "a")["data"] == {"x": 1})

# ---------------------------------------------------------------- traded / dropped players
app.yahoo.rosters[WILL] = [player("470.p.2", "Jared Goff", "QB")]  # St. Brown traded away
clock.t += trade_lab.LEAGUE_TTL + 1
pub = body(app.handle(event("GET", "/listings")))["listings"]
check("a traded player's listing is archived on the next roster sync", "470.p.1" not in [l["player_key"] for l in pub]
      and "470.p.2" in [l["player_key"] for l in pub])
check("archived, not deleted", app.store.get(app._lk(), "470.p.1")["data"]["status"] == "archived")
app.yahoo.rosters[SAM].append(player("470.p.1", "Amon-Ra St. Brown", "WR"))
clock.t += trade_lab.LEAGUE_TTL + 1
r = save(app, sam, sam_csrf, [{"player_key": "470.p.1", "status": "listening", "wants": ["QB"]}])
check("his new manager can list him", r["statusCode"] == 200 and body(r)["listings"][0]["team_key"] == SAM, r["body"])

# ---------------------------------------------------------------- Yahoo outages
app.yahoo.down = True
clock.t += trade_lab.LEAGUE_TTL + 1
before = body(app.handle(event("GET", "/listings")))
check("listings still load when Yahoo is down, flagged as stale", before["rosters_stale"] and len(before["listings"]) >= 2)
r = save(app, will, will_csrf, [{"player_key": "470.p.2", "status": "listening", "wants": ["RB"], "version": 3}])
check("saving while Yahoo is down is refused with a retry message", r["statusCode"] == 503 and "try again" in body(r)["message"])
after = body(app.handle(event("GET", "/listings")))["listings"]
check("nothing was lost or archived during the outage", sorted(l["player_key"] for l in after) == sorted(l["player_key"] for l in before["listings"]))
r = app.handle(event("GET", "/roster", cookies=will))
check("your roster falls back to the last copy, marked stale", r["statusCode"] == 200 and body(r)["roster_stale"])
v = str(next(l for l in after if l["player_key"] == "470.p.2")["version"])
r = app.handle(event("DELETE", "/listings/470.p.2", cookies=will, query={"version": v}, headers={"x-csrf-token": will_csrf}))
check("you can still remove your own listing while Yahoo is down", r["statusCode"] == 200, r["body"])
app.yahoo.down = False

# ---------------------------------------------------------------- sign out
r = app.handle(event("POST", "/logout", cookies=will, headers={"x-csrf-token": will_csrf}))
check("sign out ends the session", r["statusCode"] == 200 and not body(app.handle(event("GET", "/me", cookies=will)))["signed_in"])
r = save(app, will, will_csrf, [{"player_key": "470.p.2", "status": "available", "wants": ["RB"]}])
check("an ended session can't save", r["statusCode"] == 401)
clock.t += trade_lab.SESSION_TTL + 1
check("sessions expire", not body(app.handle(event("GET", "/me", cookies=sam)))["signed_in"])

# ---------------------------------------------------------------- misc
check("unknown endpoints 404", app.handle(event("GET", "/nope"))["statusCode"] == 404)
r = app.handle(event("PUT", "/listings", cookies=sam, body=None, headers={"x-csrf-token": sam_csrf}))
check("responses never cache personal data", r["headers"]["Cache-Control"] == "no-store")

print()
if failures:
    print(f"{len(failures)} check(s) failed: {', '.join(failures)}")
    sys.exit(1)
print("All Trade Lab checks passed.")
