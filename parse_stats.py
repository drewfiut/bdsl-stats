"""Fetch and parse a competition's authoritative per-player stats.

The Demosphere "stats" element (E 928) takes a team-group key and returns a JSON array of
records -- one per player in that competition -- embedded in the page. Each record has a
global PERSONKEY (stable across every competition a person plays in), their name, team, and
goal / assist / games-played counts. This is the same data behind the official "Top 10
Stats" leaders, so it agrees with the site and, unlike the roster pages, never drops a
player who has since left a team but scored earlier in the season.
"""
import json
import re
from dataclasses import dataclass
from typing import List, Optional

import config
import fetch

STATS_ELEMENT = "928"

# each player record is a flat JSON object containing "GOALCOUNT"
_RECORD = re.compile(r'\{[^{}]*"GOALCOUNT"[^{}]*\}')


@dataclass
class StatRecord:
    person_key: str
    last_name: str
    first_name: str
    mid_name: Optional[str]
    nickname: Optional[str]
    birthdate: Optional[str]
    team_key: str          # club id (Demosphere TEAMKEY)
    team_name: str
    jersey: str
    position: str          # PLAYERPOS (e.g. "D", "M", "F"); often blank
    goals: int
    assists: int
    games_played: int

    @property
    def full_name(self) -> str:
        first = self.nickname or self.first_name or ""
        name = f"{first} {self.last_name}".strip()
        return name or self.last_name or "(unknown)"


def _int(v) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _stats_url(tg: str) -> str:
    # NB: this element uses the "gp" (not "gpx") action and no display verb.
    return (
        f"{config.ELEMENTS_BASE}/scripts/runisa.dll?"
        f"M2:gp::{config.ORG}+Elements/Display+E+{STATS_ELEMENT}++{tg}"
    )


def fetch_stats(tg: str) -> List[StatRecord]:
    html = fetch.get(_stats_url(tg))
    records = []
    for raw in _RECORD.findall(html):
        try:
            o = json.loads(raw)
        except json.JSONDecodeError:
            continue
        person_key = o.get("PERSONKEY")
        if person_key is None:
            continue
        records.append(
            StatRecord(
                person_key=str(person_key),
                last_name=(o.get("LASTNAME") or "").strip(),
                first_name=(o.get("FIRSTNAME") or "").strip(),
                mid_name=(o.get("MIDNAME") or None),
                nickname=(o.get("NICKNAME") or None),
                birthdate=(o.get("BIRTHDATE") or None),
                team_key=str(o.get("TEAMKEY") or "").strip(),
                team_name=(o.get("FULLTEAMNAME") or "").strip(),
                jersey=str(o.get("JERSEY") or "").strip(),
                position=(o.get("PLAYERPOS") or "").strip(),
                goals=_int(o.get("GOALCOUNT")),
                assists=_int(o.get("ASSISTCOUNT")),
                games_played=_int(o.get("GAMESPLAYEDCOUNT")),
            )
        )
    return records


if __name__ == "__main__":
    recs = fetch_stats("116112414")  # Premier
    recs.sort(key=lambda r: -r.goals)
    print(f"Premier: {len(recs)} players")
    for r in recs[:8]:
        print(f"  {r.full_name:26} {r.team_name:20} G={r.goals} A={r.assists} GP={r.games_played}")
