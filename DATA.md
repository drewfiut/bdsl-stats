# BDSL Data Store — Reference

This document fully specifies the local data store under `data/`: its design principles, file
layout, and every field. **It is written so an agent can understand and consume the data
without opening the actual data files.** If you change the schema, update this document in the
same change.

The data is scraped from bdsl.org (a Demosphere / OTTO SPORT site) by this repo; see
`README.md` for the pipeline and `history.py` for the historical backfill. This file is about
the *stored result*, not the scraper.

---

## 1. Design principles

1. **Store extracted data, never raw HTML.** Each file holds parsed, typed values. Raw pages
   are never cached.
2. **One folder per season**, plus two global registries at the root. A "season" is one
   summer of play, id `"<year>-summer"` (e.g. `2026-summer`).
3. **Global, stable `person_key`.** Every player has a Demosphere person id that is identical
   across every competition *and every season*. It is the only join key you need — never match
   on names. Two different people who share a name keep different keys; one person keeps one
   key for life. This makes career and single-season aggregation a pure group-by.
4. **Facts in CSV, dimensions in JSON.** `stats.csv` is a long-format fact table (one row per
   player × competition × snapshot). Everything else (seasons, competitions, teams, players)
   is a small JSON dimension document you can extend with new fields without touching history.
5. **Append-only snapshots.** `stats.csv` accumulates dated snapshots; nothing is overwritten.
   "The current table" = the rows whose `snapshot_date` is the max in that file.
6. **History is immutable and cached forever.** Past seasons are marked `"final": true` and are
   collected exactly once; their numbers never change. Only the live season is refreshed.
7. **Capture everything the source exposes.** Because a `final` season is fetched only once,
   all available fields are stored up front, even sparse ones.

---

## 2. Directory layout

```
data/
  seasons.json                 registry: season_id -> Demosphere ids + flags        (global)
  players.json                 registry: person_key -> identity                     (global)
  <season_id>/                 one folder per season, e.g. 2014-summer ... 2026-summer
    competitions.json          the divisions / cups played that season
    teams.json                 every team + its full standings record
    stats.csv                  per-player, per-competition stat rows (the fact table)
```

Seasons currently present: `2014-summer` … `2026-summer` (11 historical + the live season).
**2020 does not exist** (season cancelled — COVID).

---

## 3. Global registries

### 3.1 `seasons.json`

Object keyed by `season_id`. Each value:

| Field | Type | Meaning |
|---|---|---|
| `label` | string | Human label, e.g. `"Summer 2026"`. |
| `league_section` | string | Demosphere section id for the league/Over-35 standings that year. |
| `standings_element` | string | Demosphere element id for standings (constant `"47107"`). |
| `cup_sections` | string[] | Cup-index section id(s) for that year's cups. Empty `[]` if none. |
| `cup_index_element` | string | Demosphere element id for the cup index (constant `"46241"`). |
| `schedules_year` | string | The 4-digit year used in cup schedule URLs. |
| `final` | bool | `true` = immutable historical season (collected once). `false` = the live season, refreshed daily. Exactly one season is `false`. |

The `*_section` / `*_element` ids are provenance for the scraper; **consumers of the data can
ignore them.** They are not needed to read stats.

### 3.2 `players.json`

Object keyed by **`person_key`** (string of digits). The global identity registry — one entry
per person across all seasons. A field is present only if a non-empty value was ever seen, so
optional fields may be missing on some entries.

| Field | Type | Presence | Meaning |
|---|---|---|---|
| `last` | string | always | Last name. |
| `first` | string | always | First (legal) name. |
| `middle` | string | optional | Middle name. Rare. |
| `nickname` | string | optional | Preferred display name; when present it's the better name to show. |
| `birthdate` | string | usually | `"MM/DD/YYYY"`. Nearly always present; useful for Over-35 checks. |

Note: this registry stores **identity only** (who the person is). Their stats live in each
season's `stats.csv`, keyed by the same `person_key`.

---

## 4. Per-season files

### 4.1 `<season>/competitions.json`

Array of the competitions that ran that season, in display order. Each entry:

| Field | Type | Meaning |
|---|---|---|
| `competition` | string | Name as shown on the site, e.g. `"Premier"`, `"Over 35 Premier"`, `"Tehel Cup"`. |
| `comp_type` | string | One of `"league"`, `"over35"`, `"cup"` (see §5.2). |
| `tg` | string | Demosphere "team-group" id for this competition; it is the `tg` used in `stats.csv`. |

A season has the six league divisions, one or two Over-35 divisions, and zero–three cups.
Names vary by year — see §5.3.

### 4.2 `<season>/teams.json`

Array, one entry per team in the league/Over-35 standings (cup teams are **not** in this file;
cup team identities appear only inside `stats.csv`). Full standings record:

| Field | Type | Meaning |
|---|---|---|
| `team_id` | string | `"<club_id>-<tg>"`. Matches `team_id` in `stats.csv`. Stable within a season. |
| `club_id` | string | Demosphere club id (the `tm`). A club can field teams in several competitions. |
| `team_code` | string | Short code; usually empty `""`. |
| `tg` | string | Competition team-group id (joins to `competitions.json` / `stats.csv`). |
| `tg_seq` | int | Sort order of the competition within the season. |
| `competition` | string | Competition name (denormalized for convenience). |
| `comp_type` | string | `"league"` or `"over35"` (this file never contains cups). |
| `name` | string | Team name, e.g. `"BSC Raiders"`. |
| `rank` | int | Final/curr. table position within its competition. |
| `gp` `w` `l` `d` | int | Games played, wins, losses, draws (overall). |
| `pts` | int | League points (competition's own scoring, not the goals+assists metric). |
| `gf` `ga` `gd` | int | Goals for, against, difference. |
| `home_w` `home_l` `home_d` | int | Home win/loss/draw split. |
| `away_w` `away_l` `away_d` | int | Away win/loss/draw split. |
| `yellows` | int \| "" | Team yellow-card total. **Recent seasons only** — `""` when the source didn't track it (see §5.4). |
| `reds` | int \| "" | Team red-card total. Same availability caveat as `yellows`. |

### 4.3 `<season>/stats.csv`

The fact table. Long format: **one row per player × competition × snapshot**. A person who
plays a league division, a cup, and an Over-35 division has (at least) three rows in a season.
Header order is fixed:

| Column | Type on disk | Meaning |
|---|---|---|
| `snapshot_date` | `YYYY-MM-DD` | The "league day" this snapshot belongs to (see §5.1). Group/filter on this. |
| `fetched_at` | ISO datetime | Wall-clock time the snapshot was fetched. |
| `person_key` | string | Global person id → join to `players.json` and across seasons. |
| `name` | string | Display name at fetch time (nickname if the person has one, else first + last). Convenience copy; `players.json` is authoritative for identity. |
| `tg` | string | Competition team-group id → join to `competitions.json` / `teams.json`. |
| `competition` | string | Competition name (denormalized). |
| `comp_type` | string | `"league"` / `"over35"` / `"cup"`. |
| `team_id` | string | `"<club_id>-<tg>"` → join to `teams.json` (league/Over-35 only; cup teams aren't in teams.json). |
| `team_name` | string | Team the player is on for this competition. |
| `jersey` | string | Shirt number; may be empty. |
| `position` | string | Position code (e.g. `D`, `M`, `F`); often empty. |
| `g` | int | Goals in this competition. |
| `a` | int | Assists in this competition. |
| `gp` | int | Games played in this competition. |

**Everything in a CSV is text on disk.** `g`, `a`, `gp` are integers; parse them. The repo's
`store.load_snapshot()` already coerces these three to int and returns only the latest
snapshot's rows.

**Points metric:** BDSL's leaderboard scores `points = 2 × g + 1 × a`. This is *not* stored;
compute it. (It is unrelated to the team `pts` column in `teams.json`.)

---

## 5. Key concepts & caveats

### 5.1 Snapshots and `snapshot_date`
The live season is re-collected daily; each collection writes a block of rows stamped with a
`snapshot_date` (the date of the most recent 3am local boundary, so the first run after 3am
starts a new day). Historical seasons have exactly one snapshot. To read a season's current
numbers, take the rows with the **maximum `snapshot_date`** in that file. Older snapshots are
retained for time-series/history and can be ignored otherwise.

### 5.2 `comp_type` values
- `"league"` — the six standard divisions (Premier, Championship, 1st–4th Division).
- `"over35"` — the Over-35 division(s). Same people can also appear in league/cup rows.
- `"cup"` — Tehel / Wood / Matthews knockout cups.

### 5.3 Naming varies by year (don't hardcode names)
Competition names are taken verbatim from the site and drift over time:
- Over-35 is sometimes one division (`"Over 35"`) and sometimes split
  (`"Over 35 Premier"`, `"Over 35 Championship"`). Classification uses the `"Over 35"` prefix,
  so **trust `comp_type`, not the name.**
- Divisions can carry sponsors/typos (`"2nd Division Pepper"`, `"4th Divison"`).
- Cups appear as `"Tehel Cup"`, `"Tehel Cup Bracket"`, `"BDSL Wood Cup Bracket"`, etc.

Group by `comp_type` (and `tg` for a specific competition), not by matching display strings.

### 5.4 Data availability by era (important)
The site goes back further than the useful stats do:
- **Individual goals/assists** exist for **league from 2014** and **cups from 2016**. Earlier
  competitions still produce rows (rosters + games played), but `g`/`a` are `0` because the
  platform didn't track scoring yet. The store only contains 2014-summer onward for this
  reason.
- **Team card totals** (`yellows`/`reds` in `teams.json`) exist for **recent seasons only**;
  they are `""` (empty) for older seasons.
- `position`, `jersey`, `middle`, `nickname` are **sparse** in every season — present when the
  source has them, empty/absent otherwise.

Treat empty scoring in pre-cutoff data as "not recorded," not "scored zero," when it matters.

### 5.5 Cross-season identity
Because `person_key` is stable across seasons, a player who changes teams or divisions between
years is still one identity. Career totals = sum of `g`/`a`/`gp` grouped by `person_key` over
every season's `stats.csv`. Single-season totals = the same group-by *within* one season
(this merges a person's league + cup + Over-35 rows into one season line).

---

## 6. Common derivations (recipes)

- **A season's current stats:** read `<season>/stats.csv`, keep rows at max `snapshot_date`.
- **Per-player season totals ("best single seasons"):** for each season, group its current rows
  by `person_key`, summing `g`/`a`/`gp`; `points = 2g + a`. (This is what the leaderboard
  renders — see `aggregate.build_player_seasons`.)
- **Career totals / who played the most seasons:** group by `person_key` across all seasons.
- **Team standings / tables:** read `<season>/teams.json` directly (already aggregated).
- **Head-to-head of two names that might collide:** they won't merge — distinct people have
  distinct `person_key`s. Always key on `person_key`.

---

## 7. Extending the store

- Add a field to a JSON dimension freely; old files simply lack it (readers should treat
  missing keys as empty). Document it here.
- Add a column to `stats.csv` by appending to `STATS_COLUMNS` in `store.py`; existing rows pad
  blank on the next rewrite. Document it here.
- Add a season by collecting it (`history.py` for past years, the live pipeline for the current
  one). It lands in its own folder; the global registries grow to span it automatically.
