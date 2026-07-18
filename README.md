# BDSL Stats

A comprehensive, unofficial stats hub for the **Buffalo District Soccer League** — standings,
champions, club and player records pulled together across **every season on record (2008–present)**.
It scrapes [bdsl.org](https://bdsl.org) into a local data store and renders it as a fast,
backend-free web app.

The site is a **Svelte single-page app** in [`web/`](web/) that reads the static `data/` store
directly in the browser and does all the aggregation client-side — no server, no database. It's
deployed to **GitHub Pages** by a GitHub Actions workflow.

## What's on the site

Everything is derived from the same `data/` store. The app groups its pages into **team** and
**individual** views, plus a few hubs:

- **Seasons** — every BDSL season in one hub: final standings for each division, every champion,
  and that year's top scorers/assisters. Drills into a single **Season** (all competitions),
  a single **Team-season** (roster, schedule, standings, playoffs), and per-game **Match Reports**.
- **Trends** — league-wide metrics tracked across every season: goals per game, age curves,
  match-outcome mix, division spread, scoring concentration, roster retention, and more.
- **Champions** — every league, Over-35 and cup champion by season, plus a most-decorated-clubs
  leaderboard with titles broken down by type and each club's current title drought.
- **Clubs** — every club in BDSL history with all-time records, season-by-season competition
  history, and the full roster of players who suited up. Individual **Club** pages included.
- **Power Rankings** — all-time **Elo** ratings computed from every league and cup result:
  current rankings for the live season, the strongest teams ever by peak rating, and
  rating-over-time charts.
- **Team Records** — most/fewest goals, best/worst goal differentials, perfect seasons, winning
  and scoring streaks, and more, across league and Over-35 play.
- **Head-to-Head** — pick any two clubs and see their all-time record: meetings, W/L/D, biggest
  wins, and the full history of every game they've played.
- **Players** — every player in BDSL history with all-time totals; open any player's full profile.
- **Best Single Season (All Comps)** — each player's single-season goals/assists/points totalled
  across **every** competition they played that year (the league divisions, the Tehel / Wood /
  Matthews cups, and Over-35), ranked to surface the best individual seasons in BDSL history.
- **Player Records** — all-time individual leaderboards: career goals, assists, points and games
  played, best goals-per-game, Golden Boot winners by season, and youngest/oldest age records.

### Data completeness

Coverage depends on the season, because BDSL's record-keeping improved over time:

| Era | What's available |
| --- | --- |
| **2017–present** | Everything — standings, champions, and full individual goal/assist stats (most reliable). |
| **2014–2016** | Individual scoring begins in 2014; solid but a little thinner in the first years. |
| **2008–2013** | Team data only — standings, champions, team goals. Individual scorers weren't tracked. |
| **Before 2008** | No data exists. |

Caveats: games-played (GP) counts are never fully reliable; per-game breakdowns come from match
reports managers didn't always fill in (so game-by-game and cup scoring can be undercounted); and
**there is no 2020 season** — it was cancelled due to COVID-19.

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
python backfill_reports.py                # one-off: fill Match Report scoring lines for past seasons
```

`update_data.py` refreshes the live season's stats, **games** (full schedule/results), each
competition's computed standings and true (playoff) champion, and any new/late **Match Reports**.
The `backfill_*` scripts are one-offs that add those data sets to already-collected past seasons —
see "Historical seasons".

Then commit the changed files so GitHub Pages serves them:

```bash
git add data/ && git commit -m "Refresh BDSL data" && git push
```

Pushing to `main` triggers the deploy workflow, which rebuilds and republishes the site. A
scheduled GitHub Action also refreshes the data twice weekly (see `.github/workflows/`).

### Rolling over to a new season

The active season is hand-maintained in `config.py`'s `SEASON` dict, so nothing switches
automatically when a season ends — the scheduled action would otherwise keep re-collecting a
season that's already over. When every division and cup has crowned its champion,
`update_data.py` prints a prominent warning after its run telling you the season looks
complete. At that point, mark `"final": True` in `config.SEASON` and update it with the new
season's ids (`config.py`'s module docstring explains how to read those ids off bdsl.org).

### Run the app locally (Node)

```bash
cd web
npm install
npm run dev        # dev server; open the printed http://localhost:5173/bdsl-stats/ URL
npm run build      # production build into web/dist (what CI deploys)
npm run preview    # serve the production build locally
```

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
- **`matchreports.py`** + **`attribution.py`** — fetch each game's **Match Report** (per-player
  scoring lines, cards, referees) and resolve its name+jersey lines to stable `person_key`s via
  a roster join, emitting `game_stats.csv`.
- **`standings.py`** — pure reconciliation over the fetched data: computes each team's `position`
  (from points/GD/GF, replacing the untrusted source rank) and each competition's true
  **champion** (the winner of the `CHMP` playoff final — which can differ from the table-topper).
- **`champions.py`** — resolves each competition's champion, backfilling from bdsl.org's
  authoritative champion-history table where the `CHMP` game leaves it undetermined.
- **`collect.py`** — the only module that touches the network. Writes the season's data to
  the store (below): a dated stats snapshot plus games, computed standings, champions, and reports.
- **`aggregate.py`** — merges each season's rows by `PERSONKEY` (so a person is one entry per
  season no matter how many teams they're on), then `build_player_seasons()` concatenates
  every season into the player-season board. Points = `2 × goals + 1 × assist` (matching
  BDSL's Points Leaders). Merging by a stable id means two different people who share a name
  are never combined — and the same id across years makes career/single-season views trivial.
- **`update_data.py`** — the command you run to refresh the live season into `data/`.
- **`web/`** — the Svelte SPA. `web/src/lib/data.js` is a client-side aggregation layer (fetch
  each season's data, merge by `person_key`, shape rows, compute Elo/records/trends);
  `web/src/routes/*` are the pages, wired by a small hash router (`web/src/lib/router.js`). The
  app consumes the static store — it never talks to bdsl.org.

## Data store

**Full schema and field reference: [`DATA.md`](DATA.md)** — read that to understand and
consume the data without opening the files. The overview below is a summary.

Extracted data (not raw HTML) is kept under `data/`, so it survives, accumulates history,
and is easy to inspect or analyse:

```
data/
  seasons.json                 registry of seasons -> their Demosphere ids
  players.json                 global person registry: person_key -> name, middle, birthdate
  2026-summer/                 one folder per season (2008-summer ... 2026-summer)
    competitions.json          the divisions / cups in the season (+ each one's champion)
    teams.json                 teams + full standings records
    stats.csv                  tidy fact table: one row per player × competition × snapshot
    games.csv                  every game played + score + playoff round label
    game_stats.csv             per-player scoring lines from each game's Match Report
    game_reports.csv           capture ledger for Match Reports (which games are done)
```

`stats.csv` is long-format — one row per *player × competition × day*
(`snapshot_date, fetched_at, person_key, name, tg, competition, comp_type, team_id,
team_name, jersey, position, g, a, gp`). It opens directly in Excel/Sheets/pandas.

`games.csv` is the match fact table — one row per game (`game_key`, teams + club ids, `date`,
score, `status`, and `round_label`). `competitions.json` records each competition's **champion**
(`champion_club_id`), computed from the `CHMP` game or backfilled from bdsl.org's authoritative
champion history table. `teams.json` carries each team's computed **`position`**, overall and
home/away W/L/T, goals for/against/diff, points, and yellow/red card totals (recent seasons only).
See [`DATA.md`](DATA.md) for every field.

This model is built to grow:
- **History** — the live season appends a new daily snapshot; past seasons are `final` and
  cached forever, so numbers never change once collected.
- **Many seasons** — `person_key` and the season id are global, so seasons are just more folders
  and `players.json` spans them. Career totals are a plain merge by `person_key`.
- **More data** — `teams.json` carries the full standings record; `players.json` carries
  birthdates and middle names (e.g. for Over-35 eligibility checks); Match Reports add per-game
  detail on top of season totals.

## Data freshness

A new snapshot of the live season is collected on the **first run after 3am** each day
(configurable via `STATS_REFRESH_HOUR` in `config.py`); later `update_data.py` runs that day reuse
the day's stored snapshot and are instant. `--force` re-collects immediately. The app shows
"current as of &lt;when the snapshot was fetched&gt;", so you can always tell how current the
numbers are.

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

Scope is **2008–2025** (`HISTORY_YEARS` in `config.py`; 2020 was cancelled). Demosphere only
began tracking individual goals/assists in **2014** for the league and **2016** for the cups —
2008–2013 exist on the site as team data (standings, champions, team goals) but have no scorer
data. Historical seasons are marked `final` and **cached indefinitely**: once stored they are
skipped on later runs, so `history.py` is safe to re-run and only fills gaps.

Because past seasons are cached and skipped, adding a new data set to them needs a dedicated
backfill:
- `python backfill_games.py` — walks every stored season, fetches each competition's full
  schedule into `games.csv`, and (re)computes the standings `position` + playoff `champion`.
- `python backfill_reports.py` — walks every stored season, fetches per-game Match Reports into
  `game_stats.csv` / `game_reports.csv`.

Both skip seasons that already have the data (use `--force` to redo, `--season <id>` for one).

## Updating for a new season

Season ids live in the `SEASON` descriptor in `config.py`. When BDSL starts a new season,
open a team page on bdsl.org, read the ids out of the roster iframe URL
(`/72601/teams/<league_section>/<club>-<division>/TEAM.html`), and update `SEASON`
(`id`, `label`, `league_section`, `cup_sections`, elements). Discovery finds the individual
division/cup keys automatically from there, and the new season lands in its own `data/`
folder alongside past ones.
