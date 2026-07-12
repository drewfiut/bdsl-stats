"""Tests for champions.py -- run with `python test_champions.py` or pytest."""
import champions

FIXTURE_HTML = """
<html><body>
<table id="tbl-46241-short-1">
  <tr><td>Division</td><td>Champion</td><td>Finalist</td><td>Result</td></tr>
  <tr><td>Premier</td><td>Amherst Sharpshooters</td><td>Buffalo United SS</td><td>3:0</td></tr>
  <tr><td>Championship</td><td>Cavallucci Marini</td><td>Olean 1854 FC</td><td>1:1 PK</td></tr>
  <tr><td>2nd Division</td><td>Ukraine</td><td>Celtic Brigade</td><td>2:1 PK</td></tr>
  <tr><td>4th Divison</td><td>Rust Belt United</td><td>Allen FC</td><td>3:2</td></tr>
  <tr><td>Over 35</td><td>Blue Stars FC</td><td>Oranje</td><td>2:1</td></tr>
  <tr>
    <td></td><td>Premier</td><td>Championship</td><td>1st Division</td><td>2nd Division</td>
  </tr>
</table>
</body></html>
"""


def test_parse_champions():
    rows = champions.parse_champions(FIXTURE_HTML)
    assert len(rows) == 5, rows
    by_div = {r["division"]: r for r in rows}
    assert by_div["Championship"]["champion"] == "Cavallucci Marini"
    assert "Division" not in [r.get("champion") for r in rows]  # header skipped
    assert all(len(r) == 4 for r in rows)


def test_norm_typo_and_bracket():
    assert champions._norm("4th Divison") == champions._norm("4th Division")
    assert champions._norm("Tehel Cup Bracket") == champions._norm("Tehel Cup")


def test_resolve_positive():
    rows = champions.parse_champions(FIXTURE_HTML)
    comp = {"competition": "Championship", "comp_type": "league", "tg": "112617820"}
    games = [{
        "tg": "112617820", "status": "played", "round_label": "CHMP",
        "home_name": "Olean 1854 FC", "home_club_id": "91256980",
        "away_name": "Cavallucci Marini", "away_club_id": "95088186",
    }]
    result = champions.resolve(comp, games, [], rows)
    assert result == ("95088186", "Cavallucci Marini", "history-table"), result


def test_resolve_negative():
    rows = champions.parse_champions(FIXTURE_HTML)
    comp = {"competition": "Championship", "comp_type": "league", "tg": "112617820"}
    games = [{
        "tg": "112617820", "status": "played", "round_label": "CHMP",
        "home_name": "Some Other Team", "home_club_id": "11111111",
        "away_name": "Another Team", "away_club_id": "22222222",
    }]
    result = champions.resolve(comp, games, [], rows)
    assert result == ("", "", ""), result


def _run_all():
    tests = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"  ok  {t.__name__}")
    print(f"\n{len(tests)} tests passed")


if __name__ == "__main__":
    _run_all()
