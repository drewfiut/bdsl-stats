<script>
  import { loadBoard, buildScoringTrend } from '../lib/data.js';
  import { hscroll } from '../lib/scrollShadow.js';

  let loading = $state(true);
  let error = $state('');
  let data = $state(null);

  $effect(() => {
    loadBoard()
      .then((b) => (data = buildScoringTrend(b)))
      .catch((e) => (error = e.message || String(e)))
      .finally(() => (loading = false));
  });

  // In-page jump nav: one button per section, in document order.
  const jumpLinks = [
    { id: 'goals-per-game', label: 'Goals per Game' },
    { id: 'participation', label: 'Participation' },
  ];

  // scrollIntoView aligns the target to the viewport top, but the sticky jump nav then overlaps
  // it -- measure the nav's actual (row-count-dependent) height and offset the scroll by that.
  function jumpTo(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const nav = document.querySelector('.jumpnav');
    const navH = nav ? nav.getBoundingClientRect().height : 0;
    const top = el.getBoundingClientRect().top + window.scrollY - navH - 10;
    window.scrollTo({ top, behavior: 'smooth' });
  }

  // Season year for compact x-axis labels ("2024-summer" -> "2024").
  const yearOf = (sid) => (/^(\d{4})/.exec(sid || '')?.[1]) || sid;

  // Chart geometry, in viewBox units. preserveAspectRatio + width:100% makes it responsive.
  const W = 720, H = 320;
  const M = { top: 24, right: 20, bottom: 40, left: 44 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;

  // Reactive plot model: y-axis runs 0..(padded max gpg), x spread evenly across seasons.
  const chart = $derived.by(() => {
    if (!data || data.length === 0) return null;
    const maxGpg = Math.max(...data.map((d) => d.gpg));
    const yMax = Math.ceil((maxGpg + 0.5) * 2) / 2; // pad, round up to a clean half-goal
    const n = data.length;
    const x = (i) => M.left + (n === 1 ? iw / 2 : (iw * i) / (n - 1));
    const y = (v) => M.top + ih - (yMax > 0 ? (v / yMax) * ih : 0);
    const points = data.map((d, i) => ({ ...d, cx: x(i), cy: y(d.gpg) }));
    // Horizontal gridlines every 0.5 goals.
    const ticks = [];
    for (let t = 0; t <= yMax + 1e-9; t += 0.5) ticks.push({ v: t, gy: y(t) });
    return { points, ticks, yMax, poly: points.map((p) => `${p.cx},${p.cy}`).join(' ') };
  });

  const gpg2 = (v) => v.toFixed(2);

  // Builds a single-series line chart (0..padded max, rounded to a clean step) for the given
  // per-season integer field. Mirrors the goals-per-game chart above but as an int y-axis.
  function buildIntChart(field, roundTo) {
    if (!data || data.length === 0) return null;
    const maxV = Math.max(...data.map((d) => d[field]), 1);
    const yMax = Math.ceil((maxV + roundTo * 0.5) / roundTo) * roundTo;
    const n = data.length;
    const x = (i) => M.left + (n === 1 ? iw / 2 : (iw * i) / (n - 1));
    const y = (v) => M.top + ih - (yMax > 0 ? (v / yMax) * ih : 0);
    const points = data.map((d, i) => ({ ...d, cx: x(i), cy: y(d[field]) }));
    const ticks = [];
    const step = yMax / 5;
    for (let t = 0; t <= yMax + 1e-9; t += step) ticks.push({ v: Math.round(t), gy: y(t) });
    return { points, ticks, yMax, poly: points.map((p) => `${p.cx},${p.cy}`).join(' ') };
  }

  const playersChart = $derived(buildIntChart('players', 100));
  const teamsChart = $derived(buildIntChart('teams', 10));
</script>

<div class="pagehead">
  <div class="wrap">
    <h1>Trends</h1>
    <div class="sub">League-wide metrics tracked across every BDSL season</div>
  </div>
</div>

{#if !loading && !error}
  <nav class="jumpnav">
    <div class="wrap" use:hscroll>
      {#each jumpLinks as j}
        <button onclick={() => jumpTo(j.id)}>{j.label}</button>
      {/each}
    </div>
    <span class="scrollarrow left" aria-hidden="true">&#9666;</span>
    <span class="scrollarrow right" aria-hidden="true">&#9656;</span>
  </nav>
{/if}

<main>
  {#if loading}
    <div class="status">Loading BDSL data&hellip;</div>
  {:else if error}
    <div class="status">Couldn&rsquo;t load data: {error}</div>
  {:else}
    <h2 class="section" id="goals-per-game">Goals per game</h2>
    <p class="recdesc">
      Average goals scored per game each season, across every competition &mdash; league,
      Over-35 and cups. The in-progress season is shown in gold.
    </p>
    <section class="trend">
      {#if chart}
        <div class="chartwrap">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
               aria-label="Goals per game by season">
            <!-- gridlines + y labels -->
            {#each chart.ticks as t}
              <line class="grid" x1={M.left} x2={W - M.right} y1={t.gy} y2={t.gy} />
              <text class="ylab" x={M.left - 8} y={t.gy} dominant-baseline="middle">{gpg2(t.v)}</text>
            {/each}

            <!-- series -->
            <polyline class="line" points={chart.poly} />
            {#each chart.points as p}
              <circle class="dot" class:live={p.live} cx={p.cx} cy={p.cy} r="4">
                <title>{p.label}: {gpg2(p.gpg)} goals/game ({p.goals} in {p.games})</title>
              </circle>
              <text class="vlab" class:live={p.live} x={p.cx} y={p.cy - 10}>{gpg2(p.gpg)}</text>
              <text class="xlab" x={p.cx} y={H - M.bottom + 20}>{yearOf(p.sid)}</text>
            {/each}
          </svg>
        </div>
      {:else}
        <div class="empty">No games recorded yet.</div>
      {/if}

      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l">Season</th>
              <th>Games</th>
              <th>Goals</th>
              <th>Goals / Game</th>
            </tr>
          </thead>
          <tbody>
            {#each [...data].reverse() as d}
              <tr class:live={d.live}>
                <td class="l" class:live={d.live}>{d.label}</td>
                <td>{d.games}</td>
                <td>{d.goals}</td>
                <td>{gpg2(d.gpg)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if data.length === 0}
          <div class="empty">No seasons recorded yet.</div>
        {/if}
      </div>
    </section>

    <h2 class="section" id="participation">Participation</h2>
    <p class="recdesc">
      Distinct players and clubs fielding a team each season, across every competition.
    </p>
    <section class="trend">
      <div class="chartgrid">
        {#if playersChart}
          <div class="chartwrap">
            <div class="chart-label">Players</div>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
                 aria-label="Players by season">
              {#each playersChart.ticks as t}
                <line class="grid" x1={M.left} x2={W - M.right} y1={t.gy} y2={t.gy} />
                <text class="ylab" x={M.left - 8} y={t.gy} dominant-baseline="middle">{t.v}</text>
              {/each}
              <polyline class="line" points={playersChart.poly} />
              {#each playersChart.points as p}
                <circle class="dot" class:live={p.live} cx={p.cx} cy={p.cy} r="4">
                  <title>{p.label}: {p.players} players</title>
                </circle>
                <text class="vlab" class:live={p.live} x={p.cx} y={p.cy - 10}>{p.players}</text>
                <text class="xlab" x={p.cx} y={H - M.bottom + 20}>{yearOf(p.sid)}</text>
              {/each}
            </svg>
          </div>
        {/if}

        {#if teamsChart}
          <div class="chartwrap">
            <div class="chart-label">Teams</div>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
                 aria-label="Teams by season">
              {#each teamsChart.ticks as t}
                <line class="grid" x1={M.left} x2={W - M.right} y1={t.gy} y2={t.gy} />
                <text class="ylab" x={M.left - 8} y={t.gy} dominant-baseline="middle">{t.v}</text>
              {/each}
              <polyline class="line" points={teamsChart.poly} />
              {#each teamsChart.points as p}
                <circle class="dot" class:live={p.live} cx={p.cx} cy={p.cy} r="4">
                  <title>{p.label}: {p.teams} teams</title>
                </circle>
                <text class="vlab" class:live={p.live} x={p.cx} y={p.cy - 10}>{p.teams}</text>
                <text class="xlab" x={p.cx} y={H - M.bottom + 20}>{yearOf(p.sid)}</text>
              {/each}
            </svg>
          </div>
        {/if}
      </div>

      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l">Season</th>
              <th>Players</th>
              <th>Teams</th>
            </tr>
          </thead>
          <tbody>
            {#each [...data].reverse() as d}
              <tr class:live={d.live}>
                <td class="l" class:live={d.live}>{d.label}</td>
                <td>{d.players}</td>
                <td>{d.teams}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}
</main>

<style>
  .trend { max-width: 1120px; margin: 0 auto; padding: 0 14px; }
  .chartwrap { background: var(--card); border: 1px solid var(--line); border-radius: 12px;
    padding: 8px 10px; margin-bottom: 16px; }
  .chartwrap svg { display: block; width: 100%; height: auto; }
  .grid { stroke: var(--line); stroke-width: 1; }
  .ylab { fill: var(--muted); font-size: 11px; text-anchor: end; }
  .xlab { fill: var(--muted); font-size: 11px; text-anchor: middle; }
  .line { fill: none; stroke: var(--navy2); stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
  .dot { fill: var(--navy2); stroke: var(--card); stroke-width: 1.5; }
  .dot.live { fill: var(--gold); }
  .vlab { fill: var(--text); font-size: 11px; font-weight: 600; text-anchor: middle; }
  .vlab.live { fill: var(--gold); }
  .chartgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
  .chartgrid .chartwrap { margin-bottom: 0; }
  .chart-label { font-size: 12px; font-weight: 600; color: var(--muted); padding: 4px 6px 0; }
  @media (max-width: 720px) {
    .chartgrid { grid-template-columns: 1fr; }
  }
</style>
