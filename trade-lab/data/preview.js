/* SAMPLE DATA for the design preview only - made-up rosters, scores and
   listings, not the league's real trading block. Loaded only when
   TRADE_LAB_PREVIEW is on. */
(function () {
  var now = Math.floor(Date.now() / 1000);
  var L = '470.l.960265';
  var SLOTS = ['QB', 'WR', 'WR', 'WR', 'RB', 'RB', 'TE', 'W/R/T', 'K', 'DEF'];
  // [key, name, position, NFL team, typical points per week]
  var R = {
    Will: [[1, 'Amon-Ra St. Brown', 'WR', 'DET', 19], [2, 'Jared Goff', 'QB', 'DET', 18], [7, 'Jalen Hurts', 'QB', 'PHI', 21],
           [8, 'James Cook III', 'RB', 'BUF', 13], [9, 'Dallas Goedert', 'TE', 'PHI', 9], [10, 'Chris Olave', 'WR', 'NO', 15],
           [18, 'Tony Pollard', 'RB', 'TEN', 9], [19, 'Tyjae Spears', 'RB', 'TEN', 6], [20, 'Garrett Wilson', 'WR', 'NYJ', 14],
           [21, 'DK Metcalf', 'WR', 'PIT', 11], [22, 'Harrison Butker', 'K', 'KC', 8], [23, 'Philadelphia', 'DEF', 'PHI', 8]],
    Sam: [[3, 'Breece Hall', 'RB', 'NYJ', 16], [11, 'Drake Maye', 'QB', 'NE', 17], [12, 'Matthew Stafford', 'QB', 'LAR', 15],
          [24, 'Bijan Robinson', 'RB', 'ATL', 20], [25, 'Josh Jacobs', 'RB', 'GB', 15], [26, 'Chuba Hubbard', 'RB', 'CAR', 11],
          [27, 'Jaylen Waddle', 'WR', 'MIA', 11], [28, 'Jakobi Meyers', 'WR', 'LV', 9], [29, 'Rome Odunze', 'WR', 'CHI', 8],
          [30, 'Trey McBride', 'TE', 'ARI', 12], [31, 'Brandon Aubrey', 'K', 'DAL', 10], [32, 'Baltimore', 'DEF', 'BAL', 7]],
    Chet: [[4, 'Brock Purdy', 'QB', 'SF', 19], [13, 'Tee Higgins', 'WR', 'CIN', 14], [33, 'Lamar Jackson', 'QB', 'BAL', 24],
           [34, 'Najee Harris', 'RB', 'LAC', 10], [35, 'Zack Moss', 'RB', 'CIN', 7], [36, 'Rico Dowdle', 'RB', 'CAR', 6],
           [37, 'CeeDee Lamb', 'WR', 'DAL', 18], [38, 'Puka Nacua', 'WR', 'LAR', 16], [39, 'Dalton Kincaid', 'TE', 'BUF', 8],
           [40, 'Jake Elliott', 'K', 'PHI', 9], [41, 'San Francisco', 'DEF', 'SF', 9]],
    Chris: [[14, 'Mark Andrews', 'TE', 'BAL', 10], [15, 'Kyren Williams', 'RB', 'LAR', 17], [42, 'Kirk Cousins', 'QB', 'ATL', 13],
            [43, 'Saquon Barkley', 'RB', 'PHI', 22], [44, "De'Von Achane", 'RB', 'MIA', 18], [45, 'Chris Godwin', 'WR', 'TB', 11],
            [46, 'Keenan Allen', 'WR', 'LAC', 10], [47, 'Drake London', 'WR', 'ATL', 13], [48, 'Tyler Bass', 'K', 'BUF', 8],
            [49, 'Cleveland', 'DEF', 'CLE', 6], [50, 'Justin Fields', 'QB', 'NYJ', 12]],
    Gabe: [[5, 'Travis Etienne', 'RB', 'JAX', 12], [16, 'George Kittle', 'TE', 'SF', 12], [51, 'Josh Allen', 'QB', 'BUF', 24],
           [52, 'Rhamondre Stevenson', 'RB', 'NE', 10], [53, "Ja'Marr Chase", 'WR', 'CIN', 19], [54, 'Justin Jefferson', 'WR', 'MIN', 18],
           [55, 'Nico Collins', 'WR', 'HOU', 15], [56, 'Jerome Ford', 'RB', 'CLE', 7], [57, 'Chris Boswell', 'K', 'PIT', 9],
           [58, 'New York Jets', 'DEF', 'NYJ', 7]],
    Patrick: [[6, 'Patrick Mahomes', 'QB', 'KC', 20], [17, 'Rashee Rice', 'WR', 'KC', 14], [59, 'Alvin Kamara', 'RB', 'NO', 15],
              [60, 'Kenneth Walker III', 'RB', 'SEA', 14], [61, 'DJ Moore', 'WR', 'CHI', 10], [62, 'Zay Flowers', 'WR', 'BAL', 10],
              [63, 'Sam LaPorta', 'TE', 'DET', 10], [64, 'Jason Myers', 'K', 'SEA', 8], [65, 'Kansas City', 'DEF', 'KC', 9],
              [66, 'Javonte Williams', 'RB', 'DAL', 8, 'IR']]
  };
  var names = ['Will', 'Sam', 'Chet', 'Chris', 'Gabe', 'Patrick'];
  var INJ = { 'Breece Hall': { code: 'Q', label: 'Questionable', note: 'Hamstring' }, 'Mark Andrews': { code: 'O', label: 'Out', note: 'Ankle' } };
  var teams = names.map(function (n, i) { return { team_key: L + '.t.' + (i + 1), manager: n, name: n + '’s team' }; });
  var T = {}; teams.forEach(function (t) { T[t.manager] = t.team_key; });
  var managerOf = {}; teams.forEach(function (t) { managerOf[t.team_key] = t.manager; });
  var rosters = {}, base = {};
  names.forEach(function (n) {
    rosters[T[n]] = R[n].map(function (r) {
      base[r[1]] = r[4];
      return { player_key: '470.p.' + r[0], name: r[1], position: r[2], positions: [r[2]], nfl_team: r[3], headshot: '', slot: r[5] || '',
               injury: INJ[r[1]] || (r[5] === 'IR' ? { code: 'IR', label: 'Injured reserve', note: 'Knee' } : null) };
    });
  });

  // Made-up weekly scores: each player's typical score plus a fixed wobble.
  function wobble(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100003; return (h % 1000) / 1000 - 0.5; }
  // Week-to-week swings that cancel out over every 3 weeks, so each team's
  // averages (and the sample's trade story) stay the same.
  var SWING = [-0.35, 0.4, -0.05], d, cur;
  function swing(name, season, week) {
    if (week > (season === cur ? 3 : 15)) return 0;  // only whole 3-week blocks, so they cancel exactly
    var ph = 0; for (var i = 0; i < name.length; i++) ph += name.charCodeAt(i);
    return SWING[(week + ph) % 3];
  }
  function points(name, season, week) { return Math.max(0, Math.round(base[name] * (1 + 0.9 * wobble(name + season + '-' + week) + swing(name, season, week)) * 100) / 100); }
  function lineup(team, season, week) {
    var ps = rosters[team].filter(function (p) { return !p.slot; }).slice()
      .sort(function (a, b) { return base[b.name] - base[a.name]; }), used = {}, out = [];
    SLOTS.forEach(function (s) {
      var ok = s === 'W/R/T' ? ['WR', 'RB', 'TE'] : [s];
      var p = ps.filter(function (x) { return !used[x.name] && ok.indexOf(x.position) >= 0; })[0];
      if (p) { used[p.name] = 1; out.push([s, p.name, p.position, p.nfl_team, points(p.name, season, week)]); }
    });
    ps.forEach(function (p) { if (!used[p.name]) out.push(['BN', p.name, p.position, p.nfl_team, points(p.name, season, week)]); });
    return out;
  }
  function seasonBox(season, weeks) {
    var games = {};
    for (var w = 1; w <= weeks; w++) {
      var order = names.slice(w % names.length).concat(names.slice(0, w % names.length));
      for (var g = 0; g < order.length; g += 2) {
        var a = order[g], b = order[g + 1];
        games[season + '-w' + (w < 10 ? '0' : '') + w + '-' + a.toLowerCase() + '-' + b.toLowerCase()] = { a: lineup(T[a], season, w), b: lineup(T[b], season, w) };
      }
    }
    return { season: season, games: games };
  }

  function pl(team, name) { return rosters[T[team]].filter(function (p) { return p.name === name; })[0]; }
  function listing(team, name, status, wants, note, mins) {
    var p = pl(team, name);
    return { player_key: p.player_key, name: p.name, position: p.position, nfl_team: p.nfl_team, headshot: '',
             team_key: T[team], manager: team, status: status, wants: wants, note: note || '',
             created_at: now - mins * 60 - 3600, updated_at: now - mins * 60, version: 1 };
  }
  var listings = [
    listing('Will', 'Amon-Ra St. Brown', 'available', ['RB'], 'Open to a package deal.', 35),
    listing('Sam', 'Breece Hall', 'available', ['WR'], '', 90),
    listing('Chet', 'Brock Purdy', 'listening', ['RB', 'WR'], 'Only for a starter.', 150),
    listing('Chet', 'Tee Higgins', 'available', ['RB', 'TE'], '', 200),
    listing('Gabe', 'Travis Etienne', 'listening', ['WR'], '', 420),
    listing('Chris', 'Mark Andrews', 'available', ['RB'], '<b>not bold</b> - notes show as plain text', 600),
    listing('Patrick', 'Rashee Rice', 'available', ['RB', 'QB'], '', 1300)
  ];
  var needs = [{ team_key: T.Gabe, manager: 'Gabe', wants: ['RB'], note: 'Need a RB2 - will pay for one.', updated_at: now - 5000 },
               { team_key: T.Patrick, manager: 'Patrick', wants: ['WR', 'TE'], note: '', updated_at: now - 9000 }];
  window.TRADE_LAB_SAMPLE = { league_key: L, now: now, me: T.Will, teams: teams, managerOf: managerOf, rosters: rosters, listings: listings, needs: needs,
                              positions: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'], slots: SLOTS,
                              boxscores: {} };
  // This season has 3 weeks played; last season all 17 (seasons follow the page's own clock).
  d = new Date(); cur = d.getMonth() < 2 ? d.getFullYear() - 1 : d.getFullYear();
  window.TRADE_LAB_SAMPLE.boxscores[cur - 1] = seasonBox(cur - 1, 17);
  window.TRADE_LAB_SAMPLE.boxscores[cur] = seasonBox(cur, 3);
  // Week 4 in progress: Sunday's games are in, Monday night players (KC, PHI here) haven't played.
  var liveTeams = {};
  names.forEach(function (n) {
    liveTeams[T[n]] = lineup(T[n], cur, 4).map(function (r) {
      var monday = r[3] === 'KC' || r[3] === 'PHI';
      return r.concat([monday ? 0 : 1]).map(function (v, i) { return i === 4 && monday ? 0 : v; });
    });
  });
  window.TRADE_LAB_SAMPLE.live = { season: cur, week: 4, updated: Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 20, 2).getTime() / 1000), teams: liveTeams };
})();
