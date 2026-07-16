"""Resolve a Match Report's name+jersey scoring lines to stable `person_key`s via a roster join.

matchreports.py gives players by name + jersey only (no person_key -- the Match Report page
never carries one). collect's in-memory stats `rows` (and each season's `stats.csv`) do carry
`person_key`, keyed by `(tg, club_id)` roster membership, jersey, and name. So attribution is a
join: build an index of each `(tg, club_id)`'s roster from the stats rows, then for each
ReportLine resolve its person_key by jersey first (exact, unambiguous match only), falling back
to name (same uniqueness requirement) when jersey doesn't resolve. A line that can't be resolved
either way is still kept -- with `person_key` and `matched` left blank -- so the fact table stays
complete; see DATA.md §4.5.
"""
import re
from typing import Dict, List, Optional

from matchreports import MatchReport

_TOKEN = re.compile(r"[a-z0-9]+")


def _normname(name: str) -> str:
    """Canonical form for name matching: lowercase, alphanumeric tokens, sorted.

    Makes "Carson Teijeira" and "Teijeira, Carson" both normalize to "carson teijeira".
    """
    return " ".join(sorted(_TOKEN.findall((name or "").lower())))


def build_roster_index(stats_rows: List[dict], players_registry: Optional[Dict[str, dict]] = None) -> dict:
    """Index stats rows by `(tg, club_id)` -> {"by_jersey": {jersey: [pk,...]}, "by_name": {normname: [pk,...]}}.

    `club_id` is derived from `team_id.split('-')[0]`. `by_name` is built from both the stats
    row's display `name` and, when `players_registry` has an entry for the person, their
    `"{first} {last}"` -- so either display convention can match a report's "Last, First" line.
    """
    index: dict = {}
    players_registry = players_registry or {}

    def bucket(tg: str, club_id: str) -> dict:
        return index.setdefault((tg, club_id), {"by_jersey": {}, "by_name": {}})

    for r in stats_rows:
        team_id = r.get("team_id") or ""
        club_id = team_id.split("-")[0] if team_id else ""
        tg = r.get("tg") or ""
        if not tg or not club_id:
            continue
        pk = r.get("person_key") or ""
        if not pk:
            continue
        b = bucket(tg, club_id)

        jersey = (r.get("jersey") or "").strip()
        if jersey:
            b["by_jersey"].setdefault(jersey, [])
            if pk not in b["by_jersey"][jersey]:
                b["by_jersey"][jersey].append(pk)

        names = set()
        if r.get("name"):
            names.add(_normname(r["name"]))
        info = players_registry.get(pk)
        if info and info.get("first") and info.get("last"):
            names.add(_normname(f"{info['first']} {info['last']}"))
        for n in names:
            if not n:
                continue
            b["by_name"].setdefault(n, [])
            if pk not in b["by_name"][n]:
                b["by_name"][n].append(pk)

    return index


def _resolve(line, roster: dict) -> tuple:
    """(person_key, matched) for one ReportLine against its side's roster bucket.

    Name is tried before jersey: a name is unique to one person on a roster, whereas jersey
    numbers collide -- a messy report can list two different players under the same number (e.g.
    2015 game 5246019 lists two #3s), and jersey-first would then mis-attribute both lines to the
    single roster owner of that number. Jersey is the fallback for lines whose name isn't on the
    roster (a guest, or a spelling the roster doesn't carry).
    """
    normname = _normname(line.name)
    if normname:
        pks = roster["by_name"].get(normname, [])
        if len(pks) == 1:
            return pks[0], "name"

    jersey = (line.jersey or "").strip()
    if jersey:
        pks = roster["by_jersey"].get(jersey, [])
        if len(pks) == 1:
            return pks[0], "jersey"

    return "", ""


_EMPTY_ROSTER = {"by_jersey": {}, "by_name": {}}


def _orientation_fit(lines, roster: dict) -> tuple:
    """(name_fit, jersey_fit) for `lines` against `roster` -- how well this orientation fits.

    Name is the reliable cross-team discriminator (a scorer's name is on their own club's roster
    only), whereas jersey numbers collide -- both clubs usually field a #10 -- so a jersey can
    resolve against the *wrong* club's roster. We therefore score name agreement separately and
    rank it above jersey agreement when choosing the home/away orientation (see attribute_report).
    """
    name_fit = jersey_fit = 0
    for line in lines:
        nm = _normname(line.name)
        if nm and nm in roster["by_name"]:
            name_fit += 1
        jersey = (line.jersey or "").strip()
        if jersey and jersey in roster["by_jersey"]:
            jersey_fit += 1
    return name_fit, jersey_fit


def _pairsum(p: tuple, q: tuple) -> tuple:
    return (p[0] + q[0], p[1] + q[1])


def attribute_report(report: MatchReport, game: dict, roster_index: dict) -> List[dict]:
    """Resolve `report`'s two team tables to person_keys and emit game_stats row dicts.

    `game` carries game_key/tg/competition/comp_type/date/round_label/home_club_id/away_club_id.

    A Match Report's two team tables are NOT reliably ordered home-then-away -- some reports list
    the teams in the opposite order to the schedule's home/away designation (observed across many
    seasons, e.g. 2016 game 6100890, where the first table holds the *away* club's scorers). So we
    don't trust the report's table order: we score both orientations (first-table->home vs
    first-table->away) by how many lines resolve against each candidate club's roster and keep the
    better fit. `side`/`club_id` on every row therefore reflect the schedule's true home/away, not
    the report's table order. Every ReportLine still produces a row -- person_key/matched are left
    blank when unresolved, but the row is never dropped (see store.GAME_STATS_COLUMNS).
    """
    tg = game.get("tg", "")
    home_club = game.get("home_club_id", "")
    away_club = game.get("away_club_id", "")
    home_roster = roster_index.get((tg, home_club), _EMPTY_ROSTER)
    away_roster = roster_index.get((tg, away_club), _EMPTY_ROSTER)

    # Orientation A: report's first table is the home club; B: first table is the away club.
    # Score each by (name_fit, jersey_fit) summed over both tables; compare name-fit first so a
    # jersey collision can't outvote real name agreement (see _orientation_fit).
    a_name, a_jersey = _pairsum(_orientation_fit(report.home, home_roster),
                                _orientation_fit(report.away, away_roster))
    b_name, b_jersey = _pairsum(_orientation_fit(report.home, away_roster),
                                _orientation_fit(report.away, home_roster))
    if (b_name, b_jersey) > (a_name, a_jersey):    # swapped order -- trust the roster fit
        mapping = [
            ("away", report.home, away_club, away_roster),
            ("home", report.away, home_club, home_roster),
        ]
    else:                                          # default to schedule order on tie/no-match
        mapping = [
            ("home", report.home, home_club, home_roster),
            ("away", report.away, away_club, away_roster),
        ]

    rows: List[dict] = []
    for side, lines, club_id, roster in mapping:
        for line in lines:
            # game_stats is an EVENT table: keep only lines with a recorded goal/assist/card. Older
            # reports (e.g. 2015) list a team's whole roster in the PLAYED/STATS table, most with no
            # events -- storing those 0/0/0/0 lines would bloat the file and misrepresent it as
            # lineup/appearance data (which it isn't, consistently, across eras). The full line set
            # is still used above for the orientation fit; only emission is filtered.
            if not (line.g or line.a or line.y or line.r):
                continue
            person_key, matched = _resolve(line, roster)
            rows.append({
                "game_key": game.get("game_key", ""),
                "tg": tg,
                "competition": game.get("competition", ""),
                "comp_type": game.get("comp_type", ""),
                "date": game.get("date", ""),
                "round_label": game.get("round_label", ""),
                "side": side,
                "club_id": club_id,
                "person_key": person_key,
                "name": line.name,
                "jersey": line.jersey,
                "g": line.g,
                "a": line.a,
                "y": line.y,
                "r": line.r,
                "matched": matched,
            })
    return rows
