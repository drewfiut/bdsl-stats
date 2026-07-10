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
    p.comps.push({ c: row.competition, t: row.team_name, g, a, gp });
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

async function buildBoard() {
  const [seasons, playersRegistry] = await Promise.all([
    fetchJson('seasons.json'),
    fetchJson('players.json'),
  ]);
  const ids = Object.keys(seasons).sort(); // oldest -> newest

  const perSeason = await Promise.all(
    ids.map(async (sid) => {
      const rows = await fetchCsv(`${sid}/stats.csv`);
      const label = seasons[sid]?.label || sid;
      return { sid, label, live: isLive(seasons[sid]), rows };
    })
  );

  const allPlayers = [];
  let dataAsOf = '';
  for (const s of perSeason) {
    allPlayers.push(...aggregateSeason(s.rows, s.sid, s.label, s.live));
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

  return { players: active, allPlayers, playersRegistry, seasonLabels, dataAsOf };
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
