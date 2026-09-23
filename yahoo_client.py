"""
Thin wrapper around the Yahoo Fantasy Sports API (v2) needed for a weekly
recap: exchanging/refreshing OAuth tokens, listing a user's NFL leagues, and
pulling a week's scoreboard.

Uses only the Python standard library (urllib) - no pip packages to
install - so this can be pasted straight into an AWS Lambda function's
console editor and run with zero extra setup.

Yahoo's API JSON has two quirks worth knowing before reading this file:
  1. Ordered collections come back as JSON objects keyed "0", "1", "2", ...
     plus a "count" field, instead of a plain list.
  2. A "record" (like a team) is often an array of many single-key objects,
     e.g. [{"name": "..."}, {"team_key": "..."}, ...], instead of one dict.
The helper functions below exist only to undo those two shapes. Yahoo's
exact nesting can vary a bit by endpoint/league configuration - if this
throws a KeyError against your real league, that's expected once, and the
fix is usually a small tweak to where these helpers look.
"""
import base64
import json
import urllib.error
import urllib.parse
import urllib.request

TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token"
FANTASY_BASE = "https://fantasysports.yahooapis.com/fantasy/v2"
AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth"


def build_authorize_url(client_id: str, redirect_uri: str = "oob") -> str:
    return (
        f"{AUTH_URL}?client_id={client_id}&redirect_uri={redirect_uri}"
        f"&response_type=code&language=en-us"
    )


def _basic_auth_header(client_id: str, client_secret: str) -> str:
    raw = f"{client_id}:{client_secret}".encode("utf-8")
    return base64.b64encode(raw).decode("utf-8")


def _request(url, headers=None, data=None, method="GET"):
    """Make an HTTP request and return the parsed JSON body. Raises
    RuntimeError with Yahoo's error body on a non-2xx response, since that
    body usually explains exactly what went wrong."""
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Yahoo returned HTTP {exc.code}: {body}") from exc


def _token_request(client_id, client_secret, data):
    body = urllib.parse.urlencode(data).encode("utf-8")
    headers = {
        "Authorization": f"Basic {_basic_auth_header(client_id, client_secret)}",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    return _request(TOKEN_URL, headers=headers, data=body, method="POST")


def exchange_code_for_tokens(client_id, client_secret, code, redirect_uri="oob"):
    return _token_request(
        client_id,
        client_secret,
        {"grant_type": "authorization_code", "redirect_uri": redirect_uri, "code": code},
    )


def refresh_access_token(client_id, client_secret, refresh_token, redirect_uri="oob"):
    return _token_request(
        client_id,
        client_secret,
        {
            "grant_type": "refresh_token",
            "redirect_uri": redirect_uri,
            "refresh_token": refresh_token,
        },
    )


def _yahoo_collection(obj):
    """Turn Yahoo's {"0": ..., "1": ..., "count": N} shape into a list."""
    if isinstance(obj, list):
        return obj
    if not isinstance(obj, dict):
        return []
    items = []
    i = 0
    while str(i) in obj:
        items.append(obj[str(i)])
        i += 1
    return items


def _merge_record(arr):
    """Merge Yahoo's [{"a": 1}, {"b": 2}, ...] shape into one dict."""
    merged = {}
    for el in arr:
        if isinstance(el, dict):
            merged.update(el)
        elif isinstance(el, list):
            merged.update(_merge_record(el))
    return merged


def get_user_leagues(access_token, game_key="nfl"):
    """Return [{'league_key', 'name', 'season', 'num_teams'}] for the
    logged-in user's leagues in the given game (nfl by default)."""
    url = f"{FANTASY_BASE}/users;use_login=1/games;game_keys={game_key}/leagues?format=json"
    data = _request(url, headers={"Authorization": f"Bearer {access_token}"})

    leagues = []
    users = _yahoo_collection(data["fantasy_content"]["users"])
    for user_entry in users:
        user = user_entry.get("user") if isinstance(user_entry, dict) else None
        if not user or len(user) < 2:
            continue
        games = _yahoo_collection(user[1].get("games", {}))
        for game_entry in games:
            game = game_entry.get("game") if isinstance(game_entry, dict) else None
            if not game or len(game) < 2:
                continue
            league_container = game[1].get("leagues")
            if not league_container:
                continue
            for league_entry in _yahoo_collection(league_container):
                league = league_entry.get("league") if isinstance(league_entry, dict) else None
                if not league:
                    continue
                merged = _merge_record(league)
                leagues.append(
                    {
                        "league_key": merged.get("league_key"),
                        "name": merged.get("name"),
                        "season": merged.get("season"),
                        "num_teams": merged.get("num_teams"),
                    }
                )
    return leagues


def get_scoreboard(access_token, league_key, week=None):
    """Return the raw parsed JSON for a league's scoreboard."""
    week_part = f";week={week}" if week else ""
    url = f"{FANTASY_BASE}/league/{league_key}/scoreboard{week_part}?format=json"
    return _request(url, headers={"Authorization": f"Bearer {access_token}"})


def scoreboard_week(scoreboard_json):
    """The week number a scoreboard covers - needed when no week was asked
    for, so "current" resolves to a real number for archives/standings."""
    league = scoreboard_json["fantasy_content"]["league"]
    week = league[1]["scoreboard"].get("week") or league[0].get("current_week")
    return int(week) if week is not None else None


def _player_record(player):
    """Merge a Yahoo player ([[meta dicts...], {sub-resource}, ...]) into one dict."""
    if not isinstance(player, list) or not player:
        return {}
    merged = _merge_record(player[0]) if isinstance(player[0], list) else {}
    for el in player[1:]:
        if isinstance(el, dict):
            merged.update(el)
    return merged


def _sub_resource(collection_owner, key):
    """Find e.g. "roster"/"players"/"transactions" among the dicts that
    follow a team or league record's metadata."""
    for el in collection_owner[1:]:
        if isinstance(el, dict) and key in el:
            return el[key]
    return {}


def get_team_roster(access_token, team_key, week):
    """[{'player_key', 'name', 'slot', 'eligible', 'status'}] for a team's
    lineup that week. slot is the lineup spot ("BN" = bench, "IR")."""
    url = f"{FANTASY_BASE}/team/{team_key}/roster;week={week}?format=json"
    data = _request(url, headers={"Authorization": f"Bearer {access_token}"})
    roster = _sub_resource(data["fantasy_content"]["team"], "roster")
    players = []
    for entry in _yahoo_collection((roster.get("0") or {}).get("players")):
        p = _player_record(entry.get("player") if isinstance(entry, dict) else None)
        selected = p.get("selected_position") or []
        selected = _merge_record(selected) if isinstance(selected, list) else selected
        eligible = p.get("eligible_positions") or []
        if isinstance(eligible, dict):
            eligible = [eligible]
        players.append(
            {
                "player_key": p.get("player_key"),
                "name": (p.get("name") or {}).get("full"),
                "slot": selected.get("position"),
                "eligible": [e.get("position") for e in eligible if isinstance(e, dict)],
                "status": p.get("status") or "",
            }
        )
    return players


def get_player_points(access_token, league_key, player_keys, week):
    """{player_key: fantasy points that week}, fetched 25 at a time (Yahoo's
    per-request cap on player collections)."""
    points = {}
    for i in range(0, len(player_keys), 25):
        batch = ",".join(player_keys[i:i + 25])
        url = f"{FANTASY_BASE}/league/{league_key}/players;player_keys={batch}/stats;type=week;week={week}?format=json"
        data = _request(url, headers={"Authorization": f"Bearer {access_token}"})
        for entry in _yahoo_collection(_sub_resource(data["fantasy_content"]["league"], "players")):
            p = _player_record(entry.get("player") if isinstance(entry, dict) else None)
            total = (p.get("player_points") or {}).get("total")
            if p.get("player_key") and total is not None:
                points[p["player_key"]] = float(total)
    return points


def get_transactions(access_token, league_key):
    """This season's completed transactions: [{'type', 'timestamp',
    'players': [{'player_key', 'name', 'type', 'source_type',
    'destination_team_key'}]}]. type is e.g. "add", "drop", "add/drop",
    "trade"; each player's own type says what happened to that player."""
    url = f"{FANTASY_BASE}/league/{league_key}/transactions?format=json"
    data = _request(url, headers={"Authorization": f"Bearer {access_token}"})
    results = []
    for entry in _yahoo_collection(_sub_resource(data["fantasy_content"]["league"], "transactions")):
        tx = entry.get("transaction") if isinstance(entry, dict) else None
        if not tx:
            continue
        meta = tx[0] if isinstance(tx[0], dict) else _merge_record(tx[0])
        if meta.get("status", "successful") != "successful":
            continue
        players = []
        players_container = tx[1].get("players") if len(tx) > 1 and isinstance(tx[1], dict) else None
        for p_entry in _yahoo_collection(players_container):
            p = _player_record(p_entry.get("player") if isinstance(p_entry, dict) else None)
            move = p.get("transaction_data") or {}
            if isinstance(move, list):
                move = move[0] if move else {}
            players.append(
                {
                    "player_key": p.get("player_key"),
                    "name": (p.get("name") or {}).get("full"),
                    "type": move.get("type"),
                    "source_type": move.get("source_type"),
                    "destination_team_key": move.get("destination_team_key"),
                }
            )
        results.append({"type": meta.get("type"), "timestamp": int(meta.get("timestamp") or 0), "players": players})
    return results


def _extract_manager(team_meta):
    """Pull (nickname, guid) for the team's manager out of a merged team
    record's "managers" list (Yahoo nests it as [{"manager": {"nickname":
    ..., "guid": ...}}]). The guid is permanent per Yahoo account, unlike
    team names or nicknames. Returns (None, None) if missing."""
    managers = team_meta.get("managers") or []
    if managers and isinstance(managers[0], dict):
        manager = managers[0].get("manager") or {}
        return manager.get("nickname"), manager.get("guid")
    return None, None


def parse_matchups(scoreboard_json):
    """Turn a raw scoreboard JSON blob into [{'team_a': {...}, 'team_b': {...}}, ...]
    where each team dict has 'name', 'score', and 'projected' (or None)."""
    league = scoreboard_json["fantasy_content"]["league"]
    scoreboard = league[1]["scoreboard"]
    matchups_container = scoreboard["0"]["matchups"]

    results = []
    for matchup_entry in _yahoo_collection(matchups_container):
        matchup = matchup_entry.get("matchup") if isinstance(matchup_entry, dict) else None
        if not matchup:
            continue
        teams_container = matchup["0"]["teams"]
        teams = []
        for team_entry in _yahoo_collection(teams_container):
            team = team_entry.get("team") if isinstance(team_entry, dict) else None
            if not team:
                continue
            meta = _merge_record(team[0]) if len(team) > 0 else {}
            stats = team[1] if len(team) > 1 and isinstance(team[1], dict) else {}
            points = (stats.get("team_points") or {}).get("total")
            projected = (stats.get("team_projected_points") or {}).get("total")
            nickname, guid = _extract_manager(meta)
            teams.append(
                {
                    "name": meta.get("name"),
                    "team_key": meta.get("team_key"),
                    "manager": nickname,
                    "manager_guid": guid,
                    "score": float(points) if points is not None else None,
                    "projected": float(projected) if projected is not None else None,
                }
            )
        if len(teams) == 2:
            results.append({"team_a": teams[0], "team_b": teams[1], "status": matchup.get("status")})
    return results
