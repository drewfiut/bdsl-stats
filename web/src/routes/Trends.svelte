<script>
  import {
    loadBoard, buildScoringTrend, buildAgeCurve, buildAgeTrend, COMP_TYPE_OPTIONS,
    buildMatchOutcomeTrend, buildDivisionSpreadTrend, buildScoringConcentrationTrend,
    buildRetentionTrend, BLOWOUT_MARGIN,
  } from '../lib/data.js';
  import { hscroll } from '../lib/scrollShadow.js';

  let loading = $state(true);
  let error = $state('');
  let data = $state(null);
  let board = $state(null);

  // Independent competition-type filters for the two age sections below.
  let ageCurveType = $state('all');
  let avgAgeType = $state('all');

  $effect(() => {
    loadBoard()
      .then((b) => {
        board = b;
        data = buildScoringTrend(b);
      })
      .catch((e) => (error = e.message || String(e)))
      .finally(() => (loading = false));
  });

  const ageCurve = $derived(board ? buildAgeCurve(board.allPlayers, board.playersRegistry, ageCurveType) : null);
  const avgAgeTrend = $derived(board ? buildAgeTrend(board, avgAgeType) : null);
  const outcomeData = $derived(board ? buildMatchOutcomeTrend(board) : null);
  const spreadData = $derived(board ? buildDivisionSpreadTrend(board) : null);
  const concentrationData = $derived(board ? buildScoringConcentrationTrend(board) : null);
  const retentionData = $derived(board ? buildRetentionTrend(board) : null);

  // In-page jump nav: one button per section, in document order.
  const jumpLinks = [
    { id: 'goals-per-game', label: 'Goals per Game' },
    { id: 'scoring-by-age', label: 'Scoring by Age' },
    { id: 'participation', label: 'Participation' },
    { id: 'average-age', label: 'Average Age' },
    { id: 'match-outcomes', label: 'Match Outcomes' },
    { id: 'division-balance', label: 'Division Balance' },
    { id: 'scoring-concentration', label: 'Scoring Concentration' },
    { id: 'player-retention', label: 'Player Retention' },
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

  // Age-curve plot model: same shape as the goals-per-game chart above, but x is age (already
  // sorted ascending by buildAgeCurve) instead of season, and points never carry a "live" flag --
  // one age bucket blends rows from many seasons, so no single point can be "in progress".
  const ageChart = $derived.by(() => {
    if (!ageCurve || ageCurve.length === 0) return null;
    const maxGpg = Math.max(...ageCurve.map((d) => d.gpg));
    const yMax = Math.ceil((maxGpg + 0.5) * 2) / 2;
    const n = ageCurve.length;
    const x = (i) => M.left + (n === 1 ? iw / 2 : (iw * i) / (n - 1));
    const y = (v) => M.top + ih - (yMax > 0 ? (v / yMax) * ih : 0);
    const points = ageCurve.map((d, i) => ({ ...d, cx: x(i), cy: y(d.gpg) }));
    const ticks = [];
    for (let t = 0; t <= yMax + 1e-9; t += 0.5) ticks.push({ v: t, gy: y(t) });
    return { points, ticks, yMax, poly: points.map((p) => `${p.cx},${p.cy}`).join(' ') };
  });

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

  // Builds a 0-100 line chart for a per-season percentage field, skipping rows where the field is
  // null (a season with no prior year to compare against, e.g. retention) so the line simply
  // starts later instead of plotting a false zero -- generalizes the null-skipping idea already
  // used for avgAgeChart to cover every 0-100 metric below in one place.
  function buildPctChart(rows, field) {
    if (!rows || rows.length === 0) return null;
    const usable = rows.filter((d) => d[field] !== null);
    if (usable.length === 0) return null;
    const maxV = Math.max(...usable.map((d) => d[field]), 10);
    const yMax = Math.min(100, Math.ceil(maxV / 10) * 10);
    const n = rows.length; // keep full season spacing so a skipped season shows as a gap
    const x = (i) => M.left + (n === 1 ? iw / 2 : (iw * i) / (n - 1));
    const y = (v) => M.top + ih - (yMax > 0 ? (v / yMax) * ih : 0);
    const points = rows
      .map((d, i) => (d[field] === null ? null : { ...d, cx: x(i), cy: y(d[field]) }))
      .filter(Boolean);
    const ticks = [];
    const step = yMax / 5;
    for (let t = 0; t <= yMax + 1e-9; t += step) ticks.push({ v: Math.round(t), gy: y(t) });
    return { points, ticks, yMax, poly: points.map((p) => `${p.cx},${p.cy}`).join(' ') };
  }

  // Builds a 0-based float line chart rounded to the next 0.25 -- same shape as the goals-per-game
  // `chart` above, factored out since division spread needs the same treatment.
  function buildSpreadChart(rows) {
    if (!rows || rows.length === 0) return null;
    const usable = rows.filter((d) => d.spread !== null);
    if (usable.length === 0) return null;
    const maxV = Math.max(...usable.map((d) => d.spread));
    const step = 0.25;
    const yMax = Math.ceil((maxV + step * 0.5) / step) * step;
    const n = rows.length;
    const x = (i) => M.left + (n === 1 ? iw / 2 : (iw * i) / (n - 1));
    const y = (v) => M.top + ih - (yMax > 0 ? (v / yMax) * ih : 0);
    const points = rows
      .map((d, i) => (d.spread === null ? null : { ...d, cx: x(i), cy: y(d.spread) }))
      .filter(Boolean);
    const ticks = [];
    for (let t = 0; t <= yMax + 1e-9; t += step) ticks.push({ v: t, gy: y(t) });
    return { points, ticks, yMax, poly: points.map((p) => `${p.cx},${p.cy}`).join(' ') };
  }

  const drawChart = $derived(outcomeData ? buildPctChart(outcomeData, 'drawRate') : null);
  const blowoutChart = $derived(outcomeData ? buildPctChart(outcomeData, 'blowoutRate') : null);
  const spreadChart = $derived(spreadData ? buildSpreadChart(spreadData) : null);
  const concentrationChart = $derived(concentrationData ? buildPctChart(concentrationData, 'share') : null);
  const retentionChart = $derived(retentionData ? buildPctChart(retentionData, 'retentionRate') : null);
  const pct1 = (v) => v.toFixed(1);

  // Average-age plot model: own float y-domain (whole-year ticks) since ages cluster in a narrow
  // adult-rec-league band rather than starting at 0; seasons with no usable birthdates (avgAge ===
  // null) are skipped so the line breaks across them instead of plotting a false zero.
  const avgAgeChart = $derived.by(() => {
    if (!avgAgeTrend || avgAgeTrend.length === 0) return null;
    const withAge = avgAgeTrend.filter((d) => d.avgAge !== null);
    if (withAge.length === 0) return null;
    const vals = withAge.map((d) => d.avgAge);
    const yMin = Math.floor(Math.min(...vals) - 1);
    const yMax = Math.ceil(Math.max(...vals) + 1);
    const n = avgAgeTrend.length; // keep full season spacing so skipped seasons show as a gap
    const x = (i) => M.left + (n === 1 ? iw / 2 : (iw * i) / (n - 1));
    const y = (v) => M.top + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
    const points = avgAgeTrend
      .map((d, i) => (d.avgAge === null ? null : { ...d, cx: x(i), cy: y(d.avgAge) }))
      .filter(Boolean);
    const ticks = [];
    for (let t = yMin; t <= yMax + 1e-9; t += 1) ticks.push({ v: Math.round(t), gy: y(t) });
    return { points, ticks, yMax, poly: points.map((p) => `${p.cx},${p.cy}`).join(' ') };
  });
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

    <h2 class="section" id="scoring-by-age">Scoring by age</h2>
    <p class="recdesc">
      Goals per game by player age, across every BDSL season. Ages with too few players are omitted.
    </p>
    <div class="leadctrl">
      <label>
        Competition
        <select bind:value={ageCurveType}>
          {#each COMP_TYPE_OPTIONS as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </label>
    </div>
    <section class="trend">
      {#if ageChart}
        <div class="chartwrap">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
               aria-label="Goals per game by age">
            {#each ageChart.ticks as t}
              <line class="grid" x1={M.left} x2={W - M.right} y1={t.gy} y2={t.gy} />
              <text class="ylab" x={M.left - 8} y={t.gy} dominant-baseline="middle">{gpg2(t.v)}</text>
            {/each}
            <polyline class="line" points={ageChart.poly} />
            {#each ageChart.points as p}
              <circle class="dot" cx={p.cx} cy={p.cy} r="4">
                <title>Age {p.age}: {gpg2(p.gpg)} goals/game ({p.g} in {p.gp}, {p.players} players)</title>
              </circle>
              <text class="vlab" x={p.cx} y={p.cy - 10}>{gpg2(p.gpg)}</text>
              <text class="xlab" x={p.cx} y={H - M.bottom + 20}>{p.age}</text>
            {/each}
          </svg>
        </div>
      {:else}
        <div class="empty">Not enough birthdate data yet.</div>
      {/if}

      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l">Age</th>
              <th>Players</th>
              <th>Games</th>
              <th>Goals</th>
              <th>Goals / Game</th>
            </tr>
          </thead>
          <tbody>
            {#each ageCurve || [] as d}
              <tr>
                <td class="l">{d.age}</td>
                <td>{d.players}</td>
                <td>{d.gp}</td>
                <td>{d.g}</td>
                <td>{gpg2(d.gpg)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if !ageCurve || ageCurve.length === 0}
          <div class="empty">Not enough birthdate data yet.</div>
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

    <h2 class="section" id="average-age">Average age</h2>
    <p class="recdesc">
      Average age of active players each season (as of July&nbsp;1), computed from registered
      birthdates. Seasons with no usable birthdate data are omitted from the chart.
    </p>
    <div class="leadctrl">
      <label>
        Competition
        <select bind:value={avgAgeType}>
          {#each COMP_TYPE_OPTIONS as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </label>
    </div>
    <section class="trend">
      {#if avgAgeChart}
        <div class="chartwrap">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
               aria-label="Average player age by season">
            {#each avgAgeChart.ticks as t}
              <line class="grid" x1={M.left} x2={W - M.right} y1={t.gy} y2={t.gy} />
              <text class="ylab" x={M.left - 8} y={t.gy} dominant-baseline="middle">{t.v}</text>
            {/each}
            <polyline class="line" points={avgAgeChart.poly} />
            {#each avgAgeChart.points as p}
              <circle class="dot" class:live={p.live} cx={p.cx} cy={p.cy} r="4">
                <title>{p.label}: {p.avgAge.toFixed(1)} yrs avg ({p.ageSample} players)</title>
              </circle>
              <text class="vlab" class:live={p.live} x={p.cx} y={p.cy - 10}>{p.avgAge.toFixed(1)}</text>
              <text class="xlab" x={p.cx} y={H - M.bottom + 20}>{yearOf(p.sid)}</text>
            {/each}
          </svg>
        </div>
      {:else}
        <div class="empty">No birthdate data recorded yet.</div>
      {/if}

      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l">Season</th>
              <th>Avg. Age</th>
              <th>Sample</th>
            </tr>
          </thead>
          <tbody>
            {#each [...(avgAgeTrend || [])].reverse() as d}
              <tr class:live={d.live}>
                <td class="l" class:live={d.live}>{d.label}</td>
                <td>{d.avgAge !== null ? d.avgAge.toFixed(1) : '—'}</td>
                <td>{d.ageSample}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <h2 class="section" id="match-outcomes">Match outcomes</h2>
    <p class="recdesc">
      Share of games ending level, and share decided by a margin of {BLOWOUT_MARGIN}+ goals, each
      season across every competition &mdash; league, Over-35 and cups.
    </p>
    <section class="trend">
      <div class="chartgrid">
        {#if drawChart}
          <div class="chartwrap">
            <div class="chart-label">Draw rate</div>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
                 aria-label="Draw rate by season">
              {#each drawChart.ticks as t}
                <line class="grid" x1={M.left} x2={W - M.right} y1={t.gy} y2={t.gy} />
                <text class="ylab" x={M.left - 8} y={t.gy} dominant-baseline="middle">{t.v}%</text>
              {/each}
              <polyline class="line" points={drawChart.poly} />
              {#each drawChart.points as p}
                <circle class="dot" class:live={p.live} cx={p.cx} cy={p.cy} r="4">
                  <title>{p.label}: {pct1(p.drawRate)}% ({p.draws} of {p.games})</title>
                </circle>
                <text class="vlab" class:live={p.live} x={p.cx} y={p.cy - 10}>{pct1(p.drawRate)}%</text>
                <text class="xlab" x={p.cx} y={H - M.bottom + 20}>{yearOf(p.sid)}</text>
              {/each}
            </svg>
          </div>
        {/if}

        {#if blowoutChart}
          <div class="chartwrap">
            <div class="chart-label">Blowout rate</div>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
                 aria-label="Blowout rate by season">
              {#each blowoutChart.ticks as t}
                <line class="grid" x1={M.left} x2={W - M.right} y1={t.gy} y2={t.gy} />
                <text class="ylab" x={M.left - 8} y={t.gy} dominant-baseline="middle">{t.v}%</text>
              {/each}
              <polyline class="line" points={blowoutChart.poly} />
              {#each blowoutChart.points as p}
                <circle class="dot" class:live={p.live} cx={p.cx} cy={p.cy} r="4">
                  <title>{p.label}: {pct1(p.blowoutRate)}% ({p.blowouts} of {p.games})</title>
                </circle>
                <text class="vlab" class:live={p.live} x={p.cx} y={p.cy - 10}>{pct1(p.blowoutRate)}%</text>
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
              <th>Games</th>
              <th>Draws</th>
              <th>Draw %</th>
              <th>Blowouts</th>
              <th>Blowout %</th>
            </tr>
          </thead>
          <tbody>
            {#each [...(outcomeData || [])].reverse() as d}
              <tr class:live={d.live}>
                <td class="l" class:live={d.live}>{d.label}</td>
                <td>{d.games}</td>
                <td>{d.draws}</td>
                <td>{pct1(d.drawRate)}%</td>
                <td>{d.blowouts}</td>
                <td>{pct1(d.blowoutRate)}%</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if !outcomeData || outcomeData.length === 0}
          <div class="empty">No games recorded yet.</div>
        {/if}
      </div>
    </section>

    <h2 class="section" id="division-balance">Division balance</h2>
    <p class="recdesc">
      Average gap in points-per-game between the best and worst team within a league division,
      each season. A smaller gap means a more competitively balanced season. Over-35 and cups
      aren&rsquo;t divisions and are excluded.
    </p>
    <section class="trend">
      {#if spreadChart}
        <div class="chartwrap">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
               aria-label="Points-per-game spread within divisions, by season">
            {#each spreadChart.ticks as t}
              <line class="grid" x1={M.left} x2={W - M.right} y1={t.gy} y2={t.gy} />
              <text class="ylab" x={M.left - 8} y={t.gy} dominant-baseline="middle">{gpg2(t.v)}</text>
            {/each}
            <polyline class="line" points={spreadChart.poly} />
            {#each spreadChart.points as p}
              <circle class="dot" class:live={p.live} cx={p.cx} cy={p.cy} r="4">
                <title>{p.label}: {gpg2(p.spread)} pts/game gap across {p.divisions} divisions</title>
              </circle>
              <text class="vlab" class:live={p.live} x={p.cx} y={p.cy - 10}>{gpg2(p.spread)}</text>
              <text class="xlab" x={p.cx} y={H - M.bottom + 20}>{yearOf(p.sid)}</text>
            {/each}
          </svg>
        </div>
      {:else}
        <div class="empty">No standings recorded yet.</div>
      {/if}

      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l">Season</th>
              <th>Divisions</th>
              <th>Avg. Spread</th>
            </tr>
          </thead>
          <tbody>
            {#each [...(spreadData || [])].reverse() as d}
              <tr class:live={d.live}>
                <td class="l" class:live={d.live}>{d.label}</td>
                <td>{d.divisions}</td>
                <td>{d.spread !== null ? gpg2(d.spread) : '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <h2 class="section" id="scoring-concentration">Scoring concentration</h2>
    <p class="recdesc">
      Share of a season&rsquo;s goals scored by its top 10 scorers, across every competition. A
      higher share means scoring is concentrated among a few standout players rather than spread
      across the league.
    </p>
    <section class="trend">
      {#if concentrationChart}
        <div class="chartwrap">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
               aria-label="Share of goals scored by the top 10 scorers, by season">
            {#each concentrationChart.ticks as t}
              <line class="grid" x1={M.left} x2={W - M.right} y1={t.gy} y2={t.gy} />
              <text class="ylab" x={M.left - 8} y={t.gy} dominant-baseline="middle">{t.v}%</text>
            {/each}
            <polyline class="line" points={concentrationChart.poly} />
            {#each concentrationChart.points as p}
              <circle class="dot" class:live={p.live} cx={p.cx} cy={p.cy} r="4">
                <title>{p.label}: {pct1(p.share)}% ({p.topGoals} of {p.goals} goals, {p.scorers} scorers)</title>
              </circle>
              <text class="vlab" class:live={p.live} x={p.cx} y={p.cy - 10}>{pct1(p.share)}%</text>
              <text class="xlab" x={p.cx} y={H - M.bottom + 20}>{yearOf(p.sid)}</text>
            {/each}
          </svg>
        </div>
      {:else}
        <div class="empty">No scoring data recorded yet.</div>
      {/if}

      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l">Season</th>
              <th>Scorers</th>
              <th>Goals</th>
              <th>Top 10 Goals</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {#each [...(concentrationData || [])].reverse() as d}
              <tr class:live={d.live}>
                <td class="l" class:live={d.live}>{d.label}</td>
                <td>{d.scorers}</td>
                <td>{d.goals}</td>
                <td>{d.topGoals}</td>
                <td>{pct1(d.share)}%</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <h2 class="section" id="player-retention">Player retention</h2>
    <p class="recdesc">
      Share of a season&rsquo;s active players who also played the previous tracked season, across
      every competition. The first tracked season has no prior year to compare against.
    </p>
    <section class="trend">
      {#if retentionChart}
        <div class="chartwrap">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
               aria-label="Returning-player rate, by season">
            {#each retentionChart.ticks as t}
              <line class="grid" x1={M.left} x2={W - M.right} y1={t.gy} y2={t.gy} />
              <text class="ylab" x={M.left - 8} y={t.gy} dominant-baseline="middle">{t.v}%</text>
            {/each}
            <polyline class="line" points={retentionChart.poly} />
            {#each retentionChart.points as p}
              <circle class="dot" class:live={p.live} cx={p.cx} cy={p.cy} r="4">
                <title>{p.label}: {pct1(p.retentionRate)}% ({p.returning} of {p.prevActive})</title>
              </circle>
              <text class="vlab" class:live={p.live} x={p.cx} y={p.cy - 10}>{pct1(p.retentionRate)}%</text>
              <text class="xlab" x={p.cx} y={H - M.bottom + 20}>{yearOf(p.sid)}</text>
            {/each}
          </svg>
        </div>
      {:else}
        <div class="empty">Not enough season-over-season data yet.</div>
      {/if}

      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l">Season</th>
              <th>Previous Active</th>
              <th>Returning</th>
              <th>Retention</th>
            </tr>
          </thead>
          <tbody>
            {#each [...(retentionData || [])].reverse() as d}
              <tr class:live={d.live}>
                <td class="l" class:live={d.live}>{d.label}</td>
                <td>{d.prevActive}</td>
                <td>{d.returning}</td>
                <td>{d.retentionRate !== null ? `${pct1(d.retentionRate)}%` : '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}
</main>

<style>
  /* Competition-type filter for the age curve / average-age sections (mirrors PlayerRecords.svelte's .leadctrl). */
  .leadctrl {
    max-width: 1120px;
    margin: 0 auto 10px;
    padding: 0 14px;
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  .leadctrl label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--muted);
  }
  .leadctrl select {
    font: inherit;
    font-size: 14px;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text);
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 5px 10px;
    cursor: pointer;
  }
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
