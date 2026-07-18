// Client-side port of aggregate.py + render_html._player_json.
//
// Reads the static ./data store (served under BASE_URL) and builds one row per
// (season, person): a player's goals/assists/points totalled across every competition they
// played that year (league + cups + Over-35). Ranking these rows surfaces the best individual
// seasons in BDSL history -- exactly what the old leaderboard.html did, but computed in the
// browser so the raw data store stays untouched and reusable for future features.
import Papa from 'papaparse';

// BDSL's official Points Leaders scoring (config.POINTS_PER_GOAL / POINTS_PER_ASSIST).
export const POINTS_PER_GOAL = 2;
export const POINTS_PER_ASSIST = 1;

const COMP_TYPES = ['league', 'cup', 'over35'];

// 2020 had no BDSL season (COVID), so it shouldn't break a streak: 2019 + 2021 reads as one range.
const SKIPPED_YEARS = new Set([2020]);

// Collapses a set of season ids (e.g. "2021-summer") into compact year ranges,
// e.g. {2017,2018,2021,2022,2023,2024} -> "2017-2018, 2021-2024".
function formatSeasonRanges(sids) {
  const years = [...new Set([...sids].map((sid) => parseInt(sid, 10)))].sort((a, b) => a - b);
  const ranges = [];
  for (const y of years) {
    const last = ranges[ranges.length - 1];
    const gapYears = last ? [...Array(y - last[1] - 1)].map((_, i) => last[1] + 1 + i) : null;
    if (last && gapYears.every((gy) => SKIPPED_YEARS.has(gy))) last[1] = y;
    else ranges.push([y, y]);
  }
  return ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ');
}

// Vite rewrites BASE_URL to '/bdsl-stats/' in prod and '/' in dev; data lives beside the app.
const DATA_BASE = `${import.meta.env.BASE_URL}data/`;

async function fetchJson(path) {
  const res = await fetch(`${DATA_BASE}${path}`);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

function fetchCsv(path) {
  return new Promise((resolve, reject) => {
    Papa.parse(`${DATA_BASE}${path}`, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (r) => resolve(r.data),
      error: reject,
    });
  });
}

const num = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};

// Pythagorean expectation (goals-for/against -> expected points), the standard "luck" metric
// borrowed from Bill James baseball analysis and widely adapted for soccer with exponent ~1.3
// (see Football Reference / clubelo write-ups). Expected win% * 3 points-per-win * games played
// approximates the points a team's goal record "deserves", ignoring draws' effect on the pool of
// available points -- a standard simplification for this kind of luck analysis.
const PYTHAGOREAN_EXPONENT = 1.3;
function pythagoreanExpectedPoints(gf, ga, gp) {
  if (gp <= 0) return 0;
  const gfE = Math.pow(gf, PYTHAGOREAN_EXPONENT);
  const gaE = Math.pow(ga, PYTHAGOREAN_EXPONENT);
  const winPct = gfE + gaE > 0 ? gfE / (gfE + gaE) : 0.5;
  return winPct * 3 * gp;
}

// Aggregate one season's tidy stats rows into player-season objects (aggregate.build_from_store
// + Player.add_row/finalize), then shape each like render_html._player_json.
function aggregateSeason(rows, sid, seasonLabel, live) {
  const players = new Map(); // person_key -> accumulator

  for (const row of rows) {
    const pk = row.person_key;
    if (!pk) continue;
    let p = players.get(pk);
    if (!p) {
      p = {
        pk,
        g: 0, a: 0, gp: 0,
        byType: { league: [0, 0], cup: [0, 0], over35: [0, 0] },
        comps: [],
        nameCounts: new Map(),
      };
      players.set(pk, p);
    }
    const g = num(row.g), a = num(row.a), gp = num(row.gp);
    p.g += g; p.a += a; p.gp += gp;
    const bt = p.byType[row.comp_type];
    if (bt) { bt[0] += g; bt[1] += a; }
    p.comps.push({ c: row.competition, t: row.team_name, club: (row.team_id || '').split('-')[0], type: row.comp_type, g, a, gp });
    if (row.name) p.nameCounts.set(row.name, (p.nameCounts.get(row.name) || 0) + 1);
  }

  const out = [];
  for (const p of players.values()) {
    // display_name = most frequently seen spelling (Player.finalize)
    let name = '(unknown)', best = -1;
    for (const [n, c] of p.nameCounts) if (c > best) { best = c; name = n; }

    const teams = [];
    const seen = new Set();
    for (const c of p.comps) {
      if (c.t && !seen.has(c.t)) { seen.add(c.t); teams.push(c.t); }
    }

    const comps = p.comps
      .slice()
      .sort((x, y) => (-(x.g + x.a) - -(y.g + y.a)) || x.c.localeCompare(y.c));

    out.push({
      pk: p.pk,
      name,
      sid,
      season: seasonLabel,
      live: live ? 1 : 0,
      teams,
      g: p.g,
      a: p.a,
      pts: POINTS_PER_GOAL * p.g + POINTS_PER_ASSIST * p.a,
      gp: p.gp,
      lg: p.byType.league,
      cup: p.byType.cup,
      o35: p.byType.over35,
      comps,
    });
  }
  return out;
}

// The live/in-progress season is the one not yet marked final in seasons.json.
const isLive = (meta) => meta && meta.final !== true;

// stats.csv is an append-only daily time series of *cumulative* season totals (store.py:22).
// Only the latest snapshot is "the current table"; summing every snapshot double-counts the
// live season. Mirror store.load_snapshot: keep only rows from the max snapshot_date.
// The production build already slims each stats.csv to its latest snapshot (see vite.config.js's
// slimStatsSnapshots plugin), so in prod this is a no-op; it still matters for `vite dev`, which
// serves the full append-only source store straight through the public/data symlink.
function latestSnapshotRows(rows) {
  let latest = '';
  for (const r of rows) if (r.snapshot_date > latest) latest = r.snapshot_date;
  return latest ? rows.filter((r) => r.snapshot_date === latest) : rows;
}

async function buildBoard() {
  const [seasons, playersRegistry] = await Promise.all([
    fetchJson('seasons.json'),
    fetchJson('players.json'),
  ]);
  const ids = Object.keys(seasons).sort(); // oldest -> newest

  const perSeason = await Promise.all(
    ids.map(async (sid) => {
      const [rows, teams, comps, games, gameStats, gameReports] = await Promise.all([
        fetchCsv(`${sid}/stats.csv`),
        fetchJson(`${sid}/teams.json`).catch(() => []), // some seasons may lack standings
        fetchJson(`${sid}/competitions.json`).catch(() => []), // carries each comp's champion
        fetchCsv(`${sid}/games.csv`).catch(() => []),
        fetchCsv(`${sid}/game_stats.csv`).catch(() => []), // per-game backfill; some seasons still missing
        fetchCsv(`${sid}/game_reports.csv`).catch(() => []), // per-game backfill; some seasons still missing
      ]);
      const label = seasons[sid]?.label || sid;
      return { sid, label, live: isLive(seasons[sid]), rows: latestSnapshotRows(rows), teams, comps, games, gameStats, gameReports };
    })
  );

  const allPlayers = [];
  const allTeamStandings = []; // flat teams.json rows tagged with season context
  const allGames = []; // flat games.csv rows (played only) tagged with season context
  const allFixtures = []; // flat games.csv rows (every status, incl. scheduled) tagged with season context
  const allGameStats = []; // flat game_stats.csv rows (one per player per game) tagged with season context
  const gameReportsByKey = new Map(); // `${sid}||${game_key}` -> game_reports.csv row (referees + capture status)
  // clubId -> [{ sid, label, competition, via }] : the authoritative source of titles, spanning
  // league, Over-35 AND cups (cups have no teams.json, so their titles only live here). A champion
  // is the CHMP playoff winner, which can differ from the regular-season table-topper (position 1).
  const championsByClub = new Map();
  // Flat, one entry per competition per season (decided AND undecided), tagged with season
  // context. Unlike championsByClub (titles only), this feeds the Champions grid, which also
  // needs to render blank/undecided cells for competitions that haven't crowned a winner yet.
  const allCompetitions = [];
  let dataAsOf = '';
  for (const s of perSeason) {
    allPlayers.push(...aggregateSeason(s.rows, s.sid, s.label, s.live));
    for (const t of s.teams) {
      allTeamStandings.push({ ...t, sid: s.sid, seasonLabel: s.label, live: s.live });
    }
    for (const g of s.games) {
      if (g.status === 'played') allGames.push({ ...g, sid: s.sid, seasonLabel: s.label });
      allFixtures.push({ ...g, sid: s.sid, seasonLabel: s.label });
    }
    for (const gs of s.gameStats) {
      allGameStats.push({ ...gs, sid: s.sid, seasonLabel: s.label });
    }
    for (const gr of s.gameReports) {
      if (gr.game_key) gameReportsByKey.set(`${s.sid}||${gr.game_key}`, gr);
    }
    for (const c of s.comps) {
      allCompetitions.push({
        sid: s.sid, label: s.label, live: s.live,
        competition: c.competition, comp_type: c.comp_type,
        clubId: c.champion_club_id || '', clubName: c.champion_name || '', via: c.champion_via || '',
      });
      const champ = c.champion_club_id;
      if (!champ) continue; // undecided (in progress / untagged final / PK) — not a title
      let list = championsByClub.get(champ);
      if (!list) { list = []; championsByClub.set(champ, list); }
      list.push({ sid: s.sid, label: s.label, competition: c.competition, via: c.champion_via || '' });
    }
    if (s.live && s.rows.length) {
      // freshest fetched_at of the live season's latest snapshot
      const latest = s.rows.reduce((mx, r) => (r.snapshot_date > mx ? r.snapshot_date : mx), '');
      const stamp = s.rows.find((r) => r.snapshot_date === latest)?.fetched_at || '';
      dataAsOf = stamp;
    }
  }

  // only player-seasons where someone actually took the field (render_html.render)
  const active = allPlayers.filter((p) => p.gp > 0 || p.pts > 0);

  // Seasons with real individual scoring. Pre-2014 seasons carry standings/champions/team
  // goals (and even games-played rosters), but goal/assist attribution is negligible or
  // absent, so their "top scorers" sections would be empty or misleadingly sparse. Detect
  // this self-calibrating: compare goals credited to players against the true team-goal total
  // (sum of GF in the standings). When players account for only a tiny fraction of the goals
  // actually scored, scoring wasn't tracked -- the season is "team data only" and the UI flags
  // it. Observed ratios: <=0.08 for 2008-2013, >=0.45 from 2014 on (see the SCORING_COVERAGE
  // gap), so the threshold sits comfortably between the two eras.
  const SCORING_COVERAGE = 0.2;
  const playerGoalsBySid = new Map();
  for (const p of allPlayers) playerGoalsBySid.set(p.sid, (playerGoalsBySid.get(p.sid) || 0) + p.g);
  const teamGoalsBySid = new Map();
  for (const t of allTeamStandings) teamGoalsBySid.set(t.sid, (teamGoalsBySid.get(t.sid) || 0) + num(t.gf));
  const scoringSeasons = new Set();
  for (const [sid, teamGoals] of teamGoalsBySid) {
    if (teamGoals > 0 && (playerGoalsBySid.get(sid) || 0) / teamGoals >= SCORING_COVERAGE) {
      scoringSeasons.add(sid);
    }
  }

  const seasonLabels = ids
    .slice()
    .reverse()
    .map((sid) => seasons[sid]?.label || sid); // newest-first, for the filter dropdown

  const bracketsBySeason = buildAllBrackets(allFixtures, allCompetitions);

  return { players: active, allPlayers, allTeamStandings, allGames, allFixtures, allGameStats, gameReportsByKey, championsByClub, allCompetitions, bracketsBySeason, scoringSeasons, playersRegistry, seasonLabels, dataAsOf };
}

// Fetch + aggregate once, then share across route navigations (board <-> profile).
let _boardPromise = null;
export function loadBoard() {
  if (!_boardPromise) _boardPromise = buildBoard().catch((e) => { _boardPromise = null; throw e; });
  return _boardPromise;
}

// Whole years between an "MM/DD/YYYY" birthdate and today; null if unparseable/missing.
export function ageFromBirthdate(birthdate) {
  if (!birthdate) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(birthdate.trim());
  if (!m) return null;
  const [, mm, dd, yyyy] = m.map(Number);
  const now = new Date();
  let age = now.getFullYear() - yyyy;
  const hadBirthday = now.getMonth() + 1 > mm || (now.getMonth() + 1 === mm && now.getDate() >= dd);
  if (!hadBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

// Whole years between an "MM/DD/YYYY" birthdate and July 1 of a season's year (mid-summer
// reference, since seasons run roughly spring-to-fall); null if unparseable/missing. Mirrors
// ageFromBirthdate's parse but against a season date instead of today.
export function ageAtSeason(birthdate, sid) {
  if (!birthdate) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(birthdate.trim());
  if (!m) return null;
  const [, mm, dd, yyyy] = m.map(Number);
  const yearMatch = /^(\d{4})/.exec(sid || '');
  if (!yearMatch) return null;
  const seasonYear = Number(yearMatch[1]);
  let age = seasonYear - yyyy;
  // Reference date is July 1 (month 7, day 1).
  const hadBirthday = 7 > mm || (7 === mm && 1 >= dd);
  if (!hadBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

// Build one player's profile from the aggregated player-season objects (all comps they were
// rostered for, incl. games-played-only rows). Returns null if the person_key isn't found.
// Best display name: prefer the registry (authoritative) — nickname, else first + last —
// and fall back to the CSV display name when the registry has no usable value.
function displayName(reg, fallback) {
  if (reg) return reg.nickname || [reg.first, reg.last].filter(Boolean).join(' ') || fallback;
  return fallback;
}

export function buildProfile(allPlayers, playersRegistry, personKey) {
  const rows = allPlayers.filter((p) => p.pk === personKey);
  if (!rows.length) return null;

  // Identity: prefer the registry (authoritative), fall back to the CSV display name.
  const reg = playersRegistry?.[personKey];
  const name = displayName(reg, rows[0].name) || '(unknown)';
  const age = ageFromBirthdate(reg?.birthdate);

  // Newest season first (sid like "2026-summer" sorts correctly as a string).
  rows.sort((a, b) => b.sid.localeCompare(a.sid));

  const career = { g: 0, a: 0, pts: 0, gp: 0, seasons: rows.length, comps: 0 };
  const seasons = rows.map((r) => {
    career.g += r.g; career.a += r.a; career.pts += r.pts; career.gp += r.gp;
    career.comps += r.comps.length;
    return {
      sid: r.sid,
      label: r.season,
      live: !!r.live,
      agg: { g: r.g, a: r.a, pts: r.pts, gp: r.gp },
      comps: r.comps,
    };
  });

  return { pk: personKey, name, age, career, seasons };
}

// One row per person: their all-time totals summed across every season, sorted by last name.
export function buildAllPlayers(allPlayers, playersRegistry) {
  const byPk = new Map();
  for (const p of allPlayers) {
    let acc = byPk.get(p.pk);
    if (!acc) { acc = { pk: p.pk, csvName: p.name, g: 0, a: 0, pts: 0, gp: 0, seasons: 0 }; byPk.set(p.pk, acc); }
    acc.g += p.g; acc.a += p.a; acc.pts += p.pts; acc.gp += p.gp; acc.seasons += 1;
  }

  const out = [];
  for (const acc of byPk.values()) {
    const reg = playersRegistry?.[acc.pk];
    out.push({
      pk: acc.pk,
      name: displayName(reg, acc.csvName) || '(unknown)',
      last: (reg?.last || '').trim(),
      g: acc.g, a: acc.a, pts: acc.pts, gp: acc.gp, seasons: acc.seasons,
    });
  }
  out.sort((a, b) => a.last.localeCompare(b.last) || a.name.localeCompare(b.name));
  return out;
}

// ---- clubs (teams) ----
// A "club" is identified by club_id and may field several sides in one year (league divisions +
// an Over-35 side, all sharing the club_id). Standings live in teams.json (league + over35 only;
// cups have no table). Roster/scoring comes from stats.csv via allPlayers' per-comp club tags.

// Sum a club's standings rows into all-time totals. Name = the club's newest-season spelling,
// since a handful of clubs were renamed over the years. Titles come from the champions index
// (championsByClub), not from these standings rows -- a table-topper isn't necessarily a champion.
function aggregateClub(rows) {
  const t = { gp: 0, w: 0, l: 0, d: 0, gf: 0, ga: 0, pts: 0, titles: 0 };
  const sids = new Set();
  let newestSid = '', name = '';
  for (const r of rows) {
    t.gp += num(r.gp); t.w += num(r.w); t.l += num(r.l); t.d += num(r.d);
    t.gf += num(r.gf); t.ga += num(r.ga); t.pts += num(r.pts);
    sids.add(r.sid);
    if (r.sid >= newestSid) { newestSid = r.sid; name = r.name; }
  }
  t.gd = t.gf - t.ga;
  return { name: name || '(unknown)', totals: t, seasons: sids.size };
}

// One row per club: all-time standings totals, sorted alphabetically by name (like buildAllPlayers).
// Titles = number of competitions the club won (championsByClub), across league, Over-35 and cups.
export function buildAllClubs(allTeamStandings, championsByClub) {
  const byClub = new Map();
  for (const r of allTeamStandings) {
    const id = r.club_id;
    if (!id) continue;
    let g = byClub.get(id);
    if (!g) { g = []; byClub.set(id, g); }
    g.push(r);
  }

  const out = [];
  for (const [clubId, rows] of byClub) {
    const { name, totals, seasons } = aggregateClub(rows);
    totals.titles = championsByClub?.get(clubId)?.length || 0;
    out.push({ clubId, name, seasons, ...totals });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// Chronological (oldest-first) league-division-only timeline for one club's standings rows.
// Over-35 and cups have no table/division, so only comp_type "league" rows count. `order` comes
// from canonicalCompetition (1 = Premier/top, rising = lower divisions), so a promotion is a
// decrease in order and a relegation is an increase -- used to color/plot movement on the Club
// page's division chart and to roll up promotion/relegation/streak summary stats.
function buildDivisionTimeline(standings) {
  const rows = standings
    .filter((r) => r.comp_type === 'league')
    .map((r) => {
      const canon = canonicalCompetition(r.competition, r.comp_type);
      return { sid: r.sid, label: r.seasonLabel, live: !!r.live, position: num(r.position),
        order: canon.order, division: canon.label };
    })
    .sort((a, b) => a.sid.localeCompare(b.sid));

  let promotions = 0, relegations = 0;
  let streak = 0, curDivision = null, longestStreak = 0, longestStreakDivision = '';
  for (let i = 0; i < rows.length; i++) {
    const prev = rows[i - 1];
    rows[i].move = prev ? Math.sign(prev.order - rows[i].order) : 0; // +1 promoted, -1 relegated
    if (prev) {
      if (rows[i].order < prev.order) promotions += 1;
      else if (rows[i].order > prev.order) relegations += 1;
    }
    if (rows[i].division === curDivision) streak += 1;
    else { curDivision = rows[i].division; streak = 1; }
    if (streak > longestStreak) { longestStreak = streak; longestStreakDivision = curDivision; }
  }
  const divisionsPlayed = new Set(rows.map((r) => r.division)).size;

  return { rows, promotions, relegations, longestStreak, longestStreakDivision, divisionsPlayed };
}

// Every played game (league, playoffs, cup and Over-35 alike) involving this club, win/loss/draw
// and goals for/against. Unlike aggregateClub's standings-derived totals -- which mirror the
// regular-season table only, since teams.json rows exclude playoff rounds (round_label set) and
// cups (no table at all) -- this walks the game log itself, so it's the true all-time record.
function aggregateClubGames(allGames, clubId) {
  const t = { gp: 0, w: 0, l: 0, d: 0, gf: 0, ga: 0 };
  for (const g of allGames || []) {
    let gf, ga;
    if (g.home_club_id === clubId) { gf = num(g.home_score); ga = num(g.away_score); }
    else if (g.away_club_id === clubId) { gf = num(g.away_score); ga = num(g.home_score); }
    else continue;
    t.gp += 1; t.gf += gf; t.ga += ga;
    if (gf > ga) t.w += 1; else if (gf < ga) t.l += 1; else t.d += 1;
  }
  t.gd = t.gf - t.ga;
  return t;
}

// Head-to-head: every played game between two specific clubs, across every season and
// competition. Record/GF/GA are reported from clubA's perspective. Games are sorted newest-first
// so "recent meetings" is a simple slice. Returns null if the two clubs have never met.
export function buildHeadToHead(allGames, clubAId, clubBId) {
  if (!clubAId || !clubBId || clubAId === clubBId) return null;
  const t = { w: 0, l: 0, d: 0, gf: 0, ga: 0 };
  let nameA = '', nameB = '', sidA = '', sidB = '';
  const games = [];
  for (const g of allGames || []) {
    let gfA, gaA, homeIsA;
    if (g.home_club_id === clubAId && g.away_club_id === clubBId) { gfA = num(g.home_score); gaA = num(g.away_score); homeIsA = true; }
    else if (g.away_club_id === clubAId && g.home_club_id === clubBId) { gfA = num(g.away_score); gaA = num(g.home_score); homeIsA = false; }
    else continue;
    if (g.sid >= sidA) { nameA = homeIsA ? g.home_name : g.away_name; sidA = g.sid; }
    if (g.sid >= sidB) { nameB = homeIsA ? g.away_name : g.home_name; sidB = g.sid; }
    t.gf += gfA; t.ga += gaA;
    if (gfA > gaA) t.w += 1; else if (gfA < gaA) t.l += 1; else t.d += 1;
    games.push({
      date: g.date, sid: g.sid, seasonLabel: g.seasonLabel, competition: g.competition,
      o35: g.comp_type === 'over35', home: g.home_name, away: g.away_name,
      hs: num(g.home_score), as: num(g.away_score), margin: Math.abs(gfA - gaA),
      winner: gfA > gaA ? 'A' : gfA < gaA ? 'B' : 'D',
    });
  }
  if (games.length === 0) return null;
  games.sort((x, y) => `${y.date}`.localeCompare(`${x.date}`) || y.sid.localeCompare(x.sid));
  t.gd = t.gf - t.ga;

  const biggestWinA = games.filter((g) => g.winner === 'A').sort((a, b) => b.margin - a.margin)[0] || null;
  const biggestWinB = games.filter((g) => g.winner === 'B').sort((a, b) => b.margin - a.margin)[0] || null;

  return {
    clubA: { clubId: clubAId, name: nameA || '(unknown)' },
    clubB: { clubId: clubBId, name: nameB || '(unknown)' },
    played: games.length, ...t, games, biggestWinA, biggestWinB,
  };
}

// Longest run of games (in date order) satisfying `ok`, keeping the games at the start/end of
// the best run so we can report which seasons the streak actually spans.
function longestRun(sortedGames, ok) {
  let best = null, curLen = 0, curStart = null;
  for (const g of sortedGames) {
    if (ok(g)) {
      if (curLen === 0) curStart = g;
      curLen += 1;
      if (!best || curLen > best.len) best = { len: curLen, start: curStart, end: g };
    } else {
      curLen = 0;
    }
  }
  return best;
}

// Longest win / unbeaten / winless / scoring streaks for a single club, across every game it's
// ever played -- league, playoffs, cups and Over-35 alike -- matching the "true all-time record"
// convention used by aggregateClubGames above (rather than the league+O35-only scope the
// league-wide Team Records page uses for its cross-club leaderboard).
function computeClubStreaks(allGames, clubId, liveSids) {
  const games = [];
  for (const g of allGames || []) {
    let gf, ga;
    if (g.home_club_id === clubId) { gf = num(g.home_score); ga = num(g.away_score); }
    else if (g.away_club_id === clubId) { gf = num(g.away_score); ga = num(g.home_score); }
    else continue;
    games.push({
      date: g.date, seasonLabel: g.seasonLabel, live: liveSids.has(g.sid),
      result: gf > ga ? 'W' : gf < ga ? 'L' : 'D', scored: gf > 0,
    });
  }
  if (!games.length) return null;
  const sorted = games.sort((a, b) => a.date.localeCompare(b.date));
  const mostRecent = sorted[sorted.length - 1];
  // "In progress" only means the streak is still active right now -- its last game IS the club's
  // most recent game overall -- not merely that it falls within a season that isn't finished yet.
  const toRecord = (run) => run && {
    len: run.len, startLabel: run.start.seasonLabel, endLabel: run.end.seasonLabel,
    live: run.end === mostRecent && run.end.live,
  };
  return {
    win: toRecord(longestRun(sorted, (g) => g.result === 'W')),
    unbeaten: toRecord(longestRun(sorted, (g) => g.result !== 'L')),
    winless: toRecord(longestRun(sorted, (g) => g.result !== 'W')),
    scoring: toRecord(longestRun(sorted, (g) => g.scored)),
  };
}

// Full profile for one club: all-time totals, per-season competition history (from teams.json,
// newest first), and the roster of every player who appeared for the club (from stats.csv, rolled
// up per person over only that club's competitions). Returns null if the club_id isn't found.
export function buildClubProfile(allTeamStandings, allPlayers, playersRegistry, clubId, championsByClub, allGames, bracketsBySeason) {
  const standings = allTeamStandings.filter((r) => r.club_id === clubId);
  if (!standings.length) return null;

  const playoffs = buildClubPlayoffs(bracketsBySeason, clubId);

  const { name } = aggregateClub(standings);
  // Header totals cover every game the club has ever played -- league, playoffs and cups --
  // rather than just the regular-season standings.
  const totals = aggregateClubGames(allGames, clubId);
  const divisionTimeline = buildDivisionTimeline(standings);
  const liveSids = new Set(allTeamStandings.filter((r) => r.live).map((r) => r.sid));
  const streaks = computeClubStreaks(allGames, clubId, liveSids);

  // Titles the club won (league + Over-35 + cups), and a lookup to flag each one in the tables.
  const wins = championsByClub?.get(clubId) || [];
  totals.titles = wins.length;
  const titleKeys = new Set(wins.map((w) => `${w.sid}||${w.competition}`));

  // Group standings by season, newest sid first; each season lists its competitions.
  const bySeason = new Map();
  for (const r of standings) {
    let s = bySeason.get(r.sid);
    if (!s) { s = { sid: r.sid, label: r.seasonLabel, live: !!r.live, comps: [] }; bySeason.set(r.sid, s); }
    s.comps.push({ c: r.competition, position: num(r.position), w: num(r.w), l: num(r.l),
      d: num(r.d), gf: num(r.gf), ga: num(r.ga), pts: num(r.pts),
      title: titleKeys.has(`${r.sid}||${r.competition}`) });
  }
  const seasons = [...bySeason.values()].sort((a, b) => b.sid.localeCompare(a.sid));
  for (const s of seasons) s.comps.sort((a, b) => a.position - b.position || a.c.localeCompare(b.c));

  // Roster: for each player-season, sum only the comps that were played for this club.
  // Cups have no standings table (teams.json is league + over35 only), so cup history is
  // aggregated here from the roster rows: per season + cup, the club's combined goals/assists,
  // squad size, and games (max player GP ≈ matches the club played that far).
  const byPk = new Map();
  const cupSeasons = new Map(); // sid -> { label, live, byCup: Map(cup -> {g,a,pks:Set,gp}) }
  for (const p of allPlayers) {
    const mine = p.comps.filter((c) => c.club === clubId);
    if (!mine.length) continue;
    let acc = byPk.get(p.pk);
    if (!acc) { acc = { pk: p.pk, csvName: p.name, g: 0, a: 0, gp: 0, sids: new Set() }; byPk.set(p.pk, acc); }
    for (const c of mine) {
      acc.g += c.g; acc.a += c.a; acc.gp += c.gp;
      if (c.type === 'cup') {
        let cs = cupSeasons.get(p.sid);
        if (!cs) { cs = { sid: p.sid, label: p.season, live: !!p.live, byCup: new Map() }; cupSeasons.set(p.sid, cs); }
        let cup = cs.byCup.get(c.c);
        if (!cup) { cup = { c: c.c, g: 0, a: 0, pks: new Set(), gp: 0 }; cs.byCup.set(c.c, cup); }
        cup.g += c.g; cup.a += c.a; cup.pks.add(p.pk);
        if (c.gp > cup.gp) cup.gp = c.gp;
      }
    }
    acc.sids.add(p.sid);
  }

  const cups = [...cupSeasons.values()]
    .sort((a, b) => b.sid.localeCompare(a.sid))
    .map((cs) => ({
      sid: cs.sid, label: cs.label, live: cs.live,
      entries: [...cs.byCup.values()]
        .map((cup) => ({ c: cup.c, g: cup.g, a: cup.a, players: cup.pks.size, gp: cup.gp,
          title: titleKeys.has(`${cs.sid}||${cup.c}`) }))
        .sort((a, b) => a.c.localeCompare(b.c)),
    }));
  const roster = [];
  for (const acc of byPk.values()) {
    const reg = playersRegistry?.[acc.pk];
    roster.push({
      pk: acc.pk,
      name: displayName(reg, acc.csvName) || '(unknown)',
      g: acc.g, a: acc.a,
      pts: POINTS_PER_GOAL * acc.g + POINTS_PER_ASSIST * acc.a,
      gp: acc.gp, seasons: acc.sids.size, seasonsPlayed: formatSeasonRanges(acc.sids),
    });
  }

  // All-time opponents: head-to-head record against every club this club has played (played games
  // only, across all competitions/seasons). Opponent name = the newest-season spelling seen for
  // that club. Last meeting tracks the most recent game by date (falling back to sid) so it's
  // correct even within a season with games entered out of date order.
  const byOpp = new Map();
  for (const g of allGames || []) {
    const gs = num(g.home_score), as = num(g.away_score);
    let oppId, oppName, gf, ga;
    if (g.home_club_id === clubId) { oppId = g.away_club_id; oppName = g.away_name; gf = gs; ga = as; }
    else if (g.away_club_id === clubId) { oppId = g.home_club_id; oppName = g.home_name; gf = as; ga = gs; }
    else continue;
    if (!oppId || oppId === clubId) continue;
    let acc = byOpp.get(oppId);
    if (!acc) {
      acc = { clubId: oppId, name: oppName, sid: g.sid, played: 0, w: 0, l: 0, d: 0, gf: 0, ga: 0,
        lastMeeting: null };
      byOpp.set(oppId, acc);
    }
    if (g.sid >= acc.sid) { acc.name = oppName; acc.sid = g.sid; }
    acc.played += 1; acc.gf += gf; acc.ga += ga;
    if (gf > ga) acc.w += 1; else if (gf < ga) acc.l += 1; else acc.d += 1;
    const lm = acc.lastMeeting;
    if (!lm || `${g.date}` >= `${lm.date}` || (g.date === lm.date && g.sid >= lm.sid)) {
      acc.lastMeeting = { date: g.date, sid: g.sid, seasonLabel: g.seasonLabel, gf, ga,
        result: gf > ga ? 'W' : gf < ga ? 'L' : 'D' };
    }
  }
  const allOpponents = [...byOpp.values()]
    .sort((a, b) => b.played - a.played || (b.gf - b.ga) - (a.gf - a.ga) || a.name.localeCompare(b.name));
  const topOpponents = allOpponents.slice(0, 5);

  return { clubId, name, totals, seasons, cups, roster, topOpponents, allOpponents, divisionTimeline, streaks, playoffs };
}

// ---- team records ----
// League + Over-35 only (teams.json never carries cup rows). Season-total records (most/fewest
// GF/GA, goal differential, points, perfect/winless seasons) only consider COMPLETED seasons --
// the in-progress season's partial totals aren't a fair comparison against a full schedule.
// Game-level records (biggest win, highest scoring game, streaks) use every played game, since
// each individual result is already final even while the season around it is still in progress.

const RANK_N = 10;

// Sanity window for any birthdate-derived age (see ageAtSeason) -- suppresses clearly-bad
// birthdates rather than dropping the player entirely.
const AGE_MIN = 14, AGE_MAX = 60;
// Age-curve buckets need enough distinct players to be a meaningful average, not a hardcoded
// display range -- this lets the curve's x-axis self-clip to wherever the data actually supports it.
const AGE_CURVE_MIN_PLAYERS = 5;

function rankedBy(list, key, dir) {
  return list
    .slice()
    .sort((a, b) => dir * (a[key] - b[key]) || b.gp - a.gp || a.name.localeCompare(b.name))
    .slice(0, RANK_N);
}

export function buildTeamRecords(allTeamStandings, allGames, bracketsBySeason) {
  const liveSids = new Set(allTeamStandings.filter((r) => r.live).map((r) => r.sid));

  const seasons = allTeamStandings
    .filter((r) => !r.live)
    .map((r) => ({
      clubId: r.club_id,
      name: r.name,
      sid: r.sid,
      seasonLabel: r.seasonLabel,
      competition: r.competition,
      o35: r.comp_type === 'over35',
      gp: num(r.gp), w: num(r.w), l: num(r.l), d: num(r.d),
      gf: num(r.gf), ga: num(r.ga), gd: num(r.gf) - num(r.ga), pts: num(r.pts),
    }))
    .filter((r) => r.gp > 0)
    .map((r) => {
      const xpts = pythagoreanExpectedPoints(r.gf, r.ga, r.gp);
      return { ...r, xpts, luck: r.pts - xpts };
    });

  const mostGF = rankedBy(seasons, 'gf', -1);
  const fewestGF = rankedBy(seasons, 'gf', 1);
  const mostGA = rankedBy(seasons, 'ga', -1);
  const fewestGA = rankedBy(seasons, 'ga', 1);
  const bestGD = rankedBy(seasons, 'gd', -1);
  const worstGD = rankedBy(seasons, 'gd', 1);
  const mostPts = rankedBy(seasons, 'pts', -1);
  const luckiest = rankedBy(seasons, 'luck', -1);
  const unluckiest = rankedBy(seasons, 'luck', 1);

  const perfect = seasons
    .filter((s) => s.l === 0)
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || a.name.localeCompare(b.name));
  const winless = seasons
    .filter((s) => s.w === 0)
    .sort((a, b) => a.pts - b.pts || a.gd - b.gd || a.name.localeCompare(b.name));

  // ---- game-level records ----
  // Some seasons' games.csv lists the same match twice under two competition labels (e.g. a
  // division renamed mid-scrape) sharing one game_key -- dedupe so streaks/margins aren't doubled.
  const seenGameKeys = new Set();
  const games = (allGames || []).filter((g) => {
    if (g.comp_type !== 'league' && g.comp_type !== 'over35') return false;
    const key = `${g.sid}||${g.game_key}`;
    if (seenGameKeys.has(key)) return false;
    seenGameKeys.add(key);
    return true;
  });
  const gameRows = games.map((g) => {
    const hs = num(g.home_score), as = num(g.away_score);
    return {
      sid: g.sid, seasonLabel: g.seasonLabel, competition: g.competition,
      o35: g.comp_type === 'over35', live: liveSids.has(g.sid), date: g.date,
      home: g.home_name, away: g.away_name, hs, as,
      margin: Math.abs(hs - as), total: hs + as,
    };
  });
  const biggestWins = gameRows
    .filter((g) => g.margin > 0)
    .sort((a, b) => b.margin - a.margin || b.total - a.total)
    .slice(0, RANK_N);
  const highestScoring = gameRows
    .slice()
    .sort((a, b) => b.total - a.total || b.margin - a.margin)
    .slice(0, RANK_N);

  // ---- clean sheets (shutouts) ----
  // Season-total: per club-season, count of games where the opponent was held scoreless.
  const csBySeasonKey = new Map(); // `${clubId}||${sid}` -> count
  for (const g of games) {
    const hs = num(g.home_score), as = num(g.away_score);
    if (as === 0 && g.home_club_id) {
      const key = `${g.home_club_id}||${g.sid}`;
      csBySeasonKey.set(key, (csBySeasonKey.get(key) || 0) + 1);
    }
    if (hs === 0 && g.away_club_id) {
      const key = `${g.away_club_id}||${g.sid}`;
      csBySeasonKey.set(key, (csBySeasonKey.get(key) || 0) + 1);
    }
  }
  const mostCleanSheets = seasons
    .map((s) => ({ ...s, cs: csBySeasonKey.get(`${s.clubId}||${s.sid}`) || 0 }))
    .sort((a, b) => b.cs - a.cs || b.pts - a.pts || a.name.localeCompare(b.name))
    .slice(0, RANK_N);

  // ---- career streaks (win / unbeaten), spanning every season ----
  // Grouped by club+competition-type only -- NOT by season -- so a streak can run straight through
  // a year boundary (or a promotion/relegation). League and O35 stay separate tracks since they're
  // different competitions for the same club.
  const byTeam = new Map();
  for (const g of games) {
    const hs = num(g.home_score), as = num(g.away_score);
    const sides = [
      { clubId: g.home_club_id, name: g.home_name, gf: hs, ga: as },
      { clubId: g.away_club_id, name: g.away_name, gf: as, ga: hs },
    ];
    for (const side of sides) {
      if (!side.clubId) continue;
      const key = `${side.clubId}||${g.comp_type}`;
      let acc = byTeam.get(key);
      if (!acc) {
        acc = { clubId: side.clubId, name: side.name, o35: g.comp_type === 'over35', lastSid: '', games: [], cs: 0 };
        byTeam.set(key, acc);
      }
      if (g.sid >= acc.lastSid) { acc.name = side.name; acc.lastSid = g.sid; }
      if (side.ga === 0) acc.cs++;
      acc.games.push({
        date: g.date, sid: g.sid, seasonLabel: g.seasonLabel, live: liveSids.has(g.sid),
        result: side.gf > side.ga ? 'W' : side.gf < side.ga ? 'L' : 'D',
      });
    }
  }
  const winStreaks = [];
  const unbeatenStreaks = [];
  for (const acc of byTeam.values()) {
    const sorted = acc.games.slice().sort((a, b) => a.date.localeCompare(b.date));
    const mostRecent = sorted[sorted.length - 1];
    const win = longestRun(sorted, (g) => g.result === 'W');
    const unbeaten = longestRun(sorted, (g) => g.result !== 'L');
    // "In progress" only means the streak is still active right now -- i.e. its last game IS the
    // team's most recent game overall (nothing since has broken it), not merely that its last game
    // happened to fall in a season that isn't finished yet (a later loss in that same season could
    // have already ended the streak).
    if (win) {
      winStreaks.push({
        clubId: acc.clubId, name: acc.name, o35: acc.o35, len: win.len,
        startLabel: win.start.seasonLabel, endLabel: win.end.seasonLabel,
        live: win.end === mostRecent && win.end.live,
      });
    }
    if (unbeaten) {
      unbeatenStreaks.push({
        clubId: acc.clubId, name: acc.name, o35: acc.o35, len: unbeaten.len,
        startLabel: unbeaten.start.seasonLabel, endLabel: unbeaten.end.seasonLabel,
        live: unbeaten.end === mostRecent && unbeaten.end.live,
      });
    }
  }
  const longestWinStreak = winStreaks
    .sort((a, b) => b.len - a.len || a.name.localeCompare(b.name))
    .slice(0, RANK_N);
  const longestUnbeatenStreak = unbeatenStreaks
    .sort((a, b) => b.len - a.len || a.name.localeCompare(b.name))
    .slice(0, RANK_N);
  const careerCleanSheets = [...byTeam.values()]
    .map((acc) => ({ clubId: acc.clubId, name: acc.name, o35: acc.o35, cs: acc.cs, gp: acc.games.length }))
    .filter((r) => r.cs > 0)
    .sort((a, b) => b.cs - a.cs || a.name.localeCompare(b.name))
    .slice(0, RANK_N);

  // ---- playoff records (league + Over-35 brackets; cups excluded, matching this page's scope) ----
  // Per club, aggregate every bracket match across all seasons: appearances (distinct competitions
  // entered), win/loss/draw over played matches, and finals reached/won. A club is tagged O35 only
  // if it has never played a league playoff (a pure Over-35 side), so league clubs stay untagged.
  const PLAYOFF_MIN_GP = 5;
  const byPlayoffClub = new Map();
  for (const [sid, brackets] of bracketsBySeason || []) {
    for (const b of brackets) {
      if (b.group === 'cup') continue;
      for (const board of b.boards) for (const rd of board.rounds) for (const m of rd.matches) {
        if (!m.played) continue;
        for (const side of [
          { id: m.homeId, name: m.home },
          { id: m.awayId, name: m.away },
        ]) {
          if (!side.id) continue;
          let acc = byPlayoffClub.get(side.id);
          if (!acc) {
            acc = { clubId: side.id, name: side.name, lastSid: '', apps: new Set(), leagueApps: 0, o35Apps: 0, gp: 0, w: 0, l: 0, d: 0, finals: 0, finalsW: 0, finalsL: 0 };
            byPlayoffClub.set(side.id, acc);
          }
          if (sid >= acc.lastSid) { acc.name = side.name; acc.lastSid = sid; }
          acc.gp += 1;
          if (m.winnerId === side.id) acc.w += 1;
          else if (m.winnerId) acc.l += 1;
          else acc.d += 1;
          if (m.round === 'F') {
            acc.finals += 1;
            if (m.winnerId === side.id) acc.finalsW += 1;
            else if (m.winnerId) acc.finalsL += 1;
          }
          const appKey = `${side.id}||${sid}||${b.key}`;
          if (!acc.apps.has(appKey)) {
            acc.apps.add(appKey);
            if (b.group === 'over35') acc.o35Apps += 1; else acc.leagueApps += 1;
          }
        }
      }
    }
  }
  const playoffClubs = [...byPlayoffClub.values()].map((a) => ({
    clubId: a.clubId, name: a.name, o35: a.leagueApps === 0 && a.o35Apps > 0,
    appearances: a.apps.size, gp: a.gp, w: a.w, l: a.l, d: a.d,
    winPct: a.gp ? a.w / a.gp : 0, finals: a.finals, finalsW: a.finalsW, finalsL: a.finalsL,
  }));
  const mostPlayoffAppearances = playoffClubs
    .slice().sort((a, b) => b.appearances - a.appearances || b.gp - a.gp || a.name.localeCompare(b.name)).slice(0, RANK_N);
  const bestPlayoffWinPct = playoffClubs
    .filter((c) => c.gp >= PLAYOFF_MIN_GP)
    .sort((a, b) => b.winPct - a.winPct || b.gp - a.gp || a.name.localeCompare(b.name)).slice(0, RANK_N);
  const mostFinals = playoffClubs
    .filter((c) => c.finals > 0)
    .sort((a, b) => b.finals - a.finals || b.finalsW - a.finalsW || a.name.localeCompare(b.name)).slice(0, RANK_N);

  return {
    mostGF, fewestGF, mostGA, fewestGA, bestGD, worstGD, mostPts,
    perfect, winless, biggestWins, highestScoring, longestWinStreak, longestUnbeatenStreak,
    mostCleanSheets, careerCleanSheets, luckiest, unluckiest,
    mostPlayoffAppearances, bestPlayoffWinPct, mostFinals, playoffMinGp: PLAYOFF_MIN_GP,
  };
}

// ---- Elo ratings / power rankings ----
// A chronological Elo rating for every club, walking the complete, date-ordered game log since
// 2014. Elo is a self-correcting strength estimate: beat a stronger club and you gain more than
// beating a weaker one; the winner's gain is the loser's loss (zero-sum), so the league's average
// stays anchored at ELO_INITIAL. Only competitive first-team games count -- league (incl. playoffs)
// and cups. Over-35 is a separate, age-restricted squad sharing the club_id, so mixing it in would
// muddy a club's strength; it's excluded. Rating is neutral-venue (no home advantage) since most
// BDSL games are played at shared school fields rather than a real home ground.

export const ELO_INITIAL = 1500;
// K = how much a single result can move a rating. 32 is the classic chess value and a reasonable
// fit for a ~14-20 game season: responsive enough to track real form, damped enough not to swing
// wildly on one upset.
const ELO_K = 32;
// Between seasons, regress every rating this fraction of the way back to ELO_INITIAL. Amateur
// rec-league rosters turn over heavily year to year, so last season's strength is only a partial
// guide to this season's -- a soft reset keeps the model honest without throwing away all history.
const ELO_SEASON_REGRESSION = 0.25;

// Margin-of-victory multiplier (World Football Elo Ratings convention): a 3-0 win says more about
// the gap in strength than a 1-0 win, so bigger margins scale the rating change up -- with
// diminishing returns so a 7-0 rout isn't seven times a 1-0. Capped at ELO_MOV_CAP: in an amateur
// rec league, a lopsided scoreline against a weak lower-division opponent is often more about
// mismatch than raw quality, so beyond a ~5-goal margin extra goals stop adding rating weight.
const ELO_MOV_CAP = 2.0;
function eloMovMultiplier(margin) {
  if (margin <= 1) return 1;
  if (margin === 2) return 1.5;
  return Math.min(ELO_MOV_CAP, (11 + margin) / 8);
}

// Division weight on ELO_K: results in a higher division carry more rating impact than the same
// result in a lower one, since the level of competition is higher. LEAGUE_DIVISIONS.order runs
// 1 (Premier) through 6 (4th Division); each step down trims the K-factor by 10%, floored at 0.6x
// so even the bottom division still moves ratings meaningfully. Cups (order 20+) and unrecognized
// competitions weight like the middle of the pack (2nd Division) rather than falling off a cliff.
function eloDivisionWeight(order) {
  const o = order == null || order > LEAGUE_DIVISIONS.length ? 4 : order;
  return Math.max(0.6, 1 - (o - 1) * 0.1);
}

// Expected score for A against B on the standard 400-point logistic scale (0.5 = evenly matched,
// ->1 as A outrates B). A's actual score is 1 win / 0.5 draw / 0 loss.
function eloExpected(ra, rb) {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

// Walk every rated game in chronological order, updating both clubs' ratings after each result and
// recording the full rating timeline per club. Returns the current power rankings (clubs active in
// the latest season, ranked by live rating), the all-time peak-rating leaderboard ("strongest team
// ever"), and a per-club history for plotting a rating-over-time chart. `liveSids` (optional) flags
// which season ids belong to an in-progress season, purely for display.
export function buildElo(allGames, liveSids = new Set()) {
  // Dedupe games that appear twice under two competition labels sharing one game_key (see
  // buildTeamRecords), and drop Over-35. `date` + kickoff time + game_number give a stable
  // chronological order even for several games on the same day.
  const seen = new Set();
  const games = (allGames || [])
    .filter((g) => {
      if (g.comp_type === 'over35') return false;
      if (g.status && g.status !== 'played') return false;
      const key = `${g.sid}||${g.game_key}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) =>
      `${a.sid}`.localeCompare(`${b.sid}`) ||
      `${a.date}`.localeCompare(`${b.date}`) ||
      parseTimeMinutes(a.time) - parseTimeMinutes(b.time) ||
      num(a.game_number) - num(b.game_number)
    );
  if (!games.length) {
    return { currentSid: '', currentLabel: '', currentLive: false, powerRankings: [], peaks: [], historyByClub: new Map(), ratedGames: 0 };
  }

  const currentSid = games[games.length - 1].sid;
  const currentLabel = games.find((g) => g.sid === currentSid)?.seasonLabel || currentSid;

  const ratings = new Map(); // clubId -> current rating
  const clubs = new Map(); // clubId -> { name, nameSid, played, peak, peakSid, peakLabel, peakDate, peakPlayed }
  const historyByClub = new Map(); // clubId -> [{ sid, seasonLabel, date, rating, oppId, oppName, gf, ga, result }]
  let seasonStart = new Map(); // ratings snapshot at the start of currentSid (post-regression)
  let prevSid = '';

  const ratingOf = (id) => (ratings.has(id) ? ratings.get(id) : ELO_INITIAL);
  const clubOf = (id, name, sid) => {
    let c = clubs.get(id);
    if (!c) { c = { name, nameSid: sid, played: 0, peak: ELO_INITIAL, peakSid: '', peakLabel: '', peakDate: '', peakPlayed: 0 }; clubs.set(id, c); }
    if (sid >= c.nameSid) { c.name = name; c.nameSid = sid; } // newest-season spelling
    return c;
  };

  for (const g of games) {
    // Season boundary: regress everyone toward the mean before the new season's games.
    if (g.sid !== prevSid) {
      if (prevSid) {
        for (const [id, r] of ratings) ratings.set(id, ELO_INITIAL + (r - ELO_INITIAL) * (1 - ELO_SEASON_REGRESSION));
      }
      if (g.sid === currentSid) seasonStart = new Map(ratings); // clubs new this season default to ELO_INITIAL
      prevSid = g.sid;
    }

    const homeId = g.home_club_id, awayId = g.away_club_id;
    if (!homeId || !awayId) continue;
    const hs = num(g.home_score), as = num(g.away_score);

    const rh = ratingOf(homeId), ra = ratingOf(awayId);
    const sh = hs > as ? 1 : hs < as ? 0 : 0.5;
    const mult = eloMovMultiplier(Math.abs(hs - as));
    const divWeight = eloDivisionWeight(canonicalCompetition(g.competition, g.comp_type).order);
    const delta = ELO_K * divWeight * mult * (sh - eloExpected(rh, ra));
    const newH = rh + delta, newA = ra - delta;
    ratings.set(homeId, newH);
    ratings.set(awayId, newA);

    const ch = clubOf(homeId, g.home_name, g.sid);
    const ca = clubOf(awayId, g.away_name, g.sid);
    ch.played += 1; ca.played += 1;
    if (newH > ch.peak) { ch.peak = newH; ch.peakSid = g.sid; ch.peakLabel = g.seasonLabel; ch.peakDate = g.date; ch.peakPlayed = ch.played; }
    if (newA > ca.peak) { ca.peak = newA; ca.peakSid = g.sid; ca.peakLabel = g.seasonLabel; ca.peakDate = g.date; ca.peakPlayed = ca.played; }

    const pushH = historyByClub.get(homeId) || historyByClub.set(homeId, []).get(homeId);
    const pushA = historyByClub.get(awayId) || historyByClub.set(awayId, []).get(awayId);
    pushH.push({ sid: g.sid, seasonLabel: g.seasonLabel, date: g.date, rating: newH, oppId: awayId, oppName: g.away_name, gf: hs, ga: as, result: sh === 1 ? 'W' : sh === 0 ? 'L' : 'D', live: liveSids.has(g.sid) });
    pushA.push({ sid: g.sid, seasonLabel: g.seasonLabel, date: g.date, rating: newA, oppId: homeId, oppName: g.home_name, gf: as, ga: hs, result: sh === 0 ? 'W' : sh === 1 ? 'L' : 'D', live: liveSids.has(g.sid) });
  }

  // Current power rankings: clubs that appeared in the latest season, by live rating.
  const currentClubIds = new Set(games.filter((g) => g.sid === currentSid).flatMap((g) => [g.home_club_id, g.away_club_id]).filter(Boolean));
  const powerRankings = [...currentClubIds].map((id) => {
    const c = clubs.get(id);
    const hist = historyByClub.get(id) || [];
    const form = hist.slice(-5).map((h) => h.result);
    return {
      clubId: id, name: c?.name || '(unknown)', rating: ratingOf(id), played: c?.played || 0,
      peak: c?.peak || ELO_INITIAL, change: ratingOf(id) - (seasonStart.get(id) ?? ELO_INITIAL), form,
    };
  }).sort((a, b) => b.rating - a.rating || b.peak - a.peak || a.name.localeCompare(b.name));

  // Strongest team ever: the single highest rating each club has ever reached, ranked.
  const peaks = [...clubs.entries()]
    .map(([id, c]) => ({ clubId: id, name: c.name, peak: c.peak, atSid: c.peakSid, atLabel: c.peakLabel, atDate: c.peakDate, playedAt: c.peakPlayed }))
    .filter((p) => p.atSid) // reached above baseline at least once
    .sort((a, b) => b.peak - a.peak || a.name.localeCompare(b.name));

  return { currentSid, currentLabel, currentLive: liveSids.has(currentSid), powerRankings, peaks, historyByClub, ratedGames: games.length };
}

// One club's Elo rating timeline, chronological, for the rating-over-time chart on the Club page.
// Elo is relative, so the whole league has to be recomputed to know one club's number -- this just
// runs buildElo and pulls out the requested club's history. Returns [] if the club never played a
// rated (non-Over-35) game.
export function buildClubEloHistory(allGames, clubId, liveSids = new Set()) {
  return buildElo(allGames, liveSids).historyByClub.get(clubId) || [];
}

// ---- champions ----
// Competition names drift across seasons (typos, sponsor suffixes, Over-35 sometimes split into
// Premier/Championship, cups carrying "Bracket"/"BDSL" noise -- see DATA.md §5.3). The Champions
// grid needs one stable column per "real" competition across all history, so every display name
// is normalized here to a canonical {key, label, group, order} rather than matched verbatim.

export const LEAGUE_DIVISIONS = [
  { key: 'premier', label: 'Premier', order: 1 },
  { key: 'championship', label: 'Championship', order: 2 },
  { key: '1st', label: '1st Division', order: 3 },
  { key: '2nd', label: '2nd Division', order: 4 },
  { key: '3rd', label: '3rd Division', order: 5 },
  { key: '4th', label: '4th Division', order: 6 },
];

const CUP_DEFS = [
  { key: 'tehel', label: 'Tehel Cup', order: 20, match: /tehel/i },
  { key: 'wood', label: 'Wood Cup', order: 21, match: /wood/i },
  { key: 'matthews', label: 'Matthews Cup', order: 22, match: /matthews/i },
];

// "8:30 pm" -> 1290 (minutes since midnight), for sorting same-day games by kickoff time.
// Returns -1 (sorts first) if the time is missing/unparseable.
function parseTimeMinutes(t) {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec((t || '').trim());
  if (!m) return -1;
  let [, hh, mm, ap] = m;
  hh = parseInt(hh, 10) % 12;
  if (ap.toLowerCase() === 'pm') hh += 12;
  return hh * 60 + parseInt(mm, 10);
}

// Returns { key, label, group, order } for any competition's display name + comp_type.
// group: 'league' | 'over35' | 'cup'. order: sort index for grid columns (league, then
// over35, then cups). Classification always keys off comp_type, never the raw name (§5.3).
export function canonicalCompetition(name, comp_type) {
  const n = (name || '').trim();

  if (comp_type === 'over35') {
    // All Over-35 flavors (single "Over 35" or the later Premier/Championship split) collapse
    // into one grid column; the split-year sub-division shows up as a cell subLabel instead.
    return { key: 'over35', label: 'Over-35', group: 'over35', order: 10 };
  }

  if (comp_type === 'cup') {
    for (const def of CUP_DEFS) {
      if (def.match.test(n)) return { key: def.key, label: def.label, group: 'cup', order: def.order };
    }
    // Unknown cup: fall back to a cleaned version of its own name so nothing is silently dropped.
    const cleaned = n.replace(/\bBDSL\b/gi, '').replace(/\bBracket\b/gi, '').replace(/\bCup\b/gi, '').trim() || n;
    const key = `cup-${cleaned.toLowerCase().replace(/\s+/g, '-')}`;
    return { key, label: `${cleaned} Cup`.trim(), group: 'cup', order: 99 };
  }

  // league: fix known typos/sponsor suffixes ("4th Divison", "2nd Division Pepper") and match on
  // the leading token so drift doesn't create phantom extra columns.
  const cleaned = n.replace(/Divison/gi, 'Division');
  for (const div of LEAGUE_DIVISIONS) {
    const re = div.key === 'premier' || div.key === 'championship'
      ? new RegExp(`^${div.key}\\b`, 'i')
      : new RegExp(`^${div.key}\\s*Division`, 'i');
    if (re.test(cleaned)) return { key: div.key, label: div.label, group: 'league', order: div.order };
  }
  // Unrecognized league name: fall back to a cleaned own-key column rather than dropping it.
  const key = `league-${cleaned.toLowerCase().replace(/\s+/g, '-')}`;
  return { key, label: cleaned || n, group: 'league', order: 98 };
}

// ---- playoff brackets ----
// Turn the round-labelled playoff games (QF*/SF*/S1-S2/CHMP/CHAMP) already present in games.csv
// into rendered brackets, mirroring standings.py's champion/final semantics. Computed once in
// buildBoard and shared by the Season, Club and Team Records pages. See DATA.md §4.4/§5.6 and
// standings.py (_winner / _infer_final / champion_for) for the authoritative rules.

const ROUND_ORDER = { QF: 0, SF: 1, F: 2 };
const ROUND_LABEL = { QF: 'Quarterfinals', SF: 'Semifinals', F: 'Final' };

// A round label -> bracket round, or null for anything that isn't a QF/SF/final (PROMO, RELEG,
// 3RD, "3 VS 4", 5v6, 7v8, the bare "1"/"2" of 2014's 3rd Division, or an empty label). S1/S2 are
// how 2014/2015 tagged their semifinals; CHMP/CHAMP are the two spellings of the final.
export function classifyRound(roundLabel) {
  const u = (roundLabel || '').trim().toUpperCase();
  if (/^QF\d*$/.test(u)) return 'QF';
  if (u === 'S1' || u === 'S2' || /^SF\d*$/.test(u)) return 'SF';
  if (u === 'CHMP' || u === 'CHAMP') return 'F';
  return null;
}

// Union-find split of a competition's tagged games into independent brackets by shared clubs --
// only needed for the Over-35 split years (2024/2025), which put two 4-team brackets under one
// canonical "Over-35" key. Games with no known club (all-TBD live slots) attach to the largest.
function splitByClub(games) {
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const g of games) for (const id of [g.home_club_id, g.away_club_id]) if (id && !parent.has(id)) parent.set(id, id);
  for (const g of games) if (g.home_club_id && g.away_club_id) parent.set(find(g.home_club_id), find(g.away_club_id));
  const byRoot = new Map();
  const orphans = [];
  for (const g of games) {
    const id = g.home_club_id || g.away_club_id;
    if (!id) { orphans.push(g); continue; }
    const r = find(id);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(g);
  }
  const comps = [...byRoot.values()].sort((a, b) => b.length - a.length);
  if (orphans.length) { if (comps.length) comps[0].push(...orphans); else comps.push(orphans); }
  return comps;
}

// One bracket board (QF -> SF -> Final) from a component's games. `allGames` is the full
// competition game log (used to reconstruct an untagged final); `champByComp` maps a raw
// competition name -> champion club_id (from competitions.json) to settle finals decided on
// penalties, whose scoreline is level.
function buildBracketBoard(comp, allGames, champByComp) {
  const byRound = { QF: [], SF: [], F: [] };
  for (const g of comp) { const r = classifyRound(g.round_label); if (r) byRound[r].push(g); }
  for (const r of ['QF', 'SF', 'F']) {
    byRound[r].sort((a, b) => num(a.game_number) - num(b.game_number) || (a.round_label || '').localeCompare(b.round_label || ''));
  }
  const mk = (g, round) => ({
    round, label: ROUND_LABEL[round], game: g,
    homeId: g.home_club_id || '', home: g.home_name || '',
    awayId: g.away_club_id || '', away: g.away_name || '',
    hs: num(g.home_score), as: num(g.away_score),
    note: (g.result_note || '').trim(),
    played: g.status === 'played',
    tbd: !g.home_club_id || !g.away_club_id,
    winnerId: null,
  });
  const rounds = ['QF', 'SF', 'F']
    .filter((r) => byRound[r].length)
    .map((r) => ({ round: r, label: ROUND_LABEL[r], matches: byRound[r].map((g) => mk(g, r)) }));

  // Clubs playing in any round strictly after `round` -- a level (penalty) QF/SF is settled by
  // whichever team turns up in a later round (they advanced), mirroring bracket progression.
  const laterParticipants = (round) => {
    const s = new Set();
    for (const rd of rounds) if (ROUND_ORDER[rd.round] > ROUND_ORDER[round]) {
      for (const m of rd.matches) { if (m.homeId) s.add(m.homeId); if (m.awayId) s.add(m.awayId); }
    }
    return s;
  };
  const resolve = (m) => {
    if (!m.played) return;
    if (m.hs > m.as) { m.winnerId = m.homeId || null; return; }
    if (m.as > m.hs) { m.winnerId = m.awayId || null; return; }
    if (m.round === 'F') {
      const champ = champByComp.get(m.game.competition);
      if (champ && (champ === m.homeId || champ === m.awayId)) m.winnerId = champ;
      return;
    }
    const later = laterParticipants(m.round);
    const homeAdv = m.homeId && later.has(m.homeId);
    const awayAdv = m.awayId && later.has(m.awayId);
    if (homeAdv && !awayAdv) m.winnerId = m.homeId;
    else if (awayAdv && !homeAdv) m.winnerId = m.awayId;
  };
  for (const rd of rounds) for (const m of rd.matches) resolve(m);

  // Untagged final (2016/2019): if both semifinals were decisive, the two SF winners are the only
  // finalists -- the final is the untagged played game between exactly those two on/after the last
  // semifinal (standings.py:_infer_final). Bail if a semifinal was a level PK (finalist unknown).
  if (!rounds.some((rd) => rd.round === 'F')) {
    const sf = rounds.find((rd) => rd.round === 'SF');
    if (sf && sf.matches.length) {
      const winners = sf.matches.map((m) => m.winnerId);
      const uniq = [...new Set(winners)];
      if (winners.every(Boolean) && uniq.length === 2) {
        const lastSf = sf.matches.reduce((mx, m) => (m.game.date > mx ? m.game.date : mx), '');
        const wset = new Set(uniq);
        const cands = allGames.filter((g) =>
          g.status === 'played' && g.date && g.date >= lastSf &&
          classifyRound(g.round_label) === null && !(g.round_label || '').trim() &&
          g.home_club_id && g.away_club_id && g.home_club_id !== g.away_club_id &&
          wset.has(g.home_club_id) && wset.has(g.away_club_id));
        if (cands.length) {
          cands.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : num(b.game_number) - num(a.game_number)));
          const m = mk(cands[0], 'F');
          resolve(m);
          rounds.push({ round: 'F', label: ROUND_LABEL.F, matches: [m] });
        }
      }
    }
  }

  rounds.sort((a, b) => ROUND_ORDER[a.round] - ROUND_ORDER[b.round]);
  return { rounds: rounds.map((rd) => ({ round: rd.round, label: rd.label, matches: rd.matches.map(({ game, ...m }) => m) })) };
}

// All bracket boards for one canonical competition in one season. A single competition is one
// bracket; only when there are >=2 tagged finals (the Over-35 split years) do we separate the
// games into independent brackets. Returns [] when nothing is tagged as a playoff round.
export function buildBracket(compGames, champByComp) {
  const seen = new Set();
  const games = [];
  for (const g of compGames) { if (seen.has(g.game_key)) continue; seen.add(g.game_key); games.push(g); }
  const tagged = games.filter((g) => classifyRound(g.round_label) !== null);
  if (!tagged.length) return [];
  const finalsCount = tagged.filter((g) => classifyRound(g.round_label) === 'F').length;
  const components = finalsCount >= 2 ? splitByClub(tagged) : [tagged];
  return components.map((comp) => buildBracketBoard(comp, games, champByComp)).filter((b) => b.rounds.length);
}

// sid -> [{ key, label, group, order, seasonLabel, boards }] : every season's playoff brackets,
// keyed and ordered like the standings/champions competition lists so pages can reuse the switcher.
export function buildAllBrackets(allFixtures, allCompetitions) {
  const bySeason = new Map();
  for (const g of allFixtures || []) {
    let seasonMap = bySeason.get(g.sid);
    if (!seasonMap) { seasonMap = new Map(); bySeason.set(g.sid, seasonMap); }
    const canon = canonicalCompetition(g.competition, g.comp_type);
    let entry = seasonMap.get(canon.key);
    if (!entry) { entry = { canon, seasonLabel: g.seasonLabel, games: [] }; seasonMap.set(canon.key, entry); }
    entry.games.push(g);
  }
  const champBySeason = new Map(); // sid -> Map(rawCompetition -> championId)
  for (const c of allCompetitions || []) {
    if (!c.clubId) continue;
    let m = champBySeason.get(c.sid);
    if (!m) { m = new Map(); champBySeason.set(c.sid, m); }
    m.set(c.competition, c.clubId);
  }
  const result = new Map();
  for (const [sid, seasonMap] of bySeason) {
    const champByComp = champBySeason.get(sid) || new Map();
    const brackets = [];
    for (const { canon, seasonLabel, games } of seasonMap.values()) {
      const boards = buildBracket(games, champByComp);
      if (boards.length) brackets.push({ key: canon.key, label: canon.label, group: canon.group, order: canon.order, seasonLabel, boards });
    }
    brackets.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
    if (brackets.length) result.set(sid, brackets);
  }
  return result;
}

// A club's playoff record across league + Over-35 brackets (cups excluded, matching the Team
// Records scope). Appearances = distinct competitions entered (>=1 played match); win% counts a
// level PK match the club didn't advance from as neither a win nor loss (a draw). perSeason lists
// how far the club got in each, newest first.
export function buildClubPlayoffs(bracketsBySeason, clubId) {
  const out = { appearances: 0, gp: 0, w: 0, l: 0, d: 0, winPct: 0, finals: 0, finalsW: 0, finalsL: 0, perSeason: [] };
  if (!bracketsBySeason || !clubId) return out;
  const rows = [];
  for (const [sid, brackets] of bracketsBySeason) {
    for (const b of brackets) {
      if (b.group === 'cup') continue;
      let played = false, deepest = -1, wonFinal = false, lostFinal = false;
      for (const board of b.boards) for (const rd of board.rounds) for (const m of rd.matches) {
        const isHome = m.homeId === clubId, isAway = m.awayId === clubId;
        if ((!isHome && !isAway) || !m.played) continue;
        played = true;
        out.gp += 1;
        if (m.winnerId === clubId) out.w += 1;
        else if (m.winnerId) out.l += 1;
        else out.d += 1;
        if (ROUND_ORDER[m.round] > deepest) deepest = ROUND_ORDER[m.round];
        if (m.round === 'F') {
          out.finals += 1;
          if (m.winnerId === clubId) { out.finalsW += 1; wonFinal = true; }
          else if (m.winnerId) { out.finalsL += 1; lostFinal = true; }
        }
      }
      if (!played) continue;
      const result = wonFinal ? 'Champion' : (lostFinal || deepest === ROUND_ORDER.F) ? 'Runner-up'
        : deepest === ROUND_ORDER.SF ? 'Semifinalist' : 'Quarterfinalist';
      rows.push({ sid, label: b.seasonLabel, comp: b.label, group: b.group, result, champion: wonFinal });
    }
  }
  out.appearances = rows.length;
  out.winPct = out.gp ? out.w / out.gp : 0;
  out.perSeason = rows.sort((a, b) => b.sid.localeCompare(a.sid) || a.comp.localeCompare(b.comp));
  return out;
}

// Newest-season display name for every club_id: prefer allTeamStandings (authoritative team
// names), falling back to allCompetitions' champion_name -- required for cup-only clubs, since
// cup teams never appear in teams.json.
function resolveClubNames(allTeamStandings, allCompetitions) {
  const newestStandingName = new Map(); // club_id -> { sid, name }
  for (const t of allTeamStandings || []) {
    if (!t.club_id) continue;
    const cur = newestStandingName.get(t.club_id);
    if (!cur || t.sid >= cur.sid) newestStandingName.set(t.club_id, { sid: t.sid, name: t.name });
  }
  const newestCompName = new Map(); // club_id -> { sid, name }
  for (const c of allCompetitions || []) {
    if (!c.clubId) continue;
    const cur = newestCompName.get(c.clubId);
    if (!cur || c.sid >= cur.sid) newestCompName.set(c.clubId, { sid: c.sid, name: c.clubName });
  }
  const names = new Map();
  for (const id of new Set([...newestStandingName.keys(), ...newestCompName.keys()])) {
    names.set(id, newestStandingName.get(id)?.name || newestCompName.get(id)?.name || '(unknown)');
  }
  return names;
}

// Longest streaks of consecutive-season titles in the same canonical competition ("dynasties" --
// successive title defenses). A competition's own season sequence (not the calendar) sets what
// "consecutive" means, since not every competition ran every season (cups added later, divisions
// renamed, etc). Only completed seasons count; an undecided (live, not-yet-crowned) season breaks
// an in-progress streak rather than extending it. Ties/streaks of 1 aren't dynasties -- length 2+.
function computeDynasties(comps) {
  const byKey = new Map(); // canonical key -> { label, group, bySid: Map<sid, {sid,label,live,clubId,name}> }
  for (const c of comps) {
    if (c.live) continue; // only completed seasons form a dynasty
    const canon = canonicalCompetition(c.competition, c.comp_type);
    let entry = byKey.get(canon.key);
    if (!entry) { entry = { label: canon.label, group: canon.group, bySid: new Map() }; byKey.set(canon.key, entry); }
    const cur = entry.bySid.get(c.sid);
    if (!cur || (!cur.clubId && c.clubId)) {
      entry.bySid.set(c.sid, { sid: c.sid, label: c.label, clubId: c.clubId || null, name: c.clubName || null });
    }
  }

  const dynasties = [];
  for (const [key, { label, group, bySid }] of byKey) {
    const seasons = [...bySid.values()].sort((a, b) => a.sid.localeCompare(b.sid));
    let curClub = null, curName = '', curLen = 0, curStart = null, prev = null;
    const flush = (end) => {
      if (curClub && curLen >= 2) {
        dynasties.push({
          clubId: curClub, name: curName, key, label, group, len: curLen,
          startLabel: curStart.label, endLabel: end.label,
        });
      }
    };
    for (const s of seasons) {
      if (s.clubId && s.clubId === curClub) {
        curLen += 1;
      } else {
        flush(prev);
        curClub = s.clubId; curName = s.name; curLen = s.clubId ? 1 : 0; curStart = s;
      }
      prev = s;
    }
    flush(prev);
  }
  dynasties.sort((a, b) => b.len - a.len || a.label.localeCompare(b.label) || a.name.localeCompare(b.name));
  return dynasties.slice(0, RANK_N);
}

// Seasons where one club won 2+ distinct competitions (any mix of league division, Over-35 or
// cup) -- doubles, trebles and beyond. Cross-competition-group by design: a club sweeping both
// league divisions it entered counts just as much as a league+cup double.
function computeMultiTitleSeasons(comps, clubNames) {
  const bySeasonClub = new Map(); // `${sid}||${clubId}` -> acc
  for (const c of comps) {
    if (!c.clubId) continue;
    const canon = canonicalCompetition(c.competition, c.comp_type);
    const mkey = `${c.sid}||${c.clubId}`;
    let acc = bySeasonClub.get(mkey);
    if (!acc) acc = { sid: c.sid, label: c.label, live: c.live, clubId: c.clubId, comps: new Set() };
    acc.comps.add(canon.label);
    bySeasonClub.set(mkey, acc);
  }
  const rows = [];
  for (const acc of bySeasonClub.values()) {
    if (acc.comps.size < 2) continue;
    rows.push({
      clubId: acc.clubId, name: clubNames.get(acc.clubId) || '(unknown)',
      sid: acc.sid, label: acc.label, live: acc.live,
      count: acc.comps.size, competitions: [...acc.comps].sort(),
    });
  }
  rows.sort((a, b) => b.count - a.count || b.sid.localeCompare(a.sid) || a.name.localeCompare(b.name));
  return rows;
}

// Builds the Champions page's grid (season x competition matrix) and leaderboard (all-time
// title counts per club) from the flat allCompetitions list plus allTeamStandings (for each
// club's current display name).
export function buildChampions(allCompetitions, allTeamStandings) {
  const comps = allCompetitions || [];

  // ---- grid ----
  // columns: every canonical competition actually seen in the data, sorted by order.
  const columnsByKey = new Map();
  for (const c of comps) {
    const canon = canonicalCompetition(c.competition, c.comp_type);
    if (!columnsByKey.has(canon.key)) {
      columnsByKey.set(canon.key, { key: canon.key, label: canon.label, group: canon.group, order: canon.order });
    }
  }
  const columns = [...columnsByKey.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));

  // rows: one per season, newest first. Group each season's competitions by canonical column key.
  const bySid = new Map();
  for (const c of comps) {
    let s = bySid.get(c.sid);
    if (!s) { s = { sid: c.sid, label: c.label, live: c.live, byKey: new Map() }; bySid.set(c.sid, s); }
    const canon = canonicalCompetition(c.competition, c.comp_type);
    let list = s.byKey.get(canon.key);
    if (!list) { list = []; s.byKey.set(canon.key, list); }
    list.push(c);
  }
  const rows = [...bySid.values()]
    .sort((a, b) => b.sid.localeCompare(a.sid)) // newest first (sid sorts lexically like a year)
    .map((s) => {
      const cells = {};
      for (const [key, list] of s.byKey) {
        const decided = list.filter((c) => c.clubId);
        if (!decided.length) {
          cells[key] = { undecided: true };
          continue;
        }
        // subLabel only distinguishes multiple champions within one season+column (e.g. an
        // Over-35 split year producing both a Premier and a Championship winner).
        const multi = list.length > 1;
        cells[key] = {
          champions: decided.map((c) => ({
            clubId: c.clubId,
            name: c.clubName,
            subLabel: multi ? c.competition : '',
          })),
        };
      }
      return { sid: s.sid, label: s.label, live: s.live, cells };
    });

  const grid = { columns, rows };

  // ---- leaderboard ----
  const clubNames = resolveClubNames(allTeamStandings, comps);

  // Ordered list of completed (non-live) season ids, deduped, for computing droughts.
  const completedSids = [...new Set(comps.filter((c) => !c.live).map((c) => c.sid))].sort();

  const byClub = new Map();
  for (const c of comps) {
    if (!c.clubId) continue; // undecided -- not a title
    let acc = byClub.get(c.clubId);
    if (!acc) {
      acc = { clubId: c.clubId, total: 0, league: 0, over35: 0, cup: 0, titles: [] };
      byClub.set(c.clubId, acc);
    }
    acc.total += 1;
    acc[c.comp_type] += 1;
    acc.titles.push({ label: c.label, competition: c.competition, sid: c.sid, via: c.via });
  }

  const leaderboard = [];
  for (const acc of byClub.values()) {
    acc.titles.sort((a, b) => b.sid.localeCompare(a.sid)); // newest first
    const lastSid = acc.titles[0].sid;
    const lastLabel = acc.titles[0].label;
    const name = clubNames.get(acc.clubId) || '(unknown)';
    const drought = completedSids.filter((sid) => sid > lastSid).length;
    leaderboard.push({
      clubId: acc.clubId, name,
      total: acc.total, league: acc.league, over35: acc.over35, cup: acc.cup,
      lastLabel, lastSid, drought, titles: acc.titles,
    });
  }
  leaderboard.sort((a, b) => b.total - a.total || b.league - a.league || a.name.localeCompare(b.name));

  // ---- longest active droughts ----
  // Same per-club "seasons since last title" figure already shown on the leaderboard, ranked as
  // a first-class record. A drought of 0 means reigning champion, so those are excluded. Clubs
  // that folded and no longer field a side in the most recent season aren't "active" droughts --
  // they can't break the streak, so they're excluded here (though they still count in the
  // leaderboard and in allTimeDroughts, which are historical, not ongoing).
  const latestSid = allTeamStandings?.reduce((max, r) => (r.sid > max ? r.sid : max), '') || '';
  const currentClubIds = new Set(
    (allTeamStandings || []).filter((r) => r.sid === latestSid).map((r) => r.club_id)
  );
  const activeDroughts = leaderboard
    .filter((r) => r.drought > 0 && currentClubIds.has(r.clubId))
    .map((r) => ({ clubId: r.clubId, name: r.name, len: r.drought, lastLabel: r.lastLabel, lastSid: r.lastSid }))
    .sort((a, b) => b.len - a.len || a.name.localeCompare(b.name))
    .slice(0, RANK_N);

  // ---- longest all-time droughts (ended) ----
  // Biggest gap between two consecutive titles (any competition) for the same club, i.e. a
  // drought that was eventually broken -- as opposed to activeDroughts, which are still ongoing.
  const allTimeDroughts = [];
  for (const acc of byClub.values()) {
    const sids = [...new Set(acc.titles.map((t) => t.sid))].sort();
    const labelBySid = new Map(acc.titles.map((t) => [t.sid, t.label]));
    for (let i = 1; i < sids.length; i++) {
      const len = completedSids.filter((sid) => sid > sids[i - 1] && sid < sids[i]).length;
      if (len > 0) {
        allTimeDroughts.push({
          clubId: acc.clubId, name: clubNames.get(acc.clubId) || '(unknown)', len,
          beforeLabel: labelBySid.get(sids[i - 1]), afterLabel: labelBySid.get(sids[i]),
        });
      }
    }
  }
  allTimeDroughts.sort((a, b) => b.len - a.len || a.name.localeCompare(b.name));

  const dynasties = computeDynasties(comps);
  const multiTitleSeasons = computeMultiTitleSeasons(comps, clubNames);

  return { grid, leaderboard, dynasties, activeDroughts, allTimeDroughts: allTimeDroughts.slice(0, RANK_N), multiTitleSeasons };
}

// ---- champion age records ----
// Youngest/oldest player to win a title (any decided competition -- league, Over-35 or cup),
// based on actually appearing (gp > 0) for the champion club in that competition-season, not
// merely being on the roster. One row per person, keeping their single most extreme qualifying
// age across every title they've won.
export function buildChampionAgeRecords(allCompetitions, allPlayers, playersRegistry) {
  const playersBySid = new Map();
  for (const p of allPlayers) {
    let list = playersBySid.get(p.sid);
    if (!list) { list = []; playersBySid.set(p.sid, list); }
    list.push(p);
  }

  const youngest = new Map();
  const oldest = new Map();
  for (const c of allCompetitions || []) {
    if (!c.clubId) continue; // undecided -- not a title
    const seasonPlayers = playersBySid.get(c.sid);
    if (!seasonPlayers) continue;
    const canon = canonicalCompetition(c.competition, c.comp_type);
    for (const p of seasonPlayers) {
      const won = (p.comps || []).some(
        (row) => row.club === c.clubId && row.c === c.competition && row.type === c.comp_type && row.gp > 0
      );
      if (!won) continue;
      const reg = playersRegistry?.[p.pk];
      const age = ageAtSeason(reg?.birthdate, p.sid);
      if (age === null || age < AGE_MIN || age > AGE_MAX) continue;
      const name = displayName(reg, p.name) || '(unknown)';
      const row = {
        pk: p.pk, name, age, seasonLabel: c.label, sid: c.sid,
        clubId: c.clubId, clubName: c.clubName, competition: canon.label,
      };
      const curY = youngest.get(p.pk);
      if (!curY || age < curY.age) youngest.set(p.pk, row);
      const curO = oldest.get(p.pk);
      if (!curO || age > curO.age) oldest.set(p.pk, row);
    }
  }
  const byAgeAsc = (a, b) => a.age - b.age || a.name.localeCompare(b.name);
  const byAgeDesc = (a, b) => b.age - a.age || a.name.localeCompare(b.name);
  return {
    youngestChampions: [...youngest.values()].sort(byAgeAsc).slice(0, RANK_N),
    oldestChampions: [...oldest.values()].sort(byAgeDesc).slice(0, RANK_N),
  };
}

// ---- player records ----
// All-time individual leaderboards: career totals (re-sorts of buildAllPlayers), a per-season/
// division Golden Boot (league + Over-35 only -- cups have no "division"), and age-based records
// derived from players.json birthdates (missing/out-of-range ages excluded; see ageAtSeason).

export function buildPlayerRecords(allPlayers, playersRegistry) {
  // ---- career leaderboards ----
  const list = buildAllPlayers(allPlayers, playersRegistry);
  const topGoals = rankedBy(list, 'g', -1);
  const topAssists = rankedBy(list, 'a', -1);
  const topPoints = rankedBy(list, 'pts', -1);
  const mostGP = rankedBy(list, 'gp', -1);
  const mostSeasons = rankedBy(list, 'seasons', -1);
  // Unsliced, with goals-per-game -- the component applies its own interactive min-GP filter.
  const careerList = list.map((p) => ({ ...p, gpg: p.gp > 0 ? p.g / p.gp : 0 }));

  // ---- golden boot ----
  // Group every player-season's league/Over-35 comp rows by (sid, canonical division key),
  // summing that player's goals within the division-season, then crown the top scorer(s).
  const groups = new Map(); // `${sid}||${divKey}` -> { sid, seasonLabel, live, division, o35, order, byPk }
  for (const p of allPlayers) {
    for (const c of p.comps || []) {
      if (c.type !== 'league' && c.type !== 'over35') continue;
      if (!c.g) continue;
      const canon = canonicalCompetition(c.c, c.type);
      const key = `${p.sid}||${canon.key}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          sid: p.sid, seasonLabel: p.season, live: !!p.live,
          division: canon.label, o35: c.type === 'over35', order: canon.order,
          byPk: new Map(),
        };
        groups.set(key, g);
      }
      let acc = g.byPk.get(p.pk);
      if (!acc) { acc = { pk: p.pk, name: p.name, g: 0 }; g.byPk.set(p.pk, acc); }
      acc.g += c.g;
    }
  }
  const goldenBoots = [...groups.values()]
    .map((g) => {
      let maxG = 0;
      for (const acc of g.byPk.values()) if (acc.g > maxG) maxG = acc.g;
      const winners = [...g.byPk.values()]
        .filter((acc) => acc.g === maxG)
        .map((acc) => ({ pk: acc.pk, name: displayName(playersRegistry?.[acc.pk], acc.name) || '(unknown)', g: acc.g }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return {
        sid: g.sid, seasonLabel: g.seasonLabel, live: g.live,
        division: g.division, o35: g.o35, order: g.order, winners, maxG,
      };
    })
    .filter((g) => g.maxG > 0)
    .sort((a, b) => b.sid.localeCompare(a.sid) || a.order - b.order)
    .map(({ maxG, ...rest }) => rest);

  // ---- age records ----
  // One row per person, keeping only their extreme (youngest/oldest) season-age. Missing
  // birthdates are excluded entirely (see AGE_MIN/AGE_MAX above).
  const youngest = new Map();
  const oldestScorer = new Map();
  const oldestApp = new Map();
  for (const p of allPlayers) {
    const reg = playersRegistry?.[p.pk];
    const age = ageAtSeason(reg?.birthdate, p.sid);
    if (age === null || age < AGE_MIN || age > AGE_MAX) continue;
    const name = displayName(reg, p.name) || '(unknown)';
    const row = { pk: p.pk, name, age, seasonLabel: p.season, sid: p.sid, g: p.g };
    if (p.g > 0) {
      const curY = youngest.get(p.pk);
      if (!curY || age < curY.age) youngest.set(p.pk, row);
      const curO = oldestScorer.get(p.pk);
      if (!curO || age > curO.age) oldestScorer.set(p.pk, row);
    }
    if (p.gp > 0) {
      const curA = oldestApp.get(p.pk);
      if (!curA || age > curA.age) oldestApp.set(p.pk, row);
    }
  }
  const byAgeAsc = (a, b) => a.age - b.age || a.name.localeCompare(b.name);
  const byAgeDesc = (a, b) => b.age - a.age || a.name.localeCompare(b.name);
  const youngestScorers = [...youngest.values()].sort(byAgeAsc).slice(0, RANK_N);
  const oldestScorers = [...oldestScorer.values()].sort(byAgeDesc).slice(0, RANK_N);
  const oldestAppearances = [...oldestApp.values()].sort(byAgeDesc).slice(0, RANK_N);

  return {
    topGoals, topAssists, topPoints, mostGP, mostSeasons, careerList,
    goldenBoots, youngestScorers, oldestScorers, oldestAppearances,
  };
}

// ---- career shape ----
// Records about the shape of a career rather than raw totals: one-club loyalty vs. wandering
// journeymen (by distinct clubs actually appeared for), how long a career spanned and whether it
// had a real comeback gap (measured in season slots that actually happened, so a missing COVID
// year never counts against anyone), cup-specific scoring, and "triple crown" seasons where a
// player scored in league, cup AND Over-35 play in the same year.
export function buildCareerShapeRecords(allPlayers, playersRegistry, allTeamStandings, allCompetitions) {
  const clubNames = resolveClubNames(allTeamStandings, allCompetitions);

  // Every season id that actually happened, in order, so gaps/spans are measured in real season
  // slots rather than calendar years (mirrors formatSeasonRanges' 2020-COVID handling).
  const allSids = [...new Set(allPlayers.map((p) => p.sid))].sort();
  const sidIndex = new Map(allSids.map((sid, i) => [sid, i]));
  const labelBySid = new Map();
  for (const p of allPlayers) labelBySid.set(p.sid, p.season);

  const byPk = new Map();
  for (const p of allPlayers) {
    if (p.gp <= 0) continue; // only actual appearances, not roster-only rows
    let acc = byPk.get(p.pk);
    if (!acc) {
      acc = { pk: p.pk, csvName: p.name, clubs: new Map(), sids: new Set(), gp: 0, cupG: 0, cupGp: 0 };
      byPk.set(p.pk, acc);
    }
    acc.sids.add(p.sid);
    acc.gp += p.gp;
    for (const c of p.comps || []) {
      if (c.type === 'cup') { acc.cupG += c.g; acc.cupGp += c.gp; }
      if (!c.club || !(c.gp > 0)) continue;
      acc.clubs.set(c.club, (acc.clubs.get(c.club) || 0) + c.gp);
    }
  }

  const rows = [];
  for (const acc of byPk.values()) {
    const reg = playersRegistry?.[acc.pk];
    const name = displayName(reg, acc.csvName) || '(unknown)';
    const sortedSids = [...acc.sids].sort();
    const debutSid = sortedSids[0];
    const finalSid = sortedSids[sortedSids.length - 1];
    let maxGap = 0, gapBeforeLabel = null, gapAfterLabel = null;
    for (let i = 1; i < sortedSids.length; i++) {
      const gap = sidIndex.get(sortedSids[i]) - sidIndex.get(sortedSids[i - 1]) - 1;
      if (gap > maxGap) {
        maxGap = gap;
        gapBeforeLabel = labelBySid.get(sortedSids[i - 1]);
        gapAfterLabel = labelBySid.get(sortedSids[i]);
      }
    }
    rows.push({
      pk: acc.pk, name, gp: acc.gp,
      seasons: sortedSids.length,
      clubCount: acc.clubs.size,
      clubNames: [...acc.clubs.keys()].map((id) => clubNames.get(id) || '(unknown)').sort(),
      debutLabel: labelBySid.get(debutSid),
      finalLabel: labelBySid.get(finalSid),
      span: sidIndex.get(finalSid) - sidIndex.get(debutSid) + 1,
      maxGap, gapBeforeLabel, gapAfterLabel,
      cupG: acc.cupG, cupGp: acc.cupGp,
    });
  }

  const oneClubPlayers = rows
    .filter((r) => r.clubCount === 1)
    .slice()
    .sort((a, b) => b.gp - a.gp || b.seasons - a.seasons || a.name.localeCompare(b.name))
    .slice(0, RANK_N)
    .map((r) => ({ ...r, clubName: r.clubNames[0] }));

  const journeymen = rows
    .filter((r) => r.clubCount > 1)
    .slice()
    .sort((a, b) => b.clubCount - a.clubCount || b.gp - a.gp || a.name.localeCompare(b.name))
    .slice(0, RANK_N);

  const longestSpans = rows
    .slice()
    .sort((a, b) => b.span - a.span || b.seasons - a.seasons || a.name.localeCompare(b.name))
    .slice(0, RANK_N);

  const longestGaps = rows
    .filter((r) => r.maxGap > 0)
    .slice()
    .sort((a, b) => b.maxGap - a.maxGap || a.name.localeCompare(b.name))
    .slice(0, RANK_N);

  const topCupGoals = rows
    .filter((r) => r.cupG > 0)
    .slice()
    .sort((a, b) => b.cupG - a.cupG || b.cupGp - a.cupGp || a.name.localeCompare(b.name))
    .slice(0, RANK_N);

  // Triple crown: scored (g > 0) in league, cup AND Over-35 in the same player-season.
  const tripleCrowns = [];
  for (const p of allPlayers) {
    if (p.gp <= 0) continue;
    let lg = 0, cup = 0, o35 = 0;
    for (const c of p.comps || []) {
      if (c.g <= 0) continue;
      if (c.type === 'league') lg += c.g;
      else if (c.type === 'cup') cup += c.g;
      else if (c.type === 'over35') o35 += c.g;
    }
    if (lg > 0 && cup > 0 && o35 > 0) {
      const reg = playersRegistry?.[p.pk];
      const name = displayName(reg, p.name) || '(unknown)';
      tripleCrowns.push({ pk: p.pk, name, sid: p.sid, seasonLabel: p.season, lg, cup, o35, total: lg + cup + o35 });
    }
  }
  tripleCrowns.sort((a, b) => b.sid.localeCompare(a.sid) || b.total - a.total || a.name.localeCompare(b.name));

  return { oneClubPlayers, journeymen, longestSpans, longestGaps, topCupGoals, tripleCrowns };
}

// A player-season's g/a/gp/pts, optionally narrowed to one comp_type ('league'/'cup'/'over35')
// by re-summing their comps rows -- 'all' (the default) just returns the pre-aggregated totals.
export const COMP_TYPE_OPTIONS = [
  { value: 'all', label: 'All Competitions' },
  { value: 'league', label: 'League' },
  { value: 'over35', label: 'Over-35' },
  { value: 'cup', label: 'Cup' },
];

function statsForType(p, compType) {
  if (!compType || compType === 'all') return { g: p.g, a: p.a, gp: p.gp, pts: p.pts };
  let g = 0, a = 0, gp = 0;
  for (const c of p.comps || []) {
    if (c.type !== compType) continue;
    g += c.g; a += c.a; gp += c.gp;
  }
  return { g, a, gp, pts: POINTS_PER_GOAL * g + POINTS_PER_ASSIST * a };
}

// ---- age curve ----
// Per-age scoring rate across every active player-season row: for each whole age, the combined
// goals/games-played of every player-season attributed to that age via ageAtSeason. Ages with
// too few distinct players are dropped so thin tails don't produce noisy spikes.
export function buildAgeCurve(allPlayers, playersRegistry, compType = 'all') {
  const byAge = new Map(); // age -> { g, gp, pks: Set }
  for (const p of allPlayers) {
    const s = statsForType(p, compType);
    if (!(s.gp > 0 || s.pts > 0)) continue;
    const reg = playersRegistry?.[p.pk];
    const age = ageAtSeason(reg?.birthdate, p.sid);
    if (age === null || age < AGE_MIN || age > AGE_MAX) continue;
    let acc = byAge.get(age);
    if (!acc) { acc = { g: 0, gp: 0, pks: new Set() }; byAge.set(age, acc); }
    acc.g += s.g; acc.gp += s.gp; acc.pks.add(p.pk);
  }

  const out = [];
  for (let age = AGE_MIN; age <= AGE_MAX; age += 1) {
    const acc = byAge.get(age);
    const players = acc?.pks.size || 0;
    if (players < AGE_CURVE_MIN_PLAYERS) continue;
    out.push({ age, g: acc.g, gp: acc.gp, gpg: acc.gp ? acc.g / acc.gp : 0, players });
  }
  return out;
}

// ---- age trend ----
// Average age of active players each season (as of July 1), optionally narrowed to one
// comp_type -- "active" then means active within that comp_type, not the player's whole season.
// Seasons with no usable birthdates for the selected comp_type report avgAge: null.
export function buildAgeTrend(board, compType = 'all') {
  const { allCompetitions, allPlayers, playersRegistry } = board;

  const meta = new Map();
  for (const c of allCompetitions || []) {
    if (!meta.has(c.sid)) meta.set(c.sid, { label: c.label, live: !!c.live });
  }

  const ageAccBySid = new Map(); // sid -> { sum, count }
  for (const p of allPlayers || []) {
    const s = statsForType(p, compType);
    if (!(s.gp > 0 || s.pts > 0)) continue;
    const reg = playersRegistry?.[p.pk];
    const age = ageAtSeason(reg?.birthdate, p.sid);
    if (age === null || age < AGE_MIN || age > AGE_MAX) continue;
    let acc = ageAccBySid.get(p.sid);
    if (!acc) { acc = { sum: 0, count: 0 }; ageAccBySid.set(p.sid, acc); }
    acc.sum += age; acc.count += 1;
  }

  return [...meta.entries()]
    .map(([sid, m]) => {
      const acc = ageAccBySid.get(sid);
      return {
        sid,
        label: m.label || sid,
        live: !!m.live,
        avgAge: acc && acc.count > 0 ? acc.sum / acc.count : null,
        ageSample: acc?.count || 0,
      };
    })
    .sort((a, b) => a.sid.localeCompare(b.sid)); // oldest -> newest
}

// ---- trends ----
// Cross-season league-wide metrics. First metric: average goals per game per season, counting
// EVERY played competition (league, Over-35, cups). Some seasons list a match twice under two
// competition labels sharing one game_key (a division renamed mid-scrape) -- dedupe so goals and
// game counts aren't doubled, mirroring buildTeamRecords. Emitted oldest->newest so a chart of
// the series reads left-to-right in time.
export function buildScoringTrend(board) {
  const { allGames, allCompetitions, allPlayers, allTeamStandings } = board;

  // sid -> { label, live } (allCompetitions carries both; fall back to each game's seasonLabel).
  const meta = new Map();
  for (const c of allCompetitions || []) {
    if (!meta.has(c.sid)) meta.set(c.sid, { label: c.label, live: !!c.live });
  }

  const bySid = new Map(); // sid -> { games, goals }
  const seenGameKeys = new Set();
  for (const g of allGames || []) {
    const key = `${g.sid}||${g.game_key}`;
    if (seenGameKeys.has(key)) continue;
    seenGameKeys.add(key);
    let acc = bySid.get(g.sid);
    if (!acc) { acc = { games: 0, goals: 0 }; bySid.set(g.sid, acc); }
    acc.games += 1;
    acc.goals += num(g.home_score) + num(g.away_score);
  }

  // sid -> distinct active player count / distinct club count, for the participation columns.
  const playersBySid = new Map();
  for (const p of allPlayers || []) {
    if (!(p.gp > 0 || p.pts > 0)) continue;
    const s = playersBySid.get(p.sid) || new Set();
    s.add(p.pk);
    playersBySid.set(p.sid, s);
  }
  const teamsBySid = new Map();
  for (const t of allTeamStandings || []) {
    if (!t.club_id) continue;
    const s = teamsBySid.get(t.sid) || new Set();
    s.add(t.club_id);
    teamsBySid.set(t.sid, s);
  }

  return [...bySid.entries()]
    .map(([sid, acc]) => {
      const m = meta.get(sid);
      return {
        sid,
        label: m?.label || sid,
        live: !!m?.live,
        games: acc.games,
        goals: acc.goals,
        gpg: acc.games ? acc.goals / acc.games : 0,
        players: playersBySid.get(sid)?.size || 0,
        teams: teamsBySid.get(sid)?.size || 0,
      };
    })
    .sort((a, b) => a.sid.localeCompare(b.sid)); // oldest -> newest
}

// A margin of 4+ goals is ~22% of every played BDSL game league-wide -- a "one in five" cutoff
// that reads as a real blowout without being so rare it's noisy season to season.
export const BLOWOUT_MARGIN = 4;

// Draw rate + blowout rate per season, counting every played competition (league, Over-35, cups),
// same scope and game_key dedupe as buildScoringTrend above. A tied score is only a true draw if
// it stood -- penalty-shootout games (result_note "PK") always report an equal home/away score
// (the shootout itself isn't reflected in the score fields) but did produce a real winner, so
// they're excluded. Extra-time games (result_note "OT") always resolve to an unequal score, so
// they need no special-casing.
export function buildMatchOutcomeTrend(board) {
  const { allGames, allCompetitions } = board;

  const meta = new Map();
  for (const c of allCompetitions || []) {
    if (!meta.has(c.sid)) meta.set(c.sid, { label: c.label, live: !!c.live });
  }

  const bySid = new Map(); // sid -> { games, draws, blowouts }
  const seenGameKeys = new Set();
  for (const g of allGames || []) {
    const key = `${g.sid}||${g.game_key}`;
    if (seenGameKeys.has(key)) continue;
    seenGameKeys.add(key);
    const hs = num(g.home_score), as = num(g.away_score);
    const margin = Math.abs(hs - as);
    let acc = bySid.get(g.sid);
    if (!acc) { acc = { games: 0, draws: 0, blowouts: 0 }; bySid.set(g.sid, acc); }
    acc.games += 1;
    if (margin === 0 && g.result_note !== 'PK') acc.draws += 1;
    if (margin >= BLOWOUT_MARGIN) acc.blowouts += 1;
  }

  return [...bySid.entries()]
    .map(([sid, acc]) => {
      const m = meta.get(sid);
      return {
        sid,
        label: m?.label || sid,
        live: !!m?.live,
        games: acc.games,
        draws: acc.draws,
        drawRate: acc.games ? (100 * acc.draws) / acc.games : 0,
        blowouts: acc.blowouts,
        blowoutRate: acc.games ? (100 * acc.blowouts) / acc.games : 0,
      };
    })
    .sort((a, b) => a.sid.localeCompare(b.sid)); // oldest -> newest
}

// Competitive-balance trend: how far apart the best and worst team are within a division table,
// averaged across every league division that season. Only comp_type "league" rows count as real
// divisions -- Over-35 (which canonicalizes to one non-divisional group) and cups (no standings
// table at all) are excluded. Points-per-game (not raw points) is used so divisions/seasons with
// uneven schedules are comparable; a division needs at least 2 teams with games played to have a
// spread at all.
export function buildDivisionSpreadTrend(board) {
  const { allTeamStandings } = board;

  const meta = new Map(); // sid -> { label, live }
  const byDivision = new Map(); // sid -> Map(divisionKey -> [ppg, ...])
  for (const r of allTeamStandings || []) {
    if (r.comp_type !== 'league') continue;
    const gp = num(r.gp);
    if (gp <= 0) continue;
    if (!meta.has(r.sid)) meta.set(r.sid, { label: r.seasonLabel, live: !!r.live });
    const divKey = canonicalCompetition(r.competition, r.comp_type).key;
    let divs = byDivision.get(r.sid);
    if (!divs) { divs = new Map(); byDivision.set(r.sid, divs); }
    let ppgs = divs.get(divKey);
    if (!ppgs) { ppgs = []; divs.set(divKey, ppgs); }
    ppgs.push(num(r.pts) / gp);
  }

  return [...meta.entries()]
    .map(([sid, m]) => {
      const divs = byDivision.get(sid);
      const spreads = [...(divs?.values() || [])]
        .filter((ppgs) => ppgs.length >= 2)
        .map((ppgs) => Math.max(...ppgs) - Math.min(...ppgs));
      const spread = spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : null;
      return { sid, label: m.label || sid, live: m.live, divisions: spreads.length, spread };
    })
    .sort((a, b) => a.sid.localeCompare(b.sid)); // oldest -> newest
}

// Scoring-concentration trend: share of a season's goals scored by its top-N scorers, across
// every competition (same all-comps scope as goals-per-game). A high share means scoring is
// concentrated among a handful of standout players rather than spread across the league.
export function buildScoringConcentrationTrend(board, topN = 10) {
  const { allPlayers, allCompetitions } = board;

  const meta = new Map();
  for (const c of allCompetitions || []) {
    if (!meta.has(c.sid)) meta.set(c.sid, { label: c.label, live: !!c.live });
  }

  const goalsBySid = new Map(); // sid -> [goal tallies, one per scorer]
  for (const p of allPlayers || []) {
    if (p.g <= 0) continue;
    let list = goalsBySid.get(p.sid);
    if (!list) { list = []; goalsBySid.set(p.sid, list); }
    list.push(p.g);
  }

  return [...meta.entries()]
    .map(([sid, m]) => {
      const goals = (goalsBySid.get(sid) || []).slice().sort((a, b) => b - a);
      const totalGoals = goals.reduce((a, b) => a + b, 0);
      const topGoals = goals.slice(0, topN).reduce((a, b) => a + b, 0);
      return {
        sid,
        label: m?.label || sid,
        live: !!m?.live,
        scorers: goals.length,
        goals: totalGoals,
        topGoals,
        share: totalGoals ? (100 * topGoals) / totalGoals : 0,
      };
    })
    .sort((a, b) => a.sid.localeCompare(b.sid)); // oldest -> newest
}

// Returning-player trend: of the players active in a season (gp > 0 || pts > 0, across every
// competition), what share also played the previous tracked season. The first season has no
// prior year to compare against, so it reports retentionRate: null (skipped when charted, same
// convention as buildAgeTrend's missing-birthdate seasons).
export function buildRetentionTrend(board) {
  const { allPlayers, allCompetitions } = board;

  const meta = new Map();
  for (const c of allCompetitions || []) {
    if (!meta.has(c.sid)) meta.set(c.sid, { label: c.label, live: !!c.live });
  }

  const activeBySid = new Map(); // sid -> Set(pk)
  for (const p of allPlayers || []) {
    if (!(p.gp > 0 || p.pts > 0)) continue;
    let s = activeBySid.get(p.sid);
    if (!s) { s = new Set(); activeBySid.set(p.sid, s); }
    s.add(p.pk);
  }

  const sids = [...meta.keys()].sort((a, b) => a.localeCompare(b)); // oldest -> newest
  let prev = null;
  const out = [];
  for (const sid of sids) {
    const m = meta.get(sid);
    const active = activeBySid.get(sid) || new Set();
    let retentionRate = null, returning = 0;
    if (prev && prev.size > 0) {
      for (const pk of active) if (prev.has(pk)) returning += 1;
      retentionRate = (100 * returning) / prev.size;
    }
    out.push({
      sid, label: m?.label || sid, live: !!m?.live,
      prevActive: prev?.size || 0, returning, retentionRate,
    });
    prev = active;
  }
  return out;
}

// ---- season index / season detail ----
// One page per season (standings, champions, top scorers/assisters) needs a lightweight index
// of every season that appears anywhere in the board, plus a detail builder for a single sid.

// Newest-first summary of every season in the board: division/champion/player counts and the
// season's leading scorer. Drives the season list/picker.
export function buildSeasonIndex(board) {
  const { allTeamStandings, allCompetitions, allPlayers, scoringSeasons } = board;

  const sids = new Set();
  for (const r of allTeamStandings) sids.add(r.sid);
  for (const c of allCompetitions) sids.add(c.sid);
  for (const p of allPlayers) sids.add(p.sid);

  const out = [];
  for (const sid of sids) {
    const meta = allCompetitions.find((c) => c.sid === sid)
      || allTeamStandings.find((r) => r.sid === sid)
      || allPlayers.find((p) => p.sid === sid);
    const label = meta?.label || meta?.seasonLabel || meta?.season || sid;
    const live = !!meta?.live;

    // distinct league/over35 competitions this season (cups don't table, so use allCompetitions
    // filtered to non-cup to count divisions, incl. any that never made it into teams.json).
    const divisionKeys = new Set(
      allCompetitions
        .filter((c) => c.sid === sid && c.comp_type !== 'cup')
        .map((c) => c.competition)
    );
    const divisions = divisionKeys.size;

    const champions = allCompetitions.filter((c) => c.sid === sid && c.clubId).length;

    const teams = new Set(
      allTeamStandings.filter((r) => r.sid === sid).map((r) => r.club_id)
    ).size;

    const activePlayers = allPlayers.filter((p) => p.sid === sid && (p.gp > 0 || p.pts > 0));
    const players = activePlayers.length;

    // Top scorer = the single highest goal tally in ANY one competition that season (not a
    // player's all-comps total), tagged with that competition's canonical division/label.
    let topScorer = null;
    for (const p of activePlayers) {
      for (const c of p.comps || []) {
        if (c.g <= 0) continue;
        if (!topScorer || c.g > topScorer.g
          || (c.g === topScorer.g && p.name.localeCompare(topScorer.name) < 0)) {
          topScorer = { name: p.name, pk: p.pk, g: c.g, division: canonicalCompetition(c.c, c.type).label };
        }
      }
    }

    const teamDataOnly = !(scoringSeasons && scoringSeasons.has(sid));

    out.push({ sid, label, live, divisions, champions, teams, players, topScorer, teamDataOnly });
  }

  out.sort((a, b) => b.sid.localeCompare(a.sid));
  return out;
}

// Full detail for one season: standings by division, the champions grid row, and top
// scorers/assisters. Returns null if the sid has no data anywhere in the board.
export function buildSeason(board, sid) {
  const { allTeamStandings, allCompetitions, allPlayers, allFixtures, bracketsBySeason, scoringSeasons } = board;

  const standingsRows = allTeamStandings.filter((r) => r.sid === sid);
  const compRows = allCompetitions.filter((c) => c.sid === sid);
  const playerRows = allPlayers.filter((p) => p.sid === sid);
  const fixtureRows = (allFixtures || []).filter((g) => g.sid === sid);
  if (!standingsRows.length && !compRows.length && !playerRows.length && !fixtureRows.length) return null;

  const meta = compRows[0] || standingsRows[0] || playerRows[0];
  const label = meta.label || meta.seasonLabel || meta.season || sid;
  const live = !!meta.live;

  // ---- standings: group by competition (never shared across divisions), ordered canonically ----
  const byComp = new Map();
  for (const r of standingsRows) {
    let g = byComp.get(r.competition);
    if (!g) {
      const canon = canonicalCompetition(r.competition, r.comp_type);
      g = { key: canon.key, label: canon.label, group: canon.group, order: canon.order, rows: [] };
      byComp.set(r.competition, g);
    }
    g.rows.push(r);
  }
  const championIds = new Map(); // competition -> champion clubId
  for (const c of compRows) if (c.clubId) championIds.set(c.competition, c.clubId);

  const standings = [...byComp.values()]
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map((g) => ({
      key: g.key, label: g.label, group: g.group,
      rows: g.rows
        .slice()
        .sort((a, b) => num(a.position) - num(b.position))
        .map((r) => {
          const gp = num(r.gp), gf = num(r.gf), ga = num(r.ga), pts = num(r.pts);
          const xpts = pythagoreanExpectedPoints(gf, ga, gp);
          return {
            clubId: r.club_id, name: r.name, position: num(r.position),
            gp, w: num(r.w), l: num(r.l), d: num(r.d),
            gf, ga, gd: num(r.gd) || gf - ga, pts,
            xpts, luck: pts - xpts,
            champion: !!r.club_id && championIds.get(r.competition) === r.club_id,
          };
        }),
    }));
  // Expected position: re-rank each division's rows by xpts (desc) using the same tiebreakers
  // as actual standings (GD, then GF) so the comparison to actual position is apples-to-apples.
  for (const g of standings) {
    const byXpts = g.rows
      .slice()
      .sort((a, b) => b.xpts - a.xpts || b.gd - a.gd || b.gf - a.gf);
    byXpts.forEach((r, i) => { r.xposition = i + 1; });
  }

  // ---- champions (league, over35 AND cups) ----
  const champions = compRows
    .map((c) => {
      const canon = canonicalCompetition(c.competition, c.comp_type);
      return {
        competition: c.competition, comp_type: c.comp_type, group: canon.group, order: canon.order,
        label: canon.label, clubId: c.clubId, clubName: c.clubName, via: c.via,
        undecided: !c.clubId,
      };
    })
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));

  // ---- leaderboard ----
  // One client-sortable row per (player, division) pairing, with that player's goals/assists/games
  // WITHIN a single league or Over-35 division. A player who appeared in both a league division and
  // Over-35 (or, rarely, two league divisions) yields one row per division, so filtering by division
  // lists them in each. Stats are per-division, not combined across comps. Cups aren't divisions
  // (no standings table) and are excluded here.
  const players = [];
  for (const p of playerRows) {
    const byDiv = new Map(); // divisionKey -> { key, label, order, g, a, gp, teams:Set }
    for (const c of p.comps || []) {
      if (c.type !== 'league' && c.type !== 'over35') continue;
      const canon = canonicalCompetition(c.c, c.type);
      let d = byDiv.get(canon.key);
      if (!d) {
        d = { key: canon.key, label: canon.label, order: canon.order, g: 0, a: 0, gp: 0, teams: new Set() };
        byDiv.set(canon.key, d);
      }
      d.g += c.g; d.a += c.a; d.gp += c.gp;
      if (c.t) d.teams.add(c.t);
    }
    for (const d of byDiv.values()) {
      if (d.g <= 0 && d.a <= 0 && d.gp <= 0) continue;
      players.push({
        pk: p.pk, name: p.name, teams: [...d.teams],
        division: d.label, divisionKey: d.key, divisionOrder: d.order,
        g: d.g, a: d.a, pts: POINTS_PER_GOAL * d.g + POINTS_PER_ASSIST * d.a, gp: d.gp,
      });
    }
  }

  // Division filter options: distinct divisions actually present, in canonical order.
  const divSeen = new Map();
  for (const p of players) {
    if (p.divisionKey && !divSeen.has(p.divisionKey)) {
      divSeen.set(p.divisionKey, { key: p.divisionKey, label: p.division, order: p.divisionOrder });
    }
  }
  const divisions = [...divSeen.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));

  // ---- results & fixtures: grouped by competition, like standings ----
  const RECENT_PER_COMP = 10;
  const UPCOMING_PER_COMP = 10;
  const shapeGame = (g) => ({
    gameKey: g.game_key, date: g.date, time: g.time,
    home: g.home_name, homeClubId: g.home_club_id,
    away: g.away_name, awayClubId: g.away_club_id,
    hs: num(g.home_score), as: num(g.away_score),
    location: g.location,
  });

  const byCompResults = new Map();
  const byCompFixtures = new Map();
  for (const g of fixtureRows) {
    const canon = canonicalCompetition(g.competition, g.comp_type);
    const target = g.status === 'played' ? byCompResults : g.status === 'scheduled' ? byCompFixtures : null;
    if (!target) continue;
    let entry = target.get(canon.key);
    if (!entry) {
      entry = { key: canon.key, label: canon.label, group: canon.group, order: canon.order, games: [] };
      target.set(canon.key, entry);
    }
    entry.games.push(shapeGame(g));
  }

  // A handful of games (mostly cup rounds) have no date/time yet -- keep those undated games
  // at the bottom of their list rather than letting an empty string sort first/last by accident.
  const results = [...byCompResults.values()]
    .map((c) => ({
      ...c,
      games: c.games
        .sort((a, b) => {
          if (!a.date || !b.date) return (!a.date ? 1 : 0) - (!b.date ? 1 : 0);
          return b.date.localeCompare(a.date) || parseTimeMinutes(b.time) - parseTimeMinutes(a.time);
        })
        .slice(0, RECENT_PER_COMP),
    }))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));

  const fixtures = [...byCompFixtures.values()]
    .map((c) => ({
      ...c,
      games: c.games
        .sort((a, b) => {
          if (!a.date || !b.date) return (!a.date ? 1 : 0) - (!b.date ? 1 : 0);
          return a.date.localeCompare(b.date) || parseTimeMinutes(a.time) - parseTimeMinutes(b.time);
        })
        .slice(0, UPCOMING_PER_COMP),
    }))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));

  const brackets = (bracketsBySeason && bracketsBySeason.get(sid)) || [];
  const teamDataOnly = !(scoringSeasons && scoringSeasons.has(sid));

  return { sid, label, live, standings, champions, players, divisions, results, fixtures, brackets, teamDataOnly };
}

// ---- team-season (one club, one season) ----
// The Club page's per-season drill-down: this club's record, roster, schedule, standings context
// and playoff run for a single sid, assembled entirely from the already-loaded board (no fetches).
// Returns null if the (clubId, sid) pair has no data anywhere in the board.
export function buildClubSeason(board, clubId, sid) {
  const standingsRows = (board.allTeamStandings || []).filter((r) => r.sid === sid && r.club_id === clubId);
  // True game log (played only), scoped to this club+season -- same source aggregateClubGames
  // walks for the all-time record, just pre-filtered to one sid.
  const clubGames = (board.allGames || []).filter(
    (g) => g.sid === sid && (g.home_club_id === clubId || g.away_club_id === clubId)
  );
  // Every fixture (played, scheduled, etc.) for the schedule tab below.
  const fixtureRows = (board.allFixtures || []).filter(
    (g) => g.sid === sid && (g.home_club_id === clubId || g.away_club_id === clubId)
  );
  // Titles this club won this season (league, Over-35 or cup).
  const titleRows = (board.allCompetitions || []).filter((c) => c.sid === sid && c.clubId === clubId);
  // Roster rows: this club's slice of each player-season's comps, for players who actually have one.
  const clubPlayerRows = (board.allPlayers || [])
    .filter((p) => p.sid === sid)
    .map((p) => ({ p, mine: (p.comps || []).filter((c) => c.club === clubId) }))
    .filter((row) => row.mine.length);

  if (!standingsRows.length && !clubGames.length && !titleRows.length && !clubPlayerRows.length) return null;

  const meta = standingsRows[0] || titleRows[0] || clubPlayerRows[0]?.p || fixtureRows[0];
  const label = meta?.seasonLabel || meta?.label || meta?.season || sid;
  const live = !!meta?.live;

  // Name as of this season: the standings spelling, else a schedule row's spelling, else the
  // club's newest-ever standings spelling (some clubs were renamed over the years), else unknown.
  let name = standingsRows[0]?.name;
  if (!name) {
    const gameRow = clubGames[0] || fixtureRows[0];
    if (gameRow) name = gameRow.home_club_id === clubId ? gameRow.home_name : gameRow.away_name;
  }
  if (!name) {
    let newestSid = '';
    for (const r of board.allTeamStandings || []) {
      if (r.club_id === clubId && r.sid >= newestSid) { newestSid = r.sid; name = r.name; }
    }
  }
  if (!name) name = '(unknown)';

  // ---- totals: the true game log for this season, mirroring aggregateClubGames ----
  const totals = { gp: 0, w: 0, l: 0, d: 0, gf: 0, ga: 0 };
  for (const g of clubGames) {
    let gf, ga;
    if (g.home_club_id === clubId) { gf = num(g.home_score); ga = num(g.away_score); }
    else { gf = num(g.away_score); ga = num(g.home_score); }
    totals.gp += 1; totals.gf += gf; totals.ga += ga;
    if (gf > ga) totals.w += 1; else if (gf < ga) totals.l += 1; else totals.d += 1;
  }
  totals.gd = totals.gf - totals.ga;

  // ---- titles ----
  const titles = titleRows.map((c) => {
    const canon = canonicalCompetition(c.competition, c.comp_type);
    return { competition: c.competition, label: canon.label, group: canon.group };
  });

  // ---- standings: reuse buildSeason's already-grouped, canonically-ordered tables, keeping only
  // the groups this club actually appears in and tagging its row for the component to highlight ----
  const seasonStandings = buildSeason(board, sid)?.standings || [];
  const standings = seasonStandings
    .filter((g) => g.rows.some((r) => r.clubId === clubId))
    .map((g) => ({
      key: g.key, label: g.label, group: g.group,
      rows: g.rows.map((r) => ({ ...r, isClub: r.clubId === clubId })),
    }));

  // ---- roster: per-player totals across just this club's comps this season (mirrors
  // buildClubProfile's roster loop, but single-season -- no seasonsPlayed) ----
  const roster = clubPlayerRows.map(({ p, mine }) => {
    let g = 0, a = 0, gp = 0;
    for (const c of mine) { g += c.g; a += c.a; gp += c.gp; }
    const reg = board.playersRegistry?.[p.pk];
    return {
      pk: p.pk,
      name: displayName(reg, p.name) || '(unknown)',
      g, a, pts: POINTS_PER_GOAL * g + POINTS_PER_ASSIST * a, gp,
      comps: mine.map((c) => ({ c: c.c, type: c.type, g: c.g, a: c.a, gp: c.gp })),
    };
  });

  // ---- games: this club's schedule this season, every status, oldest first (undated last) ----
  // A game can leak into two competitions' schedules sharing one game_key (see buildSeason/
  // buildTeamRecords) -- dedupe, keeping the first seen.
  const seenGameKeys = new Set();
  const games = [];
  for (const g of fixtureRows) {
    const key = `${g.sid}||${g.game_key}`;
    if (seenGameKeys.has(key)) continue;
    seenGameKeys.add(key);
    const hs = num(g.home_score), as = num(g.away_score);
    let result = '';
    if (g.status === 'played') {
      let gf, ga;
      if (g.home_club_id === clubId) { gf = hs; ga = as; } else { gf = as; ga = hs; }
      result = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
    }
    games.push({
      gameKey: g.game_key, date: g.date, time: g.time,
      competition: g.competition, comp_type: g.comp_type,
      home: g.home_name, homeClubId: g.home_club_id,
      away: g.away_name, awayClubId: g.away_club_id,
      hs, as, status: g.status, result,
    });
  }
  games.sort((a, b) => {
    if (!a.date || !b.date) return (!a.date ? 1 : 0) - (!b.date ? 1 : 0);
    return a.date.localeCompare(b.date) || parseTimeMinutes(a.time) - parseTimeMinutes(b.time);
  });

  // ---- playoffs: this season's brackets the club actually played in, plus how far it got ----
  // (per-bracket result logic mirrors buildClubPlayoffs, scoped to just this sid's brackets)
  const seasonBrackets = board.bracketsBySeason?.get(sid) || [];
  const brackets = seasonBrackets.filter((b) =>
    b.boards.some((bd) => bd.rounds.some((rd) => rd.matches.some((m) => m.homeId === clubId || m.awayId === clubId)))
  );
  const results = [];
  for (const b of brackets) {
    let played = false, deepest = -1, wonFinal = false, lostFinal = false;
    for (const bd of b.boards) for (const rd of bd.rounds) for (const m of rd.matches) {
      const isHome = m.homeId === clubId, isAway = m.awayId === clubId;
      if ((!isHome && !isAway) || !m.played) continue;
      played = true;
      if (ROUND_ORDER[m.round] > deepest) deepest = ROUND_ORDER[m.round];
      if (m.round === 'F') {
        if (m.winnerId === clubId) wonFinal = true;
        else if (m.winnerId) lostFinal = true;
      }
    }
    if (!played) continue; // club was slotted (e.g. TBD placeholder) but never actually played
    const result = wonFinal ? 'Champion' : (lostFinal || deepest === ROUND_ORDER.F) ? 'Runner-up'
      : deepest === ROUND_ORDER.SF ? 'Semifinalist' : 'Quarterfinalist';
    results.push({ key: b.key, label: b.label, group: b.group, result, champion: wonFinal });
  }
  // Best single-line summary across every bracket the club entered this season: Champion beats
  // any other result; otherwise the deepest round reached wins.
  let resultLabel = '';
  if (results.length) {
    const RESULT_RANK = { Champion: 3, 'Runner-up': 2, Semifinalist: 1, Quarterfinalist: 0 };
    resultLabel = results.reduce((best, r) => (RESULT_RANK[r.result] > RESULT_RANK[best] ? r.result : best), results[0].result);
  }
  const playoffs = { brackets, results, resultLabel };
  const teamDataOnly = !(board.scoringSeasons && board.scoringSeasons.has(sid));

  return { clubId, sid, label, live, name, totals, titles, standings, roster, games, playoffs, teamDataOnly };
}

// ---- per-game scoring/discipline (game_stats.csv + game_reports.csv backfill) ----
// Row-level match data is a separate, still-being-backfilled fact table layered on top of the
// season-total stats.csv aggregation above -- some seasons (and even some games within a covered
// season) have no rows yet, so every builder here must degrade to empty output rather than throw.
// Manager-entered recorded scorers can undercount a game's actual final score, so nothing here
// should be framed as an authoritative/complete scoring record -- see callers for the caveat copy.

// One player's per-game scoring/discipline log, newest game first, plus a small summary. Only
// rows with a resolved person_key count (blank person_key = unmatched to a roster, per
// game_stats.csv's schema) -- this mirrors allPlayers' own person_key-keyed aggregation.
export function buildPlayerMatchStats(allGameStats, personKey) {
  // Dedupe by (sid, game_key): a game that leaked into two competitions' schedules would otherwise
  // list this player's line twice under one game_key (see buildScoringRecords' note).
  const seen = new Set();
  const rows = (allGameStats || [])
    .filter((row) => {
      if (row.person_key !== personKey) return false;
      const key = `${row.sid}||${row.game_key}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((row) => ({
      sid: row.sid, seasonLabel: row.seasonLabel, game_key: row.game_key, date: row.date,
      competition: row.competition, comp_type: row.comp_type, round_label: row.round_label || '',
      side: row.side, g: num(row.g), a: num(row.a), y: num(row.y), r: num(row.r),
    }))
    .sort((a, b) => `${b.date}`.localeCompare(`${a.date}`) || b.sid.localeCompare(a.sid) || b.game_key.localeCompare(a.game_key));

  const summary = { hatTricks: 0, multiGoalGames: 0, bestGoalGame: 0, totalYellow: 0, totalRed: 0, gamesWithEvents: rows.length };
  for (const row of rows) {
    if (row.g >= 3) summary.hatTricks += 1;
    if (row.g >= 2) summary.multiGoalGames += 1;
    if (row.g > summary.bestGoalGame) summary.bestGoalGame = row.g;
    summary.totalYellow += row.y;
    summary.totalRed += row.r;
  }

  return { rows, summary };
}

// League-wide scoring/discipline leaderboards (top ~10 each), built straight from game_stats.csv
// rather than the season-total aggregation -- these are things per-game granularity uniquely
// enables (a hat-trick, a single-game haul) that a season total alone can't answer. No
// game-winning-goal metric: the data has no goal-timing, so there's no way to tell which goal
// actually won a match.
export function buildScoringRecords(allGameStats, playersRegistry) {
  const byPk = new Map(); // person_key -> { pk, csvName, hatTricks, multiGoalGames, yellow, red }
  const singleGames = [];
  // A game that leaked into two competitions' schedules yields the same person's line under two
  // game_stats rows sharing one game_key (as buildTeamRecords/buildElo also guard against); dedupe
  // by (sid, game_key, person_key) so a single game can't double-count a hat-trick or a card.
  const seen = new Set();
  for (const row of allGameStats || []) {
    if (!row.person_key) continue; // exclude unmatched scorers from aggregates (see module note)
    const dedupeKey = `${row.sid}||${row.game_key}||${row.person_key}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const g = num(row.g), y = num(row.y), rd = num(row.r);
    let acc = byPk.get(row.person_key);
    if (!acc) {
      acc = { pk: row.person_key, csvName: row.name, hatTricks: 0, multiGoalGames: 0, yellow: 0, red: 0 };
      byPk.set(row.person_key, acc);
    }
    if (row.name) acc.csvName = row.name;
    if (g >= 3) acc.hatTricks += 1;
    if (g >= 2) acc.multiGoalGames += 1;
    acc.yellow += y;
    acc.red += rd;
    if (g > 0) {
      singleGames.push({
        pk: row.person_key, name: row.name, g, date: row.date, competition: row.competition,
        seasonLabel: row.seasonLabel, game_key: row.game_key, sid: row.sid,
      });
    }
  }

  const nameFor = (pk, fallback) => displayName(playersRegistry?.[pk], fallback) || '(unknown)';
  const list = [...byPk.values()].map((acc) => ({
    pk: acc.pk, name: nameFor(acc.pk, acc.csvName),
    hatTricks: acc.hatTricks, multiGoalGames: acc.multiGoalGames, yellow: acc.yellow, red: acc.red,
  }));

  const mostHatTricks = list
    .filter((p) => p.hatTricks > 0)
    .sort((a, b) => b.hatTricks - a.hatTricks || a.name.localeCompare(b.name))
    .slice(0, RANK_N);
  const mostMultiGoalGames = list
    .filter((p) => p.multiGoalGames > 0)
    .sort((a, b) => b.multiGoalGames - a.multiGoalGames || a.name.localeCompare(b.name))
    .slice(0, RANK_N);
  const mostYellowCards = list
    .filter((p) => p.yellow > 0)
    .sort((a, b) => b.yellow - a.yellow || a.name.localeCompare(b.name))
    .slice(0, RANK_N);
  const mostRedCards = list
    .filter((p) => p.red > 0)
    .sort((a, b) => b.red - a.red || a.name.localeCompare(b.name))
    .slice(0, RANK_N);

  const bestSingleGame = singleGames
    .map((r) => ({ ...r, name: nameFor(r.pk, r.name) }))
    .sort((a, b) => b.g - a.g || `${b.date}`.localeCompare(`${a.date}`) || a.name.localeCompare(b.name))
    .slice(0, RANK_N);

  return { mostHatTricks, mostMultiGoalGames, bestSingleGame, mostYellowCards, mostRedCards };
}

// "Name (ROLE); Name (ROLE)" -> [{name, role}], tolerating a missing/blank string or an entry
// with no parenthesized role.
function parseReferees(referees) {
  return (referees || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const m = /^(.*)\(([^)]*)\)\s*$/.exec(entry);
      return m ? { name: m[1].trim(), role: m[2].trim() } : { name: entry, role: '' };
    });
}

// Assembles one game's match report: score/teams/date from the played-games array (allGames,
// authoritative for the final score), lineups from game_stats.csv (split by side, matched AND
// unmatched rows both kept -- see module note), referees/capture status from game_reports.csv.
// Returns null only when the game_key is unknown to every one of those three sources.
export function buildMatchReport(allGameStats, gameReportsByKey, allGames, sid, gameKey) {
  const game = (allGames || []).find((g) => g.sid === sid && g.game_key === gameKey);
  const report = gameReportsByKey?.get(`${sid}||${gameKey}`);
  const lines = (allGameStats || []).filter((row) => row.sid === sid && row.game_key === gameKey);
  if (!game && !lines.length && !report) return null;

  const shapeLine = (row) => ({
    name: row.name, jersey: row.jersey, pk: row.person_key || '',
    g: num(row.g), a: num(row.a), y: num(row.y), r: num(row.r),
  });
  const home = lines.filter((row) => row.side === 'home').map(shapeLine);
  const away = lines.filter((row) => row.side === 'away').map(shapeLine);

  return {
    sid,
    seasonLabel: game?.seasonLabel || lines[0]?.seasonLabel || '',
    competition: game?.competition || lines[0]?.competition || '',
    roundLabel: game?.round_label || lines[0]?.round_label || '',
    date: game?.date || lines[0]?.date || '',
    homeName: game?.home_name || '',
    awayName: game?.away_name || '',
    homeScore: game ? num(game.home_score) : null,
    awayScore: game ? num(game.away_score) : null,
    referees: parseReferees(report?.referees),
    home, away,
    status: report?.status || '',
  };
}
