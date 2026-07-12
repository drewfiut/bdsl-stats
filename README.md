# BDSL Best Single Seasons

Scrapes [bdsl.org](https://bdsl.org) into a local data store and builds a **best single-season
leaderboard**: each row is one *player-season* — a person's **goals, assists, and points
totalled across every competition they played that year** (the six league divisions, the
three cup tournaments Tehel / Wood / Matthews, and the Over-35 division). Ranking the rows
surfaces the best individual seasons across BDSL history. A player's league, cup, and Over-35
lines for a given year collapse into one row; the same person appears once per season played.

The site is a **Svelte single-page app** in [`web/`](web/) that reads the static `data/` store
directly in the browser and does all the aggregation client-side — no backend. It's deployed to
**GitHub Pages** by a GitHub Actions workflow.

## Usage

Two independent parts: a Python command that **refreshes the data**, and the **Svelte app** that
renders it.

### Refresh the data (Python)

```bash
pip install -r requirements.txt          # requests, beautifulsoup4, lxml
python update_data.py                     # refresh the live season into data/ (if not done today)
python update_data.py --force             # re-collect the live season even if already done today
python history.py                         # backfill past seasons (see "Historical seasons")
python backfill_games.py                  # one-off: fill games.csv + standings/champion for past seasons
```

`update_data.py` also refreshes the live season's **games** (full schedule/results) and, from those,
each competition's computed standings and true (playoff) champion. `backfill_games.py` is a one-off
that adds those to already-collected past seasons — see "Historical seasons".

Then commit the changed files so GitHub Pages serves them:

```bash
git add data/ && git commit -m "Refresh BDSL data" && git push
```

Pushing to `main` triggers the deploy workflow, which rebuilds and republishes the site.

### Run the app locally (Node)

```bash
cd web
npm install
npm run dev        # dev server; open the printed http://localhost:5173/bdsl-stats/ URL
npm run build      # production build into web/dist (what CI deploys)
npm run preview    # serve the production build locally
```

The board: sort by Points / Goals / Assists, filter by season, search by player or team,
toggle "scorers only", and click any row to expand that season's per-competition breakdown.
The in-progress season is highlighted.

## Deployment (GitHub Pages)

`.github/workflows/deploy.yml` builds `web/` and publishes it on every push to `main`. The app
is a **project page**, so Vite's `base` is `/bdsl-stats/` (see `web/vite.config.js`) — change it
if the repo is renamed. The `data/` store is served alongside the app via a committed symlink
`web/public/data -> ../../data`, so there's a single source of truth and no data duplication.

**One-time setup:** in the repo's **Settings → Pages**, set **Source: GitHub Actions**. After the
first successful run the site is live at `https://<user>.github.io/bdsl-stats/`.

## How it works

bdsl.org runs on Demosphere / OTTO SPORT; the public data lives on
`elements.demosphere-secure.com` (no login required). The pipeline separates **fetching**
from **persisting**:

- **`discover.py`** — finds each competition's team-group key (`tg`): the six divisions and
  Over-35 from the standings element, the three cups from the cup index element. Also exposes
  each league/Over-35 team's standings record.
- **`parse_stats.py`** — for a `tg`, fetches the "stats" element (Demosphere element `928`)
  and parses its embedded JSON. Each record has a **global `PERSONKEY`** plus goal / assist /
  games-played counts. This is the same data behind the site's official "Top 10 Stats"
  leaders, and a superset of the per-team roster pages (it still credits players who later
  left a team but scored earlier).
- **`schedules.py`** — for a `tg`, fetches the competition's full schedule/results page(s) and
  parses every game (stable `game_key`, home/away club ids, score, and playoff round label such
  as `QF`/`SF`/`CHMP`). League/Over-35 schedules are month-paginated, so it walks each month.
- **`standings.py`** — pure reconciliation over the fetched data: computes each team's `position`
  (from points/GD/GF, replacing the untrusted source rank) and each competition's true
  **champion** (the winner of the `CHMP` playoff final — which can differ from the table-topper).
- **`collect.py`** — the only module that touches the network. Writes the season's data to
  the store (below): a dated stats snapshot plus games, computed standings, and champions.
- **`aggregate.py`** — merges each season's rows by `PERSONKEY` (so a person is one entry per
  season no matter how many teams they're on), then `build_player_seasons()` concatenates
  every season into the player-season board. Points = `2 × goals + 1 × assist` (matching
  BDSL's Points Leaders). Merging by a stable id means two different people who share a name
  are never combined — and the same id across years makes career/single-season views trivial.
- **`update_data.py`** — the command you run to refresh the live season into `data/`.
- **`web/`** — the Svelte SPA. `web/src/lib/data.js` is a client-side port of `aggregate.py`
  (fetch each season's `stats.csv`, merge by `person_key`, shape rows); `web/src/App.svelte`
  renders the interactive board. The app consumes the static store — it never talks to bdsl.org.

## Data store

**Full schema and field reference: [`DATA.md`](DATA.md)** — read that to understand and
consume the data without opening the files. The overview below is a summary.

Extracted data (not raw HTML) is kept under `data/`, so it survives, accumulates history,
and is easy to inspect or analyse:

```
data/
  seasons.json                 registry of seasons -> their Demosphere ids
  players.json                 global person registry: person_key -> name, middle, birthdate
  2026-summer/                 one folder per season (2014-summer ... 2026-summer)
    competitions.json          the divisions / cups in the season (+ each one's champion)
    teams.json                 teams + full standings records (see below)
    stats.csv                  tidy, append-only fact table (one block of rows per day)
    games.csv                  every game played + score + playoff round label (one row per game)
```

`stats.csv` is long-format — one row per *player × competition × day*
(`snapshot_date, fetched_at, person_key, name, tg, competition, comp_type, team_id,
team_name, jersey, position, g, a, gp`). It opens directly in Excel/Sheets/pandas.

`games.csv` is the match fact table — one row per game (`game_key`, teams + club ids, `date`,
score, `status`, and `round_label` = `QF`/`SF`/`CHMP` for playoff games). `competitions.json`
records each competition's **champion** (`champion_club_id`), computed from the `CHMP` game — which
can differ from the regular-season table-topper. Champions the `CHMP` game leaves undetermined
(penalty-shootout finals, untagged cup finals) are backfilled from bdsl.org's authoritative
champion history table (`champion_via: "history-table"`). See [`DATA.md`](DATA.md) §4.4 / §5.6.

`teams.json` carries each team's computed **`position`** (regular-season table order — the source
`rank` is no longer trusted or stored), overall and **home/away** W/L/T, goals for/against/diff,
points, and **yellow/red card totals** (recent seasons only). Every field the source exposes
is captured, since historical seasons are fetched once and cached forever.

This model is built to grow:
- **History** — each run appends a new daily snapshot; nothing is overwritten, so you build a
  time series automatically. "Current" = the rows with the latest `snapshot_date`; use
  `--date` to rebuild any past day.
- **Many seasons** — `person_key` and the season id are global, so seasons are just more
  folders and `players.json` spans them. Career totals are a plain merge by `person_key`
  across every season's `stats.csv` (no name matching).
- **More team data** — `teams.json` carries the full standings record; `players.json` carries
  birthdates and middle names (e.g. for Over-35 eligibility checks).

## Data freshness

A new snapshot is collected on the **first run after 3am** each day (configurable via
`STATS_REFRESH_HOUR` in `config.py`); later `update_data.py` runs that day reuse the day's
stored snapshot and are instant. `--force` re-collects immediately regardless. The app shows
"current as of &lt;when the snapshot was fetched&gt;" (read from the live season's latest
`fetched_at`), so you can always tell how current the numbers are.

## Historical seasons

`history.py` backfills past seasons into the same store, discovering each year's Demosphere
ids straight off public bdsl.org pages (`/standings/<year>` for the league/Over-35 section,
`/league-history/<cup>` for the per-year cup sections) — no ids to hand-enter.

```bash
python history.py                 # collect every season not yet stored
python history.py --year 2019     # just one season
python history.py --harvest-only  # print the discovered ids, fetch no stats
python history.py --force         # re-collect seasons already stored
```

Scope is **2014–2025** (`HISTORY_YEARS` in `config.py`; 2020 was cancelled). Demosphere only
began tracking individual goals/assists in **2014** for the league and **2016** for the cups —
earlier years exist on the site but have no scorer data. Historical seasons are marked `final`
and **cached indefinitely**: once stored they are skipped on later runs (their numbers never
change), so `history.py` is safe to re-run and only fills gaps. The result is 12 seasons in the
store; a career leaderboard is a merge by `person_key` across every season's `stats.csv`.

Because past seasons are cached and skipped, adding a new data set to them needs a dedicated
backfill. `python backfill_games.py` walks every stored season, fetches each competition's full
schedule into `games.csv`, and (re)computes the standings `position` + playoff `champion` from
those games — without re-fetching stats. It skips seasons that already have `games.csv` (use
`--force` to redo, `--season <id>` for one). Games/results exist for every season back to 2014
(they're month-paginated on the source; the collector fetches every month).

## Updating for a new season

Season ids live in the `SEASON` descriptor in `config.py`. When BDSL starts a new season,
open a team page on bdsl.org, read the ids out of the roster iframe URL
(`/72601/teams/<league_section>/<club>-<division>/TEAM.html`), and update `SEASON`
(`id`, `label`, `league_section`, `cup_sections`, elements). Discovery finds the individual
division/cup keys automatically from there, and the new season lands in its own `data/`
folder alongside past ones.
