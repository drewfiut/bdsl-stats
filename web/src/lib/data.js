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
function aggregateSeason(rows, seasonLabel, live) {
  const players = new Map(); // person_key -> accumulator

  for (const row of rows) {
    const pk = row.person_key;
    if (!pk) continue;
    let p = players.get(pk);
    if (!p) {
      p = {
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
      name,
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

export async function loadBoard() {
  const seasons = await fetchJson('seasons.json');
  const ids = Object.keys(seasons).sort(); // oldest -> newest

  const perSeason = await Promise.all(
    ids.map(async (sid) => {
      const rows = await fetchCsv(`${sid}/stats.csv`);
      const label = seasons[sid]?.label || sid;
      return { sid, label, live: isLive(seasons[sid]), rows };
    })
  );

  const players = [];
  let dataAsOf = '';
  for (const s of perSeason) {
    players.push(...aggregateSeason(s.rows, s.label, s.live));
    if (s.live && s.rows.length) {
      // freshest fetched_at of the live season's latest snapshot
      const latest = s.rows.reduce((mx, r) => (r.snapshot_date > mx ? r.snapshot_date : mx), '');
      const stamp = s.rows.find((r) => r.snapshot_date === latest)?.fetched_at || '';
      dataAsOf = stamp;
    }
  }

  // only player-seasons where someone actually took the field (render_html.render)
  const active = players.filter((p) => p.gp > 0 || p.pts > 0);

  const seasonLabels = ids
    .slice()
    .reverse()
    .map((sid) => seasons[sid]?.label || sid); // newest-first, for the filter dropdown

  return { players: active, seasonLabels, dataAsOf };
}
