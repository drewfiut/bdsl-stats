"""Fetch and parse a competition's full schedule/results into per-game rows.

Every competition (league division, Over-35, or cup) has a Demosphere schedule page reachable
via the cup-index element with the team-group key in the section slot; the server redirects to a
friendly `schedules/<seg>/<tg>.html` page (see config.schedule_element_url). The games sit in the
static HTML (table `#tblListGames2`) -- no AJAX needed -- one `<tr class="sch-main-gm">` per game
carrying a stable `data-gamekey`, the home/away club ids (`data-tmkey`, which join straight to
teams.json `club_id`), the score, and a playoff round label (`data-`... `gmlabel`, e.g. QF/SF/CHMP).

**Pagination.** League/Over-35 schedules are split one page *per calendar month*
(`.../Summer<year>/<tg>.<year><month>.html`); the default page shows only the latest month, so we
also fetch each month bucket and dedupe by `game_key`. Cup schedules are a single page (their
friendly path is `.../<year>/<tg>.html`, not `Summer<year>`), so no month walk is needed.
"""
import datetime as dt
import re
from dataclasses import dataclass
from typing import List, Optional

from bs4 import BeautifulSoup

import config
import fetch

# H:A somewhere in the score cell (e.g. "1:2", "5:0 FT", "1:1 PK"); the remainder is a status note.
_SCORE = re.compile(r"(\d+)\s*:\s*(\d+)")
# per-month bucket links on a paginated schedule page: <tg>.<code>.html (code is <year><month>)
_BUCKET = re.compile(r"\.(\d+)\.html")


@dataclass
class Game:
    game_key: str
    game_number: str
    round_label: str        # playoff tag: "", QF1..QF4, SF1/SF2, CHMP/CHAMP
    date: str               # ISO YYYY-MM-DD (best effort; "" if unparseable)
    time: str               # kept verbatim, e.g. "8:30 pm"
    home_club_id: str
    home_name: str
    away_club_id: str
    away_name: str
    home_score: Optional[int]
    away_score: Optional[int]
    status: str             # "played" | "scheduled"
    result_note: str        # trailing token on the score, e.g. "FT", "PK"
    location: str
    report_path: str = ""   # href of the row's Match Report anchor, e.g. "/72601/MatchReports/<section>/<game_key>.html"; "" if none


def _clean(s: str) -> str:
    return (s or "").replace("\xa0", " ").strip()


def _team(cell) -> tuple:
    """(club_id, name) from a schedtm cell; name from the tm-name span if present, else cell text."""
    if cell is None:
        return "", ""
    club_id = _clean(cell.get("data-tmkey") or "")
    span = cell.select_one("span.tm-name")
    name = _clean(span.get_text(" ") if span else cell.get_text(" "))
    return club_id, name


def _report_path(tr) -> str:
    """href of the row's Match Report anchor, e.g. "/72601/MatchReports/<section>/<game_key>.html"."""
    for a in tr.find_all("a"):
        href = _clean(a.get("href") or "")
        if "MatchReports" in href:
            return href
    return ""


def _parse_date(text: str) -> str:
    """"Mon, July 6, 2026" -> "2026-07-06"; "" if it doesn't parse."""
    text = _clean(text)
    for fmt in ("%a, %B %d, %Y", "%A, %B %d, %Y"):
        try:
            return dt.datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return ""


def _parse_into(html: str, games: dict) -> None:
    """Parse the games table in `html`, adding/replacing Game rows in `games` keyed by game_key."""
    soup = BeautifulSoup(html, "lxml")
    table = soup.select_one("#tblListGames2") or soup
    current_date = ""
    for tr in table.find_all("tr"):
        classes = tr.get("class") or []
        if "gm-hdr-5d1h" in classes:                 # a date header row
            current_date = _parse_date(tr.get_text(" "))
            continue
        if "sch-main-gm" not in classes:             # not a game row
            continue
        key = _clean(tr.get("data-gamekey") or "")
        if not key:
            continue

        gamecode = tr.select_one("span.gamecode")
        gmlabel = tr.select_one("span.gmlabel")
        time_cell = tr.select_one("td.tim")
        home_id, home_name = _team(tr.select_one("td.schedtm1"))
        away_id, away_name = _team(tr.select_one("td.schedtm2"))

        sc_cell = tr.select_one("td.sch-main-sc")
        sc_text = _clean(sc_cell.get_text(" ")) if sc_cell else ""
        m = _SCORE.search(sc_text)
        if m:
            home_score, away_score = int(m.group(1)), int(m.group(2))
            status = "played"
            note = _clean(sc_text[: m.start()] + " " + sc_text[m.end():])
        else:
            home_score = away_score = None
            status = "scheduled"
            note = ""

        fac = tr.select_one("span.gm-fac")

        games[key] = Game(
            game_key=key,
            game_number=_clean(gamecode.get_text() if gamecode else ""),
            round_label=_clean(gmlabel.get_text() if gmlabel else ""),
            date=current_date,
            time=_clean(time_cell.get_text() if time_cell else ""),
            home_club_id=home_id,
            home_name=home_name,
            away_club_id=away_id,
            away_name=away_name,
            home_score=home_score,
            away_score=away_score,
            status=status,
            result_note=note,
            location=_clean(fac.get_text(" ") if fac else ""),
            report_path=_report_path(tr),
        )


def fetch_games(tg: str, year: int) -> List[Game]:
    """Every game for a competition's schedule, deduped by game_key.

    Fetches the default schedule page, then -- for month-paginated league/Over-35 schedules -- each
    month bucket (discovered from the page's nav links, plus a March-October brute-force fallback
    for older pages that carry no nav). Cup pages resolve to a single page and skip the month walk.
    """
    html, final_url = fetch.get_final(config.schedule_element_url(tg))
    games: dict = {}
    _parse_into(html, games)

    base = final_url.split("?", 1)[0]
    if base.endswith(".html"):
        base = base[: -len(".html")]

    codes = set(_BUCKET.findall(html))
    if "/schedules/Summer" in final_url:             # league / Over-35 are month-paginated
        codes |= {f"{year}{mo}" for mo in range(3, 11)}

    for code in sorted(codes):
        text = fetch.get_optional(f"{base}.{code}.html")
        if text:
            _parse_into(text, games)

    return list(games.values())


if __name__ == "__main__":
    import sys

    tg = sys.argv[1] if len(sys.argv) > 1 else "116112414"  # Premier 2026
    year = int(sys.argv[2]) if len(sys.argv) > 2 else 2026
    gs = fetch_games(tg, year)
    played = [g for g in gs if g.status == "played"]
    print(f"tg={tg}: {len(gs)} games ({len(played)} played)\n")
    for g in sorted(gs, key=lambda g: (g.date, g.game_number))[:12]:
        sc = f"{g.home_score}:{g.away_score}" if g.status == "played" else "vs"
        lbl = f"[{g.round_label}] " if g.round_label else ""
        print(f"  {g.date} #{g.game_number:>5} {lbl}{g.home_name:24} {sc:>5} {g.away_name:24} @ {g.location}")
