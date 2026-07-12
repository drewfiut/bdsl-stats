<script>
  import { loadBoard, buildChampions } from '../lib/data.js';
  import { hscroll } from '../lib/scrollShadow.js';

  let loading = $state(true);
  let error = $state('');
  let data = $state(null);
  let open = $state(new Set()); // leaderboard clubIds currently expanded

  $effect(() => {
    loadBoard()
      .then((b) => (data = buildChampions(b.allCompetitions, b.allTeamStandings)))
      .catch((e) => (error = e.message || String(e)))
      .finally(() => (loading = false));
  });

  const GROUP_LABEL = { league: 'League', over35: 'Over-35', cup: 'Cups' };

  // Collapse consecutive same-group columns into { group, label, span } for a super-header row.
  const groupSpans = $derived.by(() => {
    if (!data) return [];
    const spans = [];
    for (const c of data.grid.columns) {
      const last = spans[spans.length - 1];
      if (last && last.group === c.group) last.span += 1;
      else spans.push({ group: c.group, label: GROUP_LABEL[c.group] || c.group, span: 1 });
    }
    return spans;
  });

  const jumpLinks = [
    { id: 'roll-of-honor', label: 'Roll of Honor' },
    { id: 'most-decorated-clubs', label: 'Most Decorated Clubs' },
  ];

  // scrollIntoView aligns the target to the viewport top, but the sticky jump nav then overlaps
  // it -- measure the nav's actual height and offset the scroll by that (matches TeamRecords.svelte).
  function jumpTo(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const nav = document.querySelector('.jumpnav');
    const navH = nav ? nav.getBoundingClientRect().height : 0;
    const top = el.getBoundingClientRect().top + window.scrollY - navH - 10;
    window.scrollTo({ top, behavior: 'smooth' });
  }

  function toggle(clubId) {
    const next = new Set(open);
    next.has(clubId) ? next.delete(clubId) : next.add(clubId);
    open = next;
  }

  const droughtText = (d) => (d === 0 ? 'Reigning' : `${d} season${d === 1 ? '' : 's'}`);
</script>

<div class="pagehead">
  <div class="wrap">
    <h1>Champions</h1>
    <div class="sub">Every division, Over-35 and cup champion by season</div>
    <div class="sub detail" style="margin-top:3px">
      The champion shown is the playoff (CHMP) winner, which can differ from the team that
      topped the regular-season table.
    </div>
  </div>
</div>

{#if !loading && !error}
  <nav class="jumpnav">
    <div class="wrap" use:hscroll>
      {#each jumpLinks as j}
        <button onclick={() => jumpTo(j.id)}>{j.label}</button>
      {/each}
    </div>
    <span class="scrollarrow left" aria-hidden="true">&#9666;</span>
    <span class="scrollarrow right" aria-hidden="true">&#9656;</span>
  </nav>
{/if}

<main>
  {#if loading}
    <div class="status">Loading BDSL data&hellip;</div>
  {:else if error}
    <div class="status">Couldn&rsquo;t load data: {error}</div>
  {:else}
    <h2 class="section" id="roll-of-honor">Roll of Honor</h2>
    <p class="recdesc">Champion(s) of every league division, Over-35 competition and cup, season by season. Blank means that competition didn&rsquo;t run that season.</p>
    <section class="season">
      <div class="tablewrap">
        <table class="rollcall">
          <thead>
            <tr>
              <th class="l" rowspan="2">Season</th>
              {#each groupSpans as g}
                <th class="l" colspan={g.span}>{g.label}</th>
              {/each}
            </tr>
            <tr>
              {#each data.grid.columns as col}
                <th class="l">{col.label}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each data.grid.rows as row}
              <tr class:live={row.live}>
                <td class="l" class:live={row.live}>
                  {row.label}
                </td>
                {#each data.grid.columns as col}
                  {@const cell = row.cells[col.key]}
                  <td class="l">
                    {#if cell && cell.undecided}
                      <span class="tbd">TBD</span>
                    {:else if cell && cell.champions}
                      {#each cell.champions as champ}
                        <a class="pname champcell" href={`#/club/${champ.clubId}`}>
                          <span class="trophy">&#127942;</span>{champ.name}
                        </a>
                        {#if champ.subLabel}<div class="sublabel">{champ.subLabel}</div>{/if}
                      {/each}
                    {/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
        {#if data.grid.rows.length === 0}
          <div class="empty">No champions recorded yet.</div>
        {/if}
      </div>
    </section>

    <h2 class="section" id="most-decorated-clubs">Most Decorated Clubs</h2>
    <p class="recdesc">All-time title counts across league, Over-35 and cup competitions, ranked by total. Click a row for the full title history.</p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l rank">#</th>
              <th class="l">Club</th>
              <th>Total</th>
              <th class="mobhide">League</th>
              <th class="mobhide">O35</th>
              <th class="mobhide">Cup</th>
              <th class="l mobhide">Last</th>
              <th class="mobhide">Drought</th>
              <th style="width:14px"></th>
            </tr>
          </thead>
          <tbody>
            {#each data.leaderboard as r, i}
              {@const rk = i + 1}
              <tr class="main" class:open={open.has(r.clubId)} onclick={() => toggle(r.clubId)}>
                <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
                <td class="l">
                  <a class="pname" href={`#/club/${r.clubId}`} onclick={(e) => e.stopPropagation()}>{r.name}</a>
                  <div class="submeta">
                    <span class="season">{r.total} title{r.total === 1 ? '' : 's'} &middot; last {r.lastLabel} &middot; {droughtText(r.drought)}</span>
                  </div>
                </td>
                <td class="pts">{r.total}</td>
                <td class="mobhide">{r.league || '–'}</td>
                <td class="mobhide">{r.over35 || '–'}</td>
                <td class="mobhide">{r.cup || '–'}</td>
                <td class="l mobhide">{r.lastLabel}</td>
                <td class="mobhide" class:pts={r.drought === 0}>{droughtText(r.drought)}</td>
                <td><span class="caret">&#9654;</span></td>
              </tr>
              {#if open.has(r.clubId)}
                <tr class="detail">
                  <td colspan="9">
                    <div class="box">
                      <div class="brk titlebrk">
                        <div class="h">Season</div><div class="h">Competition</div>
                        {#each r.titles as t}
                          {@const titleLive = t.sid === data.grid.rows[0]?.sid && data.grid.rows[0]?.live}
                          <div class:live={titleLive}>{t.label}</div>
                          <div class:live={titleLive}><span class="trophy">&#127942;</span>{t.competition}</div>
                        {/each}
                      </div>
                    </div>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
        {#if data.leaderboard.length === 0}
          <div class="empty">No champions recorded yet.</div>
        {/if}
      </div>
    </section>
  {/if}
</main>
