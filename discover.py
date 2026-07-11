"""Enumerate the season's competitions (and their teams) to pull player numbers from.

Each competition (a league division, Over-35, or a cup) is a Demosphere "team group" with a
numeric key (`tg`). The stats element (see parse_stats) takes that key and returns every
player's authoritative goal/assist/games-played counts for that competition -- this is the
same data behind the site's official "Top 10 Stats" leaders, and it is a superset of the
per-team roster pages (it still credits players who were later dropped from a roster).

  * league  -> the 6 divisions (Premier ... 4th Division)
  * over35   -> the Over-35 division
  * cup      -> Tehel / Wood / Matthews cups

The league/Over-35 standings page also carries each team's record (W/L/GF/GA/...), exposed
via `discover_teams()` for the store's team dimension.
"""
import json
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import List

from bs4 import BeautifulSoup

import config
import fetch

# a team record inside the standings JSON blob (club id, division, name, W/L record, ...)
_TEAM_OBJ = re.compile(r'"\d+":(\{[^{}]*?"tm"[^{}]*?\})')


@dataclass(frozen=True)
class StatGroup:
    competition: str      # e.g. "Premier", "Over 35", "Tehel Cup"
    comp_type: str        # "league" | "over35" | "cup"
    tg: str               # team-group key -> stats element parameter


@lru_cache(maxsize=None)
def _standings_objs(section: str, element: str) -> tuple:
    """Parsed team objects from a season's league/Over-35 standings blob (memoised per run)."""
    html = fetch.get(config.runisa_url(element, "Main", section))
    objs = []
    for m in _TEAM_OBJ.finditer(html):
        try:
            objs.append(json.loads(m.group(1)))
        except json.JSONDecodeError:
            continue
    return tuple(objs)


def _comp_type(division_name: str) -> str:
    # Over-35 is a single division some years ("Over 35") and split others
    # ("Over 35 Premier" / "Over 35 Championship"), so match on the prefix.
    return "over35" if division_name.startswith(config.OVER35_DIVISION_NAME) else "league"


def _int(v) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _opt_int(v):
    """Int if present, else "" -- used for fields (cards) absent in older seasons."""
    return _int(v) if v not in (None, "") else ""


def discover_league_and_over35(section: str, element: str) -> List[StatGroup]:
    divisions = {}  # tg -> (name, seq)
    for obj in _standings_objs(section, element):
        tg, name = obj.get("tg"), (obj.get("tgnm") or "").strip()
        if tg and name:
            divisions.setdefault(tg, (name, _int(obj.get("tgseq"))))
    return [
        StatGroup(competition=name, comp_type=_comp_type(name), tg=tg)
        for tg, (name, _seq) in sorted(divisions.items(), key=lambda kv: kv[1][1])
    ]


def discover_cups(cup_sections: List[str]) -> List[StatGroup]:
    """Cups for a season. Each cup-index section lists its cups as schedule links whose id is
    the cup's team-group key. Live seasons pass one section; historical seasons pass the
    per-year sections harvested from the cup-history pages. Deduped by team-group key."""
    groups, seen = [], set()
    for section in cup_sections:
        html = fetch.get(config.runisa_url(config.CUP_INDEX_ELEMENT, "Short", section))
        soup = BeautifulSoup(html, "lxml")
        for a in soup.find_all("a", href=True):
            m = re.search(r"schedules/\d+/(\d+)\.html", a["href"])
            name = a.get_text(" ", strip=True)
            if not m or not name or m.group(1) in seen:
                continue
            seen.add(m.group(1))
            groups.append(StatGroup(competition=name, comp_type="cup", tg=m.group(1)))
    return groups


def discover_all(season: dict) -> List[StatGroup]:
    return (
        discover_league_and_over35(season["league_section"], season["standings_element"])
        + discover_cups(season["cup_sections"])
    )


def discover_teams(section: str, element: str) -> List[dict]:
    """League + Over-35 teams with their full standings record, for the store's team dimension.

    Captures overall + home/away W/L/T, goals, points, and discipline (yellow/red card totals,
    present in recent seasons only -- blank when the source omits them). The source `rank` is
    deliberately dropped (untrusted -- it ignores the playoffs); `collect`/`backfill` compute a
    trustworthy `position` instead via standings.assign_positions. Cup team identities appear in
    each stats snapshot (team_key/team_name columns).
    """
    teams = []
    for o in _standings_objs(section, element):
        tm, tg = o.get("tm"), o.get("tg")
        name = (o.get("tgnm") or "").strip()
        if not (tm and tg):
            continue
        teams.append({
            "team_id": f"{tm}-{tg}",
            "club_id": tm,
            "team_code": (o.get("tmcd") or "").strip(),
            "tg": tg,
            "tg_seq": _int(o.get("tgseq")),
            "competition": name,
            "comp_type": _comp_type(name),
            "name": (o.get("tmnm") or "").strip(),
            "gp": _int(o.get("TOT_GP")),
            "w": _int(o.get("TOT_W")),
            "l": _int(o.get("TOT_L")),
            "d": _int(o.get("TOT_T")),
            "pts": _int(o.get("TOT_PTS")),
            "gf": _int(o.get("TOT_GF")),
            "ga": _int(o.get("TOT_GA")),
            "gd": _int(o.get("TOT_GD")),
            "home_w": _int(o.get("H_W")),
            "home_l": _int(o.get("H_L")),
            "home_d": _int(o.get("H_T")),
            "away_w": _int(o.get("A_W")),
            "away_l": _int(o.get("A_L")),
            "away_d": _int(o.get("A_T")),
            "yellows": _opt_int(o.get("TOT_TC")),
            "reds": _opt_int(o.get("TOT_TE")),
        })
    return teams


if __name__ == "__main__":
    for g in discover_all(config.SEASON):
        print(f"  {g.comp_type:7} {g.competition:16} tg={g.tg}")
    n = len(discover_teams(config.LEAGUE_SECTION, config.STANDINGS_ELEMENT))
    print(f"\n{n} league/over-35 teams with records")
