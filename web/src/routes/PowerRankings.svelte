<script>
  import { loadBoard, buildElo, ELO_INITIAL } from '../lib/data.js';
  import { hscroll } from '../lib/scrollShadow.js';

  let loading = $state(true);
  let error = $state('');
  let elo = $state(null);

  $effect(() => {
    loadBoard()
      .then((b) => {
        const liveSids = new Set(b.allTeamStandings.filter((r) => r.live).map((r) => r.sid));
        elo = buildElo(b.allGames, liveSids);
      })
      .catch((e) => (error = e.message || String(e)))
      .finally(() => (loading = false));
  });

  const round = (n) => Math.round(n);
  const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n))}`;

  const fmtDate = (iso) => {
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d)) return iso || '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const yearOf = (sid) => (/^(\d{4})/.exec(sid || '')?.[1]) || sid;

  const jumpLinks = [
    { id: 'current-power-rankings', label: 'Current Power Rankings' },
    { id: 'rating-timeline', label: 'Rating Timeline' },
    { id: 'strongest-ever', label: 'Strongest Teams Ever' },
  ];
  function jumpTo(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const nav = document.querySelector('.jumpnav');
    const navH = nav ? nav.getBoundingClientRect().height : 0;
    const top = el.getBoundingClientRect().top + window.scrollY - navH - 10;
    window.scrollTo({ top, behavior: 'smooth' });
  }

  // Chart geometry (viewBox units); responsive via preserveAspectRatio + width:100%.
  const W = 720, H = 320;
  const M = { top: 24, right: 20, bottom: 40, left: 44 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;

  // Distinct series colors (CSS vars) for the timeline — one per club, in rank order.
  const SERIES = ['var(--navy2)', 'var(--gold)', 'var(--g)', 'var(--a)', 'var(--bad)'];
  const dateMs = (iso) => new Date(`${iso}T00:00:00`).getTime();

  // Multi-line rating timeline for the current top clubs, across their full history. Each club is
  // plotted on a shared date x-axis and rating y-axis, so lines can be compared directly. Only the
  // strongest few are shown to keep the chart readable.
  const timeline = $derived.by(() => {
    if (!elo || !elo.powerRankings.length) return null;
    const top = elo.powerRankings.slice(0, SERIES.length);
    const series = top
      .map((c, i) => {
        const hist = (elo.historyByClub.get(c.clubId) || [])
          .filter((h) => !isNaN(dateMs(h.date)));
        return { clubId: c.clubId, name: c.name, color: SERIES[i], hist };
      })
      .filter((s) => s.hist.length > 0);
    if (!series.length) return null;

    const allPts = series.flatMap((s) => s.hist);
    const xMin = Math.min(...allPts.map((h) => dateMs(h.date)));
    const xMax = Math.max(...allPts.map((h) => dateMs(h.date)));
    const rMin = Math.min(...allPts.map((h) => h.rating), ELO_INITIAL);
    const rMax = Math.max(...allPts.map((h) => h.rating), ELO_INITIAL);
    const yMin = Math.floor((rMin - 20) / 50) * 50;
    const yMax = Math.ceil((rMax + 20) / 50) * 50;
    const x = (ms) => M.left + (xMax === xMin ? iw / 2 : (iw * (ms - xMin)) / (xMax - xMin));
    const y = (v) => M.top + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;

    const lines = series.map((s) => ({
      ...s,
      poly: s.hist.map((h) => `${x(dateMs(h.date))},${y(h.rating)}`).join(' '),
      last: { cx: x(dateMs(s.hist[s.hist.length - 1].date)), cy: y(s.hist[s.hist.length - 1].rating) },
    }));

    const ticks = [];
    for (let v = yMin; v <= yMax + 1e-9; v += 50) ticks.push({ v, gy: y(v) });
    // Baseline (1500) reference line, if in range.
    const baseline = ELO_INITIAL >= yMin && ELO_INITIAL <= yMax ? y(ELO_INITIAL) : null;
    // One x-axis label per distinct year present.
    const years = [...new Set(allPts.map((h) => yearOf(h.sid)))].sort();
    const xlabs = years.map((yr) => ({ yr, gx: x(dateMs(`${yr}-07-01`)) }));
    return { lines, ticks, baseline, xlabs };
  });
</script>

<div class="pagehead">
  <div class="wrap">
    <h1>Power Rankings</h1>
    <div class="sub">All-time Elo ratings, computed from every league &amp; cup result since 2014</div>
    <div class="sub detail" style="margin-top:3px">
      Every club starts at {ELO_INITIAL}. Winners take rating points from losers (more for beating a
      stronger side or by a bigger margin), and ratings regress partway to the mean between seasons
      to account for roster turnover. Over-35 games are excluded.
    </div>
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
  {:else if !elo || !elo.powerRankings.length}
    <div class="status">No games recorded yet.</div>
  {:else}
    <h2 class="section" id="current-power-rankings">Current Power Rankings</h2>
    <p class="recdesc">
      Every club that played in {elo.currentLabel}, ranked by current Elo rating. Change is the
      swing since the start of the season; form is the five most recent games (newest last).
    </p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l rank">#</th>
              <th class="l">Club</th>
              <th>Rating</th>
              <th class="mobhide">Season Δ</th>
              <th class="l mobhide">Form</th>
              <th class="mobhide">Peak</th>
              <th class="mobhide">GP</th>
            </tr>
          </thead>
          <tbody>
            {#each elo.powerRankings as r, i}
              {@const rk = i + 1}
              <tr>
                <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
                <td class="l">
                  <a class="pname" href={`#/club/${r.clubId}`}>{r.name}</a>
                  <div class="submeta">
                    <span class="season">
                      Peak {round(r.peak)} &middot; {r.played} games &middot;
                      <span class:up={r.change > 0} class:down={r.change < 0}>{signed(r.change)} this season</span>
                    </span>
                  </div>
                </td>
                <td class="pts">{round(r.rating)}</td>
                <td class="mobhide"><span class:up={r.change > 0} class:down={r.change < 0}>{signed(r.change)}</span></td>
                <td class="l mobhide">
                  <span class="form">
                    {#each r.form as f}
                      <span class="chip {f === 'W' ? 'w' : f === 'L' ? 'l' : 'd'}">{f}</span>
                    {/each}
                  </span>
                </td>
                <td class="mobhide">{round(r.peak)}</td>
                <td class="mobhide">{r.played}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <h2 class="section" id="rating-timeline">Rating Timeline</h2>
    <p class="recdesc">
      Elo rating over time for the current top {timeline?.lines.length ?? 0} clubs, across their
      full BDSL history. The dashed line marks the {ELO_INITIAL} starting/average rating.
    </p>
    <section class="season">
      {#if timeline}
        <div class="legend">
          {#each timeline.lines as s}
            <span class="legitem">
              <span class="swatch" style={`background:${s.color}`}></span>
              <a class="pname" href={`#/club/${s.clubId}`}>{s.name}</a>
            </span>
          {/each}
        </div>
        <div class="chartwrap">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
               aria-label="Elo rating over time for the top clubs">
            {#each timeline.ticks as t}
              <line class="grid" x1={M.left} x2={W - M.right} y1={t.gy} y2={t.gy} />
              <text class="ylab" x={M.left - 8} y={t.gy} dominant-baseline="middle">{t.v}</text>
            {/each}
            {#if timeline.baseline !== null}
              <line class="baseline" x1={M.left} x2={W - M.right} y1={timeline.baseline} y2={timeline.baseline} />
            {/if}
            {#each timeline.xlabs as xl}
              <text class="xlab" x={xl.gx} y={H - M.bottom + 20}>{xl.yr}</text>
            {/each}
            {#each timeline.lines as s}
              <polyline class="sline" points={s.poly} style={`stroke:${s.color}`} />
              <circle class="sdot" cx={s.last.cx} cy={s.last.cy} r="4" style={`fill:${s.color}`}>
                <title>{s.name}</title>
              </circle>
            {/each}
          </svg>
        </div>
      {:else}
        <div class="empty">Not enough game history to chart yet.</div>
      {/if}
    </section>

    <h2 class="section" id="strongest-ever">Strongest Teams Ever</h2>
    <p class="recdesc">
      The highest Elo rating any club has ever reached &mdash; peak strength at a single moment in
      BDSL history, regardless of where they stand today.
    </p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l rank">#</th>
              <th class="l">Club</th>
              <th>Peak</th>
              <th class="l mobhide">Reached</th>
              <th class="mobhide">After</th>
            </tr>
          </thead>
          <tbody>
            {#each elo.peaks.slice(0, 20) as r, i}
              {@const rk = i + 1}
              <tr>
                <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
                <td class="l">
                  <a class="pname" href={`#/club/${r.clubId}`}>{r.name}</a>
                  <div class="submeta"><span class="season">{r.atLabel} &middot; {fmtDate(r.atDate)}</span></div>
                </td>
                <td class="pts">{round(r.peak)}</td>
                <td class="l mobhide">{r.atLabel} &middot; {fmtDate(r.atDate)}</td>
                <td class="mobhide">{r.playedAt} games</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}
</main>

<style>
  .up { color: var(--g); font-weight: 700; }
  .down { color: var(--bad); font-weight: 700; }

  .form { display: inline-flex; gap: 3px; }
  .chip {
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border-radius: 4px;
    font-size: 11px; font-weight: 700; color: #fff;
  }
  .chip.w { background: var(--g); }
  .chip.l { background: var(--bad); }
  .chip.d { background: var(--muted); }

  .legend { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 10px; padding: 0 2px; }
  .legitem { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
  .swatch { width: 14px; height: 4px; border-radius: 2px; display: inline-block; }

  .chartwrap { background: var(--card); border: 1px solid var(--line); border-radius: 12px;
    padding: 8px 10px; }
  .chartwrap svg { display: block; width: 100%; height: auto; }
  .grid { stroke: var(--line); stroke-width: 1; }
  .baseline { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 4 4; }
  .ylab { fill: var(--muted); font-size: 11px; text-anchor: end; }
  .xlab { fill: var(--muted); font-size: 11px; text-anchor: middle; }
  .sline { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .sdot { stroke: var(--card); stroke-width: 1.5; }
</style>
