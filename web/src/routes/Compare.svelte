<script>
  import { loadBoard, buildAllClubs, buildHeadToHead } from '../lib/data.js';

  let { clubAId = '', clubBId = '' } = $props();

  let loading = $state(true);
  let error = $state('');
  let clubs = $state([]);
  let allGames = $state([]);

  let selA = $state('');
  let selB = $state('');

  // Search-as-you-type text for each combobox. Kept separate from selA/selB (the committed club
  // id) so typing can freely diverge from the last pick until the user chooses an option again.
  let searchA = $state('');
  let searchB = $state('');
  let openA = $state(false);
  let openB = $state(false);

  const nameOf = (id) => clubs.find((c) => c.clubId === id)?.name || '';

  $effect(() => {
    loadBoard()
      .then((b) => {
        clubs = buildAllClubs(b.allTeamStandings, b.championsByClub);
        allGames = b.allGames;
      })
      .catch((e) => (error = e.message || String(e)))
      .finally(() => (loading = false));
  });

  $effect(() => {
    // Seed the pickers from the route params once the club list is loaded (deep link support).
    if (!clubs.length) return;
    selA = clubAId;
    selB = clubBId;
    searchA = nameOf(clubAId);
    searchB = nameOf(clubBId);
  });

  // Up to 50 name matches, newest-typed-first-excluded club omitted so the same club can't be
  // picked on both sides.
  const filteredA = $derived.by(() => {
    const term = searchA.trim().toLowerCase();
    return clubs
      .filter((c) => c.clubId !== selB && (!term || c.name.toLowerCase().includes(term)))
      .slice(0, 50);
  });
  const filteredB = $derived.by(() => {
    const term = searchB.trim().toLowerCase();
    return clubs
      .filter((c) => c.clubId !== selA && (!term || c.name.toLowerCase().includes(term)))
      .slice(0, 50);
  });

  function pickA(c) { selA = c.clubId; searchA = c.name; openA = false; }
  function pickB(c) { selB = c.clubId; searchB = c.name; openB = false; }

  // On blur (including a click outside), close the list and snap the text back to the last
  // committed pick -- typing that never resolved to a selection shouldn't leave stray text behind.
  function blurA() { openA = false; searchA = nameOf(selA); }
  function blurB() { openB = false; searchB = nameOf(selB); }

  function keydownA(e) {
    if (e.key === 'Escape') { openA = false; searchA = nameOf(selA); e.currentTarget.blur(); }
    else if (e.key === 'Enter' && filteredA.length) { pickA(filteredA[0]); e.preventDefault(); }
  }
  function keydownB(e) {
    if (e.key === 'Escape') { openB = false; searchB = nameOf(selB); e.currentTarget.blur(); }
    else if (e.key === 'Enter' && filteredB.length) { pickB(filteredB[0]); e.preventDefault(); }
  }

  // Keep the address bar in sync so a comparison can be shared/bookmarked, without pushing a new
  // history entry per keystroke.
  $effect(() => {
    if (!selA || !selB || selA === selB) return;
    const target = `#/compare/${selA}/${selB}`;
    if (location.hash !== target) history.replaceState(null, '', target);
  });

  const h2h = $derived.by(() => {
    if (!selA || !selB || selA === selB) return null;
    return buildHeadToHead(allGames, selA, selB);
  });

  const fmtDate = (iso) => {
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d)) return iso || '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
</script>

<div class="pagehead">
  <div class="wrap">
    <h1>Head-to-Head</h1>
    <div class="sub">Compare the all-time record between any two clubs</div>
  </div>
</div>

<main class="profile">
  {#if loading}
    <div class="status">Loading BDSL data&hellip;</div>
  {:else if error}
    <div class="status">Couldn&rsquo;t load data: {error}</div>
  {:else}
    <div class="leadctrl">
      <label>
        Club A
        <div class="combo">
          <input
            type="text"
            placeholder="Search clubs&hellip;"
            autocomplete="off"
            bind:value={searchA}
            onfocus={(e) => { openA = true; e.currentTarget.select(); }}
            oninput={() => (openA = true)}
            onblur={blurA}
            onkeydown={keydownA}
          />
          {#if openA}
            <ul class="combo-list">
              {#each filteredA as c (c.clubId)}
                <li>
                  <button type="button" class:on={c.clubId === selA} onmousedown={(e) => { e.preventDefault(); pickA(c); }}>
                    {c.name}
                  </button>
                </li>
              {:else}
                <li class="combo-empty">No clubs match.</li>
              {/each}
            </ul>
          {/if}
        </div>
      </label>
      <span class="vs">vs</span>
      <label>
        Club B
        <div class="combo">
          <input
            type="text"
            placeholder="Search clubs&hellip;"
            autocomplete="off"
            bind:value={searchB}
            onfocus={(e) => { openB = true; e.currentTarget.select(); }}
            oninput={() => (openB = true)}
            onblur={blurB}
            onkeydown={keydownB}
          />
          {#if openB}
            <ul class="combo-list">
              {#each filteredB as c (c.clubId)}
                <li>
                  <button type="button" class:on={c.clubId === selB} onmousedown={(e) => { e.preventDefault(); pickB(c); }}>
                    {c.name}
                  </button>
                </li>
              {:else}
                <li class="combo-empty">No clubs match.</li>
              {/each}
            </ul>
          {/if}
        </div>
      </label>
    </div>

    {#if !selA || !selB}
      <div class="status">Pick two clubs to see their head-to-head record.</div>
    {:else if selA === selB}
      <div class="status">Pick two different clubs.</div>
    {:else if !h2h}
      <div class="status">These clubs have never played each other.</div>
    {:else}
      <div class="stats">
        <div class="stat"><b>{h2h.played}</b><span>Meetings</span></div>
        <div class="stat"><b>{h2h.w}&ndash;{h2h.l}&ndash;{h2h.d}</b><span>{h2h.clubA.name} W&ndash;L&ndash;D</span></div>
        <div class="stat"><b>{h2h.gf}</b><span>{h2h.clubA.name} GF</span></div>
        <div class="stat"><b>{h2h.ga}</b><span>{h2h.clubA.name} GA</span></div>
        <div class="stat"><b>{h2h.gd > 0 ? '+' : ''}{h2h.gd}</b><span>Goal diff</span></div>
      </div>

      {#if h2h.biggestWinA || h2h.biggestWinB}
        <h2 class="section">Biggest Wins</h2>
        <div class="tablewrap">
          <table>
            <thead>
              <tr>
                <th class="l">Winner</th>
                <th class="l">Game</th>
                <th class="l mobhide">Date</th>
                <th>Score</th>
                <th>Margin</th>
              </tr>
            </thead>
            <tbody>
              {#each [h2h.biggestWinA, h2h.biggestWinB].filter(Boolean) as g}
                <tr>
                  <td class="l">{g.winner === 'A' ? h2h.clubA.name : h2h.clubB.name}</td>
                  <td class="l">
                    {g.home} vs {g.away}
                    {#if g.o35}<span class="o35tag">O35</span>{/if}
                    <div class="submeta"><span class="season">{fmtDate(g.date)} &middot; {g.seasonLabel} &middot; {g.competition}</span></div>
                  </td>
                  <td class="l mobhide">{fmtDate(g.date)} &middot; {g.seasonLabel}</td>
                  <td>{g.hs}&ndash;{g.as}</td>
                  <td class="pts">{g.margin}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      <h2 class="section">All Meetings</h2>
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l">Date</th>
              <th class="l mobhide">Season</th>
              <th class="l mobhide">Competition</th>
              <th class="l">Game</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {#each h2h.games as g}
              <tr>
                <td class="l">{fmtDate(g.date)}</td>
                <td class="l mobhide">{g.seasonLabel}</td>
                <td class="l mobhide">{g.competition}{#if g.o35}<span class="o35tag">O35</span>{/if}</td>
                <td class="l">{g.home} vs {g.away}</td>
                <td>{g.hs}&ndash;{g.as}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</main>

<style>
  /* Club A/B pickers, mirrors Season.svelte's .leadctrl. */
  .leadctrl {
    max-width: 1120px;
    margin: 0 auto 10px;
    padding: 0 14px;
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  .leadctrl label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--muted);
  }
  .combo { position: relative; }
  .combo input {
    font: inherit;
    font-size: 14px;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text);
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 5px 10px;
    width: 220px;
    max-width: 60vw;
  }
  .combo-list {
    position: absolute;
    z-index: 30;
    top: calc(100% + 4px);
    left: 0;
    width: 260px;
    max-width: 80vw;
    max-height: 280px;
    overflow-y: auto;
    margin: 0;
    padding: 6px;
    list-style: none;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, .22);
  }
  .combo-list li { margin: 0; }
  .combo-list button {
    display: block;
    width: 100%;
    text-align: left;
    font: inherit;
    font-size: 13.5px;
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text);
    background: none;
    border: none;
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
  }
  .combo-list button:hover { background: var(--hover); }
  .combo-list button.on { background: var(--hover); color: var(--navy2); }
  .combo-empty { padding: 8px 10px; font-size: 13px; font-weight: 400; color: var(--muted); }
  .leadctrl .vs { font-size: 12.5px; color: var(--muted); }
</style>
