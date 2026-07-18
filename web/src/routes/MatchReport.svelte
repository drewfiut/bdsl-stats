<script>
  import { loadBoard, buildMatchReport } from '../lib/data.js';

  let { sid, gameKey } = $props();

  let loading = $state(true);
  let error = $state('');
  let report = $state(null);

  $effect(() => {
    // re-run whenever the routed sid/gameKey changes
    const s = sid, k = gameKey;
    loading = true;
    error = '';
    report = null;
    loadBoard()
      .then((b) => {
        report = buildMatchReport(b.allGameStats, b.gameReportsByKey, b.allGames, s, k);
      })
      .catch((e) => (error = e.message || String(e)))
      .finally(() => (loading = false));
  });

  // Once the report loads, sharpen the generic App.svelte fallback title into
  // "<home> vs <away>". Falls back to "Home"/"Away" if a side's name is missing, matching
  // scoreLabel below. Leave the fallback alone if the game isn't found.
  $effect(() => {
    if (report) document.title = `${report.homeName || 'Home'} vs ${report.awayName || 'Away'} · BDSL Stats`;
  });

  const fmtDate = (iso) => {
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d)) return iso || '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const scoreLabel = (report) =>
    `${report.homeName || 'Home'} ${report.homeScore ?? '–'}–${report.awayScore ?? '–'} ${report.awayName || 'Away'}`;
</script>

{#if !loading && !error && report}
  <div class="pagehead">
    <div class="wrap">
      <h1>{scoreLabel(report)}</h1>
      <div class="sub">
        {report.competition || 'Competition unknown'}{#if report.roundLabel} &middot; {report.roundLabel}{/if}
        {#if report.date} &middot; {fmtDate(report.date)}{/if}
        {#if report.seasonLabel} &middot; {report.seasonLabel}{/if}
      </div>
    </div>
  </div>
{/if}

<main>
  {#if loading}
    <div class="status">Loading match report&hellip;</div>
  {:else if error}
    <div class="status">Couldn&rsquo;t load data: {error}</div>
  {:else if !report}
    <div class="status">
      Match report not found. <a href="#/seasons">Back to all seasons</a>.
    </div>
  {:else}
    <p class="recdesc">
      Recorded scorers are entered by team managers from match reports and may be incomplete
      relative to the final score &mdash; treat these as recorded events, not a complete log.
      {#if report.status === 'missing'} No match report was captured for this game.
      {:else if report.status === 'error'} There was an error capturing this match report.
      {:else if !report.status} No match report capture status is on record for this game.
      {/if}
    </p>

    {#if report.referees.length}
      <p class="recdesc">
        <b>Referees:</b>
        {#each report.referees as ref, i}{#if i > 0}, {/if}{ref.name}{ref.role ? ` (${ref.role})` : ''}{/each}
      </p>
    {/if}

    <h2 class="section">{report.homeName || 'Home'}</h2>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th class="l">Player</th>
              <th>G</th>
              <th>A</th>
              <th>Y</th>
              <th>R</th>
            </tr>
          </thead>
          <tbody>
            {#each report.home as p}
              <tr>
                <td>{p.jersey || '–'}</td>
                <td class="l">
                  {#if p.pk}
                    <a class="pname" href={`#/player/${p.pk}`}>{p.name}</a>
                  {:else}
                    {p.name}
                  {/if}
                </td>
                <td>{p.g || '–'}</td>
                <td>{p.a || '–'}</td>
                <td>{p.y || '–'}</td>
                <td>{p.r || '–'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if report.home.length === 0}
          <div class="empty">No recorded scorers for this side.</div>
        {/if}
      </div>
    </section>

    <h2 class="section">{report.awayName || 'Away'}</h2>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th class="l">Player</th>
              <th>G</th>
              <th>A</th>
              <th>Y</th>
              <th>R</th>
            </tr>
          </thead>
          <tbody>
            {#each report.away as p}
              <tr>
                <td>{p.jersey || '–'}</td>
                <td class="l">
                  {#if p.pk}
                    <a class="pname" href={`#/player/${p.pk}`}>{p.name}</a>
                  {:else}
                    {p.name}
                  {/if}
                </td>
                <td>{p.g || '–'}</td>
                <td>{p.a || '–'}</td>
                <td>{p.y || '–'}</td>
                <td>{p.r || '–'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if report.away.length === 0}
          <div class="empty">No recorded scorers for this side.</div>
        {/if}
      </div>
    </section>
  {/if}
</main>
