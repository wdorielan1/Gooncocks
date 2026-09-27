"""Runs the real Trade Lab API and the live page on http://localhost for
end-to-end browser tests: real trade_lab.py code, real cookies, CSRF and
Origin checks, but a fake Yahoo (sign-in picks the account named by the
`fake_who` cookie) and in-memory storage. Never touches Yahoo or AWS.

    python trade-lab/live_local.py 8765
"""
import os
import sys
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import build  # noqa: E402
import trade_lab  # noqa: E402
from trade_lab_store import MemoryStore  # noqa: E402

LEAGUE = "470.l.960265"
WILL, SAM = f"{LEAGUE}.t.1", f"{LEAGUE}.t.2"


def player(key, name, pos, nfl):
    return {"player_key": key, "name": name, "position": pos, "eligible": [pos], "nfl_team": nfl, "headshot": ""}


class FakeYahoo:
    def __init__(self, origin):
        self.origin = origin
        self.down = False
        self.rosters = {
            WILL: [player("470.p.1", "Amon-Ra St. Brown", "WR", "DET"), player("470.p.2", "Jared Goff", "QB", "DET")],
            SAM: [player("470.p.3", "Breece Hall", "RB", "NYJ"), player("470.p.4", "Drake Maye", "QB", "NE")],
        }
        self.accounts = {"will": ("guid-will", [WILL]), "sam": ("guid-sam", [SAM]), "outsider": ("guid-out", ["470.l.1.t.3"])}

    def authorize_url(self, state, redirect_uri):
        return self.origin + "/fake-yahoo?" + urllib.parse.urlencode({"state": state, "redirect_uri": redirect_uri})

    def exchange(self, code, redirect_uri):
        return {"access_token": "tok-" + code, "xoauth_yahoo_guid": self.accounts[code][0]}

    def login_teams(self, token, game):
        return self.accounts[token[4:]]

    def _check(self):
        if self.down:
            raise RuntimeError("Yahoo returned HTTP 503")

    def league_teams(self, league):
        self._check()
        return [{"team_key": WILL, "name": "Hubita", "manager": "Will", "guids": ["guid-will"]},
                {"team_key": SAM, "name": "Saquon's", "manager": "Sam", "guids": ["guid-sam"]}]

    def roster(self, team_key):
        self._check()
        return list(self.rosters[team_key])

    def positions(self, league):
        return ["QB", "WR", "RB", "TE", "W/R/T", "K", "DEF", "BN"]


def make_server(port):
    origin = f"http://localhost:{port}"
    yahoo = FakeYahoo(origin)
    skew = [0.0]  # test switch /__clock?advance=N moves server time forward

    def clock():
        return time.time() + skew[0]
    app = trade_lab.TradeLab(MemoryStore(clock), yahoo, {"LEAGUE_KEY": LEAGUE, "SITE_ORIGIN": origin}, clock)
    page = build.build(preview=False).encode("utf-8")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, status, headers, body=b"", cookies=()):
            self.send_response(status)
            for k, v in headers.items():
                self.send_header(k, v)
            for c in cookies:
                self.send_header("Set-Cookie", c)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _route(self, method):
            url = urllib.parse.urlparse(self.path)
            q = dict(urllib.parse.parse_qsl(url.query))
            jar = dict(p.strip().split("=", 1) for p in (self.headers.get("Cookie") or "").split(";") if "=" in p)
            if url.path == "/trade-lab.html":
                return self._send(200, {"Content-Type": "text/html; charset=utf-8"}, page)
            if url.path == "/boxscores/2026.json" or url.path == "/boxscores/2025.json":
                return self._send(404, {})
            if url.path == "/fake-yahoo":  # stands in for Yahoo's login screen
                back = q["redirect_uri"] + "?" + urllib.parse.urlencode({"state": q["state"], "code": jar.get("fake_who", "will")})
                return self._send(302, {"Location": back})
            if url.path == "/__yahoo":  # test switch: /__yahoo?down=1
                yahoo.down = q.get("down") == "1"
                return self._send(200, {"Content-Type": "text/plain"}, b"ok")
            if url.path == "/__clock":
                skew[0] += float(q.get("advance", 0))
                return self._send(200, {"Content-Type": "text/plain"}, b"ok")
            if url.path.startswith(trade_lab.PREFIX):
                n = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(n).decode("utf-8") if n else ""
                event = {"rawPath": url.path, "queryStringParameters": q or None,
                         "requestContext": {"http": {"method": method}},
                         "headers": {k.lower(): v for k, v in self.headers.items()},
                         "cookies": [f"{k}={v}" for k, v in jar.items()], "body": raw, "isBase64Encoded": False}
                r = app.handle(event)
                return self._send(r["statusCode"], r["headers"], r["body"].encode("utf-8"), r.get("cookies") or [])
            return self._send(404, {"Content-Type": "text/plain"}, b"not found")

        def do_GET(self):
            self._route("GET")

        def do_PUT(self):
            self._route("PUT")

        def do_POST(self):
            self._route("POST")

        def do_DELETE(self):
            self._route("DELETE")

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    srv = make_server(port)
    print(f"Trade Lab (fake Yahoo, memory store) on http://localhost:{port}/trade-lab.html", flush=True)
    srv.serve_forever()
