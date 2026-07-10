# BDSL Best Single Seasons

Scrapes [bdsl.org](https://bdsl.org) into a local data store and builds a **best single-season
leaderboard**: each row is one *player-season* — a person's **goals, assists, and points
totalled across every competition they played that year** (the six league divisions, the
three cup tournaments Tehel / Wood / Matthews, and the Over-35 division). Ranking the rows
surfaces the best individual seasons across BDSL history. A player's league, cup, and Over-35
lines for a given year collapse into one row; the same person appears once per season played.

Output is a self-contained, sortable **`leaderboard.html`** page (open it in any browser).

## Usage

```bash
pip install -r requirements.txt          # requests, beautifulsoup4, lxml
python leaderboard.py                     # refresh the live season if needed, then build
python leaderboard.py --refresh           # re-collect the live season first, always
python leaderboard.py -o out.html         # write to a different file
python history.py                         # backfill past seasons (see "Historical seasons")
```

The script also prints the top 10 single seasons for points, goals, and assists to the
terminal. Open `leaderboard.html` for the full interactive board: sort by Points / Goals /
Assists, search by player, team, or season, toggle "scorers only", and click any row to
expand that season's per-competition breakdown.

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
- **`collect.py`** — the only module that touches the network. Writes the season's data to
  the store (below) as a dated snapshot.
- **`aggregate.py`** — merges each season's rows by `PERSONKEY` (so a person is one entry per
  season no matter how many teams they're on), then `build_player_seasons()` concatenates
  every season into the player-season board. Points = `2 × goals + 1 × assist` (matching
  BDSL's Points Leaders). Merging by a stable id means two different people who share a name
  are never combined — and the same id across years makes career/single-season views trivial.
- **`render_html.py`** / **`leaderboard.py`** — render the page and drive the run.

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
    competitions.json          the divisions / cups in the season
    teams.json                 teams + full standings records (see below)
    stats.csv                  tidy, append-only fact table (one block of rows per day)
```

`stats.csv` is long-format — one row per *player × competition × day*
(`snapshot_date, fetched_at, person_key, name, tg, competition, comp_type, team_id,
team_name, jersey, position, g, a, gp`). It opens directly in Excel/Sheets/pandas.

`teams.json` carries each team's rank, overall and **home/away** W/L/T, goals for/against/diff,
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
`STATS_REFRESH_HOUR` in `config.py`); later runs that day reuse the day's stored snapshot and
are instant. `--refresh` re-collects immediately regardless. The generated page shows both
"Stats current as of &lt;when the snapshot was fetched&gt;" and when the page itself was
generated, so you can always tell how current the numbers are.

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

## Updating for a new season

Season ids live in the `SEASON` descriptor in `config.py`. When BDSL starts a new season,
open a team page on bdsl.org, read the ids out of the roster iframe URL
(`/72601/teams/<league_section>/<club>-<division>/TEAM.html`), and update `SEASON`
(`id`, `label`, `league_section`, `cup_sections`, elements). Discovery finds the individual
division/cup keys automatically from there, and the new season lands in its own `data/`
folder alongside past ones.
