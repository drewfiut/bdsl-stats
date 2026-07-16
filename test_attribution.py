"""Tests for attribution.py -- run with `python test_attribution.py` or pytest."""
import attribution
from matchreports import MatchReport, ReportLine


def _stats_row(pk, name, tg, club_id, jersey):
    return {
        "person_key": pk, "name": name, "tg": tg, "team_id": f"{club_id}-{tg}", "jersey": jersey,
    }


def _game(tg="T1", home_club_id="H", away_club_id="A"):
    return {
        "game_key": "G1", "tg": tg, "competition": "Premier", "comp_type": "league",
        "date": "2026-07-06", "round_label": "", "home_club_id": home_club_id, "away_club_id": away_club_id,
    }


def test_jersey_match():
    # The report line's name isn't on the roster (a spelling the stats data doesn't carry), so
    # name resolution misses and it falls back to the (unambiguous) jersey.
    stats_rows = [_stats_row("100", "C. J. Teijeira", "T1", "H", "29")]
    idx = attribution.build_roster_index(stats_rows)
    report = MatchReport(
        home=[ReportLine(side="home", jersey="29", name="Teijeira, Carson", pos="F", g=1, a=0, y=0, r=0)],
        away=[], referees=[],
    )
    rows = attribution.attribute_report(report, _game(), idx)
    assert len(rows) == 1
    assert rows[0]["person_key"] == "100"
    assert rows[0]["matched"] == "jersey"
    assert rows[0]["g"] == 1


def test_name_beats_colliding_jersey():
    # Two players share #3 on the roster; two report lines each carry #3 but distinct names.
    # Name-first resolution attributes each line to the RIGHT person (jersey-first would collapse
    # both onto the single #3 owner). Regression test for 2015 game 5246019.
    stats_rows = [
        _stats_row("10", "Colin Begy", "T1", "H", "3"),
        _stats_row("11", "Prince Saysay", "T1", "H", "3"),
    ]
    idx = attribution.build_roster_index(stats_rows)
    report = MatchReport(
        home=[
            ReportLine(side="home", jersey="3", name="Begy, Colin", pos="", g=1, a=0, y=0, r=0),
            ReportLine(side="home", jersey="3", name="Saysay, Prince", pos="", g=0, a=1, y=0, r=0),
        ],
        away=[], referees=[],
    )
    rows = attribution.attribute_report(report, _game(), idx)
    assert {r["name"]: r["person_key"] for r in rows} == {"Begy, Colin": "10", "Saysay, Prince": "11"}


def test_name_fallback_match():
    # jersey on the report line doesn't appear on the roster at all, so jersey lookup misses
    # and it falls back to a name match.
    stats_rows = [_stats_row("200", "Liam Mulderig", "T1", "A", "10")]
    idx = attribution.build_roster_index(stats_rows)
    report = MatchReport(
        home=[], away=[ReportLine(side="away", jersey="99", name="Mulderig, Liam", pos="", g=2, a=0, y=0, r=0)],
        referees=[],
    )
    rows = attribution.attribute_report(report, _game(), idx)
    assert len(rows) == 1
    assert rows[0]["person_key"] == "200"
    assert rows[0]["matched"] == "name"
    assert rows[0]["g"] == 2


def test_unresolved_stays_blank():
    # neither jersey nor name appears on the roster -- row is kept, unresolved.
    stats_rows = [_stats_row("300", "Someone Else", "T1", "H", "7")]
    idx = attribution.build_roster_index(stats_rows)
    report = MatchReport(
        home=[ReportLine(side="home", jersey="42", name="Nobody, Here", pos="", g=0, a=0, y=1, r=0)],
        away=[], referees=[],
    )
    rows = attribution.attribute_report(report, _game(), idx)
    assert len(rows) == 1
    assert rows[0]["person_key"] == ""
    assert rows[0]["matched"] == ""
    assert rows[0]["y"] == 1


def test_ambiguous_jersey_falls_back_to_name():
    # two people share jersey #5 on the roster -> jersey lookup is ambiguous, so it falls back
    # to name, which is unambiguous.
    stats_rows = [
        _stats_row("400", "Alex One", "T1", "H", "5"),
        _stats_row("401", "Sam Two", "T1", "H", "5"),
    ]
    idx = attribution.build_roster_index(stats_rows)
    report = MatchReport(
        home=[ReportLine(side="home", jersey="5", name="Two, Sam", pos="", g=1, a=0, y=0, r=0)],
        away=[], referees=[],
    )
    rows = attribution.attribute_report(report, _game(), idx)
    assert rows[0]["person_key"] == "401"
    assert rows[0]["matched"] == "name"


def test_players_registry_supplies_first_last_name_variant():
    # stats row's display name doesn't match the report's "Last, First" form on its own, but
    # players.json's first/last does.
    stats_rows = [_stats_row("500", "C. Teijeira", "T1", "H", "")]
    players = {"500": {"first": "Carson", "last": "Teijeira"}}
    idx = attribution.build_roster_index(stats_rows, players)
    report = MatchReport(
        home=[ReportLine(side="home", jersey="", name="Teijeira, Carson", pos="", g=1, a=0, y=0, r=0)],
        away=[], referees=[],
    )
    rows = attribution.attribute_report(report, _game(), idx)
    assert rows[0]["person_key"] == "500"
    assert rows[0]["matched"] == "name"


def test_swapped_report_order_is_corrected():
    # The report's FIRST table holds the AWAY club's scorers (order opposite the schedule). The
    # roster-fit heuristic must detect the swap and attribute to the away club with side="away".
    stats_rows = [
        _stats_row("600", "Gary Boughton", "T1", "A", "10"),   # away club roster
        _stats_row("601", "Andrew Incho", "T1", "A", "8"),
        _stats_row("602", "Home Keeper", "T1", "H", "1"),       # home club roster
    ]
    idx = attribution.build_roster_index(stats_rows)
    report = MatchReport(
        home=[  # first table -- actually the away club's players
            ReportLine(side="home", jersey="10", name="Boughton, Gary", pos="", g=1, a=0, y=0, r=0),
            ReportLine(side="home", jersey="8", name="Incho, Andrew", pos="", g=1, a=0, y=0, r=0),
        ],
        away=[], referees=[],
    )
    rows = attribution.attribute_report(report, _game(), idx)
    assert all(r["side"] == "away" and r["club_id"] == "A" for r in rows)
    assert {r["person_key"] for r in rows} == {"600", "601"}


def _run_all():
    tests = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"  ok  {t.__name__}")
    print(f"\n{len(tests)} tests passed")


if __name__ == "__main__":
    _run_all()
