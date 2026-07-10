<script>
  import { loadBoard, POINTS_PER_GOAL, POINTS_PER_ASSIST } from '../lib/data.js';

  // Cap rows injected into the DOM so 12 seasons stay snappy; search filters the full set
  // first, so anyone can still reach a specific player/season (render_html.DISPLAY_CAP).
  const CAP = 500;

  let loading = $state(true);
  let error = $state('');
  let players = $state([]);
  let seasonLabels = $state([]);
  let dataAsOf = $state('');

  // filter/sort state (render_html controls)
  let sortKey = $state('pts');
  let season = $state('');
  let search = $state('');
  let scorersOnly = $state(true);
  let open = $state(new Set()); // indices (into the displayed list) currently expanded

  const fmtDate = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return iso || '';
    const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${date} at ${time}`;
  };

  $effect(() => {
    loadBoard()
      .then((b) => {
        players = b.players;
        seasonLabels = b.seasonLabels;
        dataAsOf = b.dataAsOf;
      })
      .catch((e) => (error = e.message || String(e)))
      .finally(() => (loading = false));
  });

  // ---- derived header meta ----
  const seasonRange = $derived(
    seasonLabels.length >= 2
      ? `${seasonLabels[seasonLabels.length - 1]} – ${seasonLabels[0]}`
      : (seasonLabels[0] || '')
  );
  const nScorers = $derived(players.filter((p) => p.pts > 0).length);

  // ---- derived, filtered + sorted + capped list (render_html.render) ----
  const filtered = $derived.by(() => {
    const term = search.trim().toLowerCase();
    let list = players.filter((p) => {
      if (scorersOnly && p.pts <= 0) return false;
      if (season && p.season !== season) return false;
      if (!term) return true;
      if (p.name.toLowerCase().includes(term)) return true;
      return p.teams.some((t) => t.toLowerCase().includes(term));
    });
    list.sort((x, y) =>
      (y[sortKey] - x[sortKey]) || (y.g - x.g) || (y.a - x.a) ||
      x.name.localeCompare(y.name) || x.season.localeCompare(y.season));
    return list;
  });
  const total = $derived(filtered.length);
  const shown = $derived(total > CAP ? filtered.slice(0, CAP) : filtered);

  // Reset expanded rows whenever the displayed set changes (matches the old full re-render).
  $effect(() => {
    void sortKey; void season; void search; void scorersOnly;
    open = new Set();
  });

  function toggle(i) {
    const next = new Set(open);
    next.has(i) ? next.delete(i) : next.add(i);
    open = next;
  }

  const ga = (pair) => {
    const [g, a] = pair;
    return { g, a, empty: !g && !a };
  };
</script>

<div class="pagehead">
  <div class="wrap">
    <h1>Best Single Seasons</h1>
    <div class="sub">Every player&rsquo;s single-season totals across all competitions &middot; {seasonRange}</div>
    <div class="sub detail" style="margin-top:3px">
      Each row is one player in one season (league + cups + Over-35 combined). The in-progress
      season is <b style="color:var(--gold)">highlighted</b> &mdash; current as of <b>{fmtDate(dataAsOf)}</b>.
      Click a player&rsquo;s name for their full profile.
    </div>
    <div class="stats">
      <div class="stat"><b>{players.length}</b><span>Player-seasons</span></div>
      <div class="stat"><b>{seasonLabels.length}</b><span>Seasons</span></div>
      <div class="stat"><b>{nScorers}</b><span>On the scoresheet</span></div>
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
      <div class="tabs">
        <button class:on={sortKey === 'pts'} onclick={() => (sortKey = 'pts')}>Points</button>
        <button class:on={sortKey === 'g'} onclick={() => (sortKey = 'g')}>Goals</button>
        <button class:on={sortKey === 'a'} onclick={() => (sortKey = 'a')}>Assists</button>
      </div>
      <select id="season" title="Filter by season" bind:value={season}>
        <option value="">All seasons</option>
        {#each seasonLabels as l}<option>{l}</option>{/each}
      </select>
      <input type="search" placeholder="Filter by player or team&hellip;" autocomplete="off" bind:value={search} />
      <label class="toggle"><input type="checkbox" bind:checked={scorersOnly} /> Scorers only</label>
    </div>

    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th class="l rank">#</th>
            <th class="l">Player</th>
            <th class="l mobhide">Season</th>
            <th class="l mobhide">Team(s)</th>
            <th class="sortable" class:act={sortKey === 'g'} onclick={() => (sortKey = 'g')}>G</th>
            <th class="sortable" class:act={sortKey === 'a'} onclick={() => (sortKey = 'a')}>A</th>
            <th class="sortable" class:act={sortKey === 'pts'} onclick={() => (sortKey = 'pts')}>Pts</th>
            <th class="mobhide">GP</th>
            <th class="mobhide" title="League goals / assists">Lg</th>
            <th class="mobhide" title="Cup goals / assists">Cup</th>
            <th class="mobhide" title="Over-35 goals / assists">O35</th>
            <th style="width:14px"></th>
          </tr>
        </thead>
        <tbody>
          {#each shown as p, i (i)}
            {@const rk = i + 1}
            <tr class="main" class:live={p.live} class:open={open.has(i)} onclick={() => toggle(i)}>
              <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
              <td class="l">
                <a class="pname" href={`#/player/${p.pk}`} onclick={(e) => e.stopPropagation()}>{p.name}</a>
                <div class="submeta">
                  <span class="season">{p.season}</span>{#if p.live}<span class="livetag">In progress</span>{/if}{#if p.teams.length}<span class="teams">&middot; {p.teams.join(', ')}</span>{/if}
                </div>
              </td>
              <td class="l season mobhide">{p.season}{#if p.live}<span class="livetag">In progress</span>{/if}</td>
              <td class="l teams mobhide">{p.teams.join(', ')}</td>
              <td class="g">{#if p.g}{p.g}{:else}<span class="z">0</span>{/if}</td>
              <td class="a">{#if p.a}{p.a}{:else}<span class="z">0</span>{/if}</td>
              <td class="pts">{p.pts}</td>
              <td class="mobhide">{p.gp}</td>
              {#each [p.lg, p.cup, p.o35] as pair}
                {@const c = ga(pair)}
                <td class="mobhide">
                  {#if c.empty}<span class="z">&ndash;</span>
                  {:else}{#if c.g}<span class="g">{c.g}</span>{:else}0{/if}<span class="z">/</span>{#if c.a}<span class="a">{c.a}</span>{:else}0{/if}{/if}
                </td>
              {/each}
              <td><span class="caret">&#9654;</span></td>
            </tr>
            {#if open.has(i)}
              <tr class="detail" class:live={p.live}>
                <td colspan="12">
                  <div class="box">
                    <div class="brk">
                      <div class="h">Competition</div><div class="h r">G</div><div class="h r">A</div><div class="h r">GP</div>
                      {#each p.comps as c}
                        <div>{c.c} <span class="cn">{c.t}</span></div>
                        <div class="r">{c.g || '–'}</div>
                        <div class="r">{c.a || '–'}</div>
                        <div class="r">{c.gp || '–'}</div>
                      {/each}
                    </div>
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
      {#if total === 0}
        <div class="empty">Nothing matches your filter.</div>
      {/if}
      {#if total > CAP}
        <div class="note">
          Showing the top {CAP} of {total} player-seasons &mdash; pick a season or search to narrow the list.
        </div>
      {/if}
    </div>
  {/if}
</main>

<footer>
  Points = {POINTS_PER_GOAL}&times;goals + {POINTS_PER_ASSIST}&times;assist, matching BDSL&rsquo;s official
  Points Leaders. Individual scoring exists from 2014 (league) / 2016 (cups). Data from public
  pages on bdsl.org.
</footer>
