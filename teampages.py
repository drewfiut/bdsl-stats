"""Fetch and parse one club's Team Roster table (the per-club TEAM.html page).

This is a SECOND, independent view of the same per-player numbers the stats element (E 928,
see parse_stats.py) serves pre-aggregated. The roster page renders the manager-entered data
live, so it moves as soon as a manager enters or edits a game, whereas the element only moves
when Demosphere recomputes it. The two therefore disagree for a while after any entry -- which
is exactly what lagcheck.py measures. Nothing here feeds the authoritative store; `stats.csv`
stays sourced from the element alone (see DATA.md §5.8).

The table is the one whose header row carries `class="ros-hdr-2"`, with per-column `title`
attributes ("Games Played", "Goals", "Assists", "Yellow Card", "Red Card") -- we locate the
columns by those titles rather than by index, since the column set has varied. A blank/`-`
cell means zero.

League and Over-35 roster rows link each name to that person's player element, and the link's
last `+`-separated token is the PERSONKEY -- the same stable id `stats.csv` carries. Cup roster
rows are plain text with NO link, so cup rows come back with `person_key=""` and can only be
matched by name. That asymmetry is the main reason the element remains the source of truth.
"""
import re
from dataclasses import dataclass
from typing import List, Optional

from bs4 import BeautifulSoup

import config
import fetch


@dataclass
class RosterLine:
    person_key: str      # "" on cup pages, which carry no player links
    name: str            # verbatim "Last, First"
    jersey: str
    gp: int
    g: int
    a: int
    y: int
    r: int


# leading roster ordinal rendered before the name, e.g. "01. Cappuccio, Dave"
_ORDINAL = re.compile(r"^\d+\.\s*")


def _clean(s: str) -> str:
    return " ".join((s or "").replace("\xa0", " ").split())


def _int(cell) -> int:
    """Roster stat cells render 0 as "-" (or empty)."""
    text = _clean(cell.get_text()) if cell is not None else ""
    if text in ("", "-"):
        return 0
    try:
        return int(text)
    except ValueError:
        return 0


def _person_key(cell) -> str:
    """PERSONKEY from the name cell's player link; "" when the cell has no link (cup pages).

    The href ends `...+<club_id>+<tg>+<person_key>`, so the last `+`-separated token is the id.
    """
    a = cell.find("a") if cell else None
    href = a.get("href") if a else None
    if not href:
        return ""
    tail = href.rsplit("+", 1)[-1].strip().strip('"')
    return tail if tail.isdigit() else ""


def parse(html: str) -> List[RosterLine]:
    """Roster lines from a TEAM.html page; empty list if it carries no roster table."""
    soup = BeautifulSoup(html, "lxml")

    header = soup.find("tr", class_="ros-hdr-2")
    if header is None:
        return []
    table = header.find_parent("table")
    if table is None:
        return []

    # Map the stat columns by their header `title`, not by position.
    cols = {}
    for i, td in enumerate(header.find_all("td")):
        title = (td.get("title") or "").strip()
        if title:
            cols[title] = i
    name_i = cols.get("Name", 2)
    for td in header.find_all("td"):
        if "tm-name" in (td.get("class") or []):
            name_i = header.find_all("td").index(td)
            break

    lines = []
    for tr in table.find_all("tr"):
        classes = tr.get("class") or []
        if not any(c.startswith("RowGray") for c in classes):
            continue
        cells = tr.find_all("td")
        if len(cells) <= name_i:
            continue

        def col(title: str):
            i = cols.get(title)
            return cells[i] if i is not None and i < len(cells) else None

        name_cell = cells[name_i]
        name = _ORDINAL.sub("", _clean(name_cell.get_text(" ")))
        if not name:
            continue
        lines.append(
            RosterLine(
                person_key=_person_key(name_cell),
                name=name,
                jersey=_clean(cells[0].get_text()),
                gp=_int(col("Games Played")),
                g=_int(col("Goals")),
                a=_int(col("Assists")),
                y=_int(col("Yellow Card")),
                r=_int(col("Red Card")),
            )
        )
    return lines


def fetch_roster(section: str, club_id: str, tg: str) -> List[RosterLine]:
    """Roster lines for one club in one competition. `section` differs for league vs cups."""
    return parse(fetch.get(config.team_html_url(section, club_id, tg)))


def fetch_roster_any(sections, club_id: str, tg: str) -> Optional[tuple]:
    """Try each candidate section, returning (section, lines) for the first that has a roster.

    A season's cups can live under more than one `cup_section`, and a club/tg pair only renders
    under its own section -- so the caller passes every plausible section and we probe. Returns
    None when no section yields a roster table.
    """
    for section in sections:
        try:
            lines = fetch_roster(section, club_id, tg)
        except RuntimeError:
            continue
        if lines:
            return section, lines
    return None


if __name__ == "__main__":
    for label, section, club, tg in [
        ("Enigma FC / Over 35", config.LEAGUE_SECTION, "106830132", "116112420"),
        ("Infinity FC / Wood Cup", config.CUP_SECTIONS[0], "98469009", "116537289"),
    ]:
        lines = fetch_roster(section, club, tg)
        print(f"\n{label}: {len(lines)} players")
        for line in lines:
            if line.g or line.a:
                print(f"  {line.person_key or '(no key)':>10}  {line.name:26} "
                      f"GP={line.gp} G={line.g} A={line.a}")
