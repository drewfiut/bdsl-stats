"""Fetch and parse a single game's "Match Report" page into per-player stat lines.

Every played game has a Demosphere "Match Report" (element 934) reachable at
`https://elements.demosphere-secure.com/<org>/MatchReports/<section>/<game_key>.html`
(the game_key matches schedules.py's `Game.game_key`). The page is static HTML with, for
EACH of the two teams, two tables carrying `class="tbl-mr-pl bordergray"` (select via
`table.tbl-mr-pl`), the first team's pair before the second's:

1. A **PLAYED/STATS** table (header text contains "PLAYED/STATS") -- only players with a
   recorded event (goal, assist, or card) appear here. This is the fact source for scoring.
   Columns by index: `0=jersey#, 1=POS, 2=Name ("Last, First"), 3=blank spacer, 4=G, 5=A,
   6=blank spacer, 7=Y, 8=R, 9=blank spacer`. G/A render as plain digit text (blank = 0); Y/R
   render as a card icon `<img>` instead of a digit, so they're counted by icon rather than
   parsed as an int.
2. A **Match ELIGIBLE** table (header text contains "ELIGIBLE") -- the full roster for that
   team, columns `0=jersey#, 1=POS, 2=Name, 3=member ID#`. Kept as a secondary convenience
   list; the member ID# is not a stable person key so it isn't used for attribution.

The number of tables per team varies by era: recent reports carry both tables per team, so
`table.tbl-mr-pl` yields `[home-stats, home-eligible, away-stats, away-eligible]`; older reports
(e.g. 2015) omit ELIGIBLE and list the full roster in one PLAYED/STATS table per team, yielding
just `[home-stats, away-stats]`. So sides are assigned by counting PLAYED/STATS tables (the away
team's block opens with the second one), not by fixed position -- see `parse`.

Referees sit in a labelled info block next to DATE/TIME and FIELD: a `<div>` reading
"REFEREES" followed by a sibling `<div>` whose child `<div>`s are one per official, each
"Name (ROLE)" (e.g. "Chris Gray (CEN)").
"""
import re
from dataclasses import dataclass, field
from typing import List, Tuple

from bs4 import BeautifulSoup

import fetch

# a referee line's trailing role code, e.g. "Chris Gray (CEN)" -> ("Chris Gray", "CEN")
_REFEREE = re.compile(r"^(.*?)\s*\(([^)]+)\)$")


@dataclass
class ReportLine:
    side: str    # "home" | "away"
    jersey: str
    name: str    # kept verbatim as "Last, First"
    pos: str     # e.g. F/M/D/GK; often blank
    g: int
    a: int
    y: int
    r: int


@dataclass
class MatchReport:
    home: List[ReportLine]
    away: List[ReportLine]
    referees: List[Tuple[str, str]]                     # (name, role code)
    home_eligible: List[Tuple[str, str, str]] = field(default_factory=list)  # (jersey, name, pos)
    away_eligible: List[Tuple[str, str, str]] = field(default_factory=list)


def _clean(s: str) -> str:
    return (s or "").replace("\xa0", " ").strip()


def _int(v) -> int:
    try:
        return int(_clean(v))
    except (TypeError, ValueError):
        return 0


def _name_from_cell(cell) -> str:
    a = cell.find("a") if cell else None
    return _clean(a.get_text(" ") if a else (cell.get_text(" ") if cell else ""))


def _is_header_row(tr) -> bool:
    td = tr.find("td")
    return bool(td and "RowHeader" in (td.get("class") or []))


def _card_count(cell) -> int:
    """Y/R cards render as a card-icon <img> rather than a digit; blank cell -> 0."""
    if cell is None:
        return 0
    imgs = cell.find_all("img")
    if imgs:
        return len(imgs)
    return _int(cell.get_text())


def _parse_stats_table(table, side: str) -> List[ReportLine]:
    lines = []
    for tr in table.find_all("tr"):
        if _is_header_row(tr):
            continue
        cells = tr.find_all("td")
        if len(cells) < 9:
            continue
        lines.append(
            ReportLine(
                side=side,
                jersey=_clean(cells[0].get_text()),
                name=_name_from_cell(cells[2]),
                pos=_clean(cells[1].get_text()),
                g=_int(cells[4].get_text()),
                a=_int(cells[5].get_text()),
                y=_card_count(cells[7]),
                r=_card_count(cells[8]),
            )
        )
    return lines


def _parse_eligible_table(table) -> List[Tuple[str, str, str]]:
    rows = []
    for tr in table.find_all("tr"):
        if _is_header_row(tr):
            continue
        cells = tr.find_all("td")
        if len(cells) < 3:
            continue
        rows.append((_clean(cells[0].get_text()), _name_from_cell(cells[2]), _clean(cells[1].get_text())))
    return rows


def _referees(soup) -> List[Tuple[str, str]]:
    label = soup.find(lambda tag: tag.name == "div" and tag.get_text(strip=True) == "REFEREES")
    if label is None:
        return []
    value = label.find_next_sibling("div")
    if value is None:
        return []
    refs = []
    for line in value.find_all("div", recursive=False):
        text = " ".join(line.get_text(" ", strip=True).split())
        m = _REFEREE.match(text)
        if m:
            refs.append((m.group(1).strip(), m.group(2).strip()))
    return refs


def parse(html: str) -> MatchReport:
    soup = BeautifulSoup(html, "lxml")
    tables = soup.select("table.tbl-mr-pl")

    home: List[ReportLine] = []
    away: List[ReportLine] = []
    home_eligible: List[Tuple[str, str, str]] = []
    away_eligible: List[Tuple[str, str, str]] = []

    # The two teams' tables run in document order, the home team's before the away team's, and
    # each team's block LEADS with its PLAYED/STATS table. The number of tables per team varies by
    # era, though: recent reports carry both a PLAYED/STATS and a Match ELIGIBLE table per team
    # (4 total), while older ones (e.g. 2015) list the whole roster in a single PLAYED/STATS table
    # and omit ELIGIBLE (2 total). So we can't assign sides by fixed position -- instead we switch
    # from home to away when the SECOND PLAYED/STATS table appears, with any ELIGIBLE table
    # belonging to the team whose stats table most recently opened.
    stats_seen = 0
    for table in tables:
        header_row = table.find("tr")
        header_text = _clean(header_row.get_text(" ")) if header_row else ""
        is_stats = "PLAYED/STATS" in header_text
        if is_stats:
            stats_seen += 1
        side = "home" if stats_seen <= 1 else "away"
        lines = home if side == "home" else away
        eligible = home_eligible if side == "home" else away_eligible
        if is_stats:
            lines.extend(_parse_stats_table(table, side))
        elif "ELIGIBLE" in header_text:
            eligible.extend(_parse_eligible_table(table))

    return MatchReport(
        home=home,
        away=away,
        referees=_referees(soup),
        home_eligible=home_eligible,
        away_eligible=away_eligible,
    )


def fetch_report(url: str) -> MatchReport:
    return parse(fetch.get(url))


if __name__ == "__main__":
    url = "https://elements.demosphere-secure.com/72601/MatchReports/116112328/11566105.html"
    report = fetch_report(url)
    print(f"{url}\n")

    print("HOME scorers:")
    for line in report.home:
        if line.g or line.a:
            print(f"  #{line.jersey:>3} {line.name:24} G={line.g} A={line.a}")

    print("AWAY scorers:")
    for line in report.away:
        if line.g or line.a:
            print(f"  #{line.jersey:>3} {line.name:24} G={line.g} A={line.a}")

    print("\nReferees:")
    for name, role in report.referees:
        print(f"  {name} ({role})")
