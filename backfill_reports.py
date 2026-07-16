#!/usr/bin/env python3
"""One-off: backfill Match Report scoring lines (game_stats.csv + game_reports.csv) into stored seasons.

The live pipeline (collect.py) captures new/late Match Reports incrementally on every run, but
seasons already collected before this feature don't have game_stats.csv / game_reports.csv at
all -- and `collect` skips immutable `final` seasons, so it never backfills them. This script
fills every stored season in one pass, capturing every played game's report (not just new ones).

For each season it re-fetches each competition's full schedule (schedules.fetch_games), loads the
season's latest stats snapshot + players.json to build the roster join index
(attribution.build_roster_index), then captures and attributes every played game's report.

Unlike the live season, *historical* schedule pages don't carry the per-row Match Report anchor,
so `game.report_path` is empty for them. We instead reconstruct the report URL from the season's
section ids (seasons.json): league/Over-35 reports live under `league_section`, cup reports under
one of `cup_sections`. We probe the candidate sections and use the first that resolves (a 404 just
means "wrong section"); a game with no report under any section is recorded with status "missing".

`stats.csv`, `games.csv`, and `players.json` are never touched.

    python backfill_reports.py                  # every season missing game_stats.csv
    python backfill_reports.py --season 2023-summer
    python backfill_reports.py --force           # recapture even seasons already backfilled
"""
import argparse
import datetime as dt

import attribution
import collect
import config
import fetch
import matchreports
import schedules
import store


def _report_url(section: str, game_key: str) -> str:
    return f"{config.ELEMENTS_BASE}/{config.ORG}/MatchReports/{section}/{game_key}.html"


def _candidate_sections(comp_type: str, season_desc: dict) -> list:
    """Sections a game's Match Report might live under, most-likely first.

    league/Over-35 reports sit under the season's `league_section`; cup reports under one of
    `cup_sections`. We list the likely section(s) first, then the rest as a fallback so an
    unexpected placement still resolves.
    """
    league = [season_desc["league_section"]] if season_desc.get("league_section") else []
    cups = list(season_desc.get("cup_sections", []))
    primary = cups if comp_type == "cup" else league
    rest = [s for s in league + cups if s not in primary]
    return primary + rest


def _fetch_report(game, comp_type: str, season_desc: dict):
    """(MatchReport, url) for a game, probing candidate sections; (None, "") if none resolves.

    The live season's schedule rows carry `report_path` directly; historical rows don't, so we
    reconstruct the URL from section ids and take the first section that returns a page.
    """
    if game.report_path:
        url = config.ELEMENTS_BASE + game.report_path
        return matchreports.fetch_report(url), url
    for section in _candidate_sections(comp_type, season_desc):
        url = _report_url(section, game.game_key)
        html = fetch.get_optional(url)
        if html:
            return matchreports.parse(html), url
    return None, ""


def backfill_season(sid: str, force: bool = False) -> None:
    if store.game_stats_path(sid).exists() and not force:
        print(f"  {sid}: game_stats.csv already present -- skipping (use --force to redo)")
        return

    comps = store.load_competitions(sid)
    if not comps:
        print(f"  {sid}: no competitions.json -- skipping")
        return

    _snap_date, _fetched_at, stats_rows = store.load_snapshot(sid)
    if not stats_rows:
        print(f"  {sid}: no stats.csv snapshot -- skipping (roster join needs it)")
        return
    players = store.load_players()
    roster_index = attribution.build_roster_index(stats_rows, players)
    season_desc = store.load_seasons().get(sid, {})

    year = int(sid.split("-")[0])

    # Fetch every competition's schedule, then drop cross-competition schedule leakage the same
    # way collect does before capturing reports -- otherwise a division's games that leaked into
    # the Over-35 (or an adjacent division's) schedule would be captured under the wrong
    # competition, tagged with the wrong comp_type, and fail the roster join (their clubs aren't on
    # that competition's roster). See collect.dedupe_cross_tg (e.g. the 2014/2017/2025 Over-35s).
    games_by_tg = {c["tg"]: schedules.fetch_games(c["tg"], year) for c in comps}
    collect.dedupe_cross_tg(games_by_tg, store.load_teams(sid))

    game_reports = []
    game_stats = []
    total_games = 0
    captured = 0
    matched_rows = 0

    def stamp():
        return dt.datetime.now().isoformat(timespec="seconds")

    for c in comps:
        played = [g for g in games_by_tg.get(c["tg"], []) if g.status == "played"]
        total_games += len(played)
        comp_captured = 0
        for g in played:
            try:
                report, url = _fetch_report(g, c["comp_type"], season_desc)
                if report is None:      # no report under any candidate section
                    game_reports.append({
                        "game_key": g.game_key, "tg": c["tg"], "report_url": "",
                        "captured_at": stamp(), "status": "missing", "referees": "",
                    })
                    continue
                game = {
                    "game_key": g.game_key, "tg": c["tg"], "competition": c["competition"],
                    "comp_type": c["comp_type"], "date": g.date, "round_label": g.round_label,
                    "home_club_id": g.home_club_id, "away_club_id": g.away_club_id,
                }
                rows = attribution.attribute_report(report, game, roster_index)
                game_stats.extend(rows)
                matched_rows += sum(1 for r in rows if r["matched"])
                referees = "; ".join(f"{n} ({role})" for n, role in report.referees)
                game_reports.append({
                    "game_key": g.game_key, "tg": c["tg"], "report_url": url,
                    "captured_at": stamp(), "status": "captured", "referees": referees,
                })
                captured += 1
                comp_captured += 1
            except Exception as err:
                game_reports.append({
                    "game_key": g.game_key, "tg": c["tg"], "report_url": "",
                    "captured_at": stamp(), "status": "error", "referees": "",
                })
                print(f"    !! {c['competition']:22} game {g.game_key}: {err}")
        print(f"    {c['competition']:22} {comp_captured:4}/{len(played):4} reports captured")

    store.save_game_stats(sid, game_stats)
    store.save_game_reports(sid, game_reports)

    total_scorer_rows = len(game_stats)
    rate = (matched_rows / total_scorer_rows * 100) if total_scorer_rows else 0.0
    print(f"  -> {captured}/{total_games} reports, {total_scorer_rows} scorer-rows, "
          f"{matched_rows} matched ({rate:.1f}%)")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", help="backfill only this season id (e.g. 2023-summer)")
    ap.add_argument("--force", action="store_true", help="recapture seasons already backfilled")
    args = ap.parse_args()

    sids = [args.season] if args.season else sorted(store.load_seasons())
    for sid in sids:
        print(f"\n{sid}:")
        backfill_season(sid, force=args.force)

    print("\nDone.")


if __name__ == "__main__":
    main()
