/* SAMPLE DATA for the design preview only - made-up listings, not the
   league's real trading block. Loaded only when TRADE_LAB_PREVIEW is on. */
(function () {
  var now = Math.floor(Date.now() / 1000);
  var L = '470.l.960265';
  function p(id, name, pos, nfl) { return { player_key: '470.p.' + id, name: name, position: pos, positions: [pos], nfl_team: nfl, headshot: '' }; }
  var teams = [
    ['1', 'Will'], ['2', 'Sam'], ['3', 'Chet'], ['4', 'Chris'], ['5', 'Gabe'], ['6', 'Patrick']
  ].map(function (t) { return { team_key: L + '.t.' + t[0], manager: t[1], name: t[1] + '’s team' }; });
  var T = {}; teams.forEach(function (t) { T[t.manager] = t.team_key; });
  var rosters = {};
  rosters[T.Will] = [p(1, 'Amon-Ra St. Brown', 'WR', 'DET'), p(2, 'Jared Goff', 'QB', 'DET'), p(7, 'Jalen Hurts', 'QB', 'PHI'),
                     p(8, 'James Cook III', 'RB', 'BUF'), p(9, 'Dallas Goedert', 'TE', 'PHI'), p(10, 'Chris Olave', 'WR', 'NO')];
  rosters[T.Sam] = [p(3, 'Breece Hall', 'RB', 'NYJ'), p(11, 'Drake Maye', 'QB', 'NE'), p(12, 'Matthew Stafford', 'QB', 'LAR')];
  rosters[T.Chet] = [p(4, 'Brock Purdy', 'QB', 'SF'), p(13, 'Tee Higgins', 'WR', 'CIN')];
  rosters[T.Chris] = [p(14, 'Mark Andrews', 'TE', 'BAL'), p(15, 'Kyren Williams', 'RB', 'LAR')];
  rosters[T.Gabe] = [p(5, 'Travis Etienne', 'RB', 'JAX'), p(16, 'George Kittle', 'TE', 'SF')];
  rosters[T.Patrick] = [p(6, 'Patrick Mahomes', 'QB', 'KC'), p(17, 'Rashee Rice', 'WR', 'KC')];
  function listing(team, player, status, wants, note, mins) {
    return { player_key: player.player_key, name: player.name, position: player.position, nfl_team: player.nfl_team, headshot: '',
             team_key: T[team], manager: team, status: status, wants: wants, note: note || '',
             created_at: now - mins * 60 - 3600, updated_at: now - mins * 60, version: 1 };
  }
  var listings = [
    listing('Will', rosters[T.Will][0], 'available', ['RB'], 'Open to a package deal.', 35),
    listing('Sam', rosters[T.Sam][0], 'available', ['WR'], '', 90),
    listing('Chet', rosters[T.Chet][0], 'listening', ['RB', 'WR'], 'Only for a starter.', 150),
    listing('Chet', rosters[T.Chet][1], 'available', ['RB', 'TE'], '', 200),
    listing('Gabe', rosters[T.Gabe][0], 'listening', ['WR'], '', 420),
    listing('Chris', rosters[T.Chris][0], 'available', ['RB'], '<b>not bold</b> - notes show as plain text', 600),
    listing('Patrick', rosters[T.Patrick][1], 'available', ['RB', 'QB'], '', 1300)
  ];
  var managerOf = {}; teams.forEach(function (t) { managerOf[t.team_key] = t.manager; });
  function lineup(names) { return names.map(function (n) { return ['WR', n[0], n[1], '', n[2]]; }); }
  var boxscores = { season: 2026, games: {
    '2026-w01-will-sam': { a: lineup([['Amon-Ra St. Brown', 'WR', 18.4], ['Jared Goff', 'QB', 22.1], ['Jalen Hurts', 'QB', 25.6]]),
                           b: lineup([['Breece Hall', 'RB', 14.2], ['Drake Maye', 'QB', 19.8]]) },
    '2026-w02-will-chet': { a: lineup([['Amon-Ra St. Brown', 'WR', 24.9], ['Jared Goff', 'QB', 47.78], ['Jalen Hurts', 'QB', 31.16]]),
                            b: lineup([['Brock Purdy', 'QB', 21.3], ['Tee Higgins', 'WR', 11.0]]) },
    '2026-w02-sam-gabe': { a: lineup([['Breece Hall', 'RB', 22.6], ['Drake Maye', 'QB', 16.1]]),
                           b: lineup([['Travis Etienne', 'RB', 17.4]]) },
    '2026-w03-will-sam': { a: lineup([['Amon-Ra St. Brown', 'WR', 9.7], ['Jared Goff', 'QB', 18.0]]),
                           b: lineup([['Breece Hall', 'RB', 26.3], ['Drake Maye', 'QB', 12.4]]) }
  } };
  window.TRADE_LAB_SAMPLE = { league_key: L, now: now, me: T.Will, teams: teams, managerOf: managerOf, rosters: rosters, listings: listings,
                              positions: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'], boxscores: boxscores };
})();
