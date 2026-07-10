<script>
  import { loadBoard, buildAllPlayers } from '../lib/data.js';

  // Cap rows injected into the DOM; search filters the full set first so any player is reachable.
  const CAP = 500;

  let loading = $state(true);
  let error = $state('');
  let all = $state([]);
  let search = $state('');

  $effect(() => {
    loadBoard()
      .then((b) => (all = buildAllPlayers(b.allPlayers, b.playersRegistry)))
      .catch((e) => (error = e.message || String(e)))
      .finally(() => (loading = false));
  });

  const filtered = $derived.by(() => {
    const term = search.trim().toLowerCase();
    if (!term) return all;
    return all.filter((p) => p.name.toLowerCase().includes(term));
  });
  const total = $derived(filtered.length);
  const shown = $derived(total > CAP ? filtered.slice(0, CAP) : filtered);
</script>

<div class="pagehead">
  <div class="wrap">
    <h1>Players</h1>
    <div class="sub">Every player in BDSL history with their all-time totals &middot; sorted by last name</div>
    <div class="stats">
      <div class="stat"><b>{all.length}</b><span>Players</span></div>
    </div>
  </div>
</div>

<main>
  {#if loading}
    <div class="status">Loading BDSL data&hellip;</div>
  {:else if error}
    <div class="status">Couldn&rsquo;t load data: {error}</div>
  {:else}
    <div class="controls">
      <input type="search" placeholder="Search players by name&hellip;" autocomplete="off" bind:value={search} />
    </div>

    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th class="l">Player</th>
            <th>G</th>
            <th>A</th>
            <th>Pts</th>
            <th>GP</th>
            <th class="mobhide">Seasons</th>
          </tr>
        </thead>
        <tbody>
          {#each shown as p (p.pk)}
            <tr>
              <td class="l"><a class="pname" href={`#/player/${p.pk}`}>{p.name}</a></td>
              <td class="g">{#if p.g}{p.g}{:else}<span class="z">0</span>{/if}</td>
              <td class="a">{#if p.a}{p.a}{:else}<span class="z">0</span>{/if}</td>
              <td class="pts">{p.pts}</td>
              <td>{p.gp}</td>
              <td class="mobhide">{p.seasons}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if total === 0}
        <div class="empty">No players match your search.</div>
      {/if}
      {#if total > CAP}
        <div class="note">
          Showing {CAP} of {total} players &mdash; search by name to narrow the list.
        </div>
      {/if}
    </div>
  {/if}
</main>
