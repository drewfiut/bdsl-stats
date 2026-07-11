"""File-based data store for BDSL stats.

Full schema + field reference for everything under ./data lives in DATA.md — keep it in sync
with any change here (columns, dimension fields, layout).

The store keeps the *extracted* data (not raw HTML) so it survives, accumulates history, and
is easy to inspect or analyse. Layout under ./data:

    data/
      seasons.json                 registry of seasons -> their Demosphere ids
      players.json                 global person registry: person_key -> name, birthdate
      <season_id>/
        competitions.json          the divisions / cups in the season
        teams.json                 teams + standings records (room for more team data later)
        stats.csv                  tidy, append-only fact table (one block of rows per day)

Design notes / how this stays open to the future:
  * `person_key` and the season id are global, so historical seasons are just more folders
    and `players.json` naturally spans seasons -> cross-season career totals later.
  * `stats.csv` is long-format (one row per player-per-competition-per-day). A new daily
    snapshot appends rows; nothing is overwritten, so you accumulate a time series for free.
    Reading "the current table" = the rows with the latest `snapshot_date`.
  * Dimensions (seasons / competitions / teams / players) are small JSON documents you can
    extend with new fields without touching past snapshots.
"""
import csv
import datetime as dt
import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple

DATA_DIR = Path(__file__).resolve().parent / "data"

STATS_COLUMNS = [
    "snapshot_date", "fetched_at", "person_key", "name",
    "tg", "competition", "comp_type",
    "team_id", "team_name", "jersey", "position", "g", "a", "gp",
]

# One row per game (a competition's schedule/results). Keyed by the stable Demosphere game_key;
# rewritten wholesale each collect (a game's result is its result -- no dated snapshots). See
# schedules.py for the source and DATA.md §4.4 for the field reference.
GAMES_COLUMNS = [
    "game_key", "tg", "competition", "comp_type",
    "game_number", "round_label", "date", "time",
    "home_club_id", "home_name", "away_club_id", "away_name",
    "home_score", "away_score", "status", "result_note", "location",
]


# ---- paths ---------------------------------------------------------------------------

def _season_dir(season_id: str) -> Path:
    return DATA_DIR / season_id

def seasons_path() -> Path:      return DATA_DIR / "seasons.json"
def players_path() -> Path:      return DATA_DIR / "players.json"
def competitions_path(sid: str): return _season_dir(sid) / "competitions.json"
def teams_path(sid: str):        return _season_dir(sid) / "teams.json"
def stats_path(sid: str):        return _season_dir(sid) / "stats.csv"
def games_path(sid: str):        return _season_dir(sid) / "games.csv"


# ---- generic json helpers ------------------------------------------------------------

def _load_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))

def _save_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")


# ---- snapshot dating -----------------------------------------------------------------

def league_date(cutoff_hour: int, now: Optional[dt.datetime] = None) -> str:
    """The 'league day' an instant belongs to: the date of the most recent `cutoff_hour`:00.

    With cutoff_hour=3, everything from 3am today until 3am tomorrow is dated today, so the
    first run after 3am produces a new day's snapshot and later runs reuse it.
    """
    now = now or dt.datetime.now()
    d = now.date()
    if now.hour < cutoff_hour:
        d = d - dt.timedelta(days=1)
    return d.isoformat()


# ---- seasons registry ----------------------------------------------------------------

def upsert_season(season: dict) -> None:
    seasons = _load_json(seasons_path(), {})
    seasons[season["id"]] = {k: v for k, v in season.items() if k != "id"}
    _save_json(seasons_path(), seasons)

def load_seasons() -> dict:
    return _load_json(seasons_path(), {})


# ---- competitions & teams (per season) ----------------------------------------------

def save_competitions(sid: str, comps: List[dict]) -> None:
    _save_json(competitions_path(sid), comps)

def load_competitions(sid: str) -> List[dict]:
    return _load_json(competitions_path(sid), [])

def save_teams(sid: str, teams: List[dict]) -> None:
    _save_json(teams_path(sid), teams)

def load_teams(sid: str) -> List[dict]:
    return _load_json(teams_path(sid), [])


# ---- games (per season) --------------------------------------------------------------

def save_games(sid: str, games: List[dict]) -> None:
    """Write the season's games.csv, one row per game (keyed by game_key). Rewrites the file."""
    path = games_path(sid)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=GAMES_COLUMNS)
        w.writeheader()
        for g in games:
            rec = {c: "" for c in GAMES_COLUMNS}
            rec.update({k: v for k, v in g.items() if k in GAMES_COLUMNS})
            w.writerow(rec)

def load_games(sid: str) -> List[dict]:
    path = games_path(sid)
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


# ---- players (global registry) -------------------------------------------------------

def upsert_players(players: Dict[str, dict]) -> None:
    """Merge person_key -> {last, first, middle, nickname, birthdate} into players.json.

    Empty/None fields never overwrite an existing value, so a later season that happens to
    carry a middle name or nickname fills it in without losing data from other seasons.
    """
    reg = _load_json(players_path(), {})
    for pk, info in players.items():
        cur = reg.get(pk, {})
        cur.update({k: v for k, v in info.items() if v not in (None, "")})
        reg[pk] = cur
    _save_json(players_path(), reg)

def load_players() -> Dict[str, dict]:
    return _load_json(players_path(), {})


# ---- stats fact table ----------------------------------------------------------------

def _read_stats_rows(sid: str) -> List[dict]:
    path = stats_path(sid)
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))

def _write_stats_rows(sid: str, rows: List[dict]) -> None:
    path = stats_path(sid)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=STATS_COLUMNS)
        w.writeheader()
        w.writerows(rows)

def write_snapshot(sid: str, snapshot_date: str, fetched_at: str, rows: List[dict]) -> None:
    """Replace any existing rows for `snapshot_date` with `rows` (append-only across days)."""
    existing = [r for r in _read_stats_rows(sid) if r["snapshot_date"] != snapshot_date]
    stamped = []
    for r in rows:
        rec = {c: "" for c in STATS_COLUMNS}
        rec.update(r)
        rec["snapshot_date"] = snapshot_date
        rec["fetched_at"] = fetched_at
        stamped.append(rec)
    _write_stats_rows(sid, existing + stamped)

def list_snapshot_dates(sid: str) -> List[str]:
    return sorted({r["snapshot_date"] for r in _read_stats_rows(sid)})

def has_snapshot(sid: str, snapshot_date: str) -> bool:
    return snapshot_date in set(r["snapshot_date"] for r in _read_stats_rows(sid))

def has_any_snapshot(sid: str) -> bool:
    """True if the season has been collected at all (used to skip immutable history)."""
    return bool(_read_stats_rows(sid))

def load_snapshot(sid: str, snapshot_date: Optional[str] = None) -> Tuple[Optional[str], str, List[dict]]:
    """Return (snapshot_date, fetched_at, rows) for the given date, or the latest if None."""
    rows = _read_stats_rows(sid)
    if not rows:
        return None, "", []
    if snapshot_date is None:
        snapshot_date = max(r["snapshot_date"] for r in rows)
    picked = [r for r in rows if r["snapshot_date"] == snapshot_date]
    # normalise numeric columns
    for r in picked:
        for k in ("g", "a", "gp"):
            r[k] = int(r[k]) if str(r[k]).lstrip("-").isdigit() else 0
    fetched_at = picked[0]["fetched_at"] if picked else ""
    return snapshot_date, fetched_at, picked
