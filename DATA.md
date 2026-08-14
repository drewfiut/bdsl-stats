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
    competitions.json          the divisions / cups played that season (+ each one's champion)
    teams.json                 every team + its full standings record (+ computed position)
    stats.csv                  per-player, per-competition stat rows (the fact table)
    games.csv                  every game played, with score / round label (the game fact table)
    game_stats.csv             per-player scoring lines from each game's Match Report
    game_reports.csv           capture ledger for Match Reports (which games are done)
    lag_check.csv              diagnostic only: element-vs-roster-page disagreements (§4.7)
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
| `nickname` | string | optional | What the player goes by (`"AJ"` for Ivan Wangue). Shown on their profile only — every table and stat line uses `first` + `last`. |
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
| `champion_club_id` | string | `club_id` of the competition's **champion** (the trophy winner), or `""` if undecided. See §5.6. Joins to `teams.json` `club_id` / `stats.csv` team club ids. |
| `champion_name` | string | Champion team's name (denormalized), or `""`. |
| `champion_via` | string | How the champion was decided: `"playoff"` (won the `CHMP` final), `"regular"` (no playoff that year → regular-season leader), `"history-table"` (backfilled from bdsl.org's authoritative league/cup "Champion/Finalist/Result" history table — used for penalty-decided finals, untagged cup/bracket finals, and old-scheme seasons the `CHMP`-game logic leaves undetermined), or `""` (undecided — season in progress, or a competition the history table doesn't list either). See §5.6. |

A season has the six league divisions, one or two Over-35 divisions, and zero–three cups.
Names vary by year — see §5.3. **The champion is the trophy winner and can differ from the
regular-season table-topper (`teams.json` `position == 1`)** — see §5.6.

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
| `position` | int | **Computed** regular-season table position within its competition (1 = top), from `pts`, then `gd`, then `gf`, then name. Replaces the old source `rank`, which is no longer stored (it ignored the playoffs and was mis-read as "champion"). **`position == 1` means "topped the table," not "won the title"** — the champion is in `competitions.json` (§4.1, §5.6). |
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
| `fetched_at` | ISO datetime | Wall-clock time the snapshot was fetched, in `config.LEAGUE_TZ` with a UTC offset (`2026-08-04T19:53:24-04:00`). Rows written before Aug 2026 have no offset and are league-local. |
| `person_key` | string | Global person id → join to `players.json` and across seasons. |
| `name` | string | Display name at fetch time: first + last (nickname only if there's no first name). Convenience copy; `players.json` is authoritative for identity. **Rows written before Aug 2026 used the nickname when the person had one**, so ~176 people appear under a nickname in older snapshots — join to `players.json` rather than trusting this column for identity. |
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

(Note: this file's `position` column is a **player position code** (D/M/F) — unrelated to the
`position` standings field in `teams.json`.)

### 4.4 `<season>/games.csv`

Every game on the schedule/results pages, across all competitions. **One row per game**, keyed by
the stable Demosphere `game_key`. Rewritten wholesale on each collect (a game's result is its
result — no dated snapshots). Includes both played and not-yet-played games. Header order is fixed:

| Column | Type on disk | Meaning |
|---|---|---|
| `game_key` | string | Stable Demosphere game id. Unique within (and across) seasons; the dedup/join key. |
| `tg` | string | Competition team-group id → join to `competitions.json` / `teams.json` / `stats.csv`. |
| `competition` | string | Competition name (denormalized). |
| `comp_type` | string | `"league"` / `"over35"` / `"cup"`. |
| `game_number` | string | Human-facing game number shown on the site (e.g. `7032`). |
| `round_label` | string | **Playoff round tag**: `""` for regular-season games; `QF1`–`QF4` (quarterfinal), `SF1`/`SF2` (semifinal), `CHMP`/`CHAMP` (championship final). This is how the champion is identified (§5.6). |
| `date` | `YYYY-MM-DD` \| "" | Kickoff date (`""` if the source didn't give a parseable date). |
| `time` | string | Kickoff time as shown, e.g. `"8:30 pm"`; may be empty. |
| `home_club_id` | string | Home team's Demosphere club id → joins to `teams.json` `club_id`. May be `""` for an unfilled bracket slot. |
| `home_name` | string | Home team name. |
| `away_club_id` | string | Away team's club id (same join). |
| `away_name` | string | Away team name. |
| `home_score` | int \| "" | Home goals; `""` if not yet played. |
| `away_score` | int \| "" | Away goals; `""` if not yet played. |
| `status` | string | `"played"` (a score was posted) or `"scheduled"`. |
| `result_note` | string | Trailing marker on the score, e.g. `"FT"`, `"PK"` (penalties); usually `""`. |
| `location` | string | Field / facility name; may be empty. |

**Availability:** fixtures + final scores exist for **every season 2014→present** (older seasons
are month-paginated; the collector fetches every month). Per-game detail beyond the score (goal
scorers, cards, referees, lineups — visible in the site's per-game "Match Report") is **not**
captured in this file — see §4.5/§4.6. Score-only means a final decided on penalties shows the
level regulation score with `result_note="PK"` and does **not** record the shootout winner (see
§5.6).

### 4.5 `<season>/game_stats.csv`

Per-player scoring lines pulled from each played game's Demosphere "Match Report" page (see
`matchreports.py`). **One row per player per game** they appear on the report's PLAYED/STATS
table (only players with a recorded event — goal, assist, or card — appear on that table, so
this file is much sparser than `stats.csv`). Rewritten wholesale each collect, same as
`games.csv` — no dated snapshots. Header order is fixed:

| Column | Type on disk | Meaning |
|---|---|---|
| `game_key` | string | → join to `games.csv` / `stats.csv`. |
| `tg` | string | Competition team-group id (denormalized). |
| `competition` | string | Competition name (denormalized). |
| `comp_type` | string | `"league"` / `"over35"` / `"cup"` (denormalized). |
| `date` | `YYYY-MM-DD` \| "" | Kickoff date (denormalized from `games.csv`). |
| `round_label` | string | Playoff round tag (denormalized from `games.csv`; see §4.4). |
| `side` | string | `"home"` or `"away"`. |
| `club_id` | string | The player's club id for this game → joins to `teams.json` `club_id`. |
| `person_key` | string \| "" | Resolved global person id → join to `players.json` / `stats.csv`. **Blank if the roster join couldn't resolve the row** — see §5.7; the row is kept either way, never dropped. |
| `name` | string | Name **verbatim from the Match Report**, `"Last, First"` — not the display convention used elsewhere in the store. |
| `jersey` | string | Shirt number as printed on the report; may be empty. |
| `g` | int | Goals in this game. |
| `a` | int | Assists in this game. |
| `y` | int | Yellow cards in this game (counted by card icon, not a digit — see `matchreports.py`). |
| `r` | int | Red cards in this game. |
| `matched` | string | How `person_key` was resolved: `"jersey"`, `"name"`, or `""` (unresolved). See §5.7. |

**Points per game** = `2*g + 1*a` (same convention as `stats.csv`, see §4.3).

### 4.6 `<season>/game_reports.csv`

The capture ledger: one row per game whose Match Report has been fetched, used by `collect.py`
to decide which games still need (re)fetching (see §5.7) and by `backfill_reports.py` to record
its own run. Not a fact table for analysis — `game_stats.csv` is. Header order is fixed:

| Column | Type on disk | Meaning |
|---|---|---|
| `game_key` | string | → join to `games.csv` / `game_stats.csv`. |
| `tg` | string | Competition team-group id (denormalized). |
| `report_url` | string | Full URL fetched, `config.ELEMENTS_BASE + report_path`. |
| `captured_at` | ISO datetime | Wall-clock time of this capture attempt, same format as `fetched_at` (the two are compared directly in `update_data.py`). |
| `status` | string | `"captured"` (parsed successfully — any scoring lines are in `game_stats.csv`; a clean 0–0-type report with no recorded events is still "captured" with no rows), `"missing"` (no Match Report exists under any candidate section — `backfill_reports.py` probes the season's league/cup section ids), or `"error"` (fetch/parse failed). All three put the game_key *in the ledger*, so — like a `"captured"` row — it's only retried within the recent-game recapture window (see §5.7), not on every run. |
| `referees` | string | `"Name (ROLE); Name (ROLE)"` for however many officials the report lists; `""` if none or on error. |

---

### 4.7 `<season>/lag_check.csv`

Written by `lagcheck.py`, which the scheduled refresh runs right after `update_data.py` (it stays
out of `collect.py` itself — see §5.8). It records how far the stats element (the source of
`stats.csv`) trails the live per-club Team Roster pages, which render the same manager-entered
numbers without waiting for Demosphere to recompute — see §5.8 for what the file is for and how
to read a lag out of it. One dated row per player whose two readings disagree; players who agree
are not written, and re-running on the same `check_date` replaces that date's rows.

Two consumers, and they want different things from it. The **lag measurement** reads the whole
append-only history (§5.8). The **web app** reads only the newest `check_date`, to show provisional
totals on the Best Single Seasons board and player pages — and it does *not* trust the stored
deltas; see the end of §5.8 for the rule it applies instead. The deployed copy under `dist/` is
slimmed to that newest day by the `slim-daily-series` Vite plugin, exactly as `stats.csv` is; the
store here keeps every day.

| Column | Type on disk | Meaning |
|---|---|---|
| `check_date` | date | League-day of the check (same 3am boundary as `snapshot_date`, §5.1). |
| `checked_at` | ISO datetime | Wall-clock time of the run. |
| `tg` / `competition` / `comp_type` | string | The competition (denormalized, as elsewhere). |
| `club_id` / `team_name` | string | The club whose roster page was read. |
| `person_key` | string | The element's key when the row matched; the roster page's own key when it didn't; `""` for an unmatched cup row (cup roster pages carry no player links — see §5.8). |
| `name` | string | Name verbatim from the roster page, `"Last, First"`. |
| `page_gp` / `page_g` / `page_a` | int | Games played / goals / assists as the roster page shows them. |
| `el_gp` / `el_g` / `el_a` | int | The same three from the stats element, fetched in the same run. `0/0/0` when the player has no element record at all. |
| `d_gp` / `d_g` / `d_a` | int | `page − element`. Positive = the roster page is ahead (the usual case: entered but not yet recomputed); negative = the element is ahead (an earlier entry was edited downward). |
| `matched` | string | How the two rows were joined: `"key"` (person key, league/Over-35), `"name"` (normalized name, the only option on cup pages), or `""` (no element record found). |

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

### 5.6 Champion ≠ table-topper (important)
Each division and cup is decided by an **end-of-season playoff bracket**, not by the league table.
The champion is the winner of the game tagged `CHMP` (`games.csv` `round_label`), and is stored on
each competition in `competitions.json` (`champion_club_id` / `champion_name` / `champion_via`).
This is **not** the same as `teams.json` `position == 1`: a team can top the table and still lose in
the playoffs. Example — Summer 2023 4th Division: Infinity FC finished `position 1`, but lost their
semifinal; **Bangarang FC** won the `CHMP` game and is the champion.

Counting titles or crowning a champion, **use `competitions.json` `champion_club_id`, never
`position`.** `champion_via` tells you how it was decided: `"playoff"` (won the `CHMP` game),
`"regular"` (no playoff that year), or `"history-table"` (bdsl.org's authoritative "Champion/
Finalist/Result" history table). That third source is what now resolves most of the cases the
`CHMP`-game logic can't — a final settled on penalties (the score-only `games.csv` can't record a
shootout winner — see §4.4), an old cup/bracket final that was never tagged `CHMP`, or an
old-numeric-label season — as long as the table's named winner matches a team already on record
for that competition; the fill is conservative and leaves the competition blank otherwise. `""`
still means genuinely undecided — the live season in progress, or a competition the history table
doesn't list either. Treat `""` as "unknown," not "no champion."

### 5.7 Match Report attribution: roster join, `matched`, and capture cadence (important)
`game_stats.csv` doesn't come with `person_key` for free. A Match Report page (see
`matchreports.py`) identifies a player only by **name (verbatim `"Last, First"`) and jersey
number** — never a person key. `attribution.py` resolves each report line to a `person_key` with
a roster join against that game's `(tg, club_id)` slice of `stats.csv`: try an **exact, unambiguous
name match** first (normalized — case/punctuation/word-order insensitive — checked against both the
stats row's display name and, when available, `players.json`'s `first`+`last`); if the name doesn't
resolve, fall back to an **exact, unambiguous jersey match**. **Name is tried before jersey on
purpose:** a name is unique to one person on a roster, whereas jersey numbers collide — a messy
report occasionally lists two different players under the same number, and jersey-first would then
mis-attribute both lines to the single roster owner of that number. If a name or jersey maps to
more than one person on the roster (or to nobody), the line is left unresolved.

**Home/away isn't taken from the report's table order.** A Match Report's two team tables are *not*
reliably ordered home-then-away — some reports list the teams opposite to the schedule's home/away
designation. So `attribution.py` doesn't trust table position: it scores both orientations by how
well each team table's lines fit the home vs away roster (weighting name agreement above jersey,
since jerseys collide) and keeps the better fit. The `side`/`club_id` on every row therefore
reflect the schedule's true home/away, not the report's layout. (The `matchreports.py` parser
similarly tolerates both the recent 4-table layout and the older 2-table one — see that module.)

**A row is never dropped for failing to resolve.** `game_stats.csv` keeps every scoring line the
report showed; an unresolved row simply has `person_key=""` and `matched=""`. Check `matched`
before trusting a row is joined to the right person — `"jersey"` and `"name"` are both confident
single matches, `""` means the g/a/y/r on that row aren't attributed to anyone yet. Don't
recompute a player's totals from `game_stats.csv` and expect them to equal `stats.csv`'s
`g`/`a` for the same competition: `stats.csv` comes straight from bdsl.org's own per-player
totals (always complete); `game_stats.csv` is a **best-effort reconstruction** of the per-game
breakdown behind those totals, gated on both a Match Report existing for the game and the
roster join resolving it.

**Capture cadence.** Match Reports are fetched incrementally, not re-fetched wholesale every
run: `collect.py` (re)captures a played game's report only if its `game_key` isn't yet in
`game_reports.csv`'s ledger, or if the game's `date` falls within the last 21 days (bdsl.org
sometimes enters a report's stats a few days after the game — this "late-stat-entry window"
keeps recent games fresh without re-fetching the whole season's history every run). Games
outside that window that are already in the ledger — including ones that previously errored
(`status="error"`) — are left alone until backfilled with `--force`. `backfill_reports.py`
instead captures **every** played game with a report in one pass, for seeding a season that
predates this feature.

**Availability** mirrors `stats.csv`'s (§5.4) plus one more constraint: a Match Report has to
exist for the platform to have rendered it at all, so `game_stats.csv` coverage tracks
`stats.csv`'s g/a availability (league from 2014, cups from ~2016) but can be sparser within
that range wherever a report page is missing, malformed, or a jersey/name collides ambiguously
on the roster.

### 5.8 Why the stats element stays the source of truth (important)

There are three views of the same per-player numbers on bdsl.org, and they do **not** agree at
any given moment:

| Source | What it is | Fresh? | Complete? |
|---|---|---|---|
| **Stats element (E 928)** — `parse_stats.py` → `stats.csv` | Pre-aggregated season totals per competition. Also what bdsl.org's own "Top 10 Stats" leaders page renders. | No — recomputed on Demosphere's schedule | Yes, every competition |
| **Team Roster page** — `teampages.py` | Per-club table on `TEAM.html`, rendered live from the same manager-entered data. | Yes | Yes, but no person keys on cup pages |
| **Match Reports** — `matchreports.py` → `game_stats.csv` | Per-game scoring lines. | Yes | **No** — see below |

`stats.csv` is sourced from the element, and that is a deliberate choice on **completeness and
identity**, not freshness:

* **Match Reports cannot replace it.** Cup reports render `** Players are hidden **` — no
  PLAYED/STATS tables at all — so `game_stats.csv` has *zero* cup rows league-wide. In league +
  Over-35 play, reports frequently carry only one of the two teams' lines. Measured across
  2026-summer, match reports undercount the element by ~198 goals over ~151 players, while the
  element undercounts reports by ~3 goals over 3 players.
* **Roster pages cannot replace it either.** They're live and complete, but cup roster rows are
  plain text with no player link, so they carry no `person_key` — exactly the competitions where
  there are no Match Reports to fall back on. Switching to them means fuzzy name-matching for
  cup identity, which breaks §5.5's cross-season joins. They also cost one request per club per
  competition (~150/run) instead of one per competition (~10).

The element's cost is a **lag**: after a manager enters or edits a game, the roster page moves
immediately and the element follows some time later. During that window the site shows a figure
a user can see is different on bdsl.org's team page — though it still agrees with bdsl.org's own
leaders page, which reads the same element.

**The length of that lag is not currently established**, which is what `lag_check.csv` (§4.7)
exists to measure. To read a lag out of it: a disagreement's *first* `check_date` is roughly when
the manager entered the change, and the day after its *last* `check_date` is when the element
caught up. The scheduled refresh runs `python3 lagcheck.py` on every collect, so the distribution
builds itself at that cadence — every other day, which bounds how finely a lag can be resolved.
Run it by hand in between for a tighter reading. Do **not** infer
lag from `stats.csv` snapshots alone — the element is the only time series there, so a late jump
is equally explained by a manager entering late, and the two are indistinguishable without the
roster-page probe.

**Consuming `lag_check.csv` for provisional totals** (the web app's Best Single Seasons board and
player pages): do not add a row's `d_g`/`d_a` to a confirmed `stats.csv` figure. `d_g` was measured
against the element as it stood on that `check_date`, and the two files are not guaranteed to move
together — the scheduled refresh runs `lagcheck.py` right after the collect, but that step is
non-fatal, so a failed probe leaves yesterday's rows beside today's snapshot. Once the element
catches up, the delta is already inside the confirmed total and adding it again double-counts it.
Instead compute the still-outstanding remainder against the *current* confirmed
figure — `page_g − confirmed_g` for that person and `team_id` (`<club_id>-<tg>`) — which decays to
zero on its own the moment the element catches up, and clamp it into the direction the check
observed so a page number the element has since overtaken can't flip sign and hide confirmed goals.

---

## 6. Common derivations (recipes)

- **A season's current stats:** read `<season>/stats.csv`, keep rows at max `snapshot_date`.
- **Per-player season totals ("best single seasons"):** for each season, group its current rows
  by `person_key`, summing `g`/`a`/`gp`; `points = 2g + a`. (This is what the leaderboard
  renders — see `aggregate.build_player_seasons`.)
- **Career totals / who played the most seasons:** group by `person_key` across all seasons.
- **Team standings / tables:** read `<season>/teams.json` directly (already aggregated), ordered
  by `position`.
- **A competition's champion / a club's titles:** read `champion_club_id` from
  `competitions.json` (per season). Titles for a club = count of competitions across all seasons
  whose `champion_club_id` == that `club_id`. **Do not** infer titles from `position == 1` (§5.6).
- **All games / results for a competition:** read `<season>/games.csv`, filter by `tg`.
- **Head-to-head of two names that might collide:** they won't merge — distinct people have
  distinct `person_key`s. Always key on `person_key`.
- **Who scored in a specific game:** read `<season>/game_stats.csv`, filter by `game_key`,
  keep rows with `g > 0`; join `person_key` to `players.json` for identity (rows with
  `matched == ""` have no `person_key` — see §5.7).
- **A player's per-game log within a season:** read `<season>/game_stats.csv`, filter by
  `person_key` (only rows that resolved). Not a substitute for `stats.csv`'s per-competition
  totals, which are always complete — see §5.7.

---

## 7. Extending the store

- Add a field to a JSON dimension freely; old files simply lack it (readers should treat
  missing keys as empty). Document it here.
- Add a column to `stats.csv` / `games.csv` / `game_stats.csv` / `game_reports.csv` by appending
  to `STATS_COLUMNS` / `GAMES_COLUMNS` / `GAME_STATS_COLUMNS` / `GAME_REPORTS_COLUMNS` in
  `store.py`; existing rows pad blank on the next rewrite. Document it here.
- Add a season by collecting it (`history.py` for past years, the live pipeline for the current
  one). It lands in its own folder; the global registries grow to span it automatically.
