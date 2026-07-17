import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The data store lives in ./public/data (a symlink to ../../data), so Vite copies it verbatim
// into dist/. But each season's stats.csv is an append-only daily time series of *cumulative*
// season totals (store.py) -- the live season accumulates one full-roster snapshot per day and
// grows without bound. The app only ever reads the latest snapshot (see latestSnapshotRows in
// src/lib/data.js), so shipping the older days is pure redundant payload.
//
// This plugin rewrites each dist/data/*/stats.csv after the build copies it, keeping only the
// header + rows from the newest snapshot_date. The source store under ./data is untouched (it
// stays the append-only source of truth); only the deployed copy is slimmed. snapshot_date is the
// first CSV column and is a plain YYYY-MM-DD (never quoted/comma-bearing), so a simple first-field
// read per line is safe -- no full CSV parse needed.
function slimStatsSnapshots() {
  return {
    name: 'slim-stats-snapshots',
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
        const file = join(dataDir, dir, 'stats.csv');
        let raw;
        try {
          if (!statSync(file).isFile()) continue;
          raw = readFileSync(file, 'utf8');
        } catch {
          continue; // not every season dir has a stats.csv
        }

        const lines = raw.split('\n');
        // Drop a trailing empty line from a final newline so it doesn't count as a data row.
        if (lines.length && lines[lines.length - 1] === '') lines.pop();
        if (lines.length <= 1) continue; // header only (or empty) -- nothing to trim

        const [header, ...rows] = lines;
        const snapshotDateOf = (line) => line.slice(0, line.indexOf(','));
        let latest = '';
        for (const r of rows) {
          const d = snapshotDateOf(r);
          if (d > latest) latest = d;
        }
        const kept = rows.filter((r) => snapshotDateOf(r) === latest);
        if (kept.length === rows.length) continue; // already a single snapshot -- no change

        const out = `${header}\n${kept.join('\n')}\n`;
        savedBytes += Buffer.byteLength(raw) - Buffer.byteLength(out);
        writeFileSync(file, out);
      }

      if (savedBytes > 0) {
        // eslint-disable-next-line no-console
        console.log(`slim-stats-snapshots: trimmed ${(savedBytes / 1024).toFixed(0)} KiB of redundant stats.csv snapshots`);
      }
    },
  };
}

// Project Pages are served from https://<user>.github.io/bdsl-stats/, so every asset and
// data fetch must resolve under this base. Use import.meta.env.BASE_URL in app code.
export default defineConfig({
  base: '/bdsl-stats/',
  plugins: [svelte(), slimStatsSnapshots()],
});
