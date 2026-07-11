"""Static configuration for the BDSL (Demosphere / OTTO SPORT) data source.

All of these were reverse-engineered from bdsl.org, which is a thin SPA in front of
Demosphere's public elements server. Nothing here requires authentication.

If the league rolls over to a new season, the section / element ids below will change.
Load a page on bdsl.org, open one team, and read the ids out of the iframe URL:
    /72601/teams/<LEAGUE_SECTION>/<clubId>-<divisionId>/TEAM.html
and update SEASON_LABEL / the ids accordingly.
"""

ORG = "72601"

ELEMENTS_BASE = "https://elements.demosphere-secure.com"

# The active season. Each season is one entry; adding a past season later is just another
# descriptor (its ids read off that season's pages on bdsl.org). The active one is mirrored
# into data/seasons.json on each run so the store carries its own history.
SEASON = {
    "id": "2026-summer",
    "label": "Summer 2026",
    # League + Over-35 share one "section"; the standings "Main" element embeds a JSON blob
    # describing every team (club id, division id, division name, W/L record).
    "league_section": "116112328",
    "standings_element": "47107",       # display verb: Main
    # The 3 league cups live in their own section(s). The cup index element lists each cup.
    # `cup_sections` is a list so live and historical seasons share one code path: each
    # section is a cup-index page whose schedule links resolve to the cups' team-group ids.
    "cup_sections": ["116537215"],
    "cup_index_element": "46241",       # display verb: Short
    "schedules_year": "2026",           # path segment for cup schedule pages
    "final": False,                     # the active season keeps refreshing; history is final
}

SEASON_ID = SEASON["id"]
SEASON_LABEL = SEASON["label"]
LEAGUE_SECTION = SEASON["league_section"]
STANDINGS_ELEMENT = SEASON["standings_element"]
CUP_SECTIONS = SEASON["cup_sections"]
CUP_INDEX_ELEMENT = SEASON["cup_index_element"]

# bdsl.org itself. Historical seasons are discovered from these public pages.
SITE_BASE = "https://bdsl.org"

# Past seasons to backfill. Individual goal/assist stats in Demosphere only begin in 2014;
# earlier years have rosters/standings but no scoring. 2020 was cancelled (COVID).
HISTORY_YEARS = [2014, 2015, 2016, 2017, 2018, 2019, 2021, 2022, 2023, 2024, 2025]

# BDSL's own "Points Leaders" table scores a goal as 2 and an assist as 1.
POINTS_PER_GOAL = 2
POINTS_PER_ASSIST = 1

# A new stats snapshot is collected on the first run after this local hour each day, so the
# first run of the day refreshes results and later runs reuse the day's snapshot. 3 = 3am.
STATS_REFRESH_HOUR = 3

# Label used for the Over-35 competition in the standings JSON (tgnm value).
OVER35_DIVISION_NAME = "Over 35"


def runisa_url(element: str, verb: str, section: str) -> str:
    """Build a Demosphere `runisa.dll` element URL.

    The empty token slot (`M2:gpx::`) is intentional and required -- the server 404s if
    the colons around the (otherwise ignorable) cache token are missing.
    """
    return (
        f"{ELEMENTS_BASE}/scripts/runisa.dll?"
        f"M2:gpx::{ORG}+Elements/Display+E+{element}+{verb}/++++{section}"
    )


def team_html_url(section: str, tm: str, tg: str) -> str:
    """URL of a team's roster+stats page. `tm` = club id, `tg` = division/cup id."""
    return f"{ELEMENTS_BASE}/{ORG}/teams/{section}/{tm}-{tg}/TEAM.html"


def cup_schedule_url(cup_id: str) -> str:
    return f"{ELEMENTS_BASE}/{ORG}/schedules/{SEASON['schedules_year']}/{cup_id}.html"


def schedule_element_url(tg: str) -> str:
    """Schedule/results page for any competition (league division, Over-35, or cup).

    Uses the cup-index element with the competition's team-group id in the section slot; the
    server 302-redirects to that season's friendly `schedules/<...>/<tg>.html` page (the path
    segment differs between league and cups -- the redirect handles it). Works for every
    competition and every season. `fetch.get` follows the redirect. NB: like the stats element,
    this uses the `M2:gp::` action with a bare id and no display verb.
    """
    return (
        f"{ELEMENTS_BASE}/scripts/runisa.dll?"
        f"M2:gp::{ORG}+Elements/Display+E+{CUP_INDEX_ELEMENT}++{tg}"
    )
