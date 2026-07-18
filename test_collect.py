"""Tests for collect.py -- run with `python test_collect.py` or pytest."""
import datetime as dt

import attribution
import collect
import matchreports
import store
from schedules import Game


def _game(key, home_club_id, away_club_id):
    return Game(
        game_key=key, game_number="", round_label="", date="", time="",
        home_club_id=home_club_id, home_name="", away_club_id=away_club_id, away_name="",
        home_score=None, away_score=None, status="scheduled", result_note="", location="",
    )


def _teams(*pairs):
    return [{"tg": tg, "club_id": cid} for tg, cid in pairs]


def test_dedupe_removes_leaked_game():
    # Game X's clubs (1,2) are on tg A's roster; it leaked into tg B (roster 3,4).
    games_by_tg = {
        "A": [_game("X", "1", "2")],
        "B": [_game("X", "1", "2"), _game("Y", "3", "4")],
    }
    collect.dedupe_cross_tg(games_by_tg, _teams(("A", "1"), ("A", "2"), ("B", "3"), ("B", "4")))
    assert [g.game_key for g in games_by_tg["A"]] == ["X"]
    assert [g.game_key for g in games_by_tg["B"]] == ["Y"]        # leaked X dropped, real Y kept


def test_dedupe_keeps_all_when_owner_ambiguous():
    # Neither tg's roster contains both clubs -> can't single out an owner -> leave both copies.
    games_by_tg = {"A": [_game("X", "1", "2")], "B": [_game("X", "1", "2")]}
    collect.dedupe_cross_tg(games_by_tg, _teams(("A", "1"), ("B", "2")))
    assert [g.game_key for g in games_by_tg["A"]] == ["X"]
    assert [g.game_key for g in games_by_tg["B"]] == ["X"]


def test_dedupe_leaves_unique_games_untouched():
    games_by_tg = {"A": [_game("X", "1", "2")], "B": [_game("Y", "3", "4")]}
    collect.dedupe_cross_tg(games_by_tg, _teams(("A", "1"), ("A", "2"), ("B", "3"), ("B", "4")))
    assert [g.game_key for g in games_by_tg["A"]] == ["X"]
    assert [g.game_key for g in games_by_tg["B"]] == ["Y"]


def _played_game_row(key, date, report_path="/report.html"):
    """Build a `game_rows`-shaped dict for a played game with a report to capture."""
    return {
        "game_key": key, "tg": "T", "competition": "Comp", "comp_type": "league",
        "date": date, "round_label": "1", "home_club_id": "1", "away_club_id": "2",
        "status": "played", "report_path": report_path,
    }


def test_capture_reports_keeps_old_data_when_refetch_fails():
    # G1 was already captured; it falls inside the recapture window (today), so a re-fetch is
    # attempted. The re-fetch raises -- the old ledger row and old game_stats rows must survive
    # untouched, and no "error" row should be recorded over top of the good data.
    old_report = {
        "game_key": "G1", "tg": "T", "report_url": "http://x/report.html",
        "captured_at": "2020-01-01T00:00:00", "status": "captured", "referees": "Ref (R)",
    }
    old_stats = [{"game_key": "G1", "person_key": "p1", "g": "1", "a": "0"}]
    saved = {}

    def fake_load_game_reports(sid):
        return [old_report]

    def fake_load_game_stats(sid):
        return old_stats

    def fake_save_game_reports(sid, rows):
        saved["reports"] = rows

    def fake_save_game_stats(sid, rows):
        saved["stats"] = rows

    def fake_fetch_report(url):
        raise RuntimeError("simulated transient fetch failure")

    orig = (store.load_game_reports, store.load_game_stats,
            store.save_game_reports, store.save_game_stats, matchreports.fetch_report)
    store.load_game_reports = fake_load_game_reports
    store.load_game_stats = fake_load_game_stats
    store.save_game_reports = fake_save_game_reports
    store.save_game_stats = fake_save_game_stats
    matchreports.fetch_report = fake_fetch_report
    try:
        today = dt.date.today().isoformat()
        game_rows = [_played_game_row("G1", today)]
        collect._capture_reports("season", game_rows, [], {})
    finally:
        (store.load_game_reports, store.load_game_stats,
         store.save_game_reports, store.save_game_stats, matchreports.fetch_report) = orig

    assert saved["reports"] == [old_report]      # old "captured" row preserved verbatim
    assert saved["stats"] == old_stats            # old game_stats rows preserved verbatim


def test_capture_reports_retries_stale_error_row():
    # G2's only ledger row is an "error" from long ago, well outside the recapture window. Error
    # rows must always be retried regardless of age -- and this retry succeeds.
    old_error = {
        "game_key": "G2", "tg": "T", "report_url": "http://x/report.html",
        "captured_at": "2000-01-01T00:00:00", "status": "error", "referees": "",
    }
    saved = {}

    def fake_load_game_reports(sid):
        return [old_error]

    def fake_load_game_stats(sid):
        return []

    def fake_save_game_reports(sid, rows):
        saved["reports"] = rows

    def fake_save_game_stats(sid, rows):
        saved["stats"] = rows

    def fake_fetch_report(url):
        return matchreports.MatchReport(home=[], away=[], referees=[("Ref One", "R")])

    def fake_attribute_report(report, game, roster_index):
        return [{"game_key": game["game_key"], "person_key": "p2", "g": "2", "a": "0"}]

    orig = (store.load_game_reports, store.load_game_stats,
            store.save_game_reports, store.save_game_stats,
            matchreports.fetch_report, attribution.attribute_report)
    store.load_game_reports = fake_load_game_reports
    store.load_game_stats = fake_load_game_stats
    store.save_game_reports = fake_save_game_reports
    store.save_game_stats = fake_save_game_stats
    matchreports.fetch_report = fake_fetch_report
    attribution.attribute_report = fake_attribute_report
    try:
        # A date far outside the recapture window -- only the "error" status should force a retry.
        game_rows = [_played_game_row("G2", "2000-01-01")]
        collect._capture_reports("season", game_rows, [], {})
    finally:
        (store.load_game_reports, store.load_game_stats,
         store.save_game_reports, store.save_game_stats,
         matchreports.fetch_report, attribution.attribute_report) = orig

    assert len(saved["reports"]) == 1
    assert saved["reports"][0]["game_key"] == "G2"
    assert saved["reports"][0]["status"] == "captured"   # error row replaced by a fresh capture
    assert saved["stats"] == [{"game_key": "G2", "person_key": "p2", "g": "2", "a": "0"}]


def _run_all():
    tests = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"  ok  {t.__name__}")
    print(f"\n{len(tests)} tests passed")


if __name__ == "__main__":
    _run_all()
