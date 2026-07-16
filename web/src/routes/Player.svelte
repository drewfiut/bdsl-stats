<script>
  import { loadBoard, buildProfile, buildPlayerMatchStats } from '../lib/data.js';

  let { personKey } = $props();

  let loading = $state(true);
  let error = $state('');
  let profile = $state(null);
  let matchStats = $state(null);

  $effect(() => {
    // re-run whenever the routed personKey changes
    const key = personKey;
    loading = true;
    error = '';
    profile = null;
    matchStats = null;
    loadBoard()
      .then((b) => {
        profile = buildProfile(b.allPlayers, b.playersRegistry, key);
        matchStats = buildPlayerMatchStats(b.allGameStats, key);
      })
      .catch((e) => (error = e.message || String(e)))
      .finally(() => (loading = false));
  });

  const ageLabel = (age) => (age == null ? 'Age unknown' : `Age ${age}`);

  const fmtDate = (iso) => {
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d)) return iso || '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
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
          <div class="slabel"><a class="pname" href={`#/season/${s.sid}`}>{s.label}</a></div>
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
                <tr class:live={s.live}>
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

    {#if matchStats && matchStats.rows.length}
      <h2 class="section">Scoring &amp; discipline</h2>
      <p class="recdesc">
        Per-game scorers are recorded from manager-entered match reports and may be incomplete
        for some games/seasons &mdash; treat these as recorded events, not a complete log.
      </p>
      <section class="season">
        <div class="stats">
          <div class="stat"><b>{matchStats.summary.hatTricks}</b><span>Hat-tricks</span></div>
          <div class="stat"><b>{matchStats.summary.multiGoalGames}</b><span>Multi-goal games</span></div>
          <div class="stat"><b>{matchStats.summary.bestGoalGame}</b><span>Best single game</span></div>
          <div class="stat"><b>{matchStats.summary.totalYellow}</b><span>Yellow cards</span></div>
          <div class="stat"><b>{matchStats.summary.totalRed}</b><span>Red cards</span></div>
        </div>
        <div class="tablewrap">
          <table>
            <thead>
              <tr>
                <th class="l">Date</th>
                <th class="l">Competition</th>
                <th class="l">Side</th>
                <th>G</th>
                <th>A</th>
                <th>Y</th>
                <th>R</th>
              </tr>
            </thead>
            <tbody>
              {#each matchStats.rows as m}
                <tr>
                  <td class="l">
                    <a class="pname" href={`#/game/${m.sid}/${m.game_key}`}>{fmtDate(m.date)}</a>
                  </td>
                  <td class="l">{m.competition}{#if m.round_label} &middot; {m.round_label}{/if}</td>
                  <td class="l">{m.side === 'home' ? 'Home' : 'Away'}</td>
                  <td>{m.g || '–'}</td>
                  <td>{m.a || '–'}</td>
                  <td>{m.y || '–'}</td>
                  <td>{m.r || '–'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}
  {/if}
</main>
