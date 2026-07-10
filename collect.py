"""Collect a season from bdsl.org into the data store.

This is the only module that touches the network. It writes/refreshes the season's
dimensions (seasons, competitions, teams, players) and appends one dated stats snapshot.
Running it again the same league-day replaces that day's snapshot; a new day appends a new
one, building history over time.
"""
import datetime as dt
from dataclasses import asdict
from typing import Optional

import config
import discover
import store
from parse_stats import fetch_stats


def is_current(season_id: Optional[str] = None) -> bool:
    """True if today's snapshot (per the 3am boundary) already exists in the store."""
    sid = season_id or config.SEASON_ID
    today = store.league_date(config.STATS_REFRESH_HOUR)
    return store.has_snapshot(sid, today)


def collect(season: Optional[dict] = None, progress: bool = False,
            force: bool = False) -> Optional[str]:
    """Fetch a season and write it to the store. Returns the snapshot date.

    `season` defaults to the active season (`config.SEASON`). A season marked `final: True`
    is immutable historical data: it is collected once and skipped on later runs (returns
    None) unless `force` is set. The active season keeps refreshing on the 3am boundary.
    """
    season = season or config.SEASON
    sid = season["id"]
    final = season.get("final", False)

    if final and not force and store.has_any_snapshot(sid):
        if progress:
            print(f"  {sid}: already collected -- skipping (use force to re-collect)")
        return None

    # Historical seasons don't change, so their snapshot date is just the collection date.
    snapshot_date = store.league_date(config.STATS_REFRESH_HOUR)
    fetched_at = dt.datetime.now().isoformat(timespec="seconds")

    store.upsert_season(season)

    groups = discover.discover_all(season)
    store.save_competitions(sid, [asdict(g) for g in groups])
    store.save_teams(sid, discover.discover_teams(season["league_section"],
                                                  season["standings_element"]))

    rows = []
    players = {}
    for g in groups:
        recs = fetch_stats(g.tg)
        if progress:
            print(f"  {g.competition:22} {len(recs):4} players")
        for r in recs:
            rows.append({
                "person_key": r.person_key,
                "name": r.full_name,
                "tg": g.tg,
                "competition": g.competition,
                "comp_type": g.comp_type,
                "team_id": f"{r.team_key}-{g.tg}",
                "team_name": r.team_name,
                "jersey": r.jersey,
                "position": r.position,
                "g": r.goals,
                "a": r.assists,
                "gp": r.games_played,
            })
            players[r.person_key] = {
                "last": r.last_name, "first": r.first_name, "middle": r.mid_name,
                "nickname": r.nickname, "birthdate": r.birthdate,
            }

    store.write_snapshot(sid, snapshot_date, fetched_at, rows)
    store.upsert_players(players)
    return snapshot_date


if __name__ == "__main__":
    date = collect(progress=True)
    print(f"\nWrote snapshot {date} for season {config.SEASON_ID} to {store.DATA_DIR}")
