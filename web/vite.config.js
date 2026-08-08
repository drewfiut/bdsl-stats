import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The data store lives in ./public/data (a symlink to ../../data), so Vite copies it verbatim
// into dist/. But two of its files are append-only daily time series that grow without bound
// while the app only ever reads their newest day:
//
//   stats.csv     -- one full-roster snapshot of *cumulative* season totals per day (store.py);
//                    the app keeps only the max snapshot_date (latestSnapshotRows, data.js).
//   lag_check.csv -- one roster-vs-element disagreement row per player per day (lagcheck.py),
//                    written on every scheduled refresh; the app keeps only the max check_date
//                    (pendingByPerson, data.js), since an older day's deltas describe an element
//                    state that has since moved on.
//
// Shipping the older days is pure redundant payload. This plugin rewrites each copy under dist/
// after the build, keeping the header + rows from the newest date. The source store under ./data
// is untouched -- it stays the append-only source of truth, and lag_check.csv's history is what
// the lag distribution is read out of (DATA.md 5.8); only the deployed copy is slimmed.
//
// Both files carry that date as their first CSV column, a plain YYYY-MM-DD that is never quoted
// or comma-bearing, so a simple first-field read per line is safe -- no full CSV parse needed.
const DAILY_SERIES_FILES = ['stats.csv', 'lag_check.csv'];

function slimDailySeries() {
  return {
    name: 'slim-daily-series',
    apply: 'build',
    // closeBundle runs after Vite has copied publicDir into outDir, so dist/data exists here.
    closeBundle() {
      const dataDir = join(__dirname, 'dist', 'data');
      let seasonDirs;
      try {
        seasonDirs = readdirSync(dataDir);
      } catch {
        return; // no data dir (e.g. lib-only build) -- nothing to slim
      }

      let savedBytes = 0;
      for (const dir of seasonDirs) {
        for (const name of DAILY_SERIES_FILES) {
          const file = join(dataDir, dir, name);
          let raw;
          try {
            if (!statSync(file).isFile()) continue;
            raw = readFileSync(file, 'utf8');
          } catch {
            continue; // not every season dir has every file (only the live one has lag_check.csv)
          }

          const lines = raw.split('\n');
          // Drop a trailing empty line from a final newline so it doesn't count as a data row.
          if (lines.length && lines[lines.length - 1] === '') lines.pop();
          if (lines.length <= 1) continue; // header only (or empty) -- nothing to trim

          const [header, ...rows] = lines;
          const dateOf = (line) => line.slice(0, line.indexOf(','));
          let latest = '';
          for (const r of rows) {
            const d = dateOf(r);
            if (d > latest) latest = d;
          }
          const kept = rows.filter((r) => dateOf(r) === latest);
          if (kept.length === rows.length) continue; // already a single day -- no change

          const out = `${header}\n${kept.join('\n')}\n`;
          savedBytes += Buffer.byteLength(raw) - Buffer.byteLength(out);
          writeFileSync(file, out);
        }
      }

      if (savedBytes > 0) {
        // eslint-disable-next-line no-console
        console.log(`slim-daily-series: trimmed ${(savedBytes / 1024).toFixed(0)} KiB of superseded daily rows`);
      }
    },
  };
}

// Project Pages are served from https://<user>.github.io/bdsl-stats/, so every asset and
// data fetch must resolve under this base. Use import.meta.env.BASE_URL in app code.
export default defineConfig({
  base: '/bdsl-stats/',
  plugins: [svelte(), slimDailySeries()],
});
