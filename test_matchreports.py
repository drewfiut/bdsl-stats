"""Tests for matchreports.py -- run with `python test_matchreports.py` or pytest."""
import os

import matchreports

_FIXTURES = os.path.join(os.path.dirname(__file__), "tests", "fixtures")
FIXTURE_PATH = os.path.join(_FIXTURES, "matchreport_11566105.html")

with open(FIXTURE_PATH, encoding="utf-8") as f:
    FIXTURE_HTML = f.read()

# An older (2015) report: only 2 tables total (no per-team "Match ELIGIBLE" table), both
# PLAYED/STATS -- the layout that broke fixed-position side assignment. See parse's docstring.
with open(os.path.join(_FIXTURES, "matchreport_5246019_2tbl.html"), encoding="utf-8") as f:
    FIXTURE_2TBL_HTML = f.read()


def test_home_scorer_teijeira():
    report = matchreports.parse(FIXTURE_HTML)
    matches = [line for line in report.home if line.name == "Teijeira, Carson"]
    assert len(matches) == 1, report.home
    assert matches[0].g == 1
    assert matches[0].jersey == "29"


def test_away_scorer_mulderig():
    report = matchreports.parse(FIXTURE_HTML)
    matches = [line for line in report.away if line.name == "Mulderig, Liam"]
    assert len(matches) == 1, report.away
    assert matches[0].g == 2
    assert matches[0].jersey == "10"


def test_referees():
    report = matchreports.parse(FIXTURE_HTML)
    assert set(report.referees) == {("Chris Gray", "CEN"), ("Zach Cox", "RA1")}, report.referees


def test_all_played_stats_names_parsed():
    report = matchreports.parse(FIXTURE_HTML)
    for line in report.home + report.away:
        assert line.name, f"empty name for a PLAYED/STATS row on side={line.side} jersey={line.jersey}"


def test_two_table_layout_splits_both_sides():
    # Older reports carry just [home-stats, away-stats] (no ELIGIBLE tables). Both sides must
    # still be populated -- the regression where every row landed on "home" (away empty). See
    # matchreports.parse.
    report = matchreports.parse(FIXTURE_2TBL_HTML)
    assert report.home, "home side empty on the 2-table layout"
    assert report.away, "away side empty on the 2-table layout"
    # a full-roster PLAYED/STATS table on each side means neither is absurdly larger than the other
    assert abs(len(report.home) - len(report.away)) <= 5, (len(report.home), len(report.away))


def _run_all():
    tests = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"  ok  {t.__name__}")
    print(f"\n{len(tests)} tests passed")


if __name__ == "__main__":
    _run_all()
