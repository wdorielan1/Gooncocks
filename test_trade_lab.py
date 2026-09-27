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
import types
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
                         "code-outsider": ("guid-out", [OUTSIDER]), "code-cosam": ("guid-cosam", []),
                         "code-noguid": ("", [WILL])}
        self.login_teams_calls = 0
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
        self.login_teams_calls += 1
        return self.accounts[access_token.replace("SECRET-ACCESS-", "")]

    def league_teams(self, league_key):
        if self.down:
            raise RuntimeError("Yahoo returned HTTP 503")
        return [{"team_key": WILL, "name": "Hubita", "manager": "wilzer", "guids": ["guid-will"]},
                {"team_key": SAM, "name": "Saquon's", "manager": "Samuel", "guids": ["guid-sam", "guid-cosam"]}]

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
check("a failed code exchange tells the page which step and why",
      trade_lab._failure_reason("token", RuntimeError('Yahoo returned HTTP 401: {"error":"invalid_client","error_description":"x"}')) == "token_invalid_client"
      and trade_lab._failure_reason("teams", RuntimeError("Yahoo returned HTTP 403: <xml/>")) == "teams_forbidden"
      and trade_lab._failure_reason("token", KeyError("access_token")) == "token_keyerror")
r = sign_in(app, "code-unknown")[2]
check("the error reason reaches the page", r["headers"]["Location"].endswith("signin=error&reason=token_bad_request"), r["headers"]["Location"])
check("sign-in logs never contain states, codes or tokens",
      not any(x in logged for x in ("STATE-", "CODE-", "SECRET-", "code-will", "code-unknown")), logged)

# ---------------------------------------------------------------- matching by Yahoo account ID
gapp, _ = new_app()
_, _, r = sign_in(gapp, "code-cosam")
me = body(gapp.handle(event("GET", "/me", cookies=sign_in(gapp, "code-cosam")[0])))
check("a co-manager is matched to their team by Yahoo account ID", me.get("team_key") == SAM, me)
check("account-ID matching doesn't need the sign-in app's Fantasy access", gapp.yahoo.login_teams_calls == 0)
cookies, _, r = sign_in(gapp, "code-noguid")
check("without an account ID in Yahoo's reply, Yahoo's own team lookup is used",
      "signin=ok" in r["headers"]["Location"] and gapp.yahoo.login_teams_calls == 1)
gapp.yahoo.down = True
r = sign_in(gapp, "code-will")[2]
check("league list unavailable during sign-in: no session, a clear reason",
      r["headers"]["Location"].endswith("signin=error&reason=league_unavailable") and SESSION_COOKIE not in parse_cookies(r),
      r["headers"]["Location"])
gapp.yahoo.down = False
listing_json = json.dumps(body(gapp.handle(event("GET", "/listings")))) + json.dumps(body(gapp.handle(event("GET", "/rosters"))))
check("managers' Yahoo account IDs are never sent to the browser", "guid-" not in listing_json)
ros = body(gapp.handle(event("GET", "/rosters")))
check("rosters include the weekly lineup slots, without bench or IR",
      ros["slots"] == ["QB", "WR", "WR", "RB", "RB", "TE", "W/R/T", "K", "DEF"], ros.get("slots"))
check("each rostered player carries their lineup slot", all("slot" in p for t in ros["teams"] for p in t["players"]))

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

# ---------------------------------------------------------------- text alerts
class FakeSms:
    def __init__(self):
        self.sent, self.fail = [], set()

    def send(self, phone, text):
        if phone in self.fail:
            raise RuntimeError("Twilio HTTP 400, error 21610")
        self.sent.append((phone, text))


recips, bad = trade_lab.parse_recipients("Will=201-555-0123, Sam=(973) 555-0142; Chet=12345,  \nBo=+1 732 555 0199")
check("the commissioner's number list is read, bad entries are named (not shown)",
      recips == [("Will", "+12015550123"), ("Sam", "+19735550142"), ("Bo", "+17325550199")] and bad == ["Chet"], (recips, bad))
check("numbers must be real US numbers", trade_lab.normalize_phone("055-555-0123") is None
      and trade_lab.normalize_phone("201-155-0123") is None and trade_lab.normalize_phone("+1 (201) 555-0123") == "+12015550123")

clock = Clock()
sms = FakeSms()
aapp = TradeLab(MemoryStore(clock), FakeYahoo(), ENV, clock, sms=sms, recipients=recips)
will, will_csrf, _ = sign_in(aapp, "code-will")
sam, sam_csrf, _ = sign_in(aapp, "code-sam")
log = io.StringIO()
with contextlib.redirect_stdout(log):
    r = save(aapp, sam, sam_csrf, [{"player_key": "470.p.3", "status": "available", "wants": ["WR"]},
                                   {"player_key": "470.p.4", "status": "listening", "wants": []}])
check("new listings text everyone on the list except the manager who listed",
      r["statusCode"] == 200 and sorted(p for p, _ in sms.sent) == ["+12015550123", "+17325550199"], sms.sent)
check("one text per save, naming the manager and players",
      len(sms.sent) == 2 and sms.sent[0][1].startswith("Gooncocks Trade Lab: Sam put 2 players on the block - Breece Hall (RB), Tee Higgins (WR).")
      and "https://stats.gooncocks.com/trade-lab.html" in sms.sent[0][1] and sms.sent[0][1].endswith("Reply STOP to opt out."), sms.sent)
check("alert logs never contain phone numbers", "555" not in log.getvalue() and "texted 2" in log.getvalue(), log.getvalue())
sms.sent.clear()
cur = [l for l in body(aapp.handle(event("GET", "/listings")))["listings"] if l["player_key"] == "470.p.3"][0]
save(aapp, sam, sam_csrf, [{"player_key": "470.p.3", "status": "listening", "wants": ["WR"], "version": cur["version"]}])
check("editing a listing doesn't text anyone", sms.sent == [])
sms.fail = {"+12015550123"}
with contextlib.redirect_stdout(io.StringIO()) as out:
    r = save(aapp, will, will_csrf, [{"player_key": "470.p.1", "status": "available", "wants": []}])
check("a failed text (e.g. someone replied STOP) never breaks the save", r["statusCode"] == 200)
check("...and the other texts still go out", [p for p, _ in sms.sent] == ["+19735550142", "+17325550199"], sms.sent)
check("...and the failure is logged by name and code only", "Will" not in out.getvalue() or "555" not in out.getvalue())
sms.fail = set()
off = TradeLab(MemoryStore(clock), FakeYahoo(), ENV, clock, recipients=recips)
o_sam, o_csrf, _ = sign_in(off, "code-sam")
check("with no sender configured, saving works and nothing is texted",
      save(off, o_sam, o_csrf, [{"player_key": "470.p.3", "status": "available", "wants": []}])["statusCode"] == 200)
sms.sent.clear()
st = aapp.admin({"action": "alerts_status"})
check("admin status lists names only, never numbers, and flags names that match no manager",
      st == {"discord_on": False, "alerts_on": True, "managers": ["Will", "Sam", "Bo"], "not_matching_a_league_manager": ["Bo"]}
      and "555" not in json.dumps(st))
r = aapp.admin({"action": "alerts_test", "to": "bo"})
check("admin test texts just that manager", r == {"sent": 1, "failed": []} and [p for p, _ in sms.sent] == ["+17325550199"])
check("admin test with an unknown name explains who is listed", "On the list: Will, Sam, Bo" in aapp.admin({"action": "alerts_test", "to": "Zed"})["error"])
sms.sent.clear()
r = aapp.admin({"action": "alerts_welcome"})
check("welcome text goes to everyone and says how to opt out", r == {"sent": 3, "failed": []}
      and all(t == trade_lab.WELCOME for _, t in sms.sent) and "Reply STOP" in trade_lab.WELCOME)
sms.sent.clear()
r = aapp.admin({"action": "alerts_send", "message": "Trade deadline is   Friday at noon."})
check("a custom message goes to everyone, says who it's from and how to stop",
      r["sent"] == 3 and r["text"] == "Gooncocks Trade Lab: Trade deadline is Friday at noon. Reply STOP to opt out."
      and all(t == r["text"] for _, t in sms.sent), r)
sms.sent.clear()
r = aapp.admin({"action": "alerts_send", "message": "Gooncocks: draft order is up. Text STOP to opt out.", "to": ["will", "Bo"]})
check("a custom message can go to just some managers, and isn't double-labeled",
      r["sent"] == 2 and sorted(p for p, _ in sms.sent) == ["+12015550123", "+17325550199"]
      and r["text"] == "Gooncocks: draft order is up. Text STOP to opt out.", r)
check("custom messages need text, a short length, and known names",
      "error" in aapp.admin({"action": "alerts_send", "message": "  "})
      and "error" in aapp.admin({"action": "alerts_send", "message": "x" * 500})
      and "No number for zed" in aapp.admin({"action": "alerts_send", "message": "hi", "to": "Zed"})["error"])
check("admin actions aren't reachable from the website",
      aapp.handle(event("POST", "/admin", cookies=will, headers={"x-csrf-token": will_csrf}))["statusCode"] == 404)

# ---------------------------------------------------------------- Discord alerts
class FakeDiscord:
    def __init__(self):
        self.posts, self.fail = [], False

    def send(self, content, mentions=False):
        if self.fail:
            raise RuntimeError("Discord HTTP 404")
        self.posts.append((content, mentions))


clock = Clock()
disc = FakeDiscord()
dapp = TradeLab(MemoryStore(clock), FakeYahoo(), ENV, clock, discord=disc)
d_sam, d_csrf, _ = sign_in(dapp, "code-sam")
log = io.StringIO()
with contextlib.redirect_stdout(log):
    r = save(dapp, d_sam, d_csrf, [{"player_key": "470.p.3", "status": "available", "wants": ["WR"]},
                                   {"player_key": "470.p.4", "status": "listening", "wants": []}])
check("new listings post once in Discord, naming the manager, players and the link",
      r["statusCode"] == 200 and len(disc.posts) == 1
      and disc.posts[0][0] == "**Sam** put 2 players on the trading block:\n"
                             "- Breece Hall (RB, KC) - available, wants WR\n"
                             "- Tee Higgins (WR, KC) - listening to offers\n"
                             "https://stats.gooncocks.com/trade-lab.html", disc.posts)
check("listing posts can never ping anyone", disc.posts[0][1] is False)
check("the Discord post is logged", "Discord posted" in log.getvalue(), log.getvalue())
disc.posts.clear()
cur = [l for l in body(dapp.handle(event("GET", "/listings")))["listings"] if l["player_key"] == "470.p.3"][0]
save(dapp, d_sam, d_csrf, [{"player_key": "470.p.3", "status": "listening", "wants": [], "version": cur["version"]}])
check("editing a listing doesn't post", disc.posts == [])
disc.fail = True
with contextlib.redirect_stdout(io.StringIO()) as out:
    d_will, d_wcsrf, _ = sign_in(dapp, "code-will")
    r = save(dapp, d_will, d_wcsrf, [{"player_key": "470.p.1", "status": "available", "wants": []}])
check("a failed Discord post never breaks the save", r["statusCode"] == 200 and "Discord post failed (Discord HTTP 404)" in out.getvalue(),
      out.getvalue())
disc.fail = False
check("Discord markdown in names is escaped",
      trade_lab.discord_alert("*Sam*", [{"name": "A_B", "position": "RB", "nfl_team": "", "status": "available"}], "u")
      == "**\\*Sam\\*** put a player on the trading block:\n- A\\_B (RB) - available\nu")
many = [{"name": f"P{i}", "position": "WR", "nfl_team": "X", "status": "available"} for i in range(12)]
check("big listings are capped at 10 lines", trade_lab.discord_alert("Sam", many, "u").count("\n- P") == 10
      and "- +2 more" in trade_lab.discord_alert("Sam", many, "u"))
with contextlib.redirect_stdout(io.StringIO()):
    st = dapp.admin({"action": "alerts_status"})
check("status says Discord is on", st["discord_on"] is True and st["alerts_on"] is False)
disc.posts.clear()
check("alerts_test with no name posts a test in Discord", dapp.admin({"action": "alerts_test"}) == {"discord": "posted"}
      and len(disc.posts) == 1)
check("alerts_test with a name explains texts are off", "Text alerts are off" in dapp.admin({"action": "alerts_test", "to": "Sam"})["error"])
disc.posts.clear()
check("welcome posts the Trade Lab introduction in Discord", dapp.admin({"action": "alerts_welcome"}) == {"discord": "posted"}
      and disc.posts == [(trade_lab.DISCORD_WELCOME, False)] and "stats.gooncocks.com/trade-lab.html" in trade_lab.DISCORD_WELCOME)
disc.posts.clear()
r = dapp.admin({"action": "alerts_send", "message": "@everyone  trade deadline is Friday"})
check("a custom message posts as typed, and the commissioner's @everyone works",
      r == {"discord": "posted"} and disc.posts == [("@everyone trade deadline is Friday", True)], (r, disc.posts))
check("a custom message to named managers needs text alerts",
      "error" in dapp.admin({"action": "alerts_send", "message": "hi", "to": "Sam"}))
both_app = TradeLab(MemoryStore(clock), FakeYahoo(), ENV, clock, sms=FakeSms(), recipients=recips, discord=FakeDiscord())
r = both_app.admin({"action": "alerts_send", "message": "Draft is Sunday"})
check("with both on, a custom message goes to Discord and every text", r["discord"] == "posted" and r["sent"] == 3, r)
r = both_app.admin({"action": "alerts_send", "message": "Hi", "to": "Will"})
check("...and naming managers texts only them, skipping Discord", "discord" not in r and r["sent"] == 1, r)
check("nothing configured: admin explains how to turn alerts on",
      "TRADE_LAB_DISCORD_WEBHOOK" in TradeLab(MemoryStore(clock), FakeYahoo(), ENV, clock).admin({"action": "alerts_welcome"})["error"])

posted = {}
trade_lab.DiscordPoster("https://discord.com/api/webhooks/1/secret",
                        post=lambda url, content, **kw: posted.update(url=url, content=content, **kw)).send("hi")
check("Discord posts go to the webhook as Gooncocks Trade Lab, with pings off by default",
      posted == {"url": "https://discord.com/api/webhooks/1/secret", "content": "hi", "username": "Gooncocks Trade Lab", "mentions": False}, posted)


def discord_down(url, content, **kw):
    raise OSError(f"could not reach {url}")


try:
    trade_lab.DiscordPoster("https://discord.com/api/webhooks/1/secret", post=discord_down).send("hi")
    msg = "no error"
except RuntimeError as exc:
    msg = str(exc)
check("Discord errors never include the webhook URL", msg == "Discord OSError", msg)
check("Discord is on only when TRADE_LAB_DISCORD_WEBHOOK is set",
      trade_lab.DiscordPoster.from_env({}) is None and trade_lab.DiscordPoster.from_env({"TRADE_LAB_DISCORD_WEBHOOK": "u"}) is not None)

# ---------------------------------------------------------------- iPhone Shortcut digest
clock = Clock()
gapp_env = {**ENV, "TRADE_LAB_DIGEST_KEY": "s3cret-key"}
gapp = TradeLab(MemoryStore(clock), FakeYahoo(), gapp_env, clock)
g_sam, g_scsrf, _ = sign_in(gapp, "code-sam")
g_will, g_wcsrf, _ = sign_in(gapp, "code-will")


def digest(key="s3cret-key", **q):
    return gapp.handle(event("GET", "/digest", query={"key": key, **q}))


check("digest is off unless TRADE_LAB_DIGEST_KEY is set",
      TradeLab(MemoryStore(clock), FakeYahoo(), ENV, clock).handle(event("GET", "/digest", query={"key": ""}))["statusCode"] == 404)
check("digest needs the right key", digest("wrong")["statusCode"] == 403 and digest("")["statusCode"] == 403)
save(gapp, g_sam, g_scsrf, [{"player_key": "470.p.3", "status": "available", "wants": []}])
first = body(digest())
check("the first check starts the clock without dumping the whole block", first["count"] == 0 and first["text"] == "", first)
check("nothing new, nothing to send", body(digest()) == {"count": 0, "text": ""})
clock.t += 60
save(gapp, g_sam, g_scsrf, [{"player_key": "470.p.4", "status": "listening", "wants": []}])
clock.t += 60
save(gapp, g_will, g_wcsrf, [{"player_key": "470.p.1", "status": "available", "wants": []},
                             {"player_key": "470.p.2", "status": "available", "wants": []}])
clock.t += 60
d = body(digest())
check("new listings since the last check come back as one ready-to-send text, a line per manager",
      d == {"count": 3, "text": "Trade Lab - new on the trading block:\nSam: Tee Higgins (WR, KC)\n"
                                "Will: Amon-Ra St. Brown (WR, KC), Jared Goff (QB, KC)\nhttps://stats.gooncocks.com/trade-lab.html"}, d)
check("...and only once", body(digest())["count"] == 0)
cur = [l for l in body(gapp.handle(event("GET", "/listings")))["listings"] if l["player_key"] == "470.p.4"][0]
clock.t += 60
save(gapp, g_sam, g_scsrf, [{"player_key": "470.p.4", "status": "available", "wants": ["RB"], "version": cur["version"]}])
check("edits aren't reported as new", body(digest())["count"] == 0)
p = body(digest(preview="1"))
check("preview shows the last week without moving the marker",
      p["count"] == 4 and p["preview"] is True and body(digest())["count"] == 0, p)
many = [{"name": f"P{i}", "position": "WR", "nfl_team": "", "manager": "Sam", "created_at": i} for i in range(7)]
check("a big dump is capped per manager",
      trade_lab.digest_text(many, "u") == "Trade Lab - new on the trading block:\nSam: P0 (WR), P1 (WR), P2 (WR), P3 (WR), P4 (WR), +2 more\nu")


class FakeResp:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return b"{}"


seen = {}


def fake_open(req, timeout=None):
    seen["url"], seen["body"], seen["auth"] = req.full_url, req.data.decode(), req.headers.get("Authorization")
    return FakeResp()


tw = trade_lab.TwilioSender("AC123", "tok", "+18885550100", opener=fake_open)
tw.send("+12015550123", "hello")
check("Twilio request: right account URL, from/to/body, basic auth",
      seen["url"] == "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json"
      and urllib.parse.parse_qs(seen["body"]) == {"To": ["+12015550123"], "From": ["+18885550100"], "Body": ["hello"]}
      and seen["auth"] == "Basic " + __import__("base64").b64encode(b"AC123:tok").decode())


def failing_open(req, timeout=None):
    import urllib.error
    raise urllib.error.HTTPError(req.full_url, 400, "Bad", {}, io.BytesIO(
        b'{"code": 21211, "message": "The To number +12015550123 is not a valid phone number."}'))


try:
    trade_lab.TwilioSender("AC123", "tok", "+18885550100", opener=failing_open).send("+12015550123", "x")
    msg = ""
except RuntimeError as exc:
    msg = str(exc)
check("Twilio errors keep the code but drop the number", msg == "Twilio HTTP 400, error 21211", msg)
check("alerts stay off unless all three Twilio settings are set",
      trade_lab.TwilioSender.from_env({"TWILIO_ACCOUNT_SID": "AC1", "TWILIO_AUTH_TOKEN": "t"}) is None
      and trade_lab.TwilioSender.from_env({"TWILIO_ACCOUNT_SID": "AC1", "TWILIO_AUTH_TOKEN": "t", "TWILIO_FROM": "+18885550100"}) is not None)

class FakeAws:
    def __init__(self, error=None):
        self.calls, self.error = [], error
    def send_text_message(self, **kw):
        if self.error:
            raise self.error
        self.calls.append(kw)

aws = FakeAws()
trade_lab.AwsSmsSender("+18885550100", client=aws).send("+12015550123", "hello")
check("AWS SMS request: from/to/body, transactional",
      aws.calls == [{"DestinationPhoneNumber": "+12015550123", "OriginationIdentity": "+18885550100",
                     "MessageBody": "hello", "MessageType": "TRANSACTIONAL"}], aws.calls)

class AwsError(Exception):
    def __init__(self):
        super().__init__("Destination +12015550123 is not verified")
        self.response = {"Error": {"Code": "ValidationException", "Message": "Destination +12015550123 is not verified"}}

try:
    trade_lab.AwsSmsSender("+18885550100", client=FakeAws(AwsError())).send("+12015550123", "x")
    msg = "no error"
except RuntimeError as exc:
    msg = str(exc)
check("AWS errors keep the code but drop the number", msg == "AWS SMS error ValidationException", msg)
both = {"AWS_SMS_FROM": "+18885550100", "TWILIO_ACCOUNT_SID": "AC1", "TWILIO_AUTH_TOKEN": "t", "TWILIO_FROM": "+18885550100"}
saved_boto3 = sys.modules.get("boto3")
sys.modules["boto3"] = types.SimpleNamespace(client=lambda name: FakeAws())
try:
    picked = [type(trade_lab.sms_from_env(env)).__name__ for env in
              (both, {k: v for k, v in both.items() if k != "AWS_SMS_FROM"}, {})]
finally:
    if saved_boto3 is None:
        sys.modules.pop("boto3")
    else:
        sys.modules["boto3"] = saved_boto3
check("AWS is used when AWS_SMS_FROM is set, else Twilio, else alerts off",
      picked == ["AwsSmsSender", "TwilioSender", "NoneType"], picked)

brevo_seen = {}


def brevo_open(req, timeout=None):
    brevo_seen.update(url=req.full_url, body=json.loads(req.data.decode()), key=req.get_header("Api-key"))
    return FakeResp()


trade_lab.BrevoSmsSender("bk-123", "Gooncocks", opener=brevo_open).send("+12015550123", "hello")
check("Brevo request: SMS endpoint, API key header, number without +, transactional",
      brevo_seen == {"url": "https://api.brevo.com/v3/transactionalSMS/send", "key": "bk-123",
                     "body": {"sender": "Gooncocks", "recipient": "12015550123", "content": "hello", "type": "transactional"}},
      brevo_seen)
trade_lab.BrevoSmsSender("bk-123", "Gooncocks", prefix="Gooncocks", opener=brevo_open).send("+12015550123", "hi")
check("Brevo organisation prefix is sent only when set", brevo_seen["body"].get("organisationPrefix") == "Gooncocks")


def brevo_failing(req, timeout=None):
    raise urllib.error.HTTPError(req.full_url, 400, "Bad Request", {},
                                 io.BytesIO(b'{"code":"invalid_parameter","message":"12015550123 is not valid"}'))


try:
    trade_lab.BrevoSmsSender("bk-123", "Gooncocks", opener=brevo_failing).send("+12015550123", "x")
    msg = "no error"
except RuntimeError as exc:
    msg = str(exc)
check("Brevo errors keep the code but drop the number", msg == "Brevo HTTP 400, error invalid_parameter", msg)
check("Brevo is used first once its key and sender are set",
      type(trade_lab.sms_from_env({**both, "BREVO_API_KEY": "bk", "BREVO_SMS_SENDER": "Gooncocks"})).__name__ == "BrevoSmsSender"
      and trade_lab.BrevoSmsSender.from_env({"BREVO_API_KEY": "bk"}) is None)

print()
if failures:
    print(f"{len(failures)} check(s) failed: {', '.join(failures)}")
    sys.exit(1)
print("All Trade Lab checks passed.")
