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
               injury: INJ[r[1]] || (r[5] === 'IR' ? { code: 'IR', label: 'Injured reserve', note: 'Knee' } : null),
               news: INJ[r[1]] ? { recent: true, at: now - 5 * 3600 } : null };
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
  // Made-up draft: the best player on each team went in round 1, the next in round 2.
  var draft_rounds = {}, draft = {}, posSeen = {}, pickNo = 0;
  names.forEach(function (n) {
    R[n].slice().sort(function (a, b) { return b[4] - a[4]; }).slice(0, 2).forEach(function (r, i) { draft_rounds['470.p.' + r[0]] = i + 1; });
  });
  // pick order: round 1 then round 2, each in roster order; positional ranks follow it
  [1, 2].forEach(function (rd) {
    names.forEach(function (n) {
      R[n].forEach(function (r) {
        if (draft_rounds['470.p.' + r[0]] !== rd) return;
        posSeen[r[2]] = (posSeen[r[2]] || 0) + 1;
        draft['470.p.' + r[0]] = { round: rd, pick: ++pickNo, pos: r[2], pos_rank: posSeen[r[2]] };
      });
    });
  });
  window.TRADE_LAB_SAMPLE = { draft_rounds: draft_rounds, draft: draft, league_key: L, now: now, me: T.Will, teams: teams, managerOf: managerOf, rosters: rosters, listings: listings, needs: needs,
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
  // Points Against: made-up points each NFL defense allowed by position, weeks 1-3.
  var NFLT = ['ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA',
              'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS'];
  var PAB = { QB: 25, RB: 26, WR: 34, TE: 13, K: 9, DEF: 16 }, paTeams = {};
  NFLT.forEach(function (t) {
    var weeks = {}, sum = {};
    [1, 2, 3].forEach(function (w) {
      weeks[w] = {};
      Object.keys(PAB).forEach(function (p) {
        var v = Math.round(PAB[p] * (1 + 0.9 * wobble(t + p + 'team') + 0.5 * wobble(t + p + w)) * 100) / 100;
        weeks[w][p] = v; sum[p] = (sum[p] || 0) + v;
      });
    });
    var who = {};
    [1, 2, 3].forEach(function (w) {
      var opp = NFLT[(NFLT.indexOf(t) + w * 7) % 32];
      who[w] = {
        QB: [[opp + ' QB', opp, weeks[w].QB, '22/31, 264 yds, 2 TD, 1 INT; 4 car, 18 yds']],
        RB: [[opp + ' RB1', opp, Math.round(weeks[w].RB * 70) / 100, '16 car, 82 yds, 1 TD; 3 rec, 21 yds'], [opp + ' RB2', opp, Math.round(weeks[w].RB * 30) / 100, '6 car, 24 yds; 2 rec, 11 yds']],
        WR: [[opp + ' WR1', opp, Math.round(weeks[w].WR * 60) / 100, '7 rec, 104 yds, 1 TD'], [opp + ' WR2', opp, Math.round(weeks[w].WR * 40) / 100, '5 rec, 61 yds']],
        TE: [[opp + ' TE', opp, weeks[w].TE, '5 rec, 48 yds']],
        K: [[opp + ' K', opp, weeks[w].K, 'FG 2/2 (long 47), PAT 3/3']],
        DEF: [[opp + ' D/ST', opp, weeks[w].DEF, '3 sacks, 1 INT, 1 FR; 17 pts allowed']]
      };
    });
    var stats = {};
    [1, 2, 3].forEach(function (w) {
      var off = [240, 1.8, 0.8, 4, 20, 0.2, 0, 0, 0, 0, 0, 0.1, 0.2], k = [0.2, 0.6, 0.8, 0.6, 0.3, 0.3, 2.5], d = [2.5, 0.8, 0.6, 0.2, 0.05, 0.1, 21];
      function vary(arr, f) { return arr.map(function (v, i) { return Math.round(v * (1 + 0.6 * wobble(t + w + i + f)) * 10) / 10; }); }
      stats[w] = { QB: vary(off, 'q'), RB: vary([0, 0, 0, 22, 95, 0.8, 5, 38, 0.2, 6, 0, 0.1, 0.2], 'r'), WR: vary([0, 0, 0, 0.5, 3, 0, 13, 160, 1.1, 20, 0.05, 0.1, 0.1], 'w'),
                   TE: vary([0, 0, 0, 0, 0, 0, 5, 52, 0.4, 7, 0, 0, 0.05], 't'), K: vary(k, 'k'), DEF: vary(d, 'd') };
    });
    paTeams[t] = { weeks: weeks, games: 3, who: who, stats: stats };
    Object.keys(PAB).forEach(function (p) { paTeams[t][p] = Math.round(sum[p] / 3 * 100) / 100; });
  });
  var OFFC = ['Pass Yds', 'Pass TD', 'Int', 'Rush Att', 'Rush Yds', 'Rush TD', 'Rec', 'Rec Yds', 'Rec TD', 'Tgt', 'Ret TD', '2PT', 'Fum Lost'];
  var schedule = {}, starters = {};
  NFLT.forEach(function (t, i) {
    schedule[t] = {};
    for (var w = 1; w <= 18; w++) if (w !== 5 + (i % 9)) schedule[t][w] = NFLT[(i + w * 7) % 32];
    starters[t] = { QB: [t + ' QB1'], RB: [t + ' RB1', t + ' RB2'], WR: [t + ' WR1', t + ' WR2', t + ' WR3'], TE: [t + ' TE1'], K: [t + ' K'] };
  });
  // Kickoffs (Eastern), with week 4 on the coming Sunday: most at 1:00, some
  // late, one Thursday, one Sunday night and one Monday night game.
  var kick = {}, sun = new Date(d.getFullYear(), d.getMonth(), d.getDate() + ((7 - d.getDay()) % 7 || 7));
  function two(n) { return (n < 10 ? '0' : '') + n; }
  NFLT.forEach(function (t, i) {
    kick[t] = {};
    Object.keys(schedule[t]).forEach(function (w) {
      var slot = [[-3, '20:15'], [0, '16:25'], [0, '20:20'], [1, '20:15']][i % 8] || [0, '13:00'];
      var day = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + (w - 4) * 7 + slot[0]);
      kick[t][w] = day.getFullYear() + '-' + two(day.getMonth() + 1) + '-' + two(day.getDate()) + ' ' + slot[1];
    });
  });
  window.TRADE_LAB_SAMPLE.pointsAgainst = { season: cur, weeks: [1, 2, 3], updated: now - 7200, teams: paTeams, schedule: schedule, kickoffs: kick, starters: starters,
    cols: { QB: OFFC, RB: OFFC, WR: OFFC, TE: OFFC, K: ['FG 0-19', 'FG 20-29', 'FG 30-39', 'FG 40-49', 'FG 50+', 'FG Miss', 'PAT'],
            DEF: ['Sack', 'Int', 'Fum Rec', 'TD', 'Safety', 'Blk Kick', 'Pts Allow'] } };
  // Waiver Wire Report: made-up free agents (true = on waivers), and every
  // player's weekly points the way nflverse's file has them.
  var FA = [[101, 'Jaylen Warren', 'RB', 'PIT', 12], [102, 'Tyrone Tracy Jr.', 'RB', 'NYG', 13, true], [103, 'Ray Davis', 'RB', 'BUF', 7],
            [104, 'Kimani Vidal', 'RB', 'LAC', 9], [105, 'Jaleel McLaughlin', 'RB', 'DEN', 5], [111, 'Jalen McMillan', 'WR', 'TB', 12],
            [112, "Wan'Dale Robinson", 'WR', 'NYG', 11], [113, 'Jauan Jennings', 'WR', 'SF', 13, false, { code: 'Q', label: 'Questionable', note: 'Calf' }],
            [114, 'Rashid Shaheed', 'WR', 'NO', 10, true], [115, 'Demario Douglas', 'WR', 'NE', 7], [121, 'Bo Nix', 'QB', 'DEN', 18],
            [122, 'Geno Smith', 'QB', 'LV', 16], [123, 'Bryce Young', 'QB', 'CAR', 12], [131, 'Hunter Henry', 'TE', 'NE', 11],
            [132, 'Jake Ferguson', 'TE', 'DAL', 10, true], [133, 'Cole Kmet', 'TE', 'CHI', 6], [141, 'Cameron Dicker', 'K', 'LAC', 10],
            [142, 'Wil Lutz', 'K', 'DEN', 8], [151, 'Denver', 'DEF', 'DEN', 10], [152, 'Pittsburgh', 'DEF', 'PIT', 8],
            [160, 'Brand New Rookie', 'WR', 'CHI', 0]];
  FA.forEach(function (r) { if (r[4]) base[r[1]] = r[4]; });
  function nk(n) { return n.toLowerCase().replace(/[.'’]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '').replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean).join(' '); }
  var nflp = { season: cur, weeks: [1, 2, 3], updated: now - 7200, players: [], defenses: {} };
  names.map(function (n) { return R[n]; }).concat([FA]).forEach(function (list) {
    list.forEach(function (r) {
      if (!r[4]) return;
      var wk = {}; [1, 2, 3].forEach(function (w) { wk[w] = points(r[1], cur, w); });
      if (r[2] === 'DEF') nflp.defenses[r[3]] = wk; else nflp.players.push([nk(r[1]), r[1], r[2], r[3], wk]);
    });
  });
  window.TRADE_LAB_SAMPLE.nflPlayers = nflp;
  // Player pop-up game logs: made-up box scores that add up to each week's points.
  var GL = {
    QB: [['Passing', 'Cmp'], ['Passing', 'Att'], ['Passing', 'Yds'], ['Passing', 'TD'], ['Passing', 'Int'], ['Rushing', 'Car'], ['Rushing', 'Yds'], ['Rushing', 'TD']],
    RB: [['Rushing', 'Car'], ['Rushing', 'Yds'], ['Rushing', 'TD'], ['Receiving', 'Tgt'], ['Receiving', 'Rec'], ['Receiving', 'Yds'], ['Receiving', 'TD']],
    WR: [['Receiving', 'Tgt'], ['Receiving', 'Rec'], ['Receiving', 'Yds'], ['Receiving', 'TD'], ['Rushing', 'Car'], ['Rushing', 'Yds'], ['Rushing', 'TD']],
    K: [['Field goals', 'Made'], ['Field goals', 'Att'], ['Field goals', 'Long'], ['Extra points', 'Made'], ['Extra points', 'Att']],
    DEF: [['Defense', 'Sack'], ['Defense', 'Int'], ['Defense', 'Fum Rec'], ['Defense', 'TD'], ['Defense', 'Safety'], ['Defense', 'Pts Allow']]
  };
  GL.TE = GL.WR;
  function line(pos, p, j) {
    var r = Math.round, f = Math.floor;
    if (pos === 'QB') { var att = 26 + j % 12; return [r(att * 0.66), att, r(p * 11), f(p / 9), p < 14 ? 1 : 0, 2 + j % 5, r(p * 0.9), p > 26 ? 1 : 0]; }
    if (pos === 'RB') { var tg = 2 + j % 4; return [9 + r(p * 0.6), r(p * 4.1), f(p / 14), tg, Math.max(1, tg - 1), r(p * 1.1), 0]; }
    if (pos === 'WR' || pos === 'TE') { var t = 4 + r(p * 0.35); return [t, r(t * 0.66), r(p * 5.2), f(p / 13), j % 7 === 0 ? 1 : 0, j % 7 === 0 ? 6 : 0, 0]; }
    if (pos === 'K') { var m = f(p / 4); return [m, m + (j % 3 === 0 ? 1 : 0), m ? 33 + j % 22 : 0, 1 + j % 4, 1 + j % 4]; }
    return [f(p / 3), p > 9 ? 1 : 0, j % 4 === 0 ? 1 : 0, p > 14 ? 1 : 0, 0, Math.max(3, 31 - r(p * 1.6))];
  }
  var home = {};
  NFLT.forEach(function (t, i) { home[t] = Object.keys(schedule[t]).map(Number).filter(function (w) { return (w + i) % 2 === 0; }); });
  var gl = { season: cur, weeks: [1, 2, 3], updated: now - 7200, cols: GL, players: [], defenses: {}, schedule: schedule, home: home };
  names.map(function (n) { return R[n]; }).concat([FA]).forEach(function (list) {
    list.forEach(function (r) {
      if (!r[4]) return;
      var wk = {};
      [1, 2, 3].forEach(function (w) {
        if (r[1] === 'Mark Andrews' && w === 3) return;  // hurt: did not play
        if (!schedule[r[3]][w]) return;  // bye
        var p = points(r[1], cur, w);
        wk[w] = [p, schedule[r[3]][w]].concat(line(r[2], p, r[0] + w));
      });
      if (r[2] === 'DEF') gl.defenses[r[3]] = wk; else gl.players.push([nk(r[1]), r[1], r[2], r[3], wk]);
    });
  });
  window.TRADE_LAB_SAMPLE.gameLog = gl;
  // Workload report: last season vs this one (made-up numbers for the preview).
  window.TRADE_LAB_SAMPLE.workload = { season: cur, prev: cur - 1, weeks: [1, 2, 3, 4, 5, 6, 7], updated: now - 7200, players: [{"name":"Keenan Allen","pos":"WR","t_prev":"LAC","t_cur":"IND","gp_prev":17,"gp_cur":6,"o_prev":7.18,"o_cur":7.17,"p_prev":10.75,"p_cur":10.13,"e_prev":1.498,"e_cur":1.414},{"name":"Travis Kelce","pos":"TE","t_prev":"KC","t_cur":"KC","gp_prev":17,"gp_cur":6,"o_prev":6.41,"o_cur":5.83,"p_prev":11.36,"p_cur":11.72,"e_prev":1.772,"e_cur":2.009},{"name":"Davante Adams","pos":"WR","t_prev":"LA","t_cur":"LA","gp_prev":14,"gp_cur":6,"o_prev":8.14,"o_cur":8.17,"p_prev":15.92,"p_cur":17.0,"e_prev":1.955,"e_cur":2.082},{"name":"Mike Evans","pos":"WR","t_prev":"TB","t_cur":"SF","gp_prev":8,"gp_cur":6,"o_prev":7.75,"o_cur":6.5,"p_prev":10.6,"p_cur":14.83,"e_prev":1.368,"e_cur":2.282},{"name":"Stefon Diggs","pos":"WR","t_prev":"NE","t_cur":"WAS","gp_prev":17,"gp_cur":5,"o_prev":6.0,"o_cur":7.6,"p_prev":12.37,"p_cur":13.88,"e_prev":2.062,"e_cur":1.826},{"name":"Derrick Henry","pos":"RB","t_prev":"BAL","t_cur":"BAL","gp_prev":17,"gp_cur":7,"o_prev":19.29,"o_cur":22.71,"p_prev":16.44,"p_cur":17.53,"e_prev":0.852,"e_cur":0.772},{"name":"Hunter Henry","pos":"TE","t_prev":"NE","t_cur":"NE","gp_prev":17,"gp_cur":7,"o_prev":5.12,"o_cur":4.43,"p_prev":10.52,"p_cur":9.66,"e_prev":2.055,"e_cur":2.181},{"name":"Christian McCaffrey","pos":"RB","t_prev":"SF","t_cur":"SF","gp_prev":17,"gp_cur":7,"o_prev":25.88,"o_cur":18.0,"p_prev":24.51,"p_cur":20.57,"e_prev":0.947,"e_cur":1.143},{"name":"George Kittle","pos":"TE","t_prev":"SF","t_cur":"SF","gp_prev":11,"gp_cur":7,"o_prev":6.36,"o_cur":6.57,"p_prev":14.68,"p_cur":14.93,"e_prev":2.307,"e_cur":2.272},{"name":"Courtland Sutton","pos":"WR","t_prev":"DEN","t_cur":"DEN","gp_prev":17,"gp_cur":7,"o_prev":7.29,"o_cur":4.71,"p_prev":12.92,"p_cur":5.54,"e_prev":1.772,"e_cur":1.176},{"name":"Dalton Schultz","pos":"TE","t_prev":"HOU","t_cur":"HOU","gp_prev":17,"gp_cur":7,"o_prev":6.24,"o_cur":6.14,"p_prev":10.45,"p_cur":9.31,"e_prev":1.676,"e_cur":1.516},{"name":"Jakobi Meyers","pos":"WR","t_prev":"JAX","t_cur":"JAX","gp_prev":16,"gp_cur":6,"o_prev":7.19,"o_cur":4.83,"p_prev":10.99,"p_cur":10.12,"e_prev":1.529,"e_cur":2.093},{"name":"Tony Pollard","pos":"RB","t_prev":"TEN","t_cur":"TEN","gp_prev":17,"gp_cur":7,"o_prev":16.65,"o_cur":18.29,"p_prev":10.93,"p_cur":12.54,"e_prev":0.657,"e_cur":0.686},{"name":"DK Metcalf","pos":"WR","t_prev":"PIT","t_cur":"PIT","gp_prev":15,"gp_cur":7,"o_prev":6.73,"o_cur":8.43,"p_prev":12.48,"p_cur":10.93,"e_prev":1.853,"e_cur":1.297},{"name":"Terry McLaurin","pos":"WR","t_prev":"WAS","t_cur":"WAS","gp_prev":10,"gp_cur":5,"o_prev":6.0,"o_cur":5.4,"p_prev":11.42,"p_cur":9.2,"e_prev":1.903,"e_cur":1.704},{"name":"Deebo Samuel Sr.","pos":"WR","t_prev":"WAS","t_cur":"SF","gp_prev":16,"gp_cur":5,"o_prev":7.25,"o_cur":5.8,"p_prev":11.76,"p_cur":12.08,"e_prev":1.622,"e_cur":2.083},{"name":"Juwan Johnson","pos":"TE","t_prev":"NO","t_cur":"NO","gp_prev":17,"gp_cur":7,"o_prev":6.0,"o_cur":5.29,"p_prev":10.58,"p_cur":9.64,"e_prev":1.764,"e_cur":1.824},{"name":"J.K. Dobbins","pos":"RB","t_prev":"DEN","t_cur":"DEN","gp_prev":10,"gp_cur":7,"o_prev":16.7,"o_cur":13.71,"p_prev":11.59,"p_cur":8.29,"e_prev":0.694,"e_cur":0.604},{"name":"Jonathan Taylor","pos":"RB","t_prev":"IND","t_cur":"IND","gp_prev":17,"gp_cur":7,"o_prev":22.24,"o_cur":23.71,"p_prev":21.31,"p_cur":19.64,"e_prev":0.958,"e_cur":0.828},{"name":"Jauan Jennings","pos":"WR","t_prev":"SF","t_cur":"MIN","gp_prev":15,"gp_cur":5,"o_prev":6.0,"o_cur":1.6,"p_prev":11.55,"p_cur":1.66,"e_prev":1.926,"e_cur":1.038},{"name":"D'Andre Swift","pos":"RB","t_prev":"CHI","t_cur":"CHI","gp_prev":16,"gp_cur":7,"o_prev":16.94,"o_cur":20.14,"p_prev":14.29,"p_cur":17.54,"e_prev":0.844,"e_cur":0.871},{"name":"Justin Jefferson","pos":"WR","t_prev":"MIN","t_cur":"MIN","gp_prev":17,"gp_cur":5,"o_prev":8.41,"o_cur":6.4,"p_prev":11.85,"p_cur":14.42,"e_prev":1.409,"e_cur":2.253},{"name":"CeeDee Lamb","pos":"WR","t_prev":"DAL","t_cur":"DAL","gp_prev":13,"gp_cur":6,"o_prev":9.08,"o_cur":11.83,"p_prev":15.45,"p_cur":21.85,"e_prev":1.703,"e_cur":1.846},{"name":"Tee Higgins","pos":"WR","t_prev":"CIN","t_cur":"CIN","gp_prev":15,"gp_cur":6,"o_prev":6.53,"o_cur":8.33,"p_prev":14.11,"p_cur":17.02,"e_prev":2.159,"e_cur":2.042},{"name":"Nico Collins","pos":"WR","t_prev":"HOU","t_cur":"HOU","gp_prev":15,"gp_cur":5,"o_prev":8.13,"o_cur":7.4,"p_prev":15.08,"p_cur":15.22,"e_prev":1.854,"e_cur":2.057},{"name":"Jaylen Waddle","pos":"WR","t_prev":"MIA","t_cur":"DEN","gp_prev":16,"gp_cur":7,"o_prev":6.38,"o_cur":6.71,"p_prev":12.13,"p_cur":9.13,"e_prev":1.903,"e_cur":1.36},{"name":"Rhamondre Stevenson","pos":"RB","t_prev":"NE","t_cur":"NE","gp_prev":14,"gp_cur":7,"o_prev":11.93,"o_cur":14.43,"p_prev":12.77,"p_cur":12.41,"e_prev":1.071,"e_cur":0.86},{"name":"Ja'Marr Chase","pos":"WR","t_prev":"CIN","t_cur":"CIN","gp_prev":16,"gp_cur":6,"o_prev":11.75,"o_cur":7.5,"p_prev":19.6,"p_cur":16.18,"e_prev":1.668,"e_cur":2.158},{"name":"Kenny Gainwell","pos":"RB","t_prev":"PIT","t_cur":"TB","gp_prev":17,"gp_cur":7,"o_prev":11.71,"o_cur":7.14,"p_prev":13.02,"p_cur":5.57,"e_prev":1.112,"e_cur":0.78},{"name":"Amon-Ra St. Brown","pos":"WR","t_prev":"DET","t_cur":"DET","gp_prev":17,"gp_cur":6,"o_prev":10.29,"o_cur":11.5,"p_prev":19.06,"p_cur":21.4,"e_prev":1.851,"e_cur":1.861},{"name":"Kyle Pitts","pos":"TE","t_prev":"ATL","t_cur":"ATL","gp_prev":17,"gp_cur":7,"o_prev":6.94,"o_cur":3.86,"p_prev":12.4,"p_cur":9.01,"e_prev":1.786,"e_cur":2.337},{"name":"Javonte Williams","pos":"RB","t_prev":"DAL","t_cur":"DAL","gp_prev":16,"gp_cur":6,"o_prev":18.94,"o_cur":17.83,"p_prev":15.18,"p_cur":18.17,"e_prev":0.801,"e_cur":1.019},{"name":"Jaylen Warren","pos":"RB","t_prev":"PIT","t_cur":"PIT","gp_prev":16,"gp_cur":7,"o_prev":16.0,"o_cur":19.43,"p_prev":13.57,"p_cur":17.07,"e_prev":0.848,"e_cur":0.879},{"name":"Drake London","pos":"WR","t_prev":"ATL","t_cur":"ATL","gp_prev":12,"gp_cur":7,"o_prev":9.33,"o_cur":8.29,"p_prev":16.82,"p_cur":15.43,"e_prev":1.803,"e_cur":1.862},{"name":"Chris Olave","pos":"WR","t_prev":"NO","t_cur":"NO","gp_prev":16,"gp_cur":7,"o_prev":9.81,"o_cur":10.14,"p_prev":16.75,"p_cur":17.8,"e_prev":1.707,"e_cur":1.755},{"name":"Jameson Williams","pos":"WR","t_prev":"DET","t_cur":"DET","gp_prev":17,"gp_cur":6,"o_prev":6.35,"o_cur":6.33,"p_prev":12.94,"p_cur":13.95,"e_prev":2.036,"e_cur":2.203},{"name":"George Pickens","pos":"WR","t_prev":"DAL","t_cur":"DAL","gp_prev":17,"gp_cur":6,"o_prev":8.06,"o_cur":8.67,"p_prev":17.17,"p_cur":13.63,"e_prev":2.131,"e_cur":1.573},{"name":"James Cook","pos":"RB","t_prev":"BUF","t_cur":"BUF","gp_prev":17,"gp_cur":6,"o_prev":20.53,"o_cur":21.83,"p_prev":17.78,"p_cur":18.93,"e_prev":0.866,"e_cur":0.867},{"name":"Khalil Shakir","pos":"WR","t_prev":"BUF","t_cur":"BUF","gp_prev":16,"gp_cur":6,"o_prev":6.0,"o_cur":5.33,"p_prev":10.4,"p_cur":9.17,"e_prev":1.733,"e_cur":1.719},{"name":"Garrett Wilson","pos":"WR","t_prev":"NYJ","t_cur":"NYJ","gp_prev":7,"gp_cur":7,"o_prev":8.43,"o_cur":7.29,"p_prev":14.21,"p_cur":14.2,"e_prev":1.686,"e_cur":1.949},{"name":"Trey McBride","pos":"TE","t_prev":"ARI","t_cur":"ARI","gp_prev":17,"gp_cur":7,"o_prev":9.94,"o_cur":11.14,"p_prev":18.58,"p_cur":18.6,"e_prev":1.869,"e_cur":1.669},{"name":"Romeo Doubs","pos":"WR","t_prev":"GB","t_cur":"NE","gp_prev":16,"gp_cur":6,"o_prev":5.31,"o_cur":4.0,"p_prev":10.34,"p_cur":9.68,"e_prev":1.946,"e_cur":2.421},{"name":"Kyren Williams","pos":"RB","t_prev":"LA","t_cur":"LA","gp_prev":17,"gp_cur":7,"o_prev":18.18,"o_cur":19.57,"p_prev":15.49,"p_cur":19.59,"e_prev":0.852,"e_cur":1.001},{"name":"Jake Ferguson","pos":"TE","t_prev":"DAL","t_cur":"DAL","gp_prev":17,"gp_cur":6,"o_prev":6.06,"o_cur":4.0,"p_prev":11.06,"p_cur":7.42,"e_prev":1.826,"e_cur":1.854},{"name":"Wan'Dale Robinson","pos":"WR","t_prev":"NYG","t_cur":"TEN","gp_prev":16,"gp_cur":7,"o_prev":8.94,"o_cur":6.29,"p_prev":13.62,"p_cur":8.8,"e_prev":1.524,"e_cur":1.4},{"name":"Christian Watson","pos":"WR","t_prev":"GB","t_cur":"GB","gp_prev":10,"gp_cur":7,"o_prev":5.6,"o_cur":8.0,"p_prev":13.24,"p_cur":18.5,"e_prev":2.364,"e_cur":2.312},{"name":"Kenneth Walker III","pos":"RB","t_prev":"SEA","t_cur":"KC","gp_prev":17,"gp_cur":6,"o_prev":15.12,"o_cur":24.5,"p_prev":11.29,"p_cur":24.62,"e_prev":0.747,"e_cur":1.005},{"name":"Bijan Robinson","pos":"RB","t_prev":"ATL","t_cur":"ATL","gp_prev":17,"gp_cur":7,"o_prev":22.94,"o_cur":23.29,"p_prev":21.81,"p_cur":20.81,"e_prev":0.951,"e_cur":0.894},{"name":"Jaxon Smith-Njigba","pos":"WR","t_prev":"SEA","t_cur":"SEA","gp_prev":17,"gp_cur":7,"o_prev":10.0,"o_cur":11.57,"p_prev":21.17,"p_cur":28.02,"e_prev":2.117,"e_cur":2.422},{"name":"Quentin Johnston","pos":"WR","t_prev":"LAC","t_cur":"LAC","gp_prev":13,"gp_cur":5,"o_prev":6.62,"o_cur":4.8,"p_prev":13.17,"p_cur":4.96,"e_prev":1.991,"e_cur":1.033},{"name":"Michael Wilson","pos":"WR","t_prev":"ARI","t_cur":"ARI","gp_prev":17,"gp_cur":7,"o_prev":7.41,"o_cur":9.71,"p_prev":12.98,"p_cur":11.7,"e_prev":1.751,"e_cur":1.204},{"name":"Chase Brown","pos":"RB","t_prev":"CIN","t_cur":"CIN","gp_prev":17,"gp_cur":6,"o_prev":18.82,"o_cur":19.17,"p_prev":16.62,"p_cur":12.47,"e_prev":0.883,"e_cur":0.65},{"name":"Parker Washington","pos":"WR","t_prev":"JAX","t_cur":"JAX","gp_prev":16,"gp_cur":6,"o_prev":6.38,"o_cur":7.83,"p_prev":11.54,"p_cur":15.32,"e_prev":1.811,"e_cur":1.955},{"name":"Dalton Kincaid","pos":"TE","t_prev":"BUF","t_cur":"BUF","gp_prev":12,"gp_cur":6,"o_prev":4.08,"o_cur":4.83,"p_prev":10.51,"p_cur":10.08,"e_prev":2.573,"e_cur":2.086},{"name":"Tucker Kraft","pos":"TE","t_prev":"GB","t_cur":"GB","gp_prev":8,"gp_cur":7,"o_prev":5.62,"o_cur":6.43,"p_prev":14.65,"p_cur":10.17,"e_prev":2.604,"e_cur":1.582},{"name":"Zay Flowers","pos":"WR","t_prev":"BAL","t_cur":"BAL","gp_prev":17,"gp_cur":6,"o_prev":7.53,"o_cur":9.33,"p_prev":14.31,"p_cur":20.37,"e_prev":1.901,"e_cur":2.182},{"name":"Sam LaPorta","pos":"TE","t_prev":"DET","t_cur":"DET","gp_prev":9,"gp_cur":6,"o_prev":5.44,"o_cur":6.5,"p_prev":11.88,"p_cur":13.23,"e_prev":2.182,"e_cur":2.036},{"name":"Puka Nacua","pos":"WR","t_prev":"LA","t_cur":"LA","gp_prev":16,"gp_cur":5,"o_prev":11.0,"o_cur":13.4,"p_prev":23.44,"p_cur":22.72,"e_prev":2.131,"e_cur":1.696},{"name":"Jahmyr Gibbs","pos":"RB","t_prev":"DET","t_cur":"DET","gp_prev":17,"gp_cur":6,"o_prev":19.82,"o_cur":29.0,"p_prev":21.58,"p_cur":28.5,"e_prev":1.089,"e_cur":0.983},{"name":"Brock Bowers","pos":"TE","t_prev":"LV","t_cur":"LV","gp_prev":12,"gp_cur":5,"o_prev":7.33,"o_cur":10.2,"p_prev":14.68,"p_cur":19.1,"e_prev":2.002,"e_cur":1.873},{"name":"Bucky Irving","pos":"RB","t_prev":"TB","t_cur":"TB","gp_prev":10,"gp_cur":7,"o_prev":20.8,"o_cur":20.43,"p_prev":13.85,"p_cur":15.66,"e_prev":0.666,"e_cur":0.766},{"name":"Tyrone Tracy Jr.","pos":"RB","t_prev":"NYG","t_cur":"NYG","gp_prev":15,"gp_cur":7,"o_prev":14.93,"o_cur":3.71,"p_prev":10.72,"p_cur":4.56,"e_prev":0.718,"e_cur":1.227},{"name":"Marvin Harrison Jr.","pos":"WR","t_prev":"ARI","t_cur":"HOU","gp_prev":12,"gp_cur":6,"o_prev":6.08,"o_cur":3.5,"p_prev":10.65,"p_cur":5.58,"e_prev":1.751,"e_cur":1.595},{"name":"Troy Franklin","pos":"WR","t_prev":"DEN","t_cur":"DEN","gp_prev":17,"gp_cur":6,"o_prev":6.41,"o_cur":1.67,"p_prev":10.42,"p_cur":2.02,"e_prev":1.625,"e_cur":1.21},{"name":"Ladd McConkey","pos":"WR","t_prev":"LAC","t_cur":"LAC","gp_prev":16,"gp_cur":5,"o_prev":6.62,"o_cur":3.6,"p_prev":11.31,"p_cur":7.8,"e_prev":1.707,"e_cur":2.167},{"name":"Rome Odunze","pos":"WR","t_prev":"CHI","t_cur":"CHI","gp_prev":12,"gp_cur":7,"o_prev":7.5,"o_cur":5.43,"p_prev":12.17,"p_cur":8.59,"e_prev":1.623,"e_cur":1.582},{"name":"Ashton Jeanty","pos":"RB","t_prev":"LV","t_cur":"LV","gp_prev":17,"gp_cur":7,"o_prev":19.94,"o_cur":21.43,"p_prev":14.42,"p_cur":17.43,"e_prev":0.723,"e_cur":0.813},{"name":"Tetairoa McMillan","pos":"WR","t_prev":"CAR","t_cur":"CAR","gp_prev":17,"gp_cur":6,"o_prev":7.18,"o_cur":9.0,"p_prev":12.55,"p_cur":16.18,"e_prev":1.749,"e_cur":1.798},{"name":"Colston Loveland","pos":"TE","t_prev":"CHI","t_cur":"CHI","gp_prev":16,"gp_cur":7,"o_prev":5.19,"o_cur":6.0,"p_prev":10.32,"p_cur":8.91,"e_prev":1.989,"e_cur":1.486},{"name":"Tyler Warren","pos":"TE","t_prev":"IND","t_cur":"IND","gp_prev":17,"gp_cur":5,"o_prev":6.94,"o_cur":7.8,"p_prev":11.09,"p_cur":13.98,"e_prev":1.597,"e_cur":1.792},{"name":"Emeka Egbuka","pos":"WR","t_prev":"TB","t_cur":"TB","gp_prev":17,"gp_cur":6,"o_prev":7.59,"o_cur":8.5,"p_prev":11.51,"p_cur":11.85,"e_prev":1.517,"e_cur":1.394},{"name":"Harold Fannin Jr.","pos":"TE","t_prev":"CLE","t_cur":"CLE","gp_prev":16,"gp_cur":7,"o_prev":7.12,"o_cur":5.57,"p_prev":11.65,"p_cur":9.53,"e_prev":1.635,"e_cur":1.71},{"name":"Omarion Hampton","pos":"RB","t_prev":"LAC","t_cur":"LAC","gp_prev":9,"gp_cur":6,"o_prev":17.67,"o_cur":15.0,"p_prev":15.08,"p_cur":9.58,"e_prev":0.853,"e_cur":0.639},{"name":"Cam Skattebo","pos":"RB","t_prev":"NYG","t_cur":"NYG","gp_prev":8,"gp_cur":6,"o_prev":16.62,"o_cur":18.5,"p_prev":15.96,"p_cur":11.73,"e_prev":0.96,"e_cur":0.634},{"name":"RJ Harvey","pos":"RB","t_prev":"DEN","t_cur":"DEN","gp_prev":17,"gp_cur":6,"o_prev":12.0,"o_cur":8.67,"p_prev":12.15,"p_cur":11.23,"e_prev":1.013,"e_cur":1.296},{"name":"TreVeyon Henderson","pos":"RB","t_prev":"NE","t_cur":"NE","gp_prev":17,"gp_cur":6,"o_prev":13.06,"o_cur":9.83,"p_prev":12.13,"p_cur":5.63,"e_prev":0.929,"e_cur":0.573},{"name":"Quinshon Judkins","pos":"RB","t_prev":"CLE","t_cur":"CLE","gp_prev":14,"gp_cur":6,"o_prev":19.0,"o_cur":18.5,"p_prev":12.13,"p_cur":13.28,"e_prev":0.638,"e_cur":0.718}] };
  // Commissioner page: made-up signed-in visits over the last two weeks.
  var cmDays = [], hr = 3600, cday = 86400;
  for (var di = 13; di >= 0; di--) { var dd = new Date((now - di * cday) * 1000); cmDays.push(dd.getFullYear() + '-' + two(dd.getMonth() + 1) + '-' + two(dd.getDate())); }
  var cmRows = [['Will', 0.2 * hr, [1, 0, 2, 1, 0, 0, 3, 1, 0, 2, 1, 0, 2, 1], ['tools:cm', 'tools:ww', 'trade-lab']],
    ['Gabe', 2.5 * hr, [0, 1, 0, 0, 2, 0, 1, 0, 3, 1, 0, 0, 1, 2], ['tools:ww', 'tools:tx', 'tools:ld']],
    ['Sam', 26 * hr, [0, 0, 1, 0, 0, 0, 2, 0, 0, 1, 0, 0, 1, 0], ['trade-lab', 'tools:pa']],
    ['Chris', 4.2 * cday, [0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0], ['tools:ir']],
    ['Chet', 12 * cday, [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ['tools:ld']], ['Patrick', null, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], []]];
  window.TRADE_LAB_SAMPLE.commissioner = { days: cmDays, since: now - 20 * cday, checked_at: now, managers: cmRows.map(function (r) {
    var wkv = r[2].slice(-7);
    return { team_key: T[r[0]], manager: r[0], you: r[0] === 'Will', last_seen: r[1] === null ? null : now - r[1], daily: r[2], top: r[3],
             visits_week: wkv.reduce(function (a, b) { return a + b; }, 0), days_week: wkv.filter(Boolean).length };
  }) };
  window.TRADE_LAB_SAMPLE.available = FA.map(function (r) {
    return { player_key: '470.p.' + r[0], name: r[1], position: r[2], nfl_team: r[3], headshot: '', injury: r[6] || null, waivers: !!r[5] };
  });
  // Injury Report: made-up statuses on top of the sample rosters' own.
  var IRX = { 'Chris Olave': { code: 'D', label: 'Doubtful', note: 'Concussion' }, 'Puka Nacua': { code: 'O', label: 'Out', note: 'Ankle' },
              'Nico Collins': { code: 'Q', label: 'Questionable', note: 'Hamstring' }, 'Chris Godwin': { code: 'Q', label: 'Questionable', note: 'Ankle' },
              'Zay Flowers': { code: 'IR', label: 'Injured Reserve', note: 'Knee' } };
  var injured = [], back = [];
  names.forEach(function (n) {
    rosters[T[n]].forEach(function (pl, i) {
      var inj = IRX[pl.name] || pl.injury;
      var row = { player_key: pl.player_key, name: pl.name, position: pl.position, nfl_team: pl.nfl_team, headshot: '',
                  slot: pl.slot || (i < 9 ? pl.position : 'BN'), injury: inj, news: inj ? { recent: true, at: now - 7200 } : null, team_key: T[n], manager: n };
      if (inj) injured.push(Object.assign({ since: pl.name === 'Puka Nacua' ? now - 2 * 86400 : null }, row));
      if (pl.name === 'Chris Godwin') back.push(Object.assign({ was: 'IR', changed: now - 86400 }, row));
      if (pl.name === 'Kyren Williams') back.push(Object.assign({ was: 'O', changed: now - 3 * 86400 }, row, { injury: null }));
    });
  });
  window.TRADE_LAB_SAMPLE.injuries = { injured: injured, back: back };
  // Transaction Report: made-up adds, drops and trades over the last few weeks.
  function pk(n) { var f = FA.concat(R.Will, R.Sam, R.Chet, R.Chris, R.Gabe, R.Patrick).filter(function (r) { return r[1] === n; })[0]; return f; }
  function mv(name, action, fromType, toType, team) {
    var r = pk(name);
    return { player_key: '470.p.' + r[0], name: r[1], position: r[2], nfl_team: r[3], action: action, from: fromType, to: toType,
             from_team: action === 'drop' ? T[team] : null, to_team: action === 'add' ? T[team] : null };
  }
  var day = 86400;
  window.TRADE_LAB_SAMPLE.transactions = [
    { key: 's1', type: 'move', at: now - 0.3 * day, faab: '14', teams: [{ team_key: T.Will, manager: 'Will' }],
      players: [mv('Jake Ferguson', 'add', 'waivers', 'team', 'Will'), mv('Tyjae Spears', 'drop', 'team', 'waivers', 'Will')] },
    { key: 's2', type: 'move', at: now - 1.2 * day, faab: null, teams: [{ team_key: T.Gabe, manager: 'Gabe' }],
      players: [mv('Ray Davis', 'add', 'freeagents', 'team', 'Gabe')] },
    { key: 's3', type: 'trade', at: now - 2.4 * day, faab: null, teams: [{ team_key: T.Sam, manager: 'Sam' }, { team_key: T.Chet, manager: 'Chet' }],
      players: [Object.assign(mv('Jaylen Waddle', 'trade', 'team', 'team', 'Sam'), { from_team: T.Sam, to_team: T.Chet }),
                Object.assign(mv('Zack Moss', 'trade', 'team', 'team', 'Chet'), { from_team: T.Chet, to_team: T.Sam })] },
    { key: 's4', type: 'move', at: now - 6.5 * day, faab: '3', teams: [{ team_key: T.Chris, manager: 'Chris' }],
      players: [mv('Kimani Vidal', 'add', 'waivers', 'team', 'Chris'), mv('Justin Fields', 'drop', 'team', 'waivers', 'Chris')] },
    { key: 's5', type: 'move', at: now - 7.1 * day, faab: null, teams: [{ team_key: T.Patrick, manager: 'Patrick' }],
      players: [mv('Javonte Williams', 'drop', 'team', 'waivers', 'Patrick')] },
    { key: 's6', type: 'move', at: now - 13.4 * day, faab: '21', teams: [{ team_key: T.Will, manager: 'Will' }],
      players: [mv('Jaylen Warren', 'add', 'waivers', 'team', 'Will'), mv('Ray Davis', 'drop', 'team', 'waivers', 'Will')] }
  ];
  // Older winning claims, so the FAAB habits card has something to say.
  [['Will', 'Demario Douglas', 12, 15.4], ['Will', 'Cole Kmet', 4, 22.2], ['Gabe', 'Hunter Henry', 31, 16.1], ['Gabe', 'Wil Lutz', 1, 23.3],
   ['Gabe', 'Jalen McMillan', 27, 27.5], ['Sam', 'Jaleel McLaughlin', 6, 15.8], ['Sam', 'Cameron Dicker', 0, 21.6], ['Chris', 'Rashid Shaheed', 9, 28.2],
   ['Patrick', "Wan'Dale Robinson", 45, 17.4]].forEach(function (c, i) {
    window.TRADE_LAB_SAMPLE.transactions.push({ key: 'f' + i, type: 'move', at: now - c[3] * day, faab: String(c[2]),
      teams: [{ team_key: T[c[0]], manager: c[0] }], players: [mv(c[1], 'add', 'waivers', 'team', c[0])] });
  });
  window.TRADE_LAB_SAMPLE.transactions.sort(function (a, b) { return b.at - a.at; });
  // Fantasy Leaders (this week so far): every sample player, best first, with owner or FA.
  var ownerOf = {};
  names.forEach(function (n) { R[n].forEach(function (r) { ownerOf[r[1]] = n; }); });
  var lpos = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };
  names.map(function (n) { return R[n]; }).concat([FA]).forEach(function (list) {
    list.forEach(function (r) {
      if (!r[4] || !lpos[r[2]]) return;
      var lp = points(r[1], cur, 3), lc = line(r[2], lp, r[0] + 4);
      if (r[2] === 'K') lc[2] = null;  // Yahoo's live box score has no long kick
      lpos[r[2]].push([r[1], r[3], lp, ownerOf[r[1]] || null, lc]);
    });
  });
  Object.keys(lpos).forEach(function (k) { lpos[k].sort(function (a, b) { return b[2] - a[2]; }); });
  window.TRADE_LAB_SAMPLE.leaders = { season: cur, week: 4, updated: now - 1800, positions: lpos };
  // Past weeks' final leaders (week 1 left out: not published yet).
  window.TRADE_LAB_SAMPLE.leadersWeeks = {};
  [2, 3].forEach(function (wk) {
    var pp = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };
    names.map(function (n) { return R[n]; }).concat([FA]).forEach(function (list) {
      list.forEach(function (r) { if (pp[r[2]]) pp[r[2]].push([r[1], r[3], points(r[1], cur, wk - 1), ownerOf[r[1]] || null]); });
    });
    Object.keys(pp).forEach(function (k) { pp[k].sort(function (a, b) { return b[2] - a[2]; }); });
    window.TRADE_LAB_SAMPLE.leadersWeeks[wk] = { season: cur, week: wk, updated: now - (4 - wk) * 7 * 86400, positions: pp };
  });
  window.TRADE_LAB_SAMPLE.live = { season: cur, week: 4, updated: Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 20, 2).getTime() / 1000), teams: liveTeams };
})();
