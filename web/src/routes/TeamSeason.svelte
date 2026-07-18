<script>
  import { loadBoard, buildClubSeason } from '../lib/data.js';
  import { hscroll } from '../lib/scrollShadow.js';

  let { clubId, sid } = $props();

  let loading = $state(true);
  let error = $state('');
  let data = $state(null);

  $effect(() => {
    // re-run whenever the routed clubId/sid changes
    const id = clubId, s = sid;
    loading = true;
    error = '';
    data = null;
    loadBoard()
      .then((b) => {
        data = buildClubSeason(b, id, s);
      })
      .catch((e) => (error = e.message || String(e)))
      .finally(() => (loading = false));
  });

  // Once the club-season loads, sharpen the generic App.svelte fallback title into
  // "<club> <season label>". Leave the fallback alone if the team season isn't found.
  $effect(() => {
    if (data) document.title = `${data.name} ${data.label} · BDSL Stats`;
  });

  const fmtDate = (iso) => {
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d)) return iso || '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Standings/schedule/roster: one shared table per section; standings switch competitions via a
  // pill row (a club can field a league side + an Over-35 side in the same year). Falls back to
  // the first competition whenever the current pick doesn't exist.
  let standingsDivKey = $state('');
  const selectedStandings = $derived.by(() => {
    if (!data?.standings?.length) return null;
    return data.standings.find((c) => c.key === standingsDivKey) || data.standings[0];
  });

  // Roster sort (mirrors Club.svelte's tabs/sortable-header pattern).
  let sortKey = $state('pts');
  const roster = $derived.by(() => {
    if (!data) return [];
    return data.roster
      .slice()
      .sort((x, y) => (y[sortKey] - x[sortKey]) || (y.g - x.g) || (y.a - x.a) ||
        x.name.localeCompare(y.name));
  });

  const jumpLinks = $derived(data ? [
    ...(data.standings.length ? [{ id: 'standings', label: 'League Standings' }] : []),
    ...(data.games.length ? [{ id: 'schedule', label: 'Schedule & Results' }] : []),
    ...(data.playoffs.brackets.length ? [{ id: 'playoffs', label: 'Playoffs' }] : []),
    ...(data.roster.length ? [{ id: 'players', label: 'Players' }] : []),
  ] : []);

  // For team-data-only seasons we still show the roster, minus the (unrecorded) scoring, so
  // order by appearances instead of points.
  const rosterByGames = $derived(
    data ? data.roster.slice().sort((x, y) => (y.gp - x.gp) || x.name.localeCompare(y.name)) : []
  );

  // scrollIntoView aligns the target to the viewport top, but the sticky jump nav then overlaps
  // it -- measure the nav's actual height and offset the scroll by that (matches Season.svelte).
  function jumpTo(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const nav = document.querySelector('.jumpnav');
    const navH = nav ? nav.getBoundingClientRect().height : 0;
    const top = el.getBoundingClientRect().top + window.scrollY - navH - 10;
    window.scrollTo({ top, behavior: 'smooth' });
  }
</script>

{#if !loading && !error && data}
  <div class="pagehead">
    <div class="wrap">
      <h1 class:live={data.live}>{data.name} &middot; {data.label}{#if data.live}&nbsp;&middot; In progress{/if}{#if data.teamDataOnly}<span class="tdo" title="Standings, schedule and team goals only — individual scorers aren't recorded before 2014">Team data only</span>{/if}</h1>
      <div class="sub">
        <a class="headlink" href={`#/club/${data.clubId}`}>All-time club page</a>
        &middot;
        <a class="headlink" href={`#/season/${data.sid}`}>Leaguewide {data.label} season</a>
      </div>
      <div class="stats">
        <div class="stat"><b>{data.totals.w}&ndash;{data.totals.l}&ndash;{data.totals.d}</b><span>W&ndash;L&ndash;D</span></div>
        <div class="stat"><b>{data.totals.gf}</b><span>Goals for</span></div>
        <div class="stat"><b>{data.totals.ga}</b><span>Goals against</span></div>
        <div class="stat"><b>{data.totals.gd > 0 ? '+' : ''}{data.totals.gd}</b><span>Goal diff</span></div>
        <div class="stat"><b>{data.titles.length}</b><span>{data.titles.length === 1 ? 'Title' : 'Titles'}</span></div>
        {#if data.playoffs.resultLabel}
          <div class="stat"><b>{data.playoffs.resultLabel}</b><span>Playoffs</span></div>
        {/if}
      </div>
      {#if data.titles.length}
        <div class="titlerow">
          {#each data.titles as t}
            <span class="titletag"><span class="trophy">&#127942;</span>{t.label}</span>
          {/each}
        </div>
      {/if}
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

<main>
  {#if loading}
    <div class="status">Loading team season&hellip;</div>
  {:else if error}
    <div class="status">Couldn&rsquo;t load data: {error}</div>
  {:else if !data}
    <div class="status">
      Team season not found. Back to <a href={`#/club/${clubId}`}>club</a>
      or <a href={`#/season/${sid}`}>season</a>.
    </div>
  {:else}
    {#if data.standings.length > 0}
      <h2 class="section" id="standings">League Standings</h2>
      {#if data.standings.length > 1}
        <div class="divbtns">
          {#each data.standings as div}
            <button class:on={selectedStandings?.key === div.key} onclick={() => (standingsDivKey = div.key)}>{div.label}</button>
          {/each}
        </div>
      {/if}
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
              </tr>
            </thead>
            <tbody>
              {#each selectedStandings?.rows || [] as r}
                <tr class:me={r.isClub} class:champ={r.champion}>
                  <td class="rank" class:m1={r.position === 1} class:m2={r.position === 2} class:m3={r.position === 3}>{r.position || '–'}</td>
                  <td class="l">
                    {#if r.isClub}
                      <span class="pname self">{#if r.champion}<span class="trophy">&#127942;</span>{/if}{r.name}</span>
                    {:else}
                      <a class="pname" href={`#/club/${r.clubId}/${data.sid}`}>
                        {#if r.champion}<span class="trophy">&#127942;</span>{/if}{r.name}
                      </a>
                    {/if}
                  </td>
                  <td>{r.gp}</td>
                  <td>{r.w}</td>
                  <td>{r.d}</td>
                  <td>{r.l}</td>
                  <td>{r.gf}</td>
                  <td>{r.ga}</td>
                  <td>{r.gd > 0 ? '+' : ''}{r.gd}</td>
                  <td class="pts">{r.pts}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}

    {#if data.games.length > 0}
      <h2 class="section" id="schedule">Schedule &amp; Results</h2>
      <section class="season">
        <div class="tablewrap">
          <table>
            <thead>
              <tr>
                <th class="l">Date</th>
                <th class="l mobhide">Competition</th>
                <th class="l">Home</th>
                <th>Score</th>
                <th class="l">Away</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {#each data.games as g}
                <tr>
                  <td class="l">{g.date ? fmtDate(g.date) : 'TBD'}</td>
                  <td class="l mobhide">{g.competition}</td>
                  <td class="l" class:strong={g.homeClubId === data.clubId}>
                    {#if g.homeClubId && g.homeClubId !== data.clubId}
                      <a class="pname" href={`#/club/${g.homeClubId}/${data.sid}`}>{g.home}</a>
                    {:else}
                      {g.home || 'TBD'}
                    {/if}
                  </td>
                  <td class="pts">
                    {#if g.status === 'played'}
                      <a class="pname" href={`#/game/${data.sid}/${g.gameKey}`}>{g.hs}&ndash;{g.as}</a>
                    {:else}
                      <span class="tbd">&ndash;</span>
                    {/if}
                  </td>
                  <td class="l" class:strong={g.awayClubId === data.clubId}>
                    {#if g.awayClubId && g.awayClubId !== data.clubId}
                      <a class="pname" href={`#/club/${g.awayClubId}/${data.sid}`}>{g.away}</a>
                    {:else}
                      {g.away || 'TBD'}
                    {/if}
                  </td>
                  <td>
                    {#if g.result}
                      <span class="res res-{g.result}">{g.result}</span>
                    {:else}
                      <span class="tbd">&ndash;</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}

    {#if data.playoffs.brackets.length > 0}
      <h2 class="section" id="playoffs">Playoffs</h2>
      <p class="recdesc">
        {#if data.playoffs.results.length}
          {#each data.playoffs.results as r, i}{#if i > 0} &middot; {/if}<b>{r.label}:</b> {r.result}{/each}.
        {/if}
        Bold marks the team that advanced; a level game settled on penalties is tagged <b>PK</b>.
        Empty slots are still to be decided.
      </p>
      {#each data.playoffs.brackets as b}
        {#if data.playoffs.brackets.length > 1}
          <h3 class="subsection">{b.label}</h3>
        {/if}
        <section class="season">
          {#each b.boards as board}
            <div class="bracketwrap">
              <div class="bracket">
                {#each board.rounds as rnd}
                  <div class="bround">
                    <div class="brtitle">{rnd.label}</div>
                    {#each rnd.matches as m}
                      <div class="bmatch">
                        <div class="bteam" class:win={m.winnerId && m.winnerId === m.homeId} class:lose={m.played && m.winnerId && m.winnerId !== m.homeId} class:me={m.homeId === data.clubId}>
                          {#if m.homeId}
                            <a class="pname" href={`#/club/${m.homeId}/${data.sid}`}>{m.home}</a>
                          {:else}<span class="tbd">TBD</span>{/if}
                          <span class="bsc">{m.played ? m.hs : ''}</span>
                        </div>
                        <div class="bteam" class:win={m.winnerId && m.winnerId === m.awayId} class:lose={m.played && m.winnerId && m.winnerId !== m.awayId} class:me={m.awayId === data.clubId}>
                          {#if m.awayId}
                            <a class="pname" href={`#/club/${m.awayId}/${data.sid}`}>{m.away}</a>
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
      {/each}
    {/if}

    {#if data.teamDataOnly}
      {#if data.roster.length}
        <h2 class="section" id="players">Players ({data.roster.length})</h2>
        <section class="season">
          <p class="rnote">
            Goal and assist stats aren&rsquo;t recorded for {data.label} &mdash; roster and games
            played only.
          </p>
          <div class="tablewrap">
            <table>
              <thead>
                <tr>
                  <th class="l">Player</th>
                  <th>GP</th>
                </tr>
              </thead>
              <tbody>
                {#each rosterByGames as p (p.pk)}
                  <tr>
                    <td class="l"><a class="pname" href={`#/player/${p.pk}`}>{p.name}</a></td>
                    <td>{p.gp}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </section>
      {/if}
    {:else}
    <h2 class="section" id="players">Players ({data.roster.length})</h2>
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
              </tr>
            {/each}
          </tbody>
        </table>
        {#if data.roster.length === 0}
          <div class="empty">No individual player stats recorded for this club this season.</div>
        {/if}
      </div>
    </section>
    {/if}
  {/if}
</main>

<style>
  /* Explains the stats-free roster shown for pre-2014 (team-data-only) seasons. */
  .rnote { margin: 0 0 12px; color: var(--muted); font-size: 13px; }

  /* Header links back to the all-time club page and the full season page. */
  .headlink { color: #fff; text-decoration: underline; text-underline-offset: 2px; }
  .headlink:hover { opacity: 0.85; }

  /* Titles won this season, shown as trophy chips under the summary stats. */
  .titlerow { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .titletag { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; font-weight: 650;
    background: rgba(255, 255, 255, 0.14); border-radius: 999px; padding: 3px 10px; }

  /* Highlight the profiled club's own row in the standings table (mirrors tr.champ's tint). */
  tr.me td { background: color-mix(in srgb, var(--navy2) 14%, transparent); }
  tr.me td.l .pname.self { font-weight: 800; color: var(--navy2); }

  /* The profiled club's own name in a schedule row / bracket (not a link -- it's the page subject). */
  td.strong { font-weight: 750; }
  .bteam.me .pname { font-weight: 800; }

  h3.subsection { max-width: 1120px; margin: 4px auto 8px; padding: 0 14px; font-size: 14px;
    color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }

  /* Win/Loss/Draw pill in the Result column. */
  .res { display: inline-block; min-width: 20px; padding: 1px 7px; border-radius: 999px;
    font-size: 12px; font-weight: 750; }
  .res-W { background: color-mix(in srgb, var(--g) 20%, transparent); color: var(--g); }
  .res-L { background: color-mix(in srgb, var(--bad) 18%, transparent); color: var(--bad); }
  .res-D { background: var(--hover); color: var(--muted); }

  /* Standings/competition switcher pill row (ported from Season.svelte). */
  .divbtns { max-width: 1120px; margin: 0 auto 10px; padding: 0 14px; display: flex; gap: 6px; flex-wrap: wrap; }
  .divbtns button { border: 1px solid var(--line); background: var(--row); color: var(--text);
    padding: 5px 12px; border-radius: 999px; font-size: 12.5px; font-weight: 650; cursor: pointer; white-space: nowrap; }
  .divbtns button:hover { background: var(--hover); border-color: var(--navy2); color: var(--navy2); }
  .divbtns button.on { background: var(--navy); border-color: var(--navy); color: #fff; }

  /* Sortable stat headers (ported from Season.svelte). */
  th.sortable { cursor: pointer; user-select: none; white-space: nowrap; }
  th.sortable:hover { color: var(--navy2); }
  th.sortable.act { color: var(--navy2); }

  /* Playoff bracket (ported from Season.svelte -- no shared component). */
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
</style>
