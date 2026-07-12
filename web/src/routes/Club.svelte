<script>
  import { loadBoard, buildClubProfile } from '../lib/data.js';

  let { clubId } = $props();

  let loading = $state(true);
  let error = $state('');
  let club = $state(null);

  // Roster sort (mirrors the BestSingleSeasons tabs/sortable-header pattern).
  let sortKey = $state('pts');

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
                  <td class="l">{s.label}</td>
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
                    <td class="l">{s.label}</td>
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
