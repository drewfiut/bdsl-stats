"""Merge a stored stats snapshot into one per-person leaderboard.

Each player is identified by their global Demosphere person key, so a person who plays in a
league division, a cup, and the Over-35 division is a single entry whose goals/assists are
the sum across all three. No name matching is involved -- the person key is stable and
present on every record -- so distinct people who happen to share a name stay separate.

Reads only from the data store (see collect.py for the network side).

This predates the website and isn't imported by it -- the site ports this same aggregation
logic to JavaScript in web/src/lib/data.js and runs it client-side. Kept around as a
standalone CLI for ad-hoc inspection and debugging against the data store.
"""
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import config
import store
from discover import StatGroup

COMP_TYPES = ("league", "cup", "over35")
COMP_TYPE_LABELS = {"league": "League", "cup": "Cups", "over35": "Over 35"}


@dataclass
class CompStat:
    competition: str
    comp_type: str
    team_name: str
    goals: int = 0
    assists: int = 0
    games_played: int = 0


@dataclass
class Player:
    person_key: str
    display_name: str = ""
    season_id: str = ""
    season_label: str = ""
    goals: int = 0
    assists: int = 0
    games_played: int = 0
    by_type: Dict[str, Dict[str, int]] = field(
        default_factory=lambda: {t: {"g": 0, "a": 0, "gp": 0} for t in COMP_TYPES}
    )
    comps: List[CompStat] = field(default_factory=list)
    _name_counts: Dict[str, int] = field(default_factory=lambda: defaultdict(int))

    @property
    def points(self) -> int:
        return config.POINTS_PER_GOAL * self.goals + config.POINTS_PER_ASSIST * self.assists

    @property
    def teams(self) -> List[str]:
        seen, out = set(), []
        for c in self.comps:
            if c.team_name and c.team_name not in seen:
                seen.add(c.team_name)
                out.append(c.team_name)
        return out

    def add_row(self, row: dict) -> None:
        g, a, gp = int(row["g"]), int(row["a"]), int(row["gp"])
        ctype = row["comp_type"]
        self.goals += g
        self.assists += a
        self.games_played += gp
        bt = self.by_type.get(ctype)
        if bt is not None:
            bt["g"] += g
            bt["a"] += a
            bt["gp"] += gp
        self.comps.append(CompStat(
            competition=row["competition"], comp_type=ctype,
            team_name=row["team_name"], goals=g, assists=a, games_played=gp,
        ))
        if row.get("name"):
            self._name_counts[row["name"]] += 1

    def finalize(self) -> None:
        self.display_name = (
            max(self._name_counts, key=self._name_counts.get)
            if self._name_counts else "(unknown)"
        )


@dataclass
class Leaderboard:
    players: List[Player]
    groups: List[StatGroup]
    season_id: str = ""
    snapshot_date: Optional[str] = None
    fetched_at: str = ""

    def ranked_by(self, stat: str) -> List[Player]:
        key = {
            "points": lambda p: (p.points, p.goals, p.assists),
            "goals": lambda p: (p.goals, p.assists, p.points),
            "assists": lambda p: (p.assists, p.goals, p.points),
        }[stat]
        return sorted(self.players, key=key, reverse=True)


def build_from_store(season_id: Optional[str] = None,
                     snapshot_date: Optional[str] = None) -> Leaderboard:
    sid = season_id or config.SEASON_ID
    date, fetched_at, rows = store.load_snapshot(sid, snapshot_date)
    groups = [
        StatGroup(competition=c["competition"], comp_type=c["comp_type"], tg=c["tg"])
        for c in store.load_competitions(sid)
    ]

    players: Dict[str, Player] = {}
    for row in rows:
        pk = row["person_key"]
        players.setdefault(pk, Player(person_key=pk)).add_row(row)
    for p in players.values():
        p.finalize()

    return Leaderboard(players=list(players.values()), groups=groups,
                       season_id=sid, snapshot_date=date, fetched_at=fetched_at)


@dataclass
class SeasonBoard:
    """A leaderboard whose rows are individual player-seasons across the whole store."""
    players: List[Player]                 # each tagged with season_id / season_label
    season_labels: List[str]              # newest-first, for display
    current_fetched_at: str = ""          # freshness of the live season

    def ranked_by(self, stat: str) -> List[Player]:
        key = {
            "points": lambda p: (p.points, p.goals, p.assists),
            "goals": lambda p: (p.goals, p.assists, p.points),
            "assists": lambda p: (p.assists, p.goals, p.points),
        }[stat]
        return sorted(self.players, key=key, reverse=True)


def build_player_seasons(season_ids: Optional[List[str]] = None) -> SeasonBoard:
    """One Player row per (season, person) across every season in the store.

    Each season is merged on its own (a person's league + cup + Over-35 lines within that
    year are summed into a single row), then the seasons are concatenated, so the board ranks
    the best *single-season* performances in BDSL history.
    """
    seasons = store.load_seasons()
    sids = season_ids or sorted(seasons)
    rows: List[Player] = []
    for sid in sids:
        lb = build_from_store(season_id=sid)
        label = seasons.get(sid, {}).get("label", sid)
        for p in lb.players:
            p.season_id = sid
            p.season_label = label
        rows.extend(lb.players)

    labels = [seasons.get(s, {}).get("label", s) for s in sorted(sids, reverse=True)]
    current_fetched = ""
    if config.SEASON_ID in sids:
        _d, current_fetched, _r = store.load_snapshot(config.SEASON_ID)
    return SeasonBoard(players=rows, season_labels=labels, current_fetched_at=current_fetched)


if __name__ == "__main__":
    lb = build_from_store()
    active = [p for p in lb.players if p.games_played > 0]
    print(f"snapshot {lb.snapshot_date}: {len(lb.players)} people "
          f"({len(active)} with games played)\n")
    print(f"{'#':>3} {'Player':26} {'G':>3} {'A':>3} {'Pts':>4}  Competitions")
    for i, p in enumerate(lb.ranked_by("points")[:20], 1):
        comps = ", ".join(sorted({c.competition for c in p.comps}))
        print(f"{i:3} {p.display_name:26} {p.goals:3} {p.assists:3} {p.points:4}  {comps}")
