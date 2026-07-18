"""Collect a season from bdsl.org into the data store.

This is the only module that touches the network. It writes/refreshes the season's
dimensions (seasons, competitions, teams, players) and appends one dated stats snapshot.
Running it again the same league-day replaces that day's snapshot; a new day appends a new
one, building history over time.
"""
import datetime as dt
from collections import defaultdict
from dataclasses import asdict
from typing import Dict, List, Optional

import attribution
import champions
import config
import discover
import matchreports
import schedules
import standings
import store
from parse_stats import fetch_stats

# Games captured before this many days ago are treated as final and never re-fetched; games
# within the window are always re-captured even if already in the ledger, since Match Reports
# are sometimes entered a few days after the game is played ("late-stat-entry window").
REPORT_RECAPTURE_DAYS = 21


def collect_games(groups, year: int, progress: bool = False) -> Dict[str, list]:
    """Fetch every competition's full schedule/results, keyed by team-group id."""
    out: Dict[str, list] = {}
    for g in groups:
        games = schedules.fetch_games(g.tg, year)
        out[g.tg] = games
        if progress:
            print(f"  {g.competition:22} {len(games):4} games")
    return out


def dedupe_cross_tg(games_by_tg: Dict[str, list], teams: List[dict]) -> Dict[str, list]:
    """Drop games that leaked into the wrong competition's schedule, in place.

    bdsl.org's per-competition schedule pages occasionally serve another division's games:
    during playoff weeks a whole division's schedule has been observed appearing under an
    adjacent division's and the Over-35 team-group, which then hands that division's champion
    to those competitions too (see the 2014/2017/2025 Over-35 divisions). A leaked game's two
    clubs are not on the polluted competition's standings roster, so when a `game_key` appears
    under more than one `tg` we keep it only under the tg(s) whose roster contains BOTH its
    clubs. If that rule doesn't single out exactly one owner, every copy is left in place --
    the goal is to remove clear leakage, never to silently lose a legitimately shared game.
    """
    roster: Dict[str, set] = defaultdict(set)
    for t in teams:
        roster[t.get("tg")].add(t.get("club_id"))

    placements: Dict[str, list] = defaultdict(list)   # game_key -> [(tg, game), ...]
    for tg, games in games_by_tg.items():
        for g in games:
            placements[g.game_key].append((tg, g))

    for key, places in placements.items():
        if len(places) < 2:
            continue
        owners = [tg for tg, g in places
                  if g.home_club_id in roster[tg] and g.away_club_id in roster[tg]]
        if len(owners) != 1:
            continue                              # ambiguous -- leave every copy in place
        keep = owners[0]
        for tg, _g in places:
            if tg != keep:
                games_by_tg[tg] = [x for x in games_by_tg[tg] if x.game_key != key]
    return games_by_tg


def _game_rows(groups, games_by_tg: Dict[str, list]) -> List[dict]:
    """Flatten Game objects into store rows, tagging each with its competition."""
    rows = []
    for g in groups:
        for game in games_by_tg.get(g.tg, []):
            d = asdict(game)
            d.update(tg=g.tg, competition=g.competition, comp_type=g.comp_type)
            d["home_score"] = "" if d["home_score"] is None else d["home_score"]
            d["away_score"] = "" if d["away_score"] is None else d["away_score"]
            rows.append(d)
    return rows


def _fill_history_champions(season: dict, comps: List[dict], rows_by_tg: Dict[str, list],
                             teams: List[dict]) -> None:
    """Fill still-blank `champion_via` competitions from bdsl.org's champion history table.

    Fetches each needed section (the league section for league/over35 comps, each cup section
    for cup comps) at most once, caching by section id.
    """
    section_cache: Dict[str, list] = {}

    def rows_for(section: str) -> list:
        if section not in section_cache:
            section_cache[section] = champions.fetch_champions(section)
        return section_cache[section]

    for comp in comps:
        if comp.get("champion_via"):
            continue
        if comp["comp_type"] in ("league", "over35"):
            hist_rows = rows_for(season["league_section"])
        elif comp["comp_type"] == "cup":
            hist_rows = []
            for section in season.get("cup_sections", []):
                hist_rows.extend(rows_for(section))
        else:
            continue
        club_id, name, via = champions.resolve(
            comp, rows_by_tg.get(comp["tg"], []),
            [t for t in teams if t["tg"] == comp["tg"]], hist_rows)
        if club_id:
            comp.update(champion_club_id=club_id, champion_name=name, champion_via=via)


def _capture_reports(sid: str, game_rows: List[dict], rows: List[dict], players: Dict[str, dict],
                      progress: bool = False) -> None:
    """Fetch new/late Match Reports, attribute their scoring lines, and write game_stats/game_reports.

    Incremental: a played game with a report_path is (re)captured if it has never been
    successfully captured (no ledger row, or a ledger row with status "error" -- errors are
    always retried, no matter how old the game is, since we never want a transient fetch
    failure to permanently strand a game unfetched), or if it's within the last
    REPORT_RECAPTURE_DAYS days despite already being captured (Match Reports are sometimes
    filled in a few days after the game -- the "late-stat-entry window" -- so recent games are
    always re-fetched even if already captured). Games not (re)captured this run keep their
    previously stored game_stats/game_reports rows, so both files stay complete.

    A single game's fetch/parse failure never destroys previously captured data: if the game
    already has a "captured" ledger row, that row and its game_stats rows are left untouched
    (no "error" row is appended, so the carry-forward below preserves them as-is) and the game
    is simply retried again next run within another recapture-window check. Only a game that has
    never been successfully captured gets an "error" ledger row recorded, so it's easy to see
    which games still need attention while still being retried every run. A single failure does
    not stop the rest of the run.
    """
    roster_index = attribution.build_roster_index(rows, players)

    existing_reports_by_key = {r["game_key"]: r for r in store.load_game_reports(sid)}
    existing_stats_by_key: Dict[str, list] = defaultdict(list)
    for r in store.load_game_stats(sid):
        existing_stats_by_key[r["game_key"]].append(r)

    # Use the league-day boundary (not the calendar date) so the recapture window lines up with
    # the rest of the pipeline's notion of "today" (see store.league_date).
    league_today = dt.date.fromisoformat(store.league_date(config.STATS_REFRESH_HOUR))
    cutoff = (league_today - dt.timedelta(days=REPORT_RECAPTURE_DAYS)).isoformat()

    to_capture = []
    for g in game_rows:
        if g.get("status") != "played" or not g.get("report_path"):
            continue
        key = g["game_key"]
        recent = bool(g.get("date")) and g["date"] >= cutoff
        existing = existing_reports_by_key.get(key)
        # Only a genuinely captured, non-recent game is skipped; "error" rows are always retried.
        if existing is not None and existing.get("status") == "captured" and not recent:
            continue
        to_capture.append(g)

    new_reports = []
    new_stats = []
    captured = 0
    for g in to_capture:
        key = g["game_key"]
        url = config.ELEMENTS_BASE + g["report_path"]
        try:
            report = matchreports.fetch_report(url)
            game = {
                "game_key": key, "tg": g["tg"], "competition": g["competition"],
                "comp_type": g["comp_type"], "date": g["date"], "round_label": g["round_label"],
                "home_club_id": g["home_club_id"], "away_club_id": g["away_club_id"],
            }
            new_stats.extend(attribution.attribute_report(report, game, roster_index))
            referees = "; ".join(f"{name} ({role})" for name, role in report.referees)
            new_reports.append({
                "game_key": key, "tg": g["tg"], "report_url": url,
                "captured_at": dt.datetime.now().isoformat(timespec="seconds"),
                "status": "captured", "referees": referees,
            })
            captured += 1
        except Exception:
            existing = existing_reports_by_key.get(key)
            if existing is not None and existing.get("status") == "captured":
                # Already have good data for this game -- a transient failure on a recapture
                # attempt must not overwrite it. Leave the ledger/stats rows out of new_reports
                # so the carry-forward below keeps the previously captured data as-is.
                continue
            new_reports.append({
                "game_key": key, "tg": g["tg"], "report_url": url,
                "captured_at": dt.datetime.now().isoformat(timespec="seconds"),
                "status": "error", "referees": "",
            })

    captured_keys = {r["game_key"] for r in new_reports}
    carried_reports = [r for k, r in existing_reports_by_key.items() if k not in captured_keys]
    carried_stats = [row for k, rs in existing_stats_by_key.items() if k not in captured_keys for row in rs]

    store.save_game_reports(sid, new_reports + carried_reports)
    store.save_game_stats(sid, new_stats + carried_stats)

    if progress:
        print(f"  reports: {captured} captured, {len(new_stats) + len(carried_stats)} scorer-rows")


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
    year = int(sid.split("-")[0])

    groups = discover.discover_all(season)

    # Games (full schedule/results), then the derived standings + true champion.
    games_by_tg = collect_games(groups, year, progress=progress)
    teams = discover.discover_teams(season["league_section"], season["standings_element"])
    standings.assign_positions(teams)

    # bdsl.org sometimes serves one division's schedule under another competition's page; drop
    # those leaked games before they hand that division's champion to the wrong competition.
    dedupe_cross_tg(games_by_tg, teams)

    game_rows = _game_rows(groups, games_by_tg)
    rows_by_tg: Dict[str, list] = {}
    for r in game_rows:
        rows_by_tg.setdefault(r["tg"], []).append(r)

    comps = []
    for g in groups:
        comp = asdict(g)
        club_id, name, via = standings.champion_for(
            games_by_tg.get(g.tg, []), [t for t in teams if t["tg"] == g.tg],
            season_final=final)
        comp.update(champion_club_id=club_id, champion_name=name, champion_via=via)
        comps.append(comp)

    _fill_history_champions(season, comps, rows_by_tg, teams)

    store.save_competitions(sid, comps)
    store.save_teams(sid, teams)

    # save_games rewrites games.csv wholesale, so a silent upstream fetch problem that drops
    # games would otherwise quietly regress the store (and the scheduled GitHub Action would
    # commit the regression). Scheduled games may legitimately disappear (e.g. postponed off
    # the schedule), but a played game must never vanish -- guard on that count specifically.
    existing_played = sum(1 for g in store.load_games(sid) if g.get("status") == "played")
    new_played = sum(1 for g in game_rows if g.get("status") == "played")
    if new_played < existing_played:
        raise RuntimeError(
            f"refusing to save games for season {sid!r}: played-game count would drop from "
            f"{existing_played} to {new_played}. The store was left untouched to protect it. "
            f"If this shrink is intentional, delete the season's games.csv to override manually."
        )

    store.save_games(sid, game_rows)

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

    _capture_reports(sid, game_rows, rows, players, progress=progress)

    return snapshot_date


if __name__ == "__main__":
    date = collect(progress=True)
    print(f"\nWrote snapshot {date} for season {config.SEASON_ID} to {store.DATA_DIR}")
