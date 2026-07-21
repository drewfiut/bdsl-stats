<script>
  import { loadBoard, buildClubProfile, buildClubEloHistory, LEAGUE_DIVISIONS, ELO_INITIAL } from '../lib/data.js';
  import { hscroll } from '../lib/scrollShadow.js';

  let { clubId } = $props();

  let loading = $state(true);
  let error = $state('');
  let club = $state(null);
  let eloHistory = $state([]);

  // Roster sort (mirrors the BestSingleSeasons tabs/sortable-header pattern).
  let sortKey = $state('pts');

  const fmtDate = (iso) => {
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d)) return iso || '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const pct = (v) => `${Math.round((v || 0) * 100)}%`;
  const fmtMonthYear = (iso) => {
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d)) return iso || '';
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

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
    eloHistory = [];
    loadBoard()
      .then((b) => {
        club = buildClubProfile(b.allTeamStandings, b.allPlayers, b.playersRegistry, id, b.championsByClub, b.allGames, b.bracketsBySeason);
        const liveSids = new Set(b.allTeamStandings.filter((r) => r.live).map((r) => r.sid));
        eloHistory = buildClubEloHistory(b.allGames, id, liveSids);
      })
      .catch((e) => (error = e.message || String(e)))
      .finally(() => (loading = false));
  });

  // Once the profile loads, sharpen the generic App.svelte fallback title into this club's
  // name. Leave the fallback alone if the club isn't found.
  $effect(() => {
    if (club) document.title = `${club.name} · BDSL Stats`;
  });

  // Elo rating-over-time chart: y = rating (padded to clean 50s around the club's range and the
  // 1500 baseline), x = evenly-spaced games in date order. Mirrors the division chart's geometry.
  const RW = 720, RH = 220;
  const RM = { top: 20, right: 20, bottom: 30, left: 44 };
  const riw = RW - RM.left - RM.right;
  const rih = RH - RM.top - RM.bottom;
  const eloChart = $derived.by(() => {
    const h = eloHistory;
    if (!h || h.length === 0) return null;
    const ratings = h.map((p) => p.rating);
    const yMin = Math.floor((Math.min(...ratings, ELO_INITIAL) - 20) / 50) * 50;
    const yMax = Math.ceil((Math.max(...ratings, ELO_INITIAL) + 20) / 50) * 50;
    const n = h.length;
    const x = (i) => RM.left + (n === 1 ? riw / 2 : (riw * i) / (n - 1));
    const y = (v) => RM.top + rih - ((v - yMin) / (yMax - yMin || 1)) * rih;
    const points = h.map((p, i) => ({ ...p, cx: x(i), cy: y(p.rating) }));
    const ticks = [];
    for (let v = yMin; v <= yMax + 1e-9; v += 50) ticks.push({ v, gy: y(v) });
    const baseline = ELO_INITIAL >= yMin && ELO_INITIAL <= yMax ? y(ELO_INITIAL) : null;
    // Date x-axis: a handful of evenly-spaced ticks (by index, not by calendar time) rather than
    // one label per game, since a club can have dozens of rated games.
    const tickCount = Math.min(6, n);
    const xTickIdx = [...new Set(
      n === 1 ? [0] : Array.from({ length: tickCount }, (_, i) => Math.round((i * (n - 1)) / (tickCount - 1)))
    )];
    const xTicks = xTickIdx.map((i, k) => ({
      gx: x(i), label: fmtMonthYear(h[i].date),
      anchor: k === 0 ? 'start' : k === xTickIdx.length - 1 ? 'end' : 'middle',
    }));
    return { points, ticks, xTicks, baseline, poly: points.map((p) => `${p.cx},${p.cy}`).join(' '),
      current: Math.round(h[h.length - 1].rating),
      peak: Math.round(Math.max(...ratings)) };
  });

  const roster = $derived.by(() => {
    if (!club) return [];
    return club.roster
      .slice()
      .sort((x, y) => (y[sortKey] - x[sortKey]) || (y.g - x.g) || (y.a - x.a) ||
        x.name.localeCompare(y.name));
  });

  // In-page jump nav: one button per section, in document order.
  const jumpLinks = $derived(club ? [
    ...(eloChart ? [{ id: 'elo-rating', label: 'Elo Rating' }] : []),
    { id: 'division-history', label: 'Division History' },
    { id: 'league-history', label: 'League History' },
    ...(club.playoffs.gp ? [{ id: 'playoffs', label: 'Playoffs' }] : []),
    ...(club.cups.length ? [{ id: 'cup-history', label: 'Cup History' }] : []),
    ...(club.allOpponents.length ? [{ id: 'top-opponents', label: 'Opponents' }] : []),
    { id: 'players', label: 'Players' },
    { id: 'streaks', label: 'Streaks' },
  ] : []);

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
</script>

{#if !loading && !error && club}
  <div class="pagehead">
    <div class="wrap">
      <h1>{club.name}</h1>
      {#if club.nameHistory.length > 1}
        <div class="namehistory">
          Formerly
          {#each club.nameHistory.slice(0, -1).reverse() as era, i}
            {i > 0 ? ', ' : ' '}{era.name} ({era.seasons})
          {/each}
        </div>
      {/if}
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

  {#if jumpLinks.length}
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
{/if}

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
    {#if eloChart}
      <h2 class="section" id="elo-rating">Elo Rating</h2>
      <p class="recdesc">
        Strength rating over every league &amp; cup game the club has played, oldest to newest.
        Every club starts at {ELO_INITIAL} (the dashed baseline); winning against stronger sides or
        by bigger margins earns more. Over-35 games aren&rsquo;t rated.
        <a class="pname" href="#/power-rankings">See all power rankings &rarr;</a>
      </p>
      <section class="season">
        <div class="stats divstats">
          <div class="stat"><b>{eloChart.current}</b><span>Current Rating</span></div>
          <div class="stat"><b>{eloChart.peak}</b><span>Peak Rating</span></div>
          <div class="stat"><b>{eloHistory.length}</b><span>Rated Games</span></div>
        </div>
        <div class="chartwrap">
          <svg viewBox={`0 0 ${RW} ${RH}`} preserveAspectRatio="xMidYMid meet" role="img"
               aria-label="Elo rating over time">
            {#each eloChart.ticks as t}
              <line class="grid" x1={RM.left} x2={RW - RM.right} y1={t.gy} y2={t.gy} />
              <text class="ylab" x={RM.left - 8} y={t.gy} dominant-baseline="middle">{t.v}</text>
            {/each}
            {#if eloChart.baseline !== null}
              <line class="baseline" x1={RM.left} x2={RW - RM.right} y1={eloChart.baseline} y2={eloChart.baseline} />
            {/if}
            {#each eloChart.xTicks as t}
              <text class="xlab" x={t.gx} y={RH - RM.bottom + 18} style={`text-anchor:${t.anchor}`}>{t.label}</text>
            {/each}
            <polyline class="line" points={eloChart.poly} />
            {#each eloChart.points as p}
              <circle class="dot" class:live={p.live} cx={p.cx} cy={p.cy} r="2.5">
                <title>{fmtDate(p.date)} vs {p.oppName}: {p.gf}–{p.ga} ({p.result}) → {Math.round(p.rating)}</title>
              </circle>
            {/each}
          </svg>
        </div>
      </section>
    {/if}

    <h2 class="section" id="division-history">Division History</h2>
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

    <h2 class="section" id="league-history">League History</h2>
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
                  <td class="l"><a class="pname" href={`#/club/${club.clubId}/${s.sid}`}>{s.label}</a></td>
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

    {#if club.playoffs.gp}
      <h2 class="section" id="playoffs">Playoffs</h2>
      <p class="recdesc">
        Postseason record across league &amp; Over-35 brackets (cups excluded). Win&nbsp;% counts a
        game lost on penalties as a draw. &ldquo;Finals&rdquo; shows finals won&ndash;lost.
      </p>
      <section class="season">
        <div class="stats divstats">
          <div class="stat"><b>{club.playoffs.appearances}</b><span>Appearances</span></div>
          <div class="stat"><b>{club.playoffs.w}&ndash;{club.playoffs.l}&ndash;{club.playoffs.d}</b><span>W&ndash;L&ndash;D</span></div>
          <div class="stat"><b>{pct(club.playoffs.winPct)}</b><span>Win&nbsp;%</span></div>
          <div class="stat"><b>{club.playoffs.finalsW}&ndash;{club.playoffs.finalsL}</b><span>Finals&nbsp;(W&ndash;L)</span></div>
        </div>
        <div class="tablewrap">
          <table>
            <thead>
              <tr>
                <th class="l">Season</th>
                <th class="l">Competition</th>
                <th class="l">Result</th>
              </tr>
            </thead>
            <tbody>
              {#each club.playoffs.perSeason as p}
                <tr class:champ={p.champion}>
                  <td class="l"><a class="pname" href={`#/season/${p.sid}`}>{p.label}</a></td>
                  <td class="l">{p.comp}</td>
                  <td class="l">{p.result}{#if p.champion}<span class="trophy" title="Champion">🏆</span>{/if}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}

    {#if club.cups.length}
      <h2 class="section" id="cup-history">Cup History</h2>
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

    {#if club.allOpponents.length}
      <h2 class="section" id="top-opponents">All Opponents ({club.allOpponents.length})</h2>
      <section class="season">
        <div class="tablewrap opponents">
          <table>
            <thead>
              <tr>
                <th class="l">Opponent</th>
                <th>Played</th>
                <th>Record (W&ndash;L&ndash;D)</th>
                <th>GF</th>
                <th>GA</th>
                <th class="l mobhide">Last Meeting</th>
                <th class="mobhide"></th>
              </tr>
            </thead>
            <tbody>
              {#each club.allOpponents as o}
                <tr>
                  <td class="l"><a class="pname" href={`#/club/${o.clubId}`}>{o.name}</a></td>
                  <td>{o.played}</td>
                  <td>{o.w}&ndash;{o.l}&ndash;{o.d}</td>
                  <td>{o.gf}</td>
                  <td>{o.ga}</td>
                  <td class="l mobhide">
                    {#if o.lastMeeting}
                      {fmtDate(o.lastMeeting.date)} &middot; {o.lastMeeting.gf}&ndash;{o.lastMeeting.ga} ({o.lastMeeting.result})
                    {/if}
                  </td>
                  <td class="mobhide"><a class="pname" href={`#/compare/${club.clubId}/${o.clubId}`}>Compare</a></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}

    <h2 class="section" id="players">Players ({club.roster.length})</h2>
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

    <h2 class="section" id="streaks">Streaks</h2>
    <p class="recdesc">
      Longest runs across every game the club has ever played &mdash; league, playoffs and cups
      alike. &ldquo;Active&rdquo; means the streak is still running as of the club&rsquo;s most
      recent game.
    </p>
    <section class="season">
      {#if !club.streaks}
        <div class="empty">No game log recorded for this club.</div>
      {:else}
        <div class="tablewrap">
          <table>
            <thead>
              <tr>
                <th class="l">Streak</th>
                <th class="l mobhide">Seasons</th>
                <th>Games</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {#each [
                ['Longest Win Streak', club.streaks.win],
                ['Longest Unbeaten Streak', club.streaks.unbeaten],
                ['Longest Winless Streak', club.streaks.winless],
                ['Longest Scoring Streak', club.streaks.scoring],
              ] as [label, r]}
                {@const range = r ? (r.startLabel === r.endLabel ? r.startLabel : `${r.startLabel} – ${r.endLabel}`) : ''}
                <tr class:live={r?.live}>
                  <td class="l">
                    {label}
                    {#if r?.live}<span class="o35tag">ACTIVE</span>{/if}
                    <div class="submeta"><span class="season">{range}</span></div>
                  </td>
                  <td class="l mobhide">{range}</td>
                  <td class="pts">{r?.len ?? 0}</td>
                  <td class="pts">{r?.active ?? 0}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  {/if}
</main>

<style>
  /* Opponents table can run to 50+ rows -- cap it well under the default 75vh so it doesn't
     dominate the page, while staying scrollable for the full list. */
  .tablewrap.opponents { max-height: 360px; }

  /* Division-history chart (ports Trends.svelte's chart CSS locally -- this route otherwise
     has no scoped style block and relies entirely on app.css). */
  .divstats { margin-top: 0; margin-bottom: 14px; }
  .chartwrap { background: var(--card); border: 1px solid var(--line); border-radius: 12px;
    padding: 8px 10px; }
  .chartwrap svg { display: block; width: 100%; height: auto; }
  .grid { stroke: var(--line); stroke-width: 1; }
  .baseline { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 4 4; }
  .ylab { fill: var(--muted); font-size: 11px; text-anchor: end; }
  .xlab { fill: var(--muted); font-size: 11px; text-anchor: middle; }
  .line { fill: none; stroke: var(--navy2); stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
  .dot { fill: var(--navy2); stroke: var(--card); stroke-width: 1.5; }
  .dot.promoted { fill: var(--g); }
  .dot.relegated { fill: var(--bad); }
  .dot.live { fill: var(--gold); }
</style>
