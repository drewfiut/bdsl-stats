<script>
  import { loadBoard, buildProfile } from '../lib/data.js';

  let { personKey } = $props();

  let loading = $state(true);
  let error = $state('');
  let profile = $state(null);

  $effect(() => {
    // re-run whenever the routed personKey changes
    const key = personKey;
    loading = true;
    error = '';
    profile = null;
    loadBoard()
      .then((b) => {
        profile = buildProfile(b.allPlayers, b.playersRegistry, key);
      })
      .catch((e) => (error = e.message || String(e)))
      .finally(() => (loading = false));
  });

  const ageLabel = (age) => (age == null ? 'Age unknown' : `Age ${age}`);
</script>

<main class="profile">
  {#if loading}
    <div class="status">Loading player&hellip;</div>
  {:else if error}
    <div class="status">Couldn&rsquo;t load data: {error}</div>
  {:else if !profile}
    <div class="status">
      Player not found. <a href="#/best-single-seasons">Back to the leaderboard</a>.
    </div>
  {:else}
    <div class="phead">
      <div class="wrap">
        <h1>{profile.name}</h1>
        <div class="sub">{ageLabel(profile.age)}</div>
        <div class="stats">
          <div class="stat"><b>{profile.career.g}</b><span>Goals</span></div>
          <div class="stat"><b>{profile.career.a}</b><span>Assists</span></div>
          <div class="stat"><b>{profile.career.pts}</b><span>Points</span></div>
          <div class="stat"><b>{profile.career.gp}</b><span>Games played</span></div>
          <div class="stat"><b>{profile.career.seasons}</b><span>Seasons</span></div>
          <div class="stat"><b>{profile.career.comps}</b><span>Competitions</span></div>
        </div>
      </div>
    </div>

    <h2 class="section">Competitions by season</h2>
    {#each profile.seasons as s}
      <section class="season">
        <div class="seasonhead" class:live={s.live}>
          <div class="slabel">{s.label}{#if s.live}<span class="livetag">In progress</span>{/if}</div>
          <div class="sagg">
            <span><b>{s.agg.g}</b> G</span>
            <span><b>{s.agg.a}</b> A</span>
            <span><b>{s.agg.pts}</b> Pts</span>
            <span><b>{s.agg.gp}</b> GP</span>
          </div>
        </div>
        <div class="tablewrap">
          <table>
            <thead>
              <tr>
                <th class="l">Competition</th>
                <th class="l">Team</th>
                <th>G</th>
                <th>A</th>
                <th>GP</th>
              </tr>
            </thead>
            <tbody>
              {#each s.comps as c}
                <tr>
                  <td class="l">{c.c}</td>
                  <td class="l">{c.t}</td>
                  <td>{c.g || '–'}</td>
                  <td>{c.a || '–'}</td>
                  <td>{c.gp || '–'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/each}
  {/if}
</main>
