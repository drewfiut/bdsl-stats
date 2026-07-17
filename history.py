#!/usr/bin/env python3
"""Backfill past BDSL seasons into the data store.

bdsl.org keeps every season since 2008. Team-level data (standings, champions, team goals)
is available for all of them, so this ingests 2008-2025 (2020 was cancelled -- see
config.HISTORY_YEARS). Individual goal/assist stats only begin in 2014; earlier seasons have
standings but no player scoring, so their stats snapshot is empty (the store and frontend
handle that gracefully). Historical data never changes, so each season is collected once,
marked `final`, and skipped on later runs.

Discovery is entirely off public bdsl.org pages (no auth, plain GETs):
  * /standings/<year>            -> that year's league/Over-35 section (element 47107)
  * /league-history/<cup>        -> each cup's per-year cup-index sections (element 46241)
Both the standings section and the cup sections then flow through the same discover/collect
code the live season uses (see collect.collect / discover.discover_all).

    python history.py                 # harvest descriptors, collect every season not yet stored
    python history.py --year 2025     # just one season
    python history.py --force         # re-collect even seasons already stored
    python history.py --harvest-only  # print discovered descriptors, fetch no stats
"""
import argparse
import re
from collections import defaultdict
from typing import Dict, List, Optional

import collect
import config
import fetch
import store

# league/Over-35 iframe on /standings/<year>: ...Display+E+<element>+Main/++++<section>
_STANDINGS_SRC = re.compile(r"Display\+E\+(\d+)\+Main/\++(\d+)")
# cup-index iframes on /league-history/<cup>: ...Display+E+46241+Short/++++<section>
_CUP_SRC = re.compile(r"Display\+E\+" + re.escape(config.CUP_INDEX_ELEMENT) + r"\+\w+/\++(\d+)")
# schedule links inside a cup-index page: schedules/<year>/<cupid>.html. The year segment is
# restricted to a real 4-digit year: a few pre-2016 cup pages use a malformed link whose first
# segment is a section id, not a year -- those cups predate individual-stat tracking anyway.
_SCHED = re.compile(r"schedules/((?:19|20)\d\d)/(\d+)\.html")

CUP_HISTORY_PAGES = ["tehel-cup", "wood-cup", "matthews-cup"]


def _league_section(year: int):
    """(standings_element, league_section) for a year, read off bdsl.org/standings/<year>."""
    html = fetch.get(f"{config.SITE_BASE}/standings/{year}")
    m = _STANDINGS_SRC.search(html)
    return (m.group(1), m.group(2)) if m else (None, None)


def _cup_sections_by_year() -> Dict[int, List[str]]:
    """Map each year -> the cup-index sections that hold that year's cups.

    The three cup-history pages each list one section per past year; a section's year is read
    from the `schedules/<year>/...` links it contains. Sections with no schedule links (old
    pre-website champion lists) are ignored.
    """
    sections = set()
    for page in CUP_HISTORY_PAGES:
        html = fetch.get(f"{config.SITE_BASE}/league-history/{page}")
        sections.update(_CUP_SRC.findall(html))

    by_year: Dict[int, set] = defaultdict(set)
    for section in sections:
        html = fetch.get(config.runisa_url(config.CUP_INDEX_ELEMENT, "Short", section))
        years = {int(y) for y, _cupid in _SCHED.findall(html)}
        for y in years:
            by_year[y].add(section)
    return {y: sorted(secs) for y, secs in by_year.items()}


def harvest_seasons(years: Optional[List[int]] = None) -> List[dict]:
    """Discover a `final` season descriptor for each historical year."""
    years = years or config.HISTORY_YEARS
    cups_by_year = _cup_sections_by_year()
    descriptors = []
    for year in years:
        element, section = _league_section(year)
        if not section:
            print(f"  {year}: no standings section found -- skipping")
            continue
        descriptors.append({
            "id": f"{year}-summer",
            "label": f"Summer {year}",
            "standings_element": element,
            "league_section": section,
            "cup_sections": cups_by_year.get(year, []),
            "cup_index_element": config.CUP_INDEX_ELEMENT,
            "schedules_year": str(year),
            "final": True,
        })
    return descriptors


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--year", type=int, help="collect only this season")
    ap.add_argument("--force", action="store_true", help="re-collect seasons already stored")
    ap.add_argument("--harvest-only", action="store_true",
                    help="just print discovered season descriptors; fetch no stats")
    args = ap.parse_args()

    years = [args.year] if args.year else config.HISTORY_YEARS
    print(f"Harvesting historical season ids from {config.SITE_BASE} ...")
    seasons = harvest_seasons(years)

    for s in seasons:
        print(f"  {s['id']}: league_section={s['league_section']} "
              f"cup_sections={s['cup_sections'] or 'none'}")
    if args.harvest_only:
        return

    for s in seasons:
        print(f"\n{s['label']} ({s['id']}):")
        date = collect.collect(season=s, progress=True, force=args.force)
        if date is None:
            continue
        _date, _fetched, rows = store.load_snapshot(s["id"], date)
        scorers = sum(1 for r in rows if int(r["g"]) > 0)
        people = len({r["person_key"] for r in rows})
        print(f"  -> {len(rows)} rows, {people} people, {scorers} scorers "
              f"across {len({r['tg'] for r in rows})} competitions")

    print(f"\nDone. Store now holds seasons: {sorted(store.load_seasons())}")


if __name__ == "__main__":
    main()
