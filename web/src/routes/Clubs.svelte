<script>
  import { loadBoard, buildAllClubs } from '../lib/data.js';

  // Cap rows injected into the DOM; search filters the full set first so any club is reachable.
  const CAP = 500;

  let loading = $state(true);
  let error = $state('');
  let all = $state([]);
  let search = $state('');

  $effect(() => {
    loadBoard()
      .then((b) => (all = buildAllClubs(b.allTeamStandings, b.championsByClub)))
      .catch((e) => (error = e.message || String(e)))
      .finally(() => (loading = false));
  });

  const filtered = $derived.by(() => {
    const term = search.trim().toLowerCase();
    if (!term) return all;
    return all.filter((c) => c.name.toLowerCase().includes(term));
  });
  const total = $derived(filtered.length);
  const shown = $derived(total > CAP ? filtered.slice(0, CAP) : filtered);
</script>

<div class="pagehead">
  <div class="wrap">
    <h1>Clubs</h1>
    <div class="sub">Every club in BDSL history with their all-time record &middot; sorted alphabetically</div>
    <div class="stats">
      <div class="stat"><b>{all.length}</b><span>Clubs</span></div>
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
      <input type="search" placeholder="Search clubs by name&hellip;" autocomplete="off" bind:value={search} />
    </div>

    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th class="l">Club</th>
            <th>Seasons</th>
            <th>W</th>
            <th>L</th>
            <th>D</th>
            <th class="mobhide">Titles</th>
          </tr>
        </thead>
        <tbody>
          {#each shown as c (c.clubId)}
            <tr>
              <td class="l"><a class="pname" href={`#/club/${c.clubId}`}>{c.name}</a></td>
              <td>{c.seasons}</td>
              <td>{c.w}</td>
              <td>{c.l}</td>
              <td>{c.d}</td>
              <td class="mobhide">{#if c.titles}{c.titles}{:else}<span class="z">0</span>{/if}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if total === 0}
        <div class="empty">No clubs match your search.</div>
      {/if}
      {#if total > CAP}
        <div class="note">
          Showing {CAP} of {total} clubs &mdash; search by name to narrow the list.
        </div>
      {/if}
    </div>
  {/if}
</main>
