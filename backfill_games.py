#!/usr/bin/env python3
"""One-off: backfill games + computed standings/champion into every stored season.

The live pipeline (collect.py) writes games.csv, the computed `position`, and the `champion_*`
fields for the active season on every run. Seasons already collected before this feature don't
have them, and `collect` skips immutable `final` seasons -- so this script fills them in without
re-fetching stats.

For each season it reads the already-stored `competitions.json` + `teams.json` (the team-group
ids are already there), fetches each competition's full schedule, then:
  * writes `games.csv`,
  * replaces the untrusted source `rank` on each team with a computed `position`
    (standings.assign_positions),
  * writes each competition's champion (standings.champion_for) back into `competitions.json`.

`stats.csv` and `players.json` are never touched.

    python backfill_games.py                # every season missing games.csv
    python backfill_games.py --season 2023-summer
    python backfill_games.py --force        # recompute even seasons already backfilled
"""
import argparse

import champions
import collect
import schedules
import standings
import store


def backfill_season(sid: str, force: bool = False) -> None:
    if store.games_path(sid).exists() and not force:
        print(f"  {sid}: games.csv already present -- skipping (use --force to redo)")
        return

    comps = store.load_competitions(sid)
    teams = store.load_teams(sid)
    if not comps:
        print(f"  {sid}: no competitions.json -- skipping")
        return

    season_final = store.load_seasons().get(sid, {}).get("final", True)
    year = int(sid.split("-")[0])
    games_by_tg = {}
    for c in comps:
        games = schedules.fetch_games(c["tg"], year)
        games_by_tg[c["tg"]] = games
        print(f"    {c['competition']:22} {len(games):4} games")

    for t in teams:
        t.pop("rank", None)
    standings.assign_positions(teams)

    for c in comps:
        club_id, name, via = standings.champion_for(
            games_by_tg.get(c["tg"], []), [t for t in teams if t.get("tg") == c["tg"]],
            season_final=season_final)
        c["champion_club_id"], c["champion_name"], c["champion_via"] = club_id, name, via

    # groups for row-flattening carry the competition/comp_type tags collect._game_rows expects.
    class _G:
        def __init__(self, c): self.competition, self.comp_type, self.tg = \
            c["competition"], c["comp_type"], c["tg"]
    groups = [_G(c) for c in comps]

    game_rows = collect._game_rows(groups, games_by_tg)
    rows_by_tg = {}
    for r in game_rows:
        rows_by_tg.setdefault(r["tg"], []).append(r)

    before = sum(1 for c in comps if c["champion_club_id"])
    season_desc = store.load_seasons().get(sid, {})
    section_cache = {}

    def rows_for(section):
        if section not in section_cache:
            section_cache[section] = champions.fetch_champions(section)
        return section_cache[section]

    for c in comps:
        if c.get("champion_via"):
            continue
        if c["comp_type"] in ("league", "over35"):
            league_section = season_desc.get("league_section")
            hist_rows = rows_for(league_section) if league_section else []
        elif c["comp_type"] == "cup":
            hist_rows = []
            for section in season_desc.get("cup_sections", []):
                hist_rows.extend(rows_for(section))
        else:
            continue
        club_id, name, via = champions.resolve(
            c, rows_by_tg.get(c["tg"], []),
            [t for t in teams if t.get("tg") == c["tg"]], hist_rows)
        if club_id:
            c["champion_club_id"], c["champion_name"], c["champion_via"] = club_id, name, via

    filled = sum(1 for c in comps if c["champion_club_id"]) - before
    if filled:
        print(f"    filled {filled} champion(s) from the history table")

    store.save_games(sid, game_rows)
    store.save_teams(sid, teams)
    store.save_competitions(sid, comps)

    champs = sum(1 for c in comps if c["champion_club_id"])
    total = sum(len(v) for v in games_by_tg.values())
    print(f"  -> {total} games, {champs}/{len(comps)} competitions with a champion")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", help="backfill only this season id (e.g. 2023-summer)")
    ap.add_argument("--force", action="store_true", help="recompute seasons already backfilled")
    args = ap.parse_args()

    sids = [args.season] if args.season else sorted(store.load_seasons())
    for sid in sids:
        print(f"\n{sid}:")
        backfill_season(sid, force=args.force)

    print("\nDone.")


if __name__ == "__main__":
    main()
