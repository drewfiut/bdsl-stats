#!/usr/bin/env python3
"""BDSL best single-season leaderboard.

Refreshes the live season, then builds one page ranking every *player-season* in the store:
each row is one person's goals/assists/points totalled across every competition they played
in that year (league + cups + Over-35), for all seasons collected (see history.py for the
backfill). Ranking the rows surfaces the best individual seasons in BDSL history.

    python leaderboard.py                # refresh the live season if needed, then build
    python leaderboard.py --refresh      # re-collect the live season first, always
    python leaderboard.py -o out.html    # choose the output file
"""
import argparse

import aggregate
import collect
import config
import render_html
import store


def _print_board(title, players, top):
    print(f"\n{title}")
    for i, p in enumerate(players[:top], 1):
        print(f"  {i:2}  {p.display_name:24} {p.season_label:12} "
              f"{p.goals:3}G {p.assists:3}A {p.points:4}pts")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-o", "--output", default="leaderboard.html", help="output HTML file")
    ap.add_argument("--refresh", action="store_true", help="re-collect the live season before building")
    ap.add_argument("--top", type=int, default=10, help="rows per console board (default 10)")
    args = ap.parse_args()

    if args.refresh or not collect.is_current():
        print("Collecting fresh data for the live season from bdsl.org...")
        date = collect.collect(progress=True)
        print(f"Saved snapshot {date} to {store.DATA_DIR}")
    else:
        print(f"Using today's stored snapshot for the live season "
              f"({store.league_date(config.STATS_REFRESH_HOUR)}).")

    board = aggregate.build_player_seasons()
    if not board.players:
        raise SystemExit("No data in the store yet -- run history.py / collect to populate it.")

    active = sum(1 for p in board.players if p.games_played > 0)
    print(f"\n{len(board.players)} player-seasons across {len(board.season_labels)} seasons "
          f"({active} with games played). Best single seasons:")

    _print_board("POINTS", board.ranked_by("points"), args.top)
    _print_board("GOALS", board.ranked_by("goals"), args.top)
    _print_board("ASSISTS", board.ranked_by("assists"), args.top)

    with open(args.output, "w", encoding="utf-8") as f:
        f.write(render_html.render(board))
    print(f"\nWrote {args.output} -- open it in a browser for the full sortable leaderboard.")


if __name__ == "__main__":
    main()
