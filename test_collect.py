"""Tests for collect.py -- run with `python test_collect.py` or pytest."""
import collect
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


def _run_all():
    tests = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"  ok  {t.__name__}")
    print(f"\n{len(tests)} tests passed")


if __name__ == "__main__":
    _run_all()
