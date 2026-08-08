"""Diagnostic: measure how far the stats element trails the live team-roster pages.

`stats.csv` is sourced from the stats element (E 928), which Demosphere recomputes on its own
schedule. The per-club Team Roster page (teampages.py) renders the same manager-entered numbers
live. So after a manager enters or edits a game, the roster page moves first and the element
follows some unknown time later -- during which the site shows a number a user can see is stale
on bdsl.org's own team page.

This script measures that window. It fetches BOTH sources back to back (never comparing a live
page against yesterday's stored snapshot) and appends one dated row per player whose numbers
disagree, to `data/<season>/lag_check.csv`. It writes nothing else: `stats.csv` and every other
store file are untouched, and the element remains the source of truth (see DATA.md §5.8).

Reading the output: a disagreement's *first* `check_date` is roughly when the manager entered
it; the day after its *last* `check_date` is when the element caught up. The span between them
is the lag. A player who never disagrees never appears, and the distribution builds itself as the
rows accumulate.

The scheduled refresh (.github/workflows/refresh-data.yml) runs this right after update_data.py,
so the roster reading always sits next to the element snapshot it was measured against. It stays
out of collect.py itself: that remains a pure element collect, and this probe costs ~150 requests
(one per club per competition) against collect's ~10, so a failure here must not take the stats
refresh down with it. Run it by hand any time for an off-schedule reading:

    python3 lagcheck.py                # active season
    python3 lagcheck.py --season 2025-summer

Players present in the element but absent from the roster page are skipped, not reported: the
element intentionally keeps crediting players who were later dropped from a roster (see
discover.py), so those are a known, permanent difference rather than lag.
"""
import argparse
import csv
import datetime as dt
import re
from collections import defaultdict
from typing import Dict, List

import config
import parse_stats
import store
import teampages

LAG_CHECK_COLUMNS = [
    "check_date", "checked_at", "tg", "competition", "comp_type",
    "club_id", "team_name", "person_key", "name",
    "page_gp", "page_g", "page_a", "el_gp", "el_g", "el_a",
    "d_gp", "d_g", "d_a", "matched",
]

_TOKEN = re.compile(r"[a-z0-9]+")


def _normname(name: str) -> str:
    """Canonical form for name matching -- mirrors attribution._normname's rule.

    Cup roster pages carry no person key, so name is the only join available there.
    """
    return " ".join(sorted(_TOKEN.findall((name or "").lower())))


def lag_check_path(sid: str):
    return store.DATA_DIR / sid / "lag_check.csv"


def _sections_for(season: dict, comp_type: str) -> List[str]:
    """Candidate TEAM.html sections: league/Over-35 share one, cups live in their own."""
    if comp_type == "cup":
        return list(season.get("cup_sections", []))
    return [season["league_section"]]


def _clubs_by_tg(sid: str) -> Dict[str, Dict[str, str]]:
    """{tg: {club_id: team_name}} from the stored schedule, which covers cups too.

    teams.json only carries league/Over-35 teams (it comes from the standings page), so the
    schedule is the one source that enumerates every club in every competition.
    """
    clubs: Dict[str, Dict[str, str]] = defaultdict(dict)
    for t in store.load_teams(sid):
        if t.get("tg") and t.get("club_id"):
            clubs[t["tg"]][t["club_id"]] = t.get("name") or ""
    for g in store.load_games(sid):
        for side in ("home", "away"):
            club_id = g.get(f"{side}_club_id")
            if g.get("tg") and club_id:
                clubs[g["tg"]].setdefault(club_id, g.get(f"{side}_name") or "")
    return clubs


def check(season: dict = None, progress: bool = False) -> List[dict]:
    """Compare both sources for every club in every competition; return the disagreements."""
    season = season or config.SEASON
    sid = season["id"]
    check_date = store.league_date(config.STATS_REFRESH_HOUR)
    checked_at = store.league_now().isoformat(timespec="seconds")

    clubs_by_tg = _clubs_by_tg(sid)
    rows: List[dict] = []

    for comp in store.load_competitions(sid):
        tg = comp["tg"]
        sections = _sections_for(season, comp["comp_type"])
        # One element fetch per competition, reused across that competition's clubs.
        element = parse_stats.fetch_stats(tg)
        el_by_club: Dict[str, list] = defaultdict(list)
        for r in element:
            el_by_club[r.team_key].append(r)

        comp_rows = 0
        for club_id, team_name in sorted(clubs_by_tg.get(tg, {}).items()):
            found = teampages.fetch_roster_any(sections, club_id, tg)
            if found is None:
                continue                      # no roster page for this club/tg -- nothing to compare
            _section, lines = found

            recs = el_by_club.get(club_id, [])
            by_key = {r.person_key: r for r in recs}
            by_name: Dict[str, list] = defaultdict(list)
            for r in recs:
                by_name[_normname(r.full_name)].append(r)

            for line in lines:
                rec, matched = None, ""
                if line.person_key and line.person_key in by_key:
                    rec, matched = by_key[line.person_key], "key"
                else:
                    cands = by_name.get(_normname(line.name), [])
                    if len(cands) == 1:
                        rec, matched = cands[0], "name"

                el_gp, el_g, el_a = (rec.games_played, rec.goals, rec.assists) if rec else (0, 0, 0)
                d_gp, d_g, d_a = line.gp - el_gp, line.g - el_g, line.a - el_a
                if not (d_gp or d_g or d_a):
                    continue

                rows.append({
                    "check_date": check_date, "checked_at": checked_at,
                    "tg": tg, "competition": comp["competition"], "comp_type": comp["comp_type"],
                    "club_id": club_id, "team_name": team_name,
                    "person_key": (rec.person_key if rec else line.person_key),
                    "name": line.name,
                    "page_gp": line.gp, "page_g": line.g, "page_a": line.a,
                    "el_gp": el_gp, "el_g": el_g, "el_a": el_a,
                    "d_gp": d_gp, "d_g": d_g, "d_a": d_a, "matched": matched,
                })
                comp_rows += 1

        if progress:
            print(f"  {comp['competition']:22} {comp_rows:4} disagreeing players")

    return rows


def save(sid: str, check_date: str, rows: List[dict]) -> None:
    """Replace any existing rows for `check_date` (append-only across days), like write_snapshot.

    `check_date` is *stamped* onto every row, not merely used to filter -- otherwise a caller
    passing rows that carry some other date would drop the rows being replaced and write the
    new ones under the old date, silently corrupting the series.
    """
    path = lag_check_path(sid)
    existing = []
    if path.exists():
        with path.open(newline="", encoding="utf-8") as f:
            existing = [r for r in csv.DictReader(f) if r["check_date"] != check_date]
    stamped = []
    for r in rows:
        rec = {c: r.get(c, "") for c in LAG_CHECK_COLUMNS}
        rec["check_date"] = check_date
        stamped.append(rec)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=LAG_CHECK_COLUMNS)
        w.writeheader()
        w.writerows(existing + stamped)


def summarise(rows: List[dict]) -> str:
    if not rows:
        return "no disagreements -- the element matches every roster page"
    ahead = sum(r["d_g"] for r in rows if r["d_g"] > 0)
    behind = -sum(r["d_g"] for r in rows if r["d_g"] < 0)
    unmatched = sum(1 for r in rows if not r["matched"])
    comps = sorted({r["competition"] for r in rows})
    return (f"{len(rows)} players disagree across {len(comps)} competitions "
            f"({', '.join(comps)})\n"
            f"  goals the roster pages have that the element does not: {ahead}\n"
            f"  goals the element has that the roster pages do not:    {behind}\n"
            f"  roster lines with no element match at all:             {unmatched}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--season", default=config.SEASON_ID)
    args = ap.parse_args()

    # load_seasons() stores each season without its id (it's the key), so put it back.
    stored = store.load_seasons().get(args.season)
    season = dict(stored, id=args.season) if stored else config.SEASON
    sid = season["id"]

    print(f"lag check: {sid}")
    rows = check(season, progress=True)
    date = store.league_date(config.STATS_REFRESH_HOUR)
    save(sid, date, rows)
    print(f"\n{summarise(rows)}")
    print(f"\nWrote {len(rows)} rows for {date} to {lag_check_path(sid)}")
