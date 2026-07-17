<script>
  import { loadBoard, buildSeason } from '../lib/data.js';
  import { hscroll } from '../lib/scrollShadow.js';

  let { sid } = $props();

  let loading = $state(true);
  let error = $state('');
  let data = $state(null);

  $effect(() => {
    // re-run whenever the routed sid changes
    const id = sid;
    loading = true;
    error = '';
    data = null;
    loadBoard()
      .then((b) => {
        data = buildSeason(b, id);
      })
      .catch((e) => (error = e.message || String(e)))
      .finally(() => (loading = false));
  });

  const jumpLinks = $derived([
    { id: 'champions', label: 'Champions' },
    { id: 'standings', label: 'Standings' },
    ...(data?.brackets?.length ? [{ id: 'playoffs', label: 'Playoffs' }] : []),
    ...(data?.fixtures?.length ? [{ id: 'fixtures', label: 'Upcoming Matches' }] : []),
    ...(data?.results?.length ? [{ id: 'results', label: 'Recent Results' }] : []),
    { id: 'leaders', label: 'Top Performers' },
  ]);

  const fmtDate = (iso) => {
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d)) return iso || '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // scrollIntoView aligns the target to the viewport top, but the sticky jump nav then overlaps
  // it -- measure the nav's actual height and offset the scroll by that (matches Champions.svelte).
  function jumpTo(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const nav = document.querySelector('.jumpnav');
    const navH = nav ? nav.getBoundingClientRect().height : 0;
    const top = el.getBoundingClientRect().top + window.scrollY - navH - 10;
    window.scrollTo({ top, behavior: 'smooth' });
  }

  // Top-performers table controls. Sort by any of goals/assists/points (click the header) --
  // sorting by G or A reproduces the old separate top-scorers / top-assisters leaderboards --
  // and optionally filter to a single division. State resets on remount ({#key sid} in App).
  const LEADER_LIMIT = 50;
  let sortKey = $state('pts'); // 'g' | 'a' | 'pts'
  let divFilter = $state(''); // '' = all divisions

  // Standings/fixtures/results: one table each, switched between competitions via a button row
  // (instead of stacking every division's table one after another). Falls back to the first
  // competition whenever the current pick doesn't exist in this season's data (incl. right after
  // sid changes).
  let standingsDivKey = $state('');
  let fixturesDivKey = $state('');
  let resultsDivKey = $state('');
  let bracketDivKey = $state('');

  const selectedStandings = $derived.by(() => {
    if (!data?.standings?.length) return null;
    return data.standings.find((c) => c.key === standingsDivKey) || data.standings[0];
  });
  const selectedBracket = $derived.by(() => {
    if (!data?.brackets?.length) return null;
    return data.brackets.find((c) => c.key === bracketDivKey) || data.brackets[0];
  });
  const selectedFixtures = $derived.by(() => {
    if (!data?.fixtures?.length) return null;
    return data.fixtures.find((c) => c.key === fixturesDivKey) || data.fixtures[0];
  });
  const selectedResults = $derived.by(() => {
    if (!data?.results?.length) return null;
    return data.results.find((c) => c.key === resultsDivKey) || data.results[0];
  });

  const leaders = $derived.by(() => {
    if (!data) return [];
    const rows = divFilter ? data.players.filter((p) => p.divisionKey === divFilter) : data.players;
    return rows
      .slice()
      .sort((a, b) => b[sortKey] - a[sortKey] || b.pts - a.pts || b.g - a.g || a.name.localeCompare(b.name))
      .slice(0, LEADER_LIMIT);
  });

</script>

{#if !loading && !error && data}
  <div class="pagehead">
    <div class="wrap">
      <h1 class:live={data.live}>{data.label}{#if data.live} &middot; In progress{/if}</h1>
      <div class="sub">Standings, champions and top individual performances for this season</div>
    </div>
  </div>

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
    <div class="status">Loading season&hellip;</div>
  {:else if error}
    <div class="status">Couldn&rsquo;t load data: {error}</div>
  {:else if !data}
    <div class="status">
      Season not found. <a href="#/seasons">Back to all seasons</a>.
    </div>
  {:else}
    <h2 class="section" id="champions">Champions</h2>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l">Competition</th>
              <th class="l">Champion</th>
            </tr>
          </thead>
          <tbody>
            {#each data.champions as c}
              <tr>
                <td class="l">{c.label}</td>
                <td class="l">
                  {#if c.undecided}
                    <span class="tbd">TBD</span>
                  {:else}
                    <a class="pname" href={`#/club/${c.clubId}`}>
                      <span class="trophy">&#127942;</span>{c.clubName}
                    </a>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if data.champions.length === 0}
          <div class="empty">No competitions recorded this season.</div>
        {/if}
      </div>
    </section>

    <h2 class="section" id="standings">Standings</h2>
    {#if data.standings.length > 0}
      <div class="divbtns">
        {#each data.standings as div}
          <button class:on={selectedStandings?.key === div.key} onclick={() => (standingsDivKey = div.key)}>{div.label}</button>
        {/each}
      </div>
      <section class="season">
        <div class="tablewrap">
          <table>
            <thead>
              <tr>
                <th class="l">#</th>
                <th class="l">Club</th>
                <th>GP</th>
                <th>W</th>
                <th>D</th>
                <th>L</th>
                <th>GF</th>
                <th>GA</th>
                <th>GD</th>
                <th>Pts</th>
                <th class="mobhide" title="Pythagorean expected position, based on goals for/against">xPos</th>
              </tr>
            </thead>
            <tbody>
              {#each selectedStandings?.rows || [] as r}
                <tr class:live={r.champion}>
                  <td class="rank" class:m1={r.position === 1} class:m2={r.position === 2} class:m3={r.position === 3}>{r.position || '–'}</td>
                  <td class="l">
                    <a class="pname" href={`#/club/${r.clubId}/${sid}`}>
                      {#if r.champion}<span class="trophy">&#127942;</span>{/if}{r.name}
                    </a>
                    <a class="clublink" href={`#/club/${r.clubId}`} title="All-time club page" aria-label="All-time club page">&#8599;</a>
                  </td>
                  <td>{r.gp}</td>
                  <td>{r.w}</td>
                  <td>{r.d}</td>
                  <td>{r.l}</td>
                  <td>{r.gf}</td>
                  <td>{r.ga}</td>
                  <td>{r.gd > 0 ? '+' : ''}{r.gd}</td>
                  <td class="pts">{r.pts}</td>
                  <td class="mobhide" class:luckup={r.xposition > r.position} class:luckdown={r.xposition < r.position}>{r.xposition}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {:else}
      <p class="recdesc">No standings recorded this season.</p>
    {/if}

    {#if data.brackets.length > 0}
      <h2 class="section" id="playoffs">Playoffs</h2>
      <p class="recdesc">
        The playoff bracket for each competition. Bold marks the team that advanced; a level game
        settled on penalties is tagged <b>PK</b>. Empty slots are still to be decided.
      </p>
      <div class="divbtns">
        {#each data.brackets as b}
          <button class:on={selectedBracket?.key === b.key} onclick={() => (bracketDivKey = b.key)}>{b.label}</button>
        {/each}
      </div>
      {#if selectedBracket}
        <section class="season">
          {#each selectedBracket.boards as board}
            <div class="bracketwrap">
              <div class="bracket">
                {#each board.rounds as rnd}
                  <div class="bround">
                    <div class="brtitle">{rnd.label}</div>
                    {#each rnd.matches as m}
                      <div class="bmatch">
                        <div class="bteam" class:win={m.winnerId && m.winnerId === m.homeId} class:lose={m.played && m.winnerId && m.winnerId !== m.homeId}>
                          {#if m.homeId}
                            <a class="pname" href={`#/club/${m.homeId}`}>{m.home}</a>
                          {:else}<span class="tbd">TBD</span>{/if}
                          <span class="bsc">{m.played ? m.hs : ''}</span>
                        </div>
                        <div class="bteam" class:win={m.winnerId && m.winnerId === m.awayId} class:lose={m.played && m.winnerId && m.winnerId !== m.awayId}>
                          {#if m.awayId}
                            <a class="pname" href={`#/club/${m.awayId}`}>{m.away}</a>
                          {:else}<span class="tbd">TBD</span>{/if}
                          <span class="bsc">{m.played ? m.as : ''}</span>
                        </div>
                        {#if m.note}<span class="bnote">{m.note}</span>{/if}
                      </div>
                    {/each}
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </section>
      {/if}
    {/if}

    {#if data.fixtures.length > 0}
      <h2 class="section" id="fixtures">Upcoming Matches</h2>
      <div class="divbtns">
        {#each data.fixtures as comp}
          <button class:on={selectedFixtures?.key === comp.key} onclick={() => (fixturesDivKey = comp.key)}>{comp.label}</button>
        {/each}
      </div>
      <section class="season">
        <div class="tablewrap">
          <table>
            <thead>
              <tr>
                <th class="l">Date</th>
                <th class="l">Time</th>
                <th class="l">Home</th>
                <th class="l">Away</th>
                <th class="l mobhide">Location</th>
              </tr>
            </thead>
            <tbody>
              {#each selectedFixtures?.games || [] as g}
                <tr>
                  <td class="l">{g.date ? fmtDate(g.date) : 'TBD'}</td>
                  <td class="l">{g.time || '–'}</td>
                  <td class="l">
                    {#if g.homeClubId}
                      <a class="pname" href={`#/club/${g.homeClubId}`}>{g.home}</a>
                    {:else}
                      {g.home || 'TBD'}
                    {/if}
                  </td>
                  <td class="l">
                    {#if g.awayClubId}
                      <a class="pname" href={`#/club/${g.awayClubId}`}>{g.away}</a>
                    {:else}
                      {g.away || 'TBD'}
                    {/if}
                  </td>
                  <td class="l mobhide">{g.location || '–'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}

    {#if data.results.length > 0}
      <h2 class="section" id="results">Recent Results</h2>
      <div class="divbtns">
        {#each data.results as comp}
          <button class:on={selectedResults?.key === comp.key} onclick={() => (resultsDivKey = comp.key)}>{comp.label}</button>
        {/each}
      </div>
      <section class="season">
        <div class="tablewrap">
          <table>
            <thead>
              <tr>
                <th class="l">Date</th>
                <th class="l">Home</th>
                <th>Score</th>
                <th class="l">Away</th>
              </tr>
            </thead>
            <tbody>
              {#each selectedResults?.games || [] as g}
                <tr>
                  <td class="l">{g.date ? fmtDate(g.date) : 'TBD'}</td>
                  <td class="l">
                    {#if g.homeClubId}
                      <a class="pname" href={`#/club/${g.homeClubId}`}>{g.home}</a>
                    {:else}
                      {g.home || 'TBD'}
                    {/if}
                  </td>
                  <td class="pts">
                    <a class="pname" href={`#/game/${sid}/${g.gameKey}`}>{g.hs}&ndash;{g.as}</a>
                  </td>
                  <td class="l">
                    {#if g.awayClubId}
                      <a class="pname" href={`#/club/${g.awayClubId}`}>{g.away}</a>
                    {:else}
                      {g.away || 'TBD'}
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}

    <h2 class="section" id="leaders">Top Performers</h2>
    <div class="leadctrl">
      <label>
        Division
        <select bind:value={divFilter}>
          <option value="">All divisions</option>
          {#each data.divisions as d}
            <option value={d.key}>{d.label}</option>
          {/each}
        </select>
      </label>
      <span class="hint">Click <b>G</b>, <b>A</b> or <b>Pts</b> to sort</span>
    </div>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l">#</th>
              <th class="l">Player</th>
              <th class="l">Division</th>
              <th class="l mobhide">Team(s)</th>
              <th class="sortable" class:sorted={sortKey === 'g'} onclick={() => (sortKey = 'g')}>G{#if sortKey === 'g'}<span class="arr">&#9662;</span>{/if}</th>
              <th class="sortable" class:sorted={sortKey === 'a'} onclick={() => (sortKey = 'a')}>A{#if sortKey === 'a'}<span class="arr">&#9662;</span>{/if}</th>
              <th class="sortable" class:sorted={sortKey === 'pts'} onclick={() => (sortKey = 'pts')}>Pts{#if sortKey === 'pts'}<span class="arr">&#9662;</span>{/if}</th>
              <th>GP</th>
            </tr>
          </thead>
          <tbody>
            {#each leaders as p, i}
              <tr>
                <td class="rank" class:m1={i === 0} class:m2={i === 1} class:m3={i === 2}>{i + 1}</td>
                <td class="l"><a class="pname" href={`#/player/${p.pk}`}>{p.name}</a></td>
                <td class="l">{p.division}</td>
                <td class="l mobhide">{p.teams.join(', ')}</td>
                <td class="g" class:sorted={sortKey === 'g'}>{p.g}</td>
                <td class="a" class:sorted={sortKey === 'a'}>{p.a}</td>
                <td class="pts" class:sorted={sortKey === 'pts'}>{p.pts}</td>
                <td>{p.gp}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if leaders.length === 0}
          <div class="empty">No players recorded{divFilter ? ' for this division' : ' this season'}.</div>
        {/if}
      </div>
    </section>
  {/if}
</main>

<style>
  /* xPos vs actual position: green if the club overperformed its Pythagorean expectation
     (finished higher than expected), red if it underperformed (finished lower). */
  .luckup { color: #1a8a4a; font-weight: 650; }
  .luckdown { color: #c0392b; font-weight: 650; }

  /* Standings/fixtures/results competition switcher: a row of pill buttons, one per division,
     above a single shared table (instead of stacking every division's table in a row). */
  .divbtns {
    max-width: 1120px;
    margin: 0 auto 10px;
    padding: 0 14px;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .divbtns button {
    border: 1px solid var(--line);
    background: var(--row);
    color: var(--text);
    padding: 5px 12px;
    border-radius: 999px;
    font-size: 12.5px;
    font-weight: 650;
    cursor: pointer;
    white-space: nowrap;
  }
  .divbtns button:hover { background: var(--hover); border-color: var(--navy2); color: var(--navy2); }
  .divbtns button.on { background: var(--navy); border-color: var(--navy); color: #fff; }

  /* Top-performers controls: division dropdown + sort hint. */
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
  .leadctrl .hint { font-size: 12.5px; color: var(--muted); }

  /* Sortable stat headers. The active column is highlighted in both header and cells. */
  th.sortable { cursor: pointer; user-select: none; white-space: nowrap; }
  th.sortable:hover { color: var(--navy2); }
  th.sorted { color: var(--navy2); }
  td.sorted { font-weight: 800; color: var(--text); }
  .arr { font-size: 9px; margin-left: 2px; vertical-align: middle; }

  /* Playoff bracket: one flex column per round (Quarterfinals -> Semifinals -> Final), each match
     a small card with two team rows. Columns keep a fixed width and the whole bracket scrolls
     horizontally on narrow screens rather than the page itself. No SVG connectors -- space-around
     vertically centers later rounds against the earlier ones for a bracket-like read. */
  .bracketwrap { overflow-x: auto; -webkit-overflow-scrolling: touch; padding-bottom: 4px; margin-bottom: 14px; }
  .bracketwrap + .bracketwrap { border-top: 1px solid var(--line); padding-top: 12px; }
  .bracket { display: flex; gap: 16px; min-width: min-content; align-items: stretch; }
  .bround { display: flex; flex-direction: column; justify-content: space-around; gap: 12px;
    flex: 1 0 200px; min-width: 200px; }
  .brtitle { font-size: 11px; text-transform: uppercase; letter-spacing: .6px; color: var(--muted);
    font-weight: 700; text-align: center; }
  .bmatch { position: relative; background: var(--card); border: 1px solid var(--line);
    border-radius: 10px; padding: 6px 10px; box-shadow: 0 1px 3px rgba(0,0,0,.05); }
  .bteam { display: flex; align-items: center; justify-content: space-between; gap: 10px;
    font-size: 13px; padding: 4px 0; }
  .bteam + .bteam { border-top: 1px dashed var(--line); }
  .bteam .pname { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bteam.win { font-weight: 750; }
  .bteam.win .pname { color: var(--navy2); }
  .bteam.lose { color: var(--muted); }
  .bsc { flex: 0 0 auto; font-variant-numeric: tabular-nums; color: var(--muted); }
  .bteam.win .bsc { color: var(--navy2); font-weight: 750; }
  .bnote { position: absolute; top: -8px; right: 8px; background: var(--card); border: 1px solid var(--line);
    border-radius: 6px; padding: 0 5px; font-size: 9.5px; font-weight: 700; letter-spacing: .3px; color: var(--muted); }

  /* Secondary link from a standings row to the club's all-time page (the club name itself
     links to that club's season view). */
  .clublink { margin-left: 6px; font-size: 12px; color: var(--muted); text-decoration: none; }
  .clublink:hover { color: var(--navy2); }
</style>
