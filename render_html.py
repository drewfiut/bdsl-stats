"""Render the single-season leaderboard to one self-contained HTML file.

Each row is one *player-season*: a person's goals/assists/points totalled across every
competition they played in that year (league + cups + Over-35), for every season in the
store. Ranking the rows surfaces the best individual seasons in BDSL history. No external
assets -- all CSS/JS/data are inlined, and rows are sorted/filtered client-side.
"""
import datetime as _dt
import html
import json

import config
from aggregate import Player, SeasonBoard

# Cap the rows injected into the DOM so 12 seasons stay snappy; search filters the full set
# first, so anyone can still reach a specific player/season.
DISPLAY_CAP = 500


def _player_json(p: Player) -> dict:
    return {
        "name": p.display_name,
        "season": p.season_label,
        "live": 1 if p.season_id == config.SEASON_ID else 0,
        "teams": p.teams,
        "g": p.goals,
        "a": p.assists,
        "pts": p.points,
        "gp": p.games_played,
        "lg": [p.by_type["league"]["g"], p.by_type["league"]["a"]],
        "cup": [p.by_type["cup"]["g"], p.by_type["cup"]["a"]],
        "o35": [p.by_type["over35"]["g"], p.by_type["over35"]["a"]],
        "comps": [
            {"c": c.competition, "t": c.team_name, "g": c.goals, "a": c.assists, "gp": c.games_played}
            for c in sorted(p.comps, key=lambda c: (-c.goals - c.assists, c.competition))
        ],
    }


def render(board: SeasonBoard) -> str:
    # only include player-seasons where someone actually took the field
    players = [p for p in board.players if p.games_played > 0 or p.points > 0]
    data = [_player_json(p) for p in players]
    data.sort(key=lambda d: (d["pts"], d["g"], d["a"]), reverse=True)

    fmt = "%b %-d, %Y at %-I:%M %p"
    generated = _dt.datetime.now().strftime(fmt)
    try:
        data_as_of = _dt.datetime.fromisoformat(board.current_fetched_at).strftime(fmt)
    except (ValueError, TypeError):
        data_as_of = generated

    labels = board.season_labels
    if len(labels) >= 2:
        season_range = f"{labels[-1]} – {labels[0]}"   # oldest – newest
    else:
        season_range = labels[0] if labels else ""
    n_scorers = sum(1 for d in data if d["pts"] > 0)

    options = ['<option value="">All seasons</option>']
    options += [f"<option>{html.escape(l)}</option>" for l in labels]  # newest-first
    season_options = "".join(options)

    payload = json.dumps(data, separators=(",", ":"))

    return _TEMPLATE.format(
        season_range=html.escape(season_range),
        season_options=season_options,
        generated=html.escape(generated),
        n_rows=len(data),
        n_scorers=n_scorers,
        n_seasons=len(labels),
        cap=DISPLAY_CAP,
        goal_pts=config.POINTS_PER_GOAL,
        assist_pts=config.POINTS_PER_ASSIST,
        data_as_of=html.escape(data_as_of),
        data_json=payload,
    )


_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BDSL Best Single Seasons</title>
<style>
  :root {{
    --navy:#013764; --navy2:#024b86; --gold:#f5a623; --bg:#f4f6f9; --card:#ffffff;
    --text:#16202c; --muted:#647082; --line:#e3e8ef; --row:#fafbfd; --hover:#eef3f9;
    --g:#1f9d55; --a:#2f6fb0; --live:#fff5e0; --liveHover:#ffeecb;
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      --navy:#0a4c85; --navy2:#0c63ad; --gold:#f5a623; --bg:#0e1420; --card:#161e2b;
      --text:#e7edf5; --muted:#93a1b5; --line:#26303f; --row:#141c28; --hover:#1d2836;
      --g:#3ec17e; --a:#66a8e6; --live:#2a2415; --liveHover:#342c18;
    }}
  }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--text);
    font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    font-variant-numeric:tabular-nums; line-height:1.4; }}
  header {{ background:linear-gradient(135deg,var(--navy),var(--navy2)); color:#fff;
    padding:22px 20px; }}
  header .wrap {{ max-width:1120px; margin:0 auto; }}
  h1 {{ margin:0 0 4px; font-size:22px; letter-spacing:.2px; }}
  header .sub {{ opacity:.85; font-size:13px; }}
  .stats {{ display:flex; gap:22px; margin-top:14px; flex-wrap:wrap; }}
  .stat b {{ font-size:20px; display:block; }}
  .stat span {{ font-size:11px; text-transform:uppercase; letter-spacing:.6px; opacity:.8; }}
  main {{ max-width:1120px; margin:0 auto; padding:18px 14px 60px; }}
  .controls {{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin:6px 0 14px; }}
  .tabs {{ display:inline-flex; background:var(--card); border:1px solid var(--line);
    border-radius:9px; overflow:hidden; }}
  .tabs button {{ border:0; background:transparent; color:var(--muted); padding:9px 16px;
    font-size:13px; font-weight:600; cursor:pointer; }}
  .tabs button.on {{ background:var(--navy); color:#fff; }}
  input[type=search] {{ flex:1; min-width:180px; padding:9px 12px; border:1px solid var(--line);
    border-radius:9px; background:var(--card); color:var(--text); font-size:14px; }}
  select#season {{ padding:9px 12px; border:1px solid var(--line); border-radius:9px;
    background:var(--card); color:var(--text); font-size:14px; font-weight:600; cursor:pointer; }}
  label.toggle {{ font-size:13px; color:var(--muted); display:flex; align-items:center; gap:6px;
    cursor:pointer; user-select:none; }}
  .tablewrap {{ background:var(--card); border:1px solid var(--line); border-radius:12px;
    overflow-x:auto; box-shadow:0 1px 3px rgba(0,0,0,.05); }}
  table {{ border-collapse:collapse; width:100%; font-size:14px; min-width:780px; }}
  thead th {{ position:sticky; top:0; background:var(--card); text-align:right; color:var(--muted);
    font-size:11px; text-transform:uppercase; letter-spacing:.5px; padding:11px 10px;
    border-bottom:2px solid var(--line); white-space:nowrap; }}
  thead th.l {{ text-align:left; }}
  thead th.sortable {{ cursor:pointer; }}
  thead th.act {{ color:var(--text); }}
  tbody td {{ padding:10px; border-bottom:1px solid var(--line); text-align:right; white-space:nowrap; }}
  tbody td.l {{ text-align:left; }}
  tbody tr:nth-child(4n+1) {{ background:var(--row); }}
  tbody tr.main {{ cursor:pointer; }}
  tbody tr.main:hover {{ background:var(--hover); }}
  /* current, in-progress season rows: gold tint + left accent */
  tbody tr.main.live, tbody tr.detail.live td {{ background:var(--live); }}
  tbody tr.main.live:hover {{ background:var(--liveHover); }}
  tbody tr.main.live td:first-child {{ box-shadow:inset 3px 0 0 var(--gold); }}
  .livetag {{ display:inline-block; margin-left:6px; padding:1px 6px; border-radius:9px;
    background:var(--gold); color:#3a2600; font-size:10px; font-weight:750; letter-spacing:.4px;
    text-transform:uppercase; vertical-align:middle; }}
  .rank {{ color:var(--muted); font-weight:700; width:34px; }}
  .rank.m1 {{ color:#c8961e; }} .rank.m2 {{ color:#8b93a1; }} .rank.m3 {{ color:#b06a35; }}
  .pname {{ font-weight:650; }}
  .season {{ color:var(--muted); font-weight:600; font-size:12.5px; }}
  .teams {{ color:var(--muted); font-size:12px; }}
  .pts {{ font-weight:750; color:var(--navy2); }}
  .g {{ color:var(--g); font-weight:650; }} .a {{ color:var(--a); font-weight:650; }}
  .z {{ color:var(--muted); opacity:.5; }}
  .caret {{ display:inline-block; width:10px; color:var(--muted); font-size:10px; transition:transform .15s; }}
  tr.main.open .caret {{ transform:rotate(90deg); }}
  tr.detail td {{ background:var(--hover); padding:0; }}
  tr.detail .box {{ padding:8px 14px 12px 44px; }}
  .brk {{ display:grid; grid-template-columns:1fr auto auto auto; gap:2px 16px; font-size:13px;
    max-width:560px; }}
  .brk .h {{ color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.5px;
    border-bottom:1px solid var(--line); padding-bottom:3px; }}
  .brk .r {{ text-align:right; }} .brk .cn {{ color:var(--muted); }}
  .note {{ padding:10px 14px; color:var(--muted); font-size:12.5px; border-top:1px solid var(--line); }}
  footer {{ max-width:1120px; margin:0 auto; padding:0 14px 40px; color:var(--muted); font-size:12px; }}
  .hide {{ display:none !important; }}
  .empty {{ padding:26px; text-align:center; color:var(--muted); }}
</style>
</head>
<body>
<header><div class="wrap">
  <h1>BDSL Best Single Seasons</h1>
  <div class="sub">Every player&rsquo;s single-season totals across all competitions &middot; {season_range}</div>
  <div class="sub" style="margin-top:3px">Each row is one player in one season (league + cups + Over-35 combined). The in-progress season is <b style="color:var(--gold)">highlighted</b> &mdash; current as of <b>{data_as_of}</b>.</div>
  <div class="stats">
    <div class="stat"><b>{n_rows}</b><span>Player-seasons</span></div>
    <div class="stat"><b>{n_seasons}</b><span>Seasons</span></div>
    <div class="stat"><b>{n_scorers}</b><span>On the scoresheet</span></div>
  </div>
</div></header>
<main>
  <div class="controls">
    <div class="tabs" id="tabs">
      <button data-sort="pts" class="on">Points</button>
      <button data-sort="g">Goals</button>
      <button data-sort="a">Assists</button>
    </div>
    <select id="season" title="Filter by season">{season_options}</select>
    <input type="search" id="q" placeholder="Filter by player or team&hellip;" autocomplete="off">
    <label class="toggle"><input type="checkbox" id="onlyScorers" checked> Scorers only</label>
  </div>
  <div class="tablewrap">
    <table>
      <thead><tr>
        <th class="l rank">#</th>
        <th class="l">Player</th>
        <th class="l">Season</th>
        <th class="l">Team(s)</th>
        <th class="sortable" data-sort="g">G</th>
        <th class="sortable" data-sort="a">A</th>
        <th class="sortable" data-sort="pts">Pts</th>
        <th>GP</th>
        <th title="League goals / assists">Lg</th>
        <th title="Cup goals / assists">Cup</th>
        <th title="Over-35 goals / assists">O35</th>
        <th style="width:14px"></th>
      </tr></thead>
      <tbody id="rows"></tbody>
    </table>
    <div class="empty hide" id="empty">Nothing matches your filter.</div>
    <div class="note hide" id="note"></div>
  </div>
</main>
<footer>
  Points = {goal_pts}&times;goals + {assist_pts}&times;assist, matching BDSL&rsquo;s official Points Leaders. Individual scoring exists from 2014 (league) / 2016 (cups). Page generated {generated} from public data on bdsl.org.
</footer>
<script>
const DATA = {data_json};
const CAP = {cap};
let sortKey = "pts";
const rows = document.getElementById("rows");
const note = document.getElementById("note");
const q = document.getElementById("q");
const seasonSel = document.getElementById("season");
const onlyScorers = document.getElementById("onlyScorers");

function ga(pair) {{
  const g = pair[0], a = pair[1];
  if (!g && !a) return '<span class="z">&ndash;</span>';
  return (g?('<span class="g">'+g+'</span>'):'0') + '<span class="z">/</span>' + (a?('<span class="a">'+a+'</span>'):'0');
}}
function detail(p) {{
  let r = '<div class="brk"><div class="h">Competition</div><div class="h r">G</div><div class="h r">A</div><div class="h r">GP</div>';
  for (const c of p.comps) {{
    r += '<div>'+esc(c.c)+' <span class="cn">'+esc(c.t)+'</span></div>'
       + '<div class="r">'+(c.g||'&ndash;')+'</div><div class="r">'+(c.a||'&ndash;')+'</div><div class="r">'+(c.gp||'&ndash;')+'</div>';
  }}
  return r + '</div>';
}}
function esc(s) {{ return (s||"").replace(/[&<>"]/g, c => ({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}}[c])); }}

function render() {{
  const term = q.value.trim().toLowerCase();
  const season = seasonSel.value;
  const scorersOnly = onlyScorers.checked;
  let list = DATA.filter(p => {{
    if (scorersOnly && p.pts <= 0) return false;
    if (season && p.season !== season) return false;
    if (!term) return true;
    if (p.name.toLowerCase().includes(term)) return true;
    return p.teams.some(t => t.toLowerCase().includes(term));
  }});
  list.sort((x,y) => (y[sortKey]-x[sortKey]) || (y.g-x.g) || (y.a-x.a)
    || x.name.localeCompare(y.name) || x.season.localeCompare(y.season));
  const total = list.length;
  if (total > CAP) list = list.slice(0, CAP);
  rows.innerHTML = "";
  document.getElementById("empty").classList.toggle("hide", total>0);
  let html = "";
  list.forEach((p,i) => {{
    const rk = i+1, m = rk<=3 ? " m"+rk : "";
    const live = p.live ? " live" : "";
    const seasonCell = esc(p.season) + (p.live ? ' <span class="livetag">In progress</span>' : '');
    html += '<tr class="main'+live+'" data-i="'+i+'">'
      + '<td class="l rank'+m+'">'+rk+'</td>'
      + '<td class="l"><span class="pname">'+esc(p.name)+'</span></td>'
      + '<td class="l season">'+seasonCell+'</td>'
      + '<td class="l teams">'+esc(p.teams.join(", "))+'</td>'
      + '<td class="g">'+(p.g||'<span class="z">0</span>')+'</td>'
      + '<td class="a">'+(p.a||'<span class="z">0</span>')+'</td>'
      + '<td class="pts">'+p.pts+'</td>'
      + '<td>'+p.gp+'</td>'
      + '<td>'+ga(p.lg)+'</td><td>'+ga(p.cup)+'</td><td>'+ga(p.o35)+'</td>'
      + '<td><span class="caret">&#9654;</span></td></tr>'
      + '<tr class="detail hide'+live+'"><td colspan="12"><div class="box">'+detail(p)+'</div></td></tr>';
  }});
  rows.innerHTML = html;
  const capped = total > CAP;
  note.classList.toggle("hide", !capped);
  if (capped) note.textContent = "Showing the top " + CAP + " of " + total
    + " player-seasons — pick a season or search to narrow the list.";
}}
rows.addEventListener("click", e => {{
  const tr = e.target.closest("tr.main"); if (!tr) return;
  tr.classList.toggle("open");
  tr.nextElementSibling.classList.toggle("hide");
}});
document.getElementById("tabs").addEventListener("click", e => {{
  const b = e.target.closest("button"); if (!b) return;
  sortKey = b.dataset.sort;
  document.querySelectorAll("#tabs button").forEach(x => x.classList.toggle("on", x===b));
  document.querySelectorAll("thead th.sortable").forEach(x =>
    x.classList.toggle("act", x.dataset.sort===sortKey));
  render();
}});
document.querySelectorAll("thead th.sortable").forEach(th => th.addEventListener("click", () => {{
  document.querySelector('#tabs button[data-sort="'+th.dataset.sort+'"]').click();
}}));
q.addEventListener("input", render);
seasonSel.addEventListener("change", render);
onlyScorers.addEventListener("change", render);
render();
</script>
</body>
</html>"""
