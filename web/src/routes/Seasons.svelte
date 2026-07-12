<script>
  import { loadBoard, buildSeasonIndex } from '../lib/data.js';

  let loading = $state(true);
  let error = $state('');
  let data = $state(null);

  $effect(() => {
    loadBoard()
      .then((b) => (data = buildSeasonIndex(b)))
      .catch((e) => (error = e.message || String(e)))
      .finally(() => (loading = false));
  });
</script>

<div class="pagehead">
  <div class="wrap">
    <h1>Seasons</h1>
    <div class="sub">Every BDSL season, newest first &mdash; standings, champions and top scorers/assisters in one place</div>
  </div>
</div>

<main>
  {#if loading}
    <div class="status">Loading BDSL data&hellip;</div>
  {:else if error}
    <div class="status">Couldn&rsquo;t load data: {error}</div>
  {:else}
    <section class="season">
      <div class="tablewrap full">
        <table>
          <thead>
            <tr>
              <th class="l">Season</th>
              <th class="narrow">Divisions</th>
              <th class="narrow">Champions</th>
              <th class="l">Top Scorer</th>
            </tr>
          </thead>
          <tbody>
            {#each data as s}
              <tr class:live={s.live}>
                <td class="l" class:live={s.live}>
                  <a class="pname" href={`#/season/${s.sid}`}>{s.label}</a>
                </td>
                <td class="narrow">{s.divisions}</td>
                <td class="narrow">{s.champions}</td>
                <td class="l">
                  {#if s.topScorer}
                    <a class="pname" href={`#/player/${s.topScorer.pk}`}>{s.topScorer.name}</a>
                    <span class="gcount">({s.topScorer.g})</span>
                    <div class="tsdiv">{s.topScorer.division}</div>
                  {:else}
                    <span class="gcount">&ndash;</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if data.length === 0}
          <div class="empty">No seasons recorded yet.</div>
        {/if}
      </div>
    </section>
  {/if}
</main>

<style>
  .gcount { color: var(--muted); }
  .tsdiv { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .tablewrap.full { max-height: none; overflow-y: visible; }
  th.narrow, td.narrow { width: 1%; white-space: nowrap; }
</style>
