<script>
  import { loadBoard, buildAllPlayers } from '../lib/data.js';

  // Cap rows injected into the DOM; search filters the full set first so any player is reachable.
  const CAP = 500;

  let loading = $state(true);
  let error = $state('');
  let all = $state([]);
  let search = $state('');
  let sortColumn = $state('name');
  let sortAsc = $state(true);

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

  const sorted = $derived.by(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let aVal, bVal;
      switch (sortColumn) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'g':
          aVal = a.g || 0;
          bVal = b.g || 0;
          break;
        case 'a':
          aVal = a.a || 0;
          bVal = b.a || 0;
          break;
        case 'pts':
          aVal = a.pts || 0;
          bVal = b.pts || 0;
          break;
        case 'gp':
          aVal = a.gp || 0;
          bVal = b.gp || 0;
          break;
        case 'seasons':
          aVal = a.seasons || 0;
          bVal = b.seasons || 0;
          break;
        default:
          return 0;
      }
      if (aVal < bVal) return sortAsc ? -1 : 1;
      if (aVal > bVal) return sortAsc ? 1 : -1;
      return 0;
    });
    return copy;
  });

  const total = $derived(sorted.length);
  const shown = $derived(total > CAP ? sorted.slice(0, CAP) : sorted);

  function toggleSort(col) {
    if (sortColumn === col) {
      sortAsc = !sortAsc;
    } else {
      sortColumn = col;
      sortAsc = true;
    }
  }
</script>

<div class="pagehead">
  <div class="wrap">
    <h1>Players</h1>
    <div class="sub">Every player in BDSL history with their all-time totals &middot; click column headers to sort</div>
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
            <th class="rank">#</th>
            <th class="l">
              <button class="sort-header" onclick={() => toggleSort('name')}>
                Player
                {#if sortColumn === 'name'}
                  <span class="sort-indicator">{sortAsc ? '▲' : '▼'}</span>
                {/if}
              </button>
            </th>
            <th>
              <button class="sort-header" onclick={() => toggleSort('g')}>
                G
                {#if sortColumn === 'g'}
                  <span class="sort-indicator">{sortAsc ? '▲' : '▼'}</span>
                {/if}
              </button>
            </th>
            <th>
              <button class="sort-header" onclick={() => toggleSort('a')}>
                A
                {#if sortColumn === 'a'}
                  <span class="sort-indicator">{sortAsc ? '▲' : '▼'}</span>
                {/if}
              </button>
            </th>
            <th>
              <button class="sort-header" onclick={() => toggleSort('pts')}>
                Pts
                {#if sortColumn === 'pts'}
                  <span class="sort-indicator">{sortAsc ? '▲' : '▼'}</span>
                {/if}
              </button>
            </th>
            <th>
              <button class="sort-header" onclick={() => toggleSort('gp')}>
                GP
                {#if sortColumn === 'gp'}
                  <span class="sort-indicator">{sortAsc ? '▲' : '▼'}</span>
                {/if}
              </button>
            </th>
            <th class="mobhide">
              <button class="sort-header" onclick={() => toggleSort('seasons')}>
                Seasons
                {#if sortColumn === 'seasons'}
                  <span class="sort-indicator">{sortAsc ? '▲' : '▼'}</span>
                {/if}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {#each shown as p, i (p.pk)}
            <tr>
              <td class="rank">{i + 1}</td>
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

<style>
  :global(button.sort-header) {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    font: inherit;
    padding: 0;
    display: inline;
    text-align: inherit;
    white-space: nowrap;
  }

  :global(button.sort-header:hover) {
    opacity: 0.7;
  }

  :global(.sort-indicator) {
    font-size: 0.75em;
    margin-left: 0.3em;
  }

  :global(th.rank, td.rank) {
    width: 3em;
    text-align: right;
    padding-right: 0.5em;
  }
</style>
