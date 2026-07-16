#!/usr/bin/env python3
"""Refresh the BDSL data store, then commit it to GitHub.

This is the only command you need for routine updates. It re-collects the live season from
bdsl.org into ./data (competitions, teams, players, and a dated stats snapshot). The Svelte
app in ./web reads those static files directly and does all the aggregation in the browser --
nothing else is generated here.

    python update_data.py            # refresh the live season if today's snapshot is missing
    python update_data.py --force    # re-collect the live season even if already collected today

After it runs, commit the changed files:

    git add data/ && git commit -m "Refresh BDSL data" && git push

Backfilling *past* seasons is a separate one-off -- see history.py.
"""
import argparse

import collect
import config
import store


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true",
                    help="re-collect the live season even if today's snapshot already exists")
    args = ap.parse_args()

    today = store.league_date(config.STATS_REFRESH_HOUR)
    if not args.force and collect.is_current():
        print(f"Live season ({config.SEASON_LABEL}) already has today's snapshot "
              f"({today}) -- nothing to do. Use --force to re-collect.")
        return

    print(f"Collecting fresh data for {config.SEASON_LABEL} from bdsl.org...")
    date = collect.collect(progress=True, force=args.force)
    if date is None:
        print("Nothing collected (season is marked final).")
        return

    _d, fetched_at, rows = store.load_snapshot(config.SEASON_ID, date)
    scorers = sum(1 for r in rows if r["g"] or r["a"])
    print(f"\nSaved snapshot {date} ({len(rows)} player-competition rows, "
          f"{scorers} on the scoresheet) to {store.DATA_DIR}.")

    game_stats = store.load_game_stats(config.SEASON_ID)
    game_reports = store.load_game_reports(config.SEASON_ID)
    # ISO datetimes sort lexicographically, so this catches every report (re)captured at or
    # after collect() started this run -- fetched_at is stamped before capture begins.
    captured_this_run = sum(1 for r in game_reports if r["captured_at"] >= fetched_at)
    print(f"Match Reports: {captured_this_run} captured this run, "
          f"{len(game_stats)} scorer-rows attributed total.")
    print("\nNext: commit the data so GitHub Pages can serve it:")
    print("    git add data/ && git commit -m \"Refresh BDSL data\" && git push")


if __name__ == "__main__":
    main()
