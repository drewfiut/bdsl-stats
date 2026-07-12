"""Reconcile a competition's standings and true champion -- computed at collect time, stored.

Two concerns the raw source data gets wrong or omits:

  * **Standings order.** The source `rank` was being mis-read as "who won the title"; it's only the
    regular-season table position and is not trusted. `assign_positions` recomputes a `position` for
    each team from its own record (points, then goal difference, then goals scored).
  * **Champion.** A division/cup is decided by a playoff bracket whose final is tagged `CHMP`, not by
    the table. `champion_for` reads the games (see schedules.py) and returns the winner of the played
    `CHMP` game. A team can top the table yet lose in the playoffs (e.g. Infinity FC topped the 2023
    4th Division but lost their semifinal; Bangarang FC won the CHMP game and the title).

Both are pure functions over already-fetched data -- no network.
"""
from collections import defaultdict
from typing import List, Tuple

# The championship final's round label. (Quarter/semifinals are QF*/SF*; only the final decides it.)
_FINAL_LABELS = {"CHMP", "CHAMP"}


def _int(v) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _winner(g):
    """(club_id, name) of a game's winner, or None if it's unplayed / level (a tie)."""
    if g.status != "played" or g.home_score is None or g.away_score is None:
        return None
    if g.home_score > g.away_score:
        return g.home_club_id, g.home_name
    if g.away_score > g.home_score:
        return g.away_club_id, g.away_name
    return None


def _game_sort_key(g):
    return (g.date or "", _int(g.game_number))


def _infer_final(games):
    """The championship final for a bracket whose final wasn't tagged `CHMP` (older seasons).

    Safe reconstruction: if both semifinals were decisive, the two SF winners are the only
    finalists, so the final is the unlabeled game between exactly those two teams played on/after
    the last semifinal. This deliberately excludes third-place games (contested by the SF *losers*)
    and cross-competition noise. Returns the final Game, or None if it can't be pinned down (e.g. a
    semifinal decided on penalties, or the competition only tagged quarterfinals).
    """
    sfs = [g for g in games
           if (g.round_label or "").upper().startswith("SF") and g.status == "played"]
    if not sfs:
        return None
    winners = set()
    for g in sfs:
        w = _winner(g)
        if not w:
            return None            # a semifinal was level (PK) -- finalist unknown
        winners.add(w[0])
    if len(winners) != 2:
        return None
    last_sf = max((g.date for g in sfs if g.date), default="")
    cands = [g for g in games
             if g.status == "played" and g.date and g.date >= last_sf
             and not (g.round_label or "")
             and {g.home_club_id, g.away_club_id} == winners]
    if not cands:
        return None
    return max(cands, key=_game_sort_key)


def assign_positions(teams: List[dict]) -> None:
    """Set `team["position"]` (1-based) within each competition, in place.

    Teams are grouped by `tg`; each group is ordered by points, then goal difference, then goals
    for, then name. This matches the official table in the common case but does not replicate any
    exotic league tiebreaker (e.g. head-to-head).
    """
    by_tg = defaultdict(list)
    for t in teams:
        by_tg[t.get("tg")].append(t)
    for group in by_tg.values():
        group.sort(key=lambda t: (
            -_int(t.get("pts")), -_int(t.get("gd")), -_int(t.get("gf")), (t.get("name") or ""),
        ))
        for i, t in enumerate(group, 1):
            t["position"] = i


def champion_for(games: List, teams: List[dict], season_final: bool = True) -> Tuple[str, str, str]:
    """Return (champion_club_id, champion_name, via) for one competition.

    `games` are that competition's Game rows; `teams` are its position-assigned team dicts (empty
    for cups, which have no standings table). `season_final` is False for the live, in-progress
    season -- there, the absence of a playoff bracket means "playoffs haven't happened yet," not
    "no playoff this year," so the "regular" fallback is suppressed (champion stays undecided until
    the final is actually played). `via` is:
      * "playoff" -- winner of the playoff final (a tagged `CHMP` game, or -- for older seasons
                     that left the final untagged -- a safely reconstructed final; see _infer_final).
      * "regular" -- a completed season where no playoff bracket existed, so the regular-season
                     leader (position 1) is the champion.
      * ""        -- undecided: season in progress, or a bracket whose final can't be pinned down
                     (final untagged and un-reconstructable, or settled on penalties -- the
                     score-only games don't record a shootout winner). Competitions left blank
                     here may still be filled in downstream from bdsl.org's own authoritative
                     champion history table (see champions.py), which tags them
                     `via="history-table"` instead.
    """
    finals = [g for g in games
              if (g.round_label or "").upper() in _FINAL_LABELS and g.status == "played"]
    if finals:
        w = _winner(max(finals, key=_game_sort_key))
        return (w[0], w[1], "playoff") if w else ("", "", "")

    inferred = _infer_final(games)
    if inferred is not None:
        w = _winner(inferred)
        if w:
            return w[0], w[1], "playoff"

    has_bracket = any(g.round_label for g in games)
    if season_final and not has_bracket and teams:
        top = min(teams, key=lambda t: t.get("position", 1 << 30))
        return str(top.get("club_id") or ""), (top.get("name") or ""), "regular"
    return "", "", ""
