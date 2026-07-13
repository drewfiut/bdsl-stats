<script>
  import { loadBoard, buildClubProfile, LEAGUE_DIVISIONS } from '../lib/data.js';

  let { clubId } = $props();

  let loading = $state(true);
  let error = $state('');
  let club = $state(null);

  // Roster sort (mirrors the BestSingleSeasons tabs/sortable-header pattern).
  let sortKey = $state('pts');

  // Division-history chart geometry, in viewBox units (mirrors Trends.svelte's chart pattern).
  const DW = 720, DH = 220;
  const DM = { top: 20, right: 20, bottom: 30, left: 92 };
  const diw = DW - DM.left - DM.right;
  const dih = DH - DM.top - DM.bottom;

  // Season year for compact x-axis labels ("2024-summer" -> "2024").
  const yearOf = (sid) => (/^(\d{4})/.exec(sid || '')?.[1]) || sid;

  // Plots the club's league-division-only rows chronologically, y = division order (1 = Premier
  // at the top) padded +/-0.5 around the club's own min/max so the line isn't flush against the
  // chart edges. Y-axis ticks are drawn only for the LEAGUE_DIVISIONS the padded range covers.
  const divChart = $derived.by(() => {
    const rows = club?.divisionTimeline?.rows;
    if (!rows || rows.length === 0) return null;
    const orders = rows.map((r) => r.order);
    const yMin = Math.min(...orders) - 0.5;
    const yMax = Math.max(...orders) + 0.5;
    const n = rows.length;
    const x = (i) => DM.left + (n === 1 ? diw / 2 : (diw * i) / (n - 1));
    const y = (v) => DM.top + ((v - yMin) / (yMax - yMin || 1)) * dih;
    const points = rows.map((r, i) => ({ ...r, cx: x(i), cy: y(r.order) }));
    const ticks = LEAGUE_DIVISIONS
      .filter((d) => d.order >= yMin && d.order <= yMax)
      .map((d) => ({ label: d.label, gy: y(d.order) }));
    return { points, ticks, poly: points.map((p) => `${p.cx},${p.cy}`).join(' ') };
  });

  $effect(() => {
    // re-run whenever the routed clubId changes
    const id = clubId;
    loading = true;
    error = '';
    club = null;
    loadBoard()
      .then((b) => {
        club = buildClubProfile(b.allTeamStandings, b.allPlayers, b.playersRegistry, id, b.championsByClub, b.allGames);
      })
      .catch((e) => (error = e.message || String(e)))
      .finally(() => (loading = false));
  });

  const roster = $derived.by(() => {
    if (!club) return [];
    return club.roster
      .slice()
      .sort((x, y) => (y[sortKey] - x[sortKey]) || (y.g - x.g) || (y.a - x.a) ||
        x.name.localeCompare(y.name));
  });
</script>

<main class="profile">
  {#if loading}
    <div class="status">Loading club&hellip;</div>
  {:else if error}
    <div class="status">Couldn&rsquo;t load data: {error}</div>
  {:else if !club}
    <div class="status">
      Club not found. <a href="#/clubs">Back to all clubs</a>.
    </div>
  {:else}
    <div class="phead">
      <div class="wrap">
        <h1>{club.name}</h1>
        <div class="sub">All-time record across every BDSL season</div>
        <div class="stats">
          <div class="stat"><b>{club.seasons?.length ?? 0}</b><span>Seasons</span></div>
          <div class="stat"><b>{club.totals.w}&ndash;{club.totals.l}&ndash;{club.totals.d}</b><span>W&ndash;L&ndash;D</span></div>
          <div class="stat"><b>{club.totals.gf}</b><span>Goals for</span></div>
          <div class="stat"><b>{club.totals.ga}</b><span>Goals against</span></div>
          <div class="stat"><b>{club.totals.gd > 0 ? '+' : ''}{club.totals.gd}</b><span>Goal diff</span></div>
          <div class="stat"><b>{club.totals.titles}</b><span>Titles</span></div>
        </div>
      </div>
    </div>

    <h2 class="section">Division History</h2>
    <p class="recdesc">
      League division for every season played, oldest to newest &mdash; a promotion moves the
      line up, a relegation moves it down. Over-35 and cups have no table and aren&rsquo;t shown.
    </p>
    <section class="season">
      {#if club.divisionTimeline.rows.length === 0}
        <div class="empty">No league-division history recorded for this club.</div>
      {:else}
        <div class="stats divstats">
          <div class="stat"><b>{club.divisionTimeline.promotions}</b><span>Promotions</span></div>
          <div class="stat"><b>{club.divisionTimeline.relegations}</b><span>Relegations</span></div>
          <div class="stat"><b>{club.divisionTimeline.longestStreak}</b><span>Longest Spell&nbsp;({club.divisionTimeline.longestStreakDivision})</span></div>
          <div class="stat"><b>{club.divisionTimeline.divisionsPlayed}</b><span>Divisions Played</span></div>
        </div>
        <div class="chartwrap">
          <svg viewBox={`0 0 ${DW} ${DH}`} preserveAspectRatio="xMidYMid meet" role="img"
               aria-label="Division history by season">
            {#each divChart.ticks as t}
              <line class="grid" x1={DM.left} x2={DW - DM.right} y1={t.gy} y2={t.gy} />
              <text class="ylab" x={DM.left - 8} y={t.gy} dominant-baseline="middle">{t.label}</text>
            {/each}
            <polyline class="line" points={divChart.poly} />
            {#each divChart.points as p}
              <circle class="dot" class:live={p.live} class:promoted={!p.live && p.move === 1}
                class:relegated={!p.live && p.move === -1} cx={p.cx} cy={p.cy} r="4">
                <title>{p.label}: {p.division}{p.position ? ` (finished ${p.position})` : ''}</title>
              </circle>
              <text class="xlab" x={p.cx} y={DH - DM.bottom + 18}>{yearOf(p.sid)}</text>
            {/each}
          </svg>
        </div>
      {/if}
    </section>

    <h2 class="section">League History</h2>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l">Season</th>
              <th class="l">Competition</th>
              <th>Pos</th>
              <th>W</th>
              <th>L</th>
              <th>D</th>
              <th>GF</th>
              <th>GA</th>
              <th>Pts</th>
            </tr>
          </thead>
          <tbody>
            {#each club.seasons as s}
              {#each s.comps as c}
                <tr class:champ={c.title} class:live={s.live}>
                  <td class="l"><a class="pname" href={`#/season/${s.sid}`}>{s.label}</a></td>
                  <td class="l">{c.c}{#if c.title}<span class="trophy" title="Champion">🏆</span>{/if}</td>
                  <td class="rank" class:m1={c.position === 1} class:m2={c.position === 2} class:m3={c.position === 3}>{c.position || '–'}</td>
                  <td>{c.w}</td>
                  <td>{c.l}</td>
                  <td>{c.d}</td>
                  <td>{c.gf}</td>
                  <td>{c.ga}</td>
                  <td class="pts">{c.pts}</td>
                </tr>
              {/each}
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    {#if club.cups.length}
      <h2 class="section">Cup History</h2>
      <section class="season">
        <div class="tablewrap">
          <table>
            <thead>
              <tr>
                <th class="l">Season</th>
                <th class="l">Cup</th>
                <th>Players</th>
                <th>G</th>
                <th>A</th>
                <th>GP</th>
              </tr>
            </thead>
            <tbody>
              {#each club.cups as s}
                {#each s.entries as c}
                  <tr class:champ={c.title} class:live={s.live}>
                    <td class="l"><a class="pname" href={`#/season/${s.sid}`}>{s.label}</a></td>
                    <td class="l">{c.c}{#if c.title}<span class="trophy" title="Champion">🏆</span>{/if}</td>
                    <td>{c.players}</td>
                    <td class="g">{#if c.g}{c.g}{:else}<span class="z">0</span>{/if}</td>
                    <td class="a">{#if c.a}{c.a}{:else}<span class="z">0</span>{/if}</td>
                    <td>{c.gp || '–'}</td>
                  </tr>
                {/each}
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}

    {#if club.topOpponents.length}
      <h2 class="section">Top 5 Most Common Opponents</h2>
      <section class="season">
        <div class="tablewrap">
          <table>
            <thead>
              <tr>
                <th class="l">Opponent</th>
                <th>Played</th>
                <th>Record (W&ndash;L&ndash;D)</th>
                <th>GF</th>
                <th>GA</th>
              </tr>
            </thead>
            <tbody>
              {#each club.topOpponents as o}
                <tr>
                  <td class="l"><a class="pname" href={`#/club/${o.clubId}`}>{o.name}</a></td>
                  <td>{o.played}</td>
                  <td>{o.w}&ndash;{o.l}&ndash;{o.d}</td>
                  <td>{o.gf}</td>
                  <td>{o.ga}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}

    <h2 class="section">Players ({club.roster.length})</h2>
    <section class="season">
      <div class="controls">
        <div class="tabs">
          <button class:on={sortKey === 'pts'} onclick={() => (sortKey = 'pts')}>Points</button>
          <button class:on={sortKey === 'g'} onclick={() => (sortKey = 'g')}>Goals</button>
          <button class:on={sortKey === 'a'} onclick={() => (sortKey = 'a')}>Assists</button>
          <button class:on={sortKey === 'gp'} onclick={() => (sortKey = 'gp')}>Games</button>
        </div>
      </div>
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l">Player</th>
              <th class="sortable" class:act={sortKey === 'g'} onclick={() => (sortKey = 'g')}>G</th>
              <th class="sortable" class:act={sortKey === 'a'} onclick={() => (sortKey = 'a')}>A</th>
              <th class="sortable" class:act={sortKey === 'pts'} onclick={() => (sortKey = 'pts')}>Pts</th>
              <th class="sortable" class:act={sortKey === 'gp'} onclick={() => (sortKey = 'gp')}>GP</th>
              <th class="mobhide">Seasons</th>
              <th class="mobhide l">Seasons Played</th>
            </tr>
          </thead>
          <tbody>
            {#each roster as p (p.pk)}
              <tr>
                <td class="l"><a class="pname" href={`#/player/${p.pk}`}>{p.name}</a></td>
                <td class="g">{#if p.g}{p.g}{:else}<span class="z">0</span>{/if}</td>
                <td class="a">{#if p.a}{p.a}{:else}<span class="z">0</span>{/if}</td>
                <td class="pts">{p.pts}</td>
                <td>{p.gp}</td>
                <td class="mobhide">{p.seasons}</td>
                <td class="mobhide l">{p.seasonsPlayed}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if club.roster.length === 0}
          <div class="empty">No individual player stats recorded for this club.</div>
        {/if}
      </div>
    </section>
  {/if}
</main>

<style>
  /* Division-history chart (ports Trends.svelte's chart CSS locally -- this route otherwise
     has no scoped style block and relies entirely on app.css). */
  .divstats { margin-top: 0; margin-bottom: 14px; }
  .chartwrap { background: var(--card); border: 1px solid var(--line); border-radius: 12px;
    padding: 8px 10px; }
  .chartwrap svg { display: block; width: 100%; height: auto; }
  .grid { stroke: var(--line); stroke-width: 1; }
  .ylab { fill: var(--muted); font-size: 11px; text-anchor: end; }
  .xlab { fill: var(--muted); font-size: 11px; text-anchor: middle; }
  .line { fill: none; stroke: var(--navy2); stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
  .dot { fill: var(--navy2); stroke: var(--card); stroke-width: 1.5; }
  .dot.promoted { fill: var(--g); }
  .dot.relegated { fill: var(--bad); }
  .dot.live { fill: var(--gold); }
</style>
