"""
Trade Lab API - the league's trading block, behind "Sign in with Yahoo".

A separate Lambda from the weekly awards job (handler: trade_lab.handler),
reached through the site's CloudFront at /api/trade-lab/* so its cookies
are first-party on stats.gooncocks.com.

  GET  /api/trade-lab/login              start Yahoo sign-in
  GET  /api/trade-lab/callback           Yahoo sends the manager back here
  GET  /api/trade-lab/me                 who's signed in (and a CSRF token)
  POST /api/trade-lab/logout
  GET  /api/trade-lab/listings           the public trading block
  GET  /api/trade-lab/rosters            every team's current roster (public)
  GET  /api/trade-lab/roster             the signed-in manager's roster
  GET  /api/trade-lab/digest?key=...     new listings as one ready-to-send text,
                                         for the commissioner's iPhone Shortcut
  PUT  /api/trade-lab/listings           add or update your listings
  PUT  /api/trade-lab/needs              say what positions your team is looking for
  DELETE /api/trade-lab/listings/<player_key>?version=N

Who you are comes only from Yahoo: the sign-in exchanges Yahoo's one-time
code for an access token on the server, asks Yahoo which teams that
account manages, and keeps the one in our league. The token is then
thrown away - sessions hold only the verified team - and nothing the
browser sends can choose a team. Every change is checked again on the
server: the session's team must own the listing, and a listed player
must be on that team's roster as Yahoo reports it right now.

Environment:
  TRADE_LAB_TABLE          DynamoDB table (pk/sk strings, TTL on "expires")
  LEAGUE_KEY               this season's league, e.g. 470.l.960265
  YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET / YAHOO_REFRESH_TOKEN
                           the league connection used to read rosters
  TRADE_LAB_CLIENT_ID / TRADE_LAB_CLIENT_SECRET
                           the Yahoo app managers sign in with (defaults
                           to the league app above)
  TRADE_LAB_REDIRECT_URI   e.g. https://stats.gooncocks.com/api/trade-lab/callback
  SITE_ORIGIN              e.g. https://stats.gooncocks.com
  TRADE_LAB_PAGE           where sign-in returns to (default /trade-lab.html)
  TRADE_LAB_DIGEST_KEY     turns on /digest; the Shortcut sends it as ?key=
  TRADE_LAB_DISCORD_WEBHOOK
                           Discord alerts: a channel webhook URL (secret)
  TRADE_LAB_ALERT_NUMBERS  text alerts: "Name=number, ..." (names as the site shows them)
  BREVO_API_KEY / BREVO_SMS_SENDER (/ BREVO_SMS_PREFIX), or AWS_SMS_FROM, or
  TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM
                           the text service; the first one set up is used
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request

import discord_client
import yahoo_client
from trade_lab_store import Conflict, DynamoStore

PREFIX = "/api/trade-lab"
SESSION_COOKIE = "__Host-tl_session"
STATE_COOKIE = "__Host-tl_state"
SESSION_TTL = 3 * 24 * 3600
STATE_TTL = 10 * 60
LEAGUE_TTL = 15 * 60        # how long league-wide rosters are reused for reading
WRITE_ROSTER_TTL = 3 * 60   # a roster must be this fresh to approve a listing
NOTE_MAX = 200
MAX_ITEMS = 25
STATUSES = ("available", "listening")
SCOPE = "fspt-r"            # Fantasy Sports read - all Trade Lab needs from Yahoo
DEFAULT_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"]
NOT_STARTING = {"BN", "IR", "IR+", "NA"}  # roster spots that aren't in the weekly lineup
NOT_TRADABLE = {"BN", "IR", "IR+", "NA", "W/R/T", "W/R", "W/T", "Q/W/R/T", "D", "DB", "DL", "LB"}
YAHOO_DOWN = ("We couldn't confirm rosters with Yahoo right now, so nothing was changed. "
              "Your listings are safe - try again in a minute.")


class YahooUnavailable(Exception):
    pass


class HttpError(Exception):
    def __init__(self, status, code, message, extra=None):
        super().__init__(message)
        self.status, self.code, self.message, self.extra = status, code, message, extra or {}


# ------------------------------------------------------------ Yahoo adapter

class YahooLeague:
    """Everything Trade Lab asks Yahoo. Rosters are read with the league's
    own connection; a manager's token is only used once, at sign-in, to
    learn which teams they manage."""

    def __init__(self, env=os.environ):
        self.env = env
        self._token, self._token_at = None, 0

    def _league_token(self):
        if not self._token or time.time() - self._token_at > 45 * 60:
            tokens = yahoo_client.refresh_access_token(
                self.env["YAHOO_CLIENT_ID"], self.env["YAHOO_CLIENT_SECRET"], self.env["YAHOO_REFRESH_TOKEN"])
            self._token, self._token_at = tokens["access_token"], time.time()
        return self._token

    def _login_app(self):
        return (self.env.get("TRADE_LAB_CLIENT_ID") or self.env["YAHOO_CLIENT_ID"],
                self.env.get("TRADE_LAB_CLIENT_SECRET") or self.env["YAHOO_CLIENT_SECRET"])

    def authorize_url(self, state, redirect_uri):
        return yahoo_client.build_authorize_url(self._login_app()[0], redirect_uri, state=state, scope=SCOPE)

    def exchange(self, code, redirect_uri):
        client_id, secret = self._login_app()
        return yahoo_client.exchange_code_for_tokens(client_id, secret, code, redirect_uri)

    def login_teams(self, access_token, game_key):
        return yahoo_client.get_login_teams(access_token, game_key)

    def league_teams(self, league_key):
        return yahoo_client.get_league_teams(self._league_token(), league_key)

    def roster(self, team_key):
        return yahoo_client.get_team_roster(self._league_token(), team_key)

    def positions(self, league_key):
        return yahoo_client.get_league_positions(self._league_token(), league_key)


# ------------------------------------------------------------ helpers

def _json(status, body, cookies=None, cache="no-store"):
    return {"statusCode": status, "headers": {"Content-Type": "application/json", "Cache-Control": cache,
                                              "X-Content-Type-Options": "nosniff"},
            "cookies": cookies or [], "body": json.dumps(body, separators=(",", ":"))}


def _redirect(location, cookies=None):
    return {"statusCode": 302, "headers": {"Location": location, "Cache-Control": "no-store"},
            "cookies": cookies or [], "body": ""}


def _cookie(name, value, max_age):
    return f"{name}={value}; Max-Age={max_age}; Path=/; Secure; HttpOnly; SameSite=Lax"


_HTTP_WORDS = {400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found",
               429: "rate_limited", 500: "server_error", 502: "bad_gateway", 503: "unavailable"}


def _failure_reason(step, exc):
    """A short, safe label for a failed Yahoo call, shown on the page:
    the step plus Yahoo's error code (e.g. "token_invalid_client") or the
    HTTP status in words - letters and underscores only."""
    text = str(exc)
    code = re.search(r'"error"\s*:\s*"([A-Za-z_]+)"', text)
    status = re.match(r"Yahoo returned HTTP (\d+)", text)
    if code:
        what = code.group(1)
    elif status:
        what = _HTTP_WORDS.get(int(status.group(1)), "http_error")
    else:
        what = type(exc).__name__
    return re.sub(r"[^a-z_]", "", f"{step}_{what}".lower())[:40]


WELCOME = ("Gooncocks Trade Lab: you're signed up for trade alerts! Trade Lab is our league's trading block - see who's "
           "available and find trade partners: https://stats.gooncocks.com/trade-lab.html To put your own players on the block, "
           "sign in with the Yahoo account you use for our league. We'll text you when someone adds a player. "
           "Reply STOP to opt out.")


def alert_text(manager, fresh, url):
    players = [f"{d['name']} ({d['position']})" for d in fresh]
    shown = ", ".join(players[:3]) + (f" +{len(players) - 3} more" if len(players) > 3 else "")
    what = "a player" if len(fresh) == 1 else f"{len(fresh)} players"
    return f"Gooncocks Trade Lab: {manager} put {what} on the block - {shown}. {url} Reply STOP to opt out."


DISCORD_NAME = "Gooncocks Trade Lab"
DISCORD_WELCOME = ("**Trade Lab is live!** It's our league's trading block: see who's available, check each team's "
                   "strengths and weak spots, and find trade partners.\n"
                   "https://stats.gooncocks.com/trade-lab.html\n"
                   "To put your own players on the block, sign in with the Yahoo account you use for our league. "
                   "New listings get posted in this channel automatically.")
WANT_WORDS = {"available": "available", "listening": "listening to offers"}


def _md(text):
    """Plain text for a Discord message: markdown characters escaped."""
    return re.sub(r"([\\*_~`|>#\[\]()@:-])", r"\\\1", str(text or ""))


def discord_alert(manager, fresh, url):
    """The Discord post for new listings: who, each player, and the link.
    Everything but the link is escaped, and the post can't ping anyone."""
    what = "a player" if len(fresh) == 1 else f"{len(fresh)} players"
    lines = [f"**{_md(manager)}** put {what} on the trading block:"]
    for d in fresh[:10]:
        line = f"- {_md(d['name'])} ({_md(d['position'])}"
        line += f", {_md(d['nfl_team'])})" if d.get("nfl_team") else ")"
        line += f" - {WANT_WORDS.get(d.get('status'), 'available')}"
        if d.get("wants"):
            line += ", wants " + "/".join(_md(w) for w in d["wants"])
        lines.append(line)
    if len(fresh) > 10:
        lines.append(f"- +{len(fresh) - 10} more")
    lines.append(url)
    return "\n".join(lines)


class DiscordPoster:
    """Posts into one Discord channel through its webhook."""

    def __init__(self, webhook_url, post=None):
        self.url = webhook_url
        self.post = post or discord_client.post_message

    @classmethod
    def from_env(cls, env):
        url = env.get("TRADE_LAB_DISCORD_WEBHOOK")
        return cls(url) if url else None

    def send(self, content, mentions=False):
        try:
            self.post(self.url, content, username=DISCORD_NAME, mentions=mentions)
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"Discord HTTP {exc.code}") from None
        except Exception as exc:
            # Never the exception text: it could carry the webhook URL.
            raise RuntimeError(f"Discord {type(exc).__name__}") from None


DIGEST_PREVIEW_DAYS = 7
DIGEST_MAX_PER_MANAGER = 5


def digest_text(listings, url):
    """One text for new listings: a heading, then a section per manager (in
    the order they listed) with one player per line, then the link, with
    blank lines between so it's easy to read. Empty when there's nothing new."""
    if not listings:
        return ""
    by_manager = {}
    for d in sorted(listings, key=lambda d: d["created_at"]):
        by_manager.setdefault(d.get("manager") or "A manager", []).append(d)
    parts = ["🦚 Gooncocks Trading Lab AI"]
    for manager, ds in by_manager.items():
        lines = [f"{manager} added to the Trading Block:"]
        for d in ds[:DIGEST_MAX_PER_MANAGER]:
            lines.append(f"• {d['name']} ({d['position']}" + (f", {d['nfl_team']})" if d.get("nfl_team") else ")"))
        if len(ds) > DIGEST_MAX_PER_MANAGER:
            lines.append(f"• +{len(ds) - DIGEST_MAX_PER_MANAGER} more")
        parts.append("\n".join(lines))
    parts.append(f"Check out the Trading Lab:\n{url}")
    return "\n\n".join(parts)


def normalize_phone(raw):
    """A US mobile number as +1XXXXXXXXXX, or None."""
    digits = re.sub(r"\D", "", str(raw or ""))
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10 or digits[0] in "01" or digits[3] in "01":
        return None
    return "+1" + digits


def parse_recipients(raw):
    """TRADE_LAB_ALERT_NUMBERS, e.g. "Will=201-555-0123, Sam=(973) 555-0142",
    into ([(name, +1...)], [names that couldn't be read])."""
    good, bad = [], []
    for entry in re.split(r"[,;\n]+", raw or ""):
        if not entry.strip():
            continue
        name, _, number = entry.partition("=")
        name, phone = name.strip(), normalize_phone(number)
        if name and phone:
            good.append((name, phone))
        else:
            bad.append(name or "(no name)")
    return good, bad


class TwilioSender:
    """Sends one text through Twilio's REST API (no extra libraries)."""

    def __init__(self, account_sid, auth_token, from_number, opener=None):
        self.sid, self.token, self.from_number = account_sid, auth_token, from_number
        self.opener = opener or urllib.request.urlopen

    @classmethod
    def from_env(cls, env):
        sid, token, frm = env.get("TWILIO_ACCOUNT_SID"), env.get("TWILIO_AUTH_TOKEN"), env.get("TWILIO_FROM")
        return cls(sid, token, frm) if sid and token and frm else None

    def send(self, to, text):
        url = f"https://api.twilio.com/2010-04-01/Accounts/{self.sid}/Messages.json"
        body = urllib.parse.urlencode({"To": to, "From": self.from_number, "Body": text}).encode("utf-8")
        auth = base64.b64encode(f"{self.sid}:{self.token}".encode("utf-8")).decode("ascii")
        req = urllib.request.Request(url, data=body, method="POST", headers={
            "Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"})
        try:
            with self.opener(req, timeout=10) as resp:
                resp.read()
        except urllib.error.HTTPError as exc:
            # Twilio's error text can include the phone number, so only the
            # numeric code goes into the exception (and the logs).
            try:
                code = json.loads(exc.read().decode("utf-8")).get("code")
            except Exception:
                code = None
            raise RuntimeError(f"Twilio HTTP {exc.code}" + (f", error {code}" if code else "")) from None


class AwsSmsSender:
    """Sends one text through AWS End User Messaging SMS (boto3 comes with
    Lambda). AWS_SMS_FROM is the toll-free number (or its phone number ID)
    from that console, in the same region as this Lambda."""

    def __init__(self, from_number, client=None):
        self.from_number = from_number
        if client is None:
            import boto3
            client = boto3.client("pinpoint-sms-voice-v2")
        self.client = client

    @classmethod
    def from_env(cls, env):
        frm = env.get("AWS_SMS_FROM")
        return cls(frm) if frm else None

    def send(self, to, text):
        try:
            self.client.send_text_message(DestinationPhoneNumber=to, OriginationIdentity=self.from_number,
                                          MessageBody=text, MessageType="TRANSACTIONAL")
        except Exception as exc:
            # AWS error messages can include the phone number, so only the
            # error code goes into the exception (and the logs).
            code = ((getattr(exc, "response", None) or {}).get("Error") or {}).get("Code") or type(exc).__name__
            raise RuntimeError(f"AWS SMS error {code}") from None


class BrevoSmsSender:
    """Sends one text through Brevo's transactional SMS API (no extra
    libraries). BREVO_SMS_SENDER is the sender name (up to 11 letters or
    digits) or number Brevo approved; BREVO_SMS_PREFIX is the optional
    organisation prefix Brevo puts in front of US texts."""

    URL = "https://api.brevo.com/v3/transactionalSMS/send"

    def __init__(self, api_key, sender, prefix=None, opener=None):
        self.api_key, self.sender, self.prefix = api_key, sender, prefix
        self.opener = opener or urllib.request.urlopen

    @classmethod
    def from_env(cls, env):
        key, sender = env.get("BREVO_API_KEY"), env.get("BREVO_SMS_SENDER")
        return cls(key, sender, env.get("BREVO_SMS_PREFIX") or None) if key and sender else None

    def send(self, to, text):
        payload = {"sender": self.sender, "recipient": to.lstrip("+"), "content": text, "type": "transactional"}
        if self.prefix:
            payload["organisationPrefix"] = self.prefix
        req = urllib.request.Request(self.URL, data=json.dumps(payload).encode("utf-8"), method="POST", headers={
            "api-key": self.api_key, "Content-Type": "application/json", "Accept": "application/json"})
        try:
            with self.opener(req, timeout=10) as resp:
                resp.read()
        except urllib.error.HTTPError as exc:
            # Brevo's error message can include the phone number, so only
            # its short error code goes into the exception (and the logs).
            try:
                code = json.loads(exc.read().decode("utf-8")).get("code")
            except Exception:
                code = None
            code = re.sub(r"[^A-Za-z0-9_]", "", str(code or ""))[:40]
            raise RuntimeError(f"Brevo HTTP {exc.code}" + (f", error {code}" if code else "")) from None


def sms_from_env(env):
    """The first text service that's set up: Brevo, then AWS, then Twilio.
    None means text alerts are off."""
    return BrevoSmsSender.from_env(env) or AwsSmsSender.from_env(env) or TwilioSender.from_env(env)


def _hash(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def clean_note(note):
    """A manager's note as plain text: control characters removed, runs of
    whitespace collapsed, at most NOTE_MAX characters. Pages render it as
    text, never HTML."""
    if note is None:
        return ""
    if not isinstance(note, str):
        raise HttpError(400, "bad_note", "The note must be text.")
    note = re.sub(r"[\x00-\x08\x0b-\x1f\x7f​-‏‪-‮⁦-⁩]", "", note)
    note = re.sub(r"\s+", " ", note).strip()
    if len(note) > NOTE_MAX:
        raise HttpError(400, "note_too_long", f"Keep the note to {NOTE_MAX} characters.")
    return note


def primary_position(player):
    return (player.get("position") or "").split(",")[0].strip() or "?"


class TradeLab:
    def __init__(self, store, yahoo, env=os.environ, clock=time.time, sms=None, recipients=(), discord=None):
        self.store, self.yahoo, self.env, self.now = store, yahoo, env, clock
        self.discord = discord  # a DiscordPoster for the league channel (None = off)
        # Text alerts: a sender (None = off) and the league's opted-in numbers
        # as [(manager name, +1XXXXXXXXXX)], set by the commissioner.
        self.sms, self.recipients = sms, list(recipients)
        self.league = env["LEAGUE_KEY"]
        self.game = self.league.split(".")[0]
        self.origin = env.get("SITE_ORIGIN", "https://stats.gooncocks.com").rstrip("/")
        self.redirect_uri = env.get("TRADE_LAB_REDIRECT_URI", self.origin + PREFIX + "/callback")
        self.page = env.get("TRADE_LAB_PAGE", "/trade-lab.html")

    # ---------------- keys
    def _lk(self):
        return f"LISTING#{self.league}"

    def _nk(self):
        return f"NEEDS#{self.league}"

    def _rk(self):
        return f"ROSTER#{self.league}"

    # ---------------- league + rosters
    def league_info(self, max_age=LEAGUE_TTL):
        """Teams and tradable positions, cached. Raises YahooUnavailable only
        when there is nothing cached to fall back on."""
        cached = self.store.get(f"META#{self.league}", "league")
        if cached and self.now() - cached["data"]["fetched_at"] < max_age:
            return cached["data"]
        try:
            teams = self.yahoo.league_teams(self.league)
            try:
                raw = self.yahoo.positions(self.league)
            except Exception:
                raw = []
            positions = [p for p in raw if p not in NOT_TRADABLE]
            # The weekly starting lineup, one entry per slot (e.g. WR three
            # times, W/R/T once) - what the Scouting Report fills.
            slots = [p for p in raw if p not in NOT_STARTING]
            data = {"teams": teams, "positions": positions or DEFAULT_POSITIONS, "slots": slots, "fetched_at": self.now()}
            self.store.put(f"META#{self.league}", "league", data, 1)
            return data
        except Exception:
            traceback.print_exc()
            if cached:
                return cached["data"]
            raise YahooUnavailable()

    def team_names(self):
        try:
            teams = self.league_info()["teams"]
        except YahooUnavailable:
            return {}
        return {t["team_key"]: _manager_name(t) for t in teams}

    def roster(self, team_key, max_age):
        """A team's roster, from cache if fresh enough, else from Yahoo.
        A successful fetch also archives that team's listings for players
        no longer on it. Raises YahooUnavailable if a fresh one is needed
        and Yahoo can't provide it."""
        cached = self.store.get(self._rk(), team_key)
        if cached and self.now() - cached["data"]["fetched_at"] < max_age:
            return cached["data"]
        try:
            players = self.yahoo.roster(team_key)
        except Exception:
            traceback.print_exc()
            raise YahooUnavailable()
        data = {"team_key": team_key, "fetched_at": self.now(), "players": [
            {"player_key": p["player_key"], "name": p.get("name") or "", "position": primary_position(p),
             "positions": p.get("eligible") or [], "nfl_team": p.get("nfl_team") or "", "headshot": p.get("headshot") or "",
             "slot": p.get("slot") or ""}
            for p in players if p.get("player_key")]}
        self.store.put(self._rk(), team_key, data, 1)
        self._archive_gone(team_key, {p["player_key"] for p in data["players"]})
        return data

    def _archive_gone(self, team_key, on_roster):
        for item in self.store.query(self._lk()):
            d = item["data"]
            if d["team_key"] == team_key and d["status"] in STATUSES and item["sk"] not in on_roster:
                archived = dict(d, status="archived", archived_reason="no longer on this roster",
                                updated_at=self.now())
                try:
                    self.store.put(self._lk(), item["sk"], archived, item["version"] + 1, expect=item["version"])
                except Conflict:
                    pass  # changed meanwhile; the next sync looks again

    def sync_league(self, max_age=LEAGUE_TTL):
        """Refresh every team's roster that's older than max_age. Returns
        (rosters, oldest fetch time, whether any refresh failed)."""
        teams = self.league_info()["teams"]
        rosters, failed = {}, False
        for t in teams:
            try:
                rosters[t["team_key"]] = self.roster(t["team_key"], max_age)
            except YahooUnavailable:
                failed = True
                cached = self.store.get(self._rk(), t["team_key"])
                if cached:
                    rosters[t["team_key"]] = cached["data"]
        oldest = min((r["fetched_at"] for r in rosters.values()), default=None)
        return rosters, oldest, failed

    # ---------------- sessions
    def session(self, cookies):
        sid = cookies.get(SESSION_COOKIE)
        if not sid:
            return None
        item = self.store.get("SESSION", _hash(sid))
        return item["data"] if item else None

    def _require_editor(self, event, cookies):
        sess = self.session(cookies)
        if not sess:
            raise HttpError(401, "signed_out", "Sign in with Yahoo to manage your listings.")
        origin = (event.get("headers") or {}).get("origin")
        if origin != self.origin:
            raise HttpError(403, "bad_origin", "That request didn't come from the Trade Lab page.")
        token = (event.get("headers") or {}).get("x-csrf-token") or ""
        if not hmac.compare_digest(token, sess.get("csrf") or ""):
            raise HttpError(403, "bad_csrf", "Your session expired. Reload the page and try again.")
        if not sess.get("team_key"):
            raise HttpError(403, "not_in_league",
                            "This Yahoo account doesn't manage a team in our league, so it can browse but not list players.")
        return sess

    # ---------------- routes
    def login(self, event, cookies):
        state = secrets.token_urlsafe(32)
        self.store.put("STATE", _hash(state), {"created": self.now()}, 1, expect=0,
                       expires=self.now() + STATE_TTL)
        return _redirect(self.yahoo.authorize_url(state, self.redirect_uri),
                         [_cookie(STATE_COOKIE, state, STATE_TTL)])

    def callback(self, event, cookies):
        q = event.get("queryStringParameters") or {}
        clear = _cookie(STATE_COOKIE, "", 0)
        back = self.page + "?signin="
        state, cookie_state = q.get("state") or "", cookies.get(STATE_COOKIE) or ""
        # Every outcome is logged with a plain reason (never a code, state or
        # token) so a failed sign-in can be diagnosed from the Lambda logs.
        if q.get("error"):
            reason = re.sub(r"[^a-z_]", "", str(q["error"]).lower())[:40]
            print(f"Trade Lab sign-in: Yahoo sent back error={reason or '?'}")
            return _redirect(back + "cancelled" + (f"&reason={reason}" if reason else ""), [clear])
        if not state or not cookie_state or not hmac.compare_digest(state, cookie_state):
            print("Trade Lab sign-in: state check failed ("
                  + ("no state in URL" if not state else "no state cookie came back" if not cookie_state
                     else "state cookie didn't match") + ")")
            return _redirect(back + "expired", [clear])
        try:  # each state works once
            self.store.delete("STATE", _hash(state), expect=1)
        except Conflict:
            print("Trade Lab sign-in: state already used or expired")
            return _redirect(back + "expired", [clear])
        if not q.get("code"):
            print("Trade Lab sign-in: Yahoo returned no code")
            return _redirect(back + "expired", [clear])
        step = "token"  # which Yahoo call failed: the code exchange, or the team lookup
        try:
            tokens = self.yahoo.exchange(q["code"], self.redirect_uri)
            guid = tokens.get("xoauth_yahoo_guid")
            if guid:
                # Yahoo's account ID for whoever signed in, straight from
                # Yahoo's token response, matched against the league's own
                # manager list (read with the league's connection). The
                # sign-in app never needs Fantasy Sports access for this.
                step = "league"
                team_keys = [t["team_key"] for t in self.yahoo.league_teams(self.league)
                             if guid in (t.get("guids") or [])]
            else:
                step = "teams"
                guid, team_keys = self.yahoo.login_teams(tokens["access_token"], self.game)
        except Exception as exc:
            # Yahoo's error bodies (e.g. {"error":"invalid_client"}) hold no
            # secrets; anything else is logged by type only.
            detail = str(exc)[:300] if str(exc).startswith("Yahoo returned HTTP") else ""
            print(f"Trade Lab sign-in failed at {step}: {type(exc).__name__} {detail}".rstrip())
            return _redirect(back + "error&reason=" + _failure_reason(step, exc), [clear])
        mine = [k for k in team_keys if k.startswith(self.league + ".t.")]
        team_key = mine[0] if mine else None
        names = self.team_names() if team_key else {}
        sid = secrets.token_urlsafe(32)
        self.store.put("SESSION", _hash(sid), {
            "guid": _hash(guid or ""), "team_key": team_key, "manager": names.get(team_key) if team_key else None,
            "csrf": secrets.token_urlsafe(24), "created": self.now(),
        }, 1, expect=0, expires=self.now() + SESSION_TTL)
        print(f"Trade Lab sign-in: ok ({'manages a team in the league' if team_key else 'no team in this league'})")
        return _redirect(back + ("ok" if team_key else "not-in-league"),
                         [clear, _cookie(SESSION_COOKIE, sid, SESSION_TTL)])

    def logout(self, event, cookies):
        sess = self.session(cookies)
        if sess:
            token = (event.get("headers") or {}).get("x-csrf-token") or ""
            if (event.get("headers") or {}).get("origin") != self.origin or not hmac.compare_digest(token, sess.get("csrf") or ""):
                raise HttpError(403, "bad_csrf", "Reload the page and try again.")
            self.store.delete("SESSION", _hash(cookies[SESSION_COOKIE]))
        return _json(200, {"signed_in": False}, [_cookie(SESSION_COOKIE, "", 0)])

    def me(self, event, cookies):
        sess = self.session(cookies)
        if not sess:
            return _json(200, {"signed_in": False})
        return _json(200, {"signed_in": True, "team_key": sess.get("team_key"), "manager": sess.get("manager"),
                           "can_edit": bool(sess.get("team_key")), "csrf": sess["csrf"]})

    def _public(self, item, names):
        d = item["data"]
        return {"player_key": item["sk"], "name": d["name"], "position": d["position"], "nfl_team": d.get("nfl_team", ""),
                "headshot": d.get("headshot", ""), "team_key": d["team_key"],
                "manager": names.get(d["team_key"]) or d.get("manager") or "",
                "status": d["status"], "wants": d["wants"], "note": d.get("note", ""),
                "created_at": d["created_at"], "updated_at": d["updated_at"], "version": item["version"]}

    def listings(self, event, cookies):
        refreshed, stale = None, False
        try:
            _rosters, refreshed, stale = self.sync_league()
            info = self.league_info()
        except YahooUnavailable:
            stale, info = True, {"teams": [], "positions": DEFAULT_POSITIONS}
        names = {t["team_key"]: _manager_name(t) for t in info["teams"]}
        active = [self._public(i, names) for i in self.store.query(self._lk()) if i["data"]["status"] in STATUSES]
        active.sort(key=lambda l: -l["updated_at"])
        needs = [{"team_key": i["sk"], "manager": names.get(i["sk"]) or i["data"].get("manager") or "",
                  "wants": i["data"]["wants"], "note": i["data"].get("note", ""), "updated_at": i["data"]["updated_at"]}
                 for i in self.store.query(self._nk())]
        return _json(200, {"league_key": self.league, "listings": active, "needs": needs, "positions": info["positions"],
                           "teams": [{"team_key": t["team_key"], "manager": names[t["team_key"]], "name": t["name"]}
                                     for t in info["teams"]],
                           "rosters_checked_at": refreshed, "rosters_stale": stale})

    def rosters(self, event, cookies):
        try:
            rosters, refreshed, stale = self.sync_league()
            names = self.team_names()
        except YahooUnavailable:
            return _json(503, {"error": "yahoo_unavailable", "message": "Rosters aren't available from Yahoo right now."})
        try:
            slots = self.league_info().get("slots") or []
        except YahooUnavailable:
            slots = []
        return _json(200, {"teams": [{"team_key": k, "manager": names.get(k, k), "players": r["players"]}
                                     for k, r in rosters.items()],
                           "slots": slots, "rosters_checked_at": refreshed, "rosters_stale": stale})

    def my_roster(self, event, cookies):
        sess = self.session(cookies)
        if not sess:
            raise HttpError(401, "signed_out", "Sign in with Yahoo to manage your listings.")
        if not sess.get("team_key"):
            raise HttpError(403, "not_in_league", "This Yahoo account doesn't manage a team in our league.")
        stale = False
        try:
            roster = self.roster(sess["team_key"], WRITE_ROSTER_TTL)
        except YahooUnavailable:
            cached = self.store.get(self._rk(), sess["team_key"])
            if not cached:
                raise HttpError(503, "yahoo_unavailable", "Your roster isn't available from Yahoo right now. Try again in a minute.")
            roster, stale = cached["data"], True
        names = self.team_names()
        mine = [self._public(i, names) for i in self.store.query(self._lk())
                if i["data"]["team_key"] == sess["team_key"] and i["data"]["status"] in STATUSES]
        return _json(200, {"team_key": sess["team_key"], "players": roster["players"], "listings": mine,
                           "roster_checked_at": roster["fetched_at"], "roster_stale": stale,
                           "positions": self._positions()})

    def _positions(self):
        try:
            return self.league_info()["positions"]
        except YahooUnavailable:
            return DEFAULT_POSITIONS

    def save(self, event, cookies):
        sess = self._require_editor(event, cookies)
        body = _body(event)
        items = body.get("items")
        if not isinstance(items, list) or not items or len(items) > MAX_ITEMS:
            raise HttpError(400, "bad_request", f"Send between 1 and {MAX_ITEMS} players.")
        positions = set(self._positions())
        clean = []
        for it in items:
            if not isinstance(it, dict) or not isinstance(it.get("player_key"), str):
                raise HttpError(400, "bad_request", "Each player needs a player_key.")
            if it.get("status") not in STATUSES:
                raise HttpError(400, "bad_status", "Choose Available or Listening to offers.")
            wants = it.get("wants") or []
            if not isinstance(wants, list) or any(w not in positions for w in wants) or len(set(wants)) != len(wants):
                raise HttpError(400, "bad_wants", "Pick positions from the league's list.")
            version = it.get("version") or 0
            if not isinstance(version, int) or version < 0:
                raise HttpError(400, "bad_request", "Bad version.")
            clean.append({"player_key": it["player_key"], "status": it["status"], "wants": wants,
                          "note": clean_note(it.get("note")), "version": version})
        try:  # ownership comes from Yahoo, fresh - never from the request
            roster = self.roster(sess["team_key"], WRITE_ROSTER_TTL)
        except YahooUnavailable:
            raise HttpError(503, "yahoo_unavailable", YAHOO_DOWN)
        on_roster = {p["player_key"]: p for p in roster["players"]}
        foreign = [c["player_key"] for c in clean if c["player_key"] not in on_roster]
        if foreign:
            raise HttpError(403, "not_on_roster", "Only players on your current Yahoo roster can be listed.",
                            {"players": foreign})
        names = self.team_names()
        results, saved, fresh = [], [], []
        for c in clean:
            p = on_roster[c["player_key"]]
            is_new = False
            existing = self.store.get(self._lk(), c["player_key"])
            if existing and existing["data"]["team_key"] == sess["team_key"] and existing["data"]["status"] in STATUSES:
                expect = existing["version"]
                if c["version"] != expect:
                    results.append({"player_key": c["player_key"], "ok": False, "error": "conflict",
                                    "current": self._public(existing, names)})
                    continue
                created = existing["data"]["created_at"]
            else:
                # New, archived, or left over from the player's previous team
                # (Yahoo just confirmed he's on yours now).
                expect, created = (existing["version"] if existing else 0), self.now()
                is_new = True
            data = {"team_key": sess["team_key"], "manager": names.get(sess["team_key"]) or sess.get("manager"),
                    "name": p["name"], "position": p["position"], "nfl_team": p.get("nfl_team", ""),
                    "headshot": p.get("headshot", ""), "status": c["status"], "wants": c["wants"], "note": c["note"],
                    "created_at": created, "updated_at": self.now()}
            try:
                item = self.store.put(self._lk(), c["player_key"], data, (existing["version"] if existing else 0) + 1,
                                      expect=expect)
            except Conflict:
                current = self.store.get(self._lk(), c["player_key"])
                results.append({"player_key": c["player_key"], "ok": False, "error": "conflict",
                                "current": self._public(current, names) if current else None})
                continue
            saved.append(self._public(item, names))
            results.append({"player_key": c["player_key"], "ok": True})
            if is_new:
                fresh.append(data)
        if fresh:
            self.alert_new(names.get(sess["team_key"]) or sess.get("manager") or "A manager", fresh)
        status = 200 if all(r["ok"] for r in results) else 409
        return _json(status, {"results": results, "listings": saved})

    def set_needs(self, event, cookies):
        """What the signed-in manager's team is looking for, without listing
        anyone: positions plus an optional note. The team comes only from
        the session; saving nothing clears it."""
        sess = self._require_editor(event, cookies)
        body = _body(event)
        wants = body.get("wants") or []
        positions = set(self._positions())
        if not isinstance(wants, list) or any(w not in positions for w in wants) or len(set(wants)) != len(wants):
            raise HttpError(400, "bad_wants", "Pick positions from the league's list.")
        note = clean_note(body.get("note"))
        if not wants and not note:
            try:
                self.store.delete(self._nk(), sess["team_key"])
            except Conflict:
                pass
            return _json(200, {"needs": None})
        manager = self.team_names().get(sess["team_key"]) or sess.get("manager") or ""
        data = {"wants": wants, "note": note, "manager": manager, "updated_at": self.now()}
        self.store.put(self._nk(), sess["team_key"], data, 1)
        return _json(200, {"needs": {"team_key": sess["team_key"], "manager": manager, **{k: data[k] for k in ("wants", "note", "updated_at")}}})

    def remove(self, event, cookies, player_key):
        sess = self._require_editor(event, cookies)
        q = event.get("queryStringParameters") or {}
        existing = self.store.get(self._lk(), player_key)
        if not existing or existing["data"]["status"] not in STATUSES:
            raise HttpError(404, "not_found", "That listing is already gone.")
        if existing["data"]["team_key"] != sess["team_key"]:
            raise HttpError(403, "not_yours", "You can only remove your own listings.")
        try:
            version = int(q.get("version", ""))
        except ValueError:
            raise HttpError(400, "bad_request", "Missing version.")
        try:
            self.store.delete(self._lk(), player_key, expect=version)
        except Conflict:
            raise HttpError(409, "conflict", "That listing changed since you loaded it. Reload and try again.")
        return _json(200, {"removed": player_key})

    # ---------------- text alerts
    def _text_all(self, text, skip=None):
        """Texts every opted-in manager except `skip` (a manager name).
        Returns (sent, [names that failed]). Numbers are never logged."""
        sent, failed = 0, []
        for name, phone in self.recipients:
            if skip and name.casefold() == skip.casefold():
                continue
            try:
                self.sms.send(phone, text)
                sent += 1
            except Exception as exc:
                failed.append(name)
                print(f"Trade Lab alerts: text to {name} failed ({exc})")
        return sent, failed

    def _post_discord(self, content, mentions=False):
        """'posted' or 'failed'. The error is logged without the webhook URL."""
        try:
            self.discord.send(content, mentions=mentions)
            return "posted"
        except Exception as exc:
            print(f"Trade Lab alerts: Discord post failed ({exc})")
            return "failed"

    def alert_new(self, manager, fresh):
        """After new listings are saved: tell the rest of the league.
        Never fails the save that triggered it."""
        if self.discord:
            try:
                result = self._post_discord(discord_alert(manager, fresh, self.origin + self.page))
                print(f"Trade Lab alerts: {manager} listed {len(fresh)}; Discord {result}")
            except Exception:
                traceback.print_exc()
        if not self.sms or not self.recipients:
            return
        try:
            text = alert_text(manager, fresh, self.origin + self.page)
            sent, failed = self._text_all(text, skip=manager)
            print(f"Trade Lab alerts: {manager} listed {len(fresh)}; texted {sent}" + (f", failed {len(failed)}" if failed else ""))
        except Exception:
            traceback.print_exc()

    def admin(self, event):
        """Commissioner actions, run as a Lambda test event (not reachable
        from the website):
          {"action": "alerts_status"}                 what's on, and who's on the text list
          {"action": "alerts_test"}                   a test post in Discord
          {"action": "alerts_test", "to": "Will"}     one test text
          {"action": "alerts_welcome"}                the Trade Lab introduction (Discord and texts)
          {"action": "alerts_send", "message": "...", "to": ["Will", "Sam"]}
                                                      your own message: Discord and every text, or
                                                      with "to", texts to just those managers"""
        action = event.get("action")
        names = [n for n, _ in self.recipients]
        if action == "alerts_status":
            # Names must match how the site shows managers, or the lister
            # would get a text about their own listing.
            league = {n.casefold() for n in self.team_names().values()}
            unknown = [n for n in names if n.casefold() not in league]
            return {"discord_on": bool(self.discord), "alerts_on": bool(self.sms), "managers": names,
                    "not_matching_a_league_manager": unknown}
        if not self.sms and not self.discord:
            return {"error": "Alerts are off: set TRADE_LAB_DISCORD_WEBHOOK (or a text service)."}
        if action == "alerts_test" and not event.get("to"):
            if not self.discord:
                return {"error": 'Discord is off. To test a text, add "to", e.g. {"action": "alerts_test", "to": "Will"}.'}
            return {"discord": self._post_discord("Test post: Trade Lab alerts are working.")}
        if action == "alerts_test" and not self.sms:
            return {"error": "Text alerts are off: set BREVO_API_KEY and BREVO_SMS_SENDER (or AWS_SMS_FROM, or the TWILIO_ settings)."}
        if action == "alerts_test":
            who = str(event.get("to") or "")
            match = [(n, p) for n, p in self.recipients if n.casefold() == who.casefold()]
            if not match:
                return {"error": f"No number for {who!r}. On the list: {', '.join(names) or 'nobody'}."}
            saved, self.recipients = self.recipients, match
            try:
                sent, failed = self._text_all("Gooncocks Trade Lab: test text. Trading block alerts are working.")
            finally:
                self.recipients = saved
            return {"sent": sent, "failed": failed}
        if action == "alerts_welcome":
            result = {"discord": self._post_discord(DISCORD_WELCOME)} if self.discord else {}
            if self.sms:
                result["sent"], result["failed"] = self._text_all(WELCOME)
            return result
        if action == "alerts_send":
            text = " ".join(str(event.get("message") or "").split())
            if not text:
                return {"error": 'Add a message, e.g. {"action": "alerts_send", "message": "Trade deadline is Friday"}.'}
            if len(text) > 480:
                return {"error": f"That message is {len(text)} characters; keep it under 480."}
            to = event.get("to")
            result = {}
            if self.discord and not to:
                # Your own words, as typed - and your @everyone works here.
                result["discord"] = self._post_discord(text, mentions=True)
            if not self.sms:
                if to:
                    return {"error": "Text alerts are off, so there's no one to send to by name."}
                return result
            if not text.lower().startswith("gooncocks"):
                text = "Gooncocks Trade Lab: " + text  # say who it's from
            if "stop" not in text.lower():
                text += " Reply STOP to opt out."
            wanted = None if not to else {n.casefold() for n in ([to] if isinstance(to, str) else to)}
            unknown = sorted(w for w in (wanted or ()) if w not in {n.casefold() for n in names})
            if unknown:
                return {"error": f"No number for {', '.join(unknown)}. On the list: {', '.join(names)}."}
            saved = self.recipients
            if wanted:
                self.recipients = [(n, p) for n, p in saved if n.casefold() in wanted]
            try:
                sent, failed = self._text_all(text)
            finally:
                self.recipients = saved
            return {**result, "sent": sent, "failed": failed, "text": text}
        return {"error": f"Unknown action {action!r}."}

    # ---------------- iPhone Shortcut digest
    def digest(self, event):
        """What's been newly listed since the Shortcut last asked, as one
        text ready to send. Listings are public anyway; the key keeps anyone
        else from using up the "since last time" marker. ?preview=1 shows
        the last week without moving the marker, for testing."""
        want = self.env.get("TRADE_LAB_DIGEST_KEY") or ""
        if not want:
            raise HttpError(404, "not_found", "No such Trade Lab endpoint.")
        q = event.get("queryStringParameters") or {}
        if not hmac.compare_digest(str(q.get("key") or "").encode("utf-8"), want.encode("utf-8")):
            raise HttpError(403, "bad_key", "That key doesn't match TRADE_LAB_DIGEST_KEY.")
        now = int(self.now())
        url = self.origin + self.page
        active = [i["data"] for i in self.store.query(self._lk()) if i["data"]["status"] in STATUSES]
        if q.get("preview") in ("1", "true", "yes"):
            since = now - DIGEST_PREVIEW_DAYS * 24 * 3600
            new = [d for d in active if d["created_at"] > since]
            return _json(200, {"count": len(new), "text": digest_text(new, url), "preview": True})
        pk = f"DIGEST#{self.league}"
        cursor = self.store.get(pk, "cursor")
        try:
            self.store.put(pk, "cursor", {"through": now}, (cursor["version"] + 1) if cursor else 1,
                           expect=cursor["version"] if cursor else 0)
        except Conflict:
            # Another check ran at the same moment and will report these.
            return _json(200, {"count": 0, "text": ""})
        if not cursor:
            return _json(200, {"count": 0, "text": "",
                               "note": "Started. Players listed from now on will show up here."})
        through = cursor["data"]["through"]
        new = [d for d in active if through < d["created_at"] <= now]
        return _json(200, {"count": len(new), "text": digest_text(new, url)})

    # ---------------- dispatch
    def handle(self, event):
        method = ((event.get("requestContext") or {}).get("http") or {}).get("method") or event.get("httpMethod") or "GET"
        path = event.get("rawPath") or event.get("path") or ""
        cookies = _cookies(event)
        route = path[len(PREFIX):] if path.startswith(PREFIX) else path
        try:
            if method == "GET" and route == "/login":
                return self.login(event, cookies)
            if method == "GET" and route == "/callback":
                return self.callback(event, cookies)
            if method == "GET" and route == "/me":
                return self.me(event, cookies)
            if method == "POST" and route == "/logout":
                return self.logout(event, cookies)
            if method == "GET" and route == "/listings":
                return self.listings(event, cookies)
            if method == "GET" and route == "/rosters":
                return self.rosters(event, cookies)
            if method == "GET" and route == "/roster":
                return self.my_roster(event, cookies)
            if method == "GET" and route == "/digest":
                return self.digest(event)
            if method == "PUT" and route == "/needs":
                return self.set_needs(event, cookies)
            if method == "PUT" and route == "/listings":
                return self.save(event, cookies)
            m = re.fullmatch(r"/listings/([0-9]+\.p\.[0-9]+)", route)
            if method == "DELETE" and m:
                return self.remove(event, cookies, m.group(1))
            raise HttpError(404, "not_found", "No such Trade Lab endpoint.")
        except HttpError as err:
            return _json(err.status, {"error": err.code, "message": err.message, **err.extra})
        except Exception:
            traceback.print_exc()
            return _json(500, {"error": "server_error", "message": "Something went wrong. Nothing was changed."})


def _cookies(event):
    raw = list(event.get("cookies") or [])
    header = (event.get("headers") or {}).get("cookie")
    if header:
        raw.extend(header.split(";"))
    out = {}
    for part in raw:
        name, _, value = part.strip().partition("=")
        if name and name not in out:
            out[name] = value
    return out


def _body(event):
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    try:
        body = json.loads(raw or "{}")
    except ValueError:
        raise HttpError(400, "bad_request", "The request body must be JSON.")
    if not isinstance(body, dict):
        raise HttpError(400, "bad_request", "The request body must be a JSON object.")
    return body


def _manager_name(team):
    """The league's MANAGER_NAMES name for a team (same as the rest of the
    site), else Yahoo's nickname, else the team name."""
    from lambda_function import _known_manager_name  # shares the one name list
    return _known_manager_name({"manager": team.get("manager")}) or team.get("manager") or team.get("name") or ""


_APP = None


def handler(event, context=None):
    global _APP
    if _APP is None:
        recipients, bad = parse_recipients(os.environ.get("TRADE_LAB_ALERT_NUMBERS", ""))
        if bad:
            print(f"Trade Lab alerts: skipped unreadable entries for: {', '.join(bad)}")
        _APP = TradeLab(DynamoStore(os.environ["TRADE_LAB_TABLE"]), YahooLeague(),
                        sms=sms_from_env(os.environ), recipients=recipients,
                        discord=DiscordPoster.from_env(os.environ))
    if event.get("action") and not event.get("rawPath"):
        result = _APP.admin(event)
        print("Result: " + json.dumps(result))  # names only, never numbers
        return result
    return _APP.handle(event)
