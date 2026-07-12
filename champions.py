"""Backstop champion source: bdsl.org's own "Champion / Finalist / Result" history table.

`standings.champion_for` computes a competition's champion from the schedule (winner of the
`CHMP` game, or the regular-season leader when no bracket exists); for 19 historical
competitions neither of those works out and it returns `via=""`. bdsl.org separately renders
one authoritative table per season section (the "cup index" element, verb "Short") listing
every division/cup's Champion, Finalist, and Result -- this module reads that table and uses
it to fill in the still-blank competitions, tagging them `via="history-table"`.

It is deliberately conservative: a champion name from the table is only accepted if it can be
tied to a real club_id already on record for that competition (one of its teams, or one of the
two sides of an identified played game). If the name can't be matched to a real team, the
competition is left blank rather than guessing.
"""
import re
from typing import List, Tuple

from bs4 import BeautifulSoup

import config
import fetch

_HEADER = ("division", "champion", "finalist", "result")
_TYPO_FIX = re.compile(r"\bdivison\b")
_TRAILING_BRACKET = re.compile(r"\s+bracket$")
_WS = re.compile(r"\s+")


def _clean(s: str) -> str:
    return (s or "").replace("\xa0", " ").strip()


def _norm(name: str) -> str:
    """Normalize a division/competition label for matching across sources.

    Lowercases, collapses whitespace, fixes the known "Divison" typo in the source table, and
    drops a trailing "bracket" (the cup-schedule label often reads "Tehel Cup Bracket" while
    the history table just says "Tehel Cup").
    """
    s = _clean(name).lower()
    s = _WS.sub(" ", s)
    s = _TYPO_FIX.sub("division", s)
    s = _TRAILING_BRACKET.sub("", s).strip()
    return s


def parse_champions(html: str) -> List[dict]:
    """Parse the Champion/Finalist/Result history table into row dicts.

    Finds a table whose id contains "46241-short" (the cup-index element rendering), or -- as a
    fallback -- any table whose header row is Division/Champion/Finalist/Result. Skips the
    header row and the trailing nav row (a row whose first cell is empty, or that has more than
    4 non-empty cells).
    """
    soup = BeautifulSoup(html, "lxml")
    table = None
    for t in soup.find_all("table"):
        tid = t.get("id") or ""
        if "46241-short" in tid:
            table = t
            break
    if table is None:
        for t in soup.find_all("table"):
            rows = t.find_all("tr")
            if not rows:
                continue
            cells = [_clean(c.get_text(" ")) for c in rows[0].find_all(["td", "th"])]
            if [c.lower() for c in cells[:4]] == list(_HEADER):
                table = t
                break
    if table is None:
        return []

    out = []
    for tr in table.find_all("tr"):
        cells = [_clean(c.get_text(" ")) for c in tr.find_all(["td", "th"])]
        non_empty = [c for c in cells if c]
        if not non_empty:
            continue
        if [c.lower() for c in cells[:4]] == list(_HEADER):
            continue                      # header row
        if not cells or not cells[0]:
            continue                      # nav row (blank first cell)
        if len(cells) > 4:
            continue                      # trailing nav row (more than 4 cells)
        if len(cells) < 4:
            continue                      # malformed / not a data row
        division, champion, finalist, result = cells[:4]
        out.append({
            "division": division,
            "champion": champion,
            "finalist": finalist,
            "result": result,
        })
    return out


def fetch_champions(section: str) -> List[dict]:
    """Fetch and parse a season section's champion history table."""
    url = config.runisa_url(config.CUP_INDEX_ELEMENT, "Short", section)
    return parse_champions(fetch.get(url))


def _club_id_for(name: str, candidates: List[Tuple[str, str]]) -> str:
    """First club_id in `candidates` (club_id, name) pairs matching `name` (normalized)."""
    target = _norm(name)
    for club_id, cname in candidates:
        if club_id and _norm(cname) == target:
            return club_id
    return ""


def resolve(comp: dict, games: List[dict], teams: List[dict], rows: List[dict]) -> Tuple[str, str, str]:
    """Resolve a still-blank competition's champion from the parsed history-table `rows`.

    Matches the competition to its row primarily by name (`comp["competition"]` vs
    `row["division"]`); if that's not a unique match, falls back to identifying the row whose
    {champion, finalist} pair equals the two teams of some played game in this competition (the
    final, identified by its contestants rather than its label). The champion name is then tied
    to a real club_id -- first from that identified game's two sides, else from `teams`, else
    from any of this competition's games -- and only returned if that resolution succeeds.
    Returns ("", "", "") if no row matches or the champion name can't be tied to a real team.
    """
    comp_games = [g for g in games if g.get("tg") == comp.get("tg")]

    target = _norm(comp.get("competition", ""))
    matches = [r for r in rows if _norm(r["division"]) == target]

    final_game = None
    if len(matches) != 1:
        matches = []
        for r in comp_games:
            if r.get("status") != "played":
                continue
            pair = {_norm(r.get("home_name", "")), _norm(r.get("away_name", ""))}
            for row in rows:
                row_pair = {_norm(row["champion"]), _norm(row["finalist"])}
                if row_pair == pair:
                    matches = [row]
                    final_game = r
                    break
            if matches:
                break

    if len(matches) != 1:
        return "", "", ""

    row = matches[0]

    if final_game is None:
        target_pair = {_norm(row["champion"]), _norm(row["finalist"])}
        for r in comp_games:
            if r.get("status") != "played":
                continue
            pair = {_norm(r.get("home_name", "")), _norm(r.get("away_name", ""))}
            if pair == target_pair:
                final_game = r
                break

    candidates: List[Tuple[str, str]] = []
    if final_game is not None:
        candidates.append((final_game.get("home_club_id", ""), final_game.get("home_name", "")))
        candidates.append((final_game.get("away_club_id", ""), final_game.get("away_name", "")))
    candidates.extend((t.get("club_id", ""), t.get("name", "")) for t in teams)
    for g in comp_games:
        candidates.append((g.get("home_club_id", ""), g.get("home_name", "")))
        candidates.append((g.get("away_club_id", ""), g.get("away_name", "")))

    club_id = _club_id_for(row["champion"], candidates)
    if not club_id:
        return "", "", ""
    return club_id, row["champion"], "history-table"


if __name__ == "__main__":
    import sys

    section = sys.argv[1] if len(sys.argv) > 1 else config.SEASON["league_section"]
    rows = fetch_champions(section)
    print(f"section={section}: {len(rows)} rows\n")
    for r in rows:
        print(f"  {r['division']:16} {r['champion']:26} beat {r['finalist']:26} {r['result']}")
