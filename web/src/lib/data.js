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
      const [rows, teams, comps, games] = await Promise.all([
        fetchCsv(`${sid}/stats.csv`),
        fetchJson(`${sid}/teams.json`).catch(() => []), // some seasons may lack standings
        fetchJson(`${sid}/competitions.json`).catch(() => []), // carries each comp's champion
        fetchCsv(`${sid}/games.csv`).catch(() => []),
      ]);
      const label = seasons[sid]?.label || sid;
      return { sid, label, live: isLive(seasons[sid]), rows: latestSnapshotRows(rows), teams, comps, games };
    })
  );

  const allPlayers = [];
  const allTeamStandings = []; // flat teams.json rows tagged with season context
  const allGames = []; // flat games.csv rows (played only) tagged with season context
  // clubId -> [{ sid, label, competition, via }] : the authoritative source of titles, spanning
  // league, Over-35 AND cups (cups have no teams.json, so their titles only live here). A champion
  // is the CHMP playoff winner, which can differ from the regular-season table-topper (position 1).
  const championsByClub = new Map();
  let dataAsOf = '';
  for (const s of perSeason) {
    allPlayers.push(...aggregateSeason(s.rows, s.sid, s.label, s.live));
    for (const t of s.teams) {
      allTeamStandings.push({ ...t, sid: s.sid, seasonLabel: s.label, live: s.live });
    }
    for (const g of s.games) {
      if (g.status === 'played') allGames.push({ ...g, sid: s.sid, seasonLabel: s.label });
    }
    for (const c of s.comps) {
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

  const seasonLabels = ids
    .slice()
    .reverse()
    .map((sid) => seasons[sid]?.label || sid); // newest-first, for the filter dropdown

  return { players: active, allPlayers, allTeamStandings, allGames, championsByClub, playersRegistry, seasonLabels, dataAsOf };
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

// Full profile for one club: all-time totals, per-season competition history (from teams.json,
// newest first), and the roster of every player who appeared for the club (from stats.csv, rolled
// up per person over only that club's competitions). Returns null if the club_id isn't found.
export function buildClubProfile(allTeamStandings, allPlayers, playersRegistry, clubId, championsByClub, allGames) {
  const standings = allTeamStandings.filter((r) => r.club_id === clubId);
  if (!standings.length) return null;

  const { name, totals } = aggregateClub(standings);

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

  // Top opponents: head-to-head record against every club this club has played (played games only,
  // across all competitions/seasons). Opponent name = the newest-season spelling seen for that club.
  const byOpp = new Map();
  for (const g of allGames || []) {
    const gs = num(g.home_score), as = num(g.away_score);
    let oppId, oppName, gf, ga;
    if (g.home_club_id === clubId) { oppId = g.away_club_id; oppName = g.away_name; gf = gs; ga = as; }
    else if (g.away_club_id === clubId) { oppId = g.home_club_id; oppName = g.home_name; gf = as; ga = gs; }
    else continue;
    if (!oppId || oppId === clubId) continue;
    let acc = byOpp.get(oppId);
    if (!acc) { acc = { clubId: oppId, name: oppName, sid: g.sid, played: 0, w: 0, l: 0, d: 0, gf: 0, ga: 0 }; byOpp.set(oppId, acc); }
    if (g.sid >= acc.sid) { acc.name = oppName; acc.sid = g.sid; }
    acc.played += 1; acc.gf += gf; acc.ga += ga;
    if (gf > ga) acc.w += 1; else if (gf < ga) acc.l += 1; else acc.d += 1;
  }
  const topOpponents = [...byOpp.values()]
    .sort((a, b) => b.played - a.played || (b.gf - b.ga) - (a.gf - a.ga) || a.name.localeCompare(b.name))
    .slice(0, 5);

  return { clubId, name, totals, seasons, cups, roster, topOpponents };
}

// ---- team records ----
// League + Over-35 only (teams.json never carries cup rows). Season-total records (most/fewest
// GF/GA, goal differential, points, perfect/winless seasons) only consider COMPLETED seasons --
// the in-progress season's partial totals aren't a fair comparison against a full schedule.
// Game-level records (biggest win, highest scoring game, streaks) use every played game, since
// each individual result is already final even while the season around it is still in progress.

const RANK_N = 10;

function rankedBy(list, key, dir) {
  return list
    .slice()
    .sort((a, b) => dir * (a[key] - b[key]) || b.gp - a.gp || a.name.localeCompare(b.name))
    .slice(0, RANK_N);
}

export function buildTeamRecords(allTeamStandings, allGames) {
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
    .filter((r) => r.gp > 0);

  const mostGF = rankedBy(seasons, 'gf', -1);
  const fewestGF = rankedBy(seasons, 'gf', 1);
  const mostGA = rankedBy(seasons, 'ga', -1);
  const fewestGA = rankedBy(seasons, 'ga', 1);
  const bestGD = rankedBy(seasons, 'gd', -1);
  const worstGD = rankedBy(seasons, 'gd', 1);
  const mostPts = rankedBy(seasons, 'pts', -1);

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
        acc = { clubId: side.clubId, name: side.name, o35: g.comp_type === 'over35', lastSid: '', games: [] };
        byTeam.set(key, acc);
      }
      if (g.sid >= acc.lastSid) { acc.name = side.name; acc.lastSid = g.sid; }
      acc.games.push({
        date: g.date, sid: g.sid, seasonLabel: g.seasonLabel, live: liveSids.has(g.sid),
        result: side.gf > side.ga ? 'W' : side.gf < side.ga ? 'L' : 'D',
      });
    }
  }
  // Longest run of games (in date order) satisfying `ok`, keeping the games at the start/end of
  // the best run so we can report which seasons the streak actually spans.
  const longestRun = (sortedGames, ok) => {
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
  };
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

  return {
    mostGF, fewestGF, mostGA, fewestGA, bestGD, worstGD, mostPts,
    perfect, winless, biggestWins, highestScoring, longestWinStreak, longestUnbeatenStreak,
  };
}
