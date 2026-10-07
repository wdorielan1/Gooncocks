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


def build_authorize_url(client_id: str, redirect_uri: str = "oob", state=None, scope=None) -> str:
    """Yahoo's authorization-code login link. `state` (a one-time random
    value the caller checks on the way back) and `scope` are optional so
    the existing command-line setup ("oob") keeps working unchanged."""
    params = {"client_id": client_id, "redirect_uri": redirect_uri, "response_type": "code", "language": "en-us"}
    if state:
        params["state"] = state
    if scope:
        params["scope"] = scope
    return f"{AUTH_URL}?{urllib.parse.urlencode(params)}"


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


def get_user_leagues(access_token, game_key="nfl", all_seasons=False):
    """Return [{'league_key', 'name', 'season', 'num_teams'}] for the
    logged-in user's leagues in the given game (nfl by default). With
    all_seasons, every past season's leagues come back too (Yahoo keeps
    one "game" per NFL season; game_codes matches all of them)."""
    games = f"game_codes={game_key}" if all_seasons else f"game_keys={game_key}"
    url = f"{FANTASY_BASE}/users;use_login=1/games;{games}/leagues?format=json"
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


def scoreboard_meta(scoreboard_json):
    """The league's own fields from a scoreboard response: season, name,
    start_week, end_week, current_week, is_finished, renew, ..."""
    league = scoreboard_json["fantasy_content"]["league"]
    return league[0] if isinstance(league[0], dict) else _merge_record(league[0])


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


def headshot_url(player):
    """The best Yahoo headshot URL for a merged player record, or "".
    Yahoo's URLs wrap the original image in a resizing proxy that shrinks
    it to about 46x60; the original (after the last "https://") is the
    larger cutout."""
    url = (player.get("headshot") or {}).get("url") or player.get("image_url") or ""
    i = url.rfind("https://")
    return url[i:] if i > 0 else url


def get_team_roster(access_token, team_key, week=None):
    """[{'player_key', 'name', 'slot', 'eligible', 'status', 'position',
    'nfl_team', 'headshot'}] for a team's lineup that week, or its current
    roster when week is None. slot is the lineup spot ("BN" = bench,
    "IR"); position is the player's own (e.g. "WR")."""
    url = f"{FANTASY_BASE}/team/{team_key}/roster{f';week={week}' if week else ''}?format=json"
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
                # Injury detail when Yahoo has it, e.g. "Questionable" / "Hamstring".
                "status_full": p.get("status_full") or "",
                "injury_note": p.get("injury_note") or "",
                # Yahoo's player-news flags (the note text itself isn't in the API).
                "has_recent_player_notes": p.get("has_recent_player_notes"),
                "player_notes_last_timestamp": p.get("player_notes_last_timestamp"),
                "position": p.get("display_position") or "",
                "nfl_team": (p.get("editorial_team_abbr") or "").upper(),
                "headshot": headshot_url(p),
                # 0 once his game has started (Yahoo locks the spot); None if Yahoo doesn't say.
                "editable": p.get("is_editable"),
            }
        )
    return players


def _find_values(obj, key):
    """Every value stored under `key` anywhere inside Yahoo's nested JSON."""
    found = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == key:
                found.append(v)
            found.extend(_find_values(v, key))
    elif isinstance(obj, list):
        for v in obj:
            found.extend(_find_values(v, key))
    return found


def get_login_teams(access_token, game_key):
    """(guid, [team keys]) for the Yahoo account the access token belongs
    to: every team that account manages in that game (e.g. "470")."""
    url = f"{FANTASY_BASE}/users;use_login=1/games;game_keys={game_key}/teams?format=json"
    data = _request(url, headers={"Authorization": f"Bearer {access_token}"})
    guids = [g for g in _find_values(data, "guid") if isinstance(g, str)]
    team_keys = sorted({k for k in _find_values(data, "team_key") if isinstance(k, str)})
    return (guids[0] if guids else None), team_keys


def get_league_teams(access_token, league_key):
    """[{'team_key', 'name', 'manager', 'guids', 'commish_guids'}] for every
    team in a league. guids holds the Yahoo account ID of every manager and
    co-manager - permanent per account, unlike names; commish_guids the
    ones Yahoo marks as the league's commissioner."""
    url = f"{FANTASY_BASE}/league/{league_key}/teams?format=json"
    data = _request(url, headers={"Authorization": f"Bearer {access_token}"})
    teams = []
    for entry in _yahoo_collection(_sub_resource(data["fantasy_content"]["league"], "teams")):
        t = _player_record(entry.get("team") if isinstance(entry, dict) else None)
        nickname, _guid = _extract_manager(t)
        guids = [g for g in _find_values(t.get("managers") or [], "guid") if isinstance(g, str) and g]
        managers = [e.get("manager") for e in t.get("managers") or [] if isinstance(e, dict)]
        commish = [m["guid"] for m in managers if isinstance(m, dict) and str(m.get("is_commissioner")) == "1" and m.get("guid")]
        if t.get("team_key"):
            teams.append({"team_key": t["team_key"], "name": t.get("name") or "", "manager": nickname, "guids": guids,
                          "commish_guids": commish})
    return teams


def get_league_positions(access_token, league_key):
    """The league's lineup positions (e.g. ["QB", "WR", "RB", "TE",
    "W/R/T", "K", "DEF", "BN", "IR"]), in Yahoo's order."""
    url = f"{FANTASY_BASE}/league/{league_key}/settings?format=json"
    data = _request(url, headers={"Authorization": f"Bearer {access_token}"})
    positions = []
    for rp in _find_values(data, "roster_position"):
        if isinstance(rp, dict) and rp.get("position") and rp["position"] not in positions:
            positions.append(rp["position"])
    return positions


def parse_scoring(settings_json):
    """The league's scoring rules from its settings response:
    [{"stat_id", "name", "display", "position_type", "points", "bonuses"}],
    one per stat the league scores. bonuses is [{"target", "points"}]."""
    names = {}
    for cats in _find_values(settings_json, "stat_categories"):
        for entry in (cats.get("stats") or []) if isinstance(cats, dict) else []:
            st = entry.get("stat") if isinstance(entry, dict) else None
            if isinstance(st, dict) and st.get("stat_id") is not None:
                names[str(st["stat_id"])] = st
    rules = []
    for mods in _find_values(settings_json, "stat_modifiers"):
        for entry in (mods.get("stats") or []) if isinstance(mods, dict) else []:
            st = entry.get("stat") if isinstance(entry, dict) else None
            if not isinstance(st, dict) or st.get("stat_id") is None:
                continue
            sid = str(st["stat_id"])
            meta = names.get(sid, {})
            bonuses = []
            for b in st.get("bonuses") or []:
                b = b.get("bonus") if isinstance(b, dict) and "bonus" in b else b
                if isinstance(b, dict):
                    bonuses.append({"target": float(b.get("target") or 0), "points": float(b.get("points") or 0)})
            rules.append({"stat_id": int(sid), "name": meta.get("name") or "", "display": meta.get("display_name") or "",
                          "position_type": meta.get("position_type") or "", "points": float(st.get("value") or 0),
                          "bonuses": bonuses})
    return sorted(rules, key=lambda r: r["stat_id"])


def get_league_scoring(access_token, league_key):
    """The league's scoring rules - see parse_scoring."""
    url = f"{FANTASY_BASE}/league/{league_key}/settings?format=json"
    return parse_scoring(_request(url, headers={"Authorization": f"Bearer {access_token}"}))


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


def get_league_players(access_token, league_key, status="A", position=None, start=0, count=25, sort="AR"):
    """One page (Yahoo's cap is 25) of the league's players with a given
    status - "A" every available player (free agents and waivers), "FA"
    free agents only, "W" waivers only - best first by Yahoo's actual
    rank. [{'player_key', 'name', 'position', 'nfl_team', 'status',
    'status_full', 'injury_note', 'headshot'}]."""
    filters = f"status={status}" + (f";position={position}" if position else "") + f";sort={sort};start={start};count={count}"
    url = f"{FANTASY_BASE}/league/{league_key}/players;{filters}?format=json"
    data = _request(url, headers={"Authorization": f"Bearer {access_token}"})
    players = []
    for entry in _yahoo_collection(_sub_resource(data["fantasy_content"]["league"], "players")):
        p = _player_record(entry.get("player") if isinstance(entry, dict) else None)
        if not p.get("player_key"):
            continue
        players.append({
            "player_key": p["player_key"],
            "name": (p.get("name") or {}).get("full") or "",
            "position": p.get("display_position") or "",
            "nfl_team": (p.get("editorial_team_abbr") or "").upper(),
            "status": p.get("status") or "",
            "status_full": p.get("status_full") or "",
            "injury_note": p.get("injury_note") or "",
            "headshot": headshot_url(p),
        })
    return players


def get_week_leaders(access_token, league_key, position, week, count=25):
    """The league's top fantasy scorers at one position for a week so far,
    in league scoring, owned or not: [{'player_key', 'name', 'position',
    'nfl_team', 'points'}], most points first."""
    url = (f"{FANTASY_BASE}/league/{league_key}/players;position={position};sort=PTS;sort_type=week;sort_week={week};"
           f"count={count}/stats;type=week;week={week}?format=json")
    data = _request(url, headers={"Authorization": f"Bearer {access_token}"})
    out = []
    for entry in _yahoo_collection(_sub_resource(data["fantasy_content"]["league"], "players")):
        p = _player_record(entry.get("player") if isinstance(entry, dict) else None)
        total = (p.get("player_points") or {}).get("total")
        if not p.get("player_key") or total is None:
            continue
        out.append({"player_key": p["player_key"], "name": (p.get("name") or {}).get("full") or "",
                    "position": p.get("display_position") or position, "nfl_team": (p.get("editorial_team_abbr") or "").upper(),
                    "points": float(total)})
    return sorted(out, key=lambda r: -r["points"])


def get_league_season(access_token, league_key):
    """One season's final standings: {'season', 'name', 'is_finished',
    'renew', 'teams': [{'team', 'manager', 'manager_guid', 'rank'}]}.
    'renew' is the previous season's league ("423_123456"), if any."""
    url = f"{FANTASY_BASE}/league/{league_key}/standings?format=json"
    data = _request(url, headers={"Authorization": f"Bearer {access_token}"})
    league = data["fantasy_content"]["league"]
    meta = league[0] if isinstance(league[0], dict) else _merge_record(league[0])
    standings = _sub_resource(league, "standings")
    if isinstance(standings, list):
        standings = standings[0] if standings else {}
    teams = []
    for entry in _yahoo_collection(standings.get("teams")):
        t = _player_record(entry.get("team") if isinstance(entry, dict) else None)
        nickname, guid = _extract_manager(t)
        rank = (t.get("team_standings") or {}).get("rank")
        teams.append({
            "team": t.get("name"), "manager": nickname, "manager_guid": guid,
            "rank": int(rank) if str(rank or "").isdigit() else None,
        })
    return {
        "season": meta.get("season"), "name": meta.get("name"),
        "is_finished": str(meta.get("is_finished") or "0") == "1",
        "renew": meta.get("renew") or None, "teams": teams,
        "end_week": int(meta["end_week"]) if str(meta.get("end_week") or "").isdigit() else None,
    }


def get_league_history(access_token, league_key, max_seasons=40):
    """Every season of this league, newest first, following Yahoo's chain
    of renewed leagues back to the first season."""
    seasons = []
    key = league_key
    while key and len(seasons) < max_seasons:
        season = get_league_season(access_token, key)
        season["league_key"] = key
        seasons.append(season)
        key = season["renew"].replace("_", ".l.", 1) if season["renew"] else None
    return seasons


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
        results.append({
            "type": meta.get("type"), "timestamp": int(meta.get("timestamp") or 0),
            "faab_bid": meta.get("faab_bid"), "players": players,
        })
    return results


def get_league_transactions(access_token, league_key, start=0, count=25):
    """One page of the league's completed transactions, newest first, with
    everything the Transaction Report shows: [{'key', 'type', 'timestamp',
    'faab_bid', 'trader_team_key', 'tradee_team_key', 'players': [{
    'player_key', 'name', 'position', 'nfl_team', 'type' (add/drop/trade),
    'source_type', 'source_team_key', 'destination_type',
    'destination_team_key'}]}]."""
    url = f"{FANTASY_BASE}/league/{league_key}/transactions;start={start};count={count}?format=json"
    data = _request(url, headers={"Authorization": f"Bearer {access_token}"})
    results = []
    for entry in _yahoo_collection(_sub_resource(data["fantasy_content"]["league"], "transactions")):
        tx = entry.get("transaction") if isinstance(entry, dict) else None
        if not tx:
            continue
        meta = tx[0] if isinstance(tx[0], dict) else _merge_record(tx[0])
        players = []
        container = tx[1].get("players") if len(tx) > 1 and isinstance(tx[1], dict) else None
        for p_entry in _yahoo_collection(container):
            p = _player_record(p_entry.get("player") if isinstance(p_entry, dict) else None)
            move = p.get("transaction_data") or {}
            if isinstance(move, list):
                move = move[0] if move else {}
            players.append({
                "player_key": p.get("player_key"),
                "name": (p.get("name") or {}).get("full") or "",
                "position": p.get("display_position") or "",
                "nfl_team": (p.get("editorial_team_abbr") or "").upper(),
                "type": move.get("type"),
                "source_type": move.get("source_type"),
                "source_team_key": move.get("source_team_key"),
                "destination_type": move.get("destination_type"),
                "destination_team_key": move.get("destination_team_key"),
            })
        results.append({
            "key": meta.get("transaction_key"), "type": meta.get("type"), "status": meta.get("status", "successful"),
            "timestamp": int(meta.get("timestamp") or 0), "faab_bid": meta.get("faab_bid"),
            "trader_team_key": meta.get("trader_team_key"), "tradee_team_key": meta.get("tradee_team_key"),
            "players": players,
        })
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
    if len(league) < 2 or not isinstance(league[1], dict) or "scoreboard" not in league[1]:
        raise RuntimeError("Yahoo's response has no scoreboard in it")
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
            results.append({
                "team_a": teams[0], "team_b": teams[1], "status": matchup.get("status"),
                "week": int(matchup["week"]) if str(matchup.get("week") or "").isdigit() else None,
                "is_playoffs": str(matchup.get("is_playoffs") or "0") == "1",
                "is_consolation": str(matchup.get("is_consolation") or "0") == "1",
            })
    return results
