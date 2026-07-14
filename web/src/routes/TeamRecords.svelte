<script>
  import { loadBoard, buildTeamRecords } from '../lib/data.js';
  import { hscroll } from '../lib/scrollShadow.js';

  let loading = $state(true);
  let error = $state('');
  let recs = $state(null);

  $effect(() => {
    loadBoard()
      .then((b) => (recs = buildTeamRecords(b.allTeamStandings, b.allGames)))
      .catch((e) => (error = e.message || String(e)))
      .finally(() => (loading = false));
  });

  // Season-total leaderboards: same row shape, one highlighted stat column each.
  const seasonBoards = $derived(recs ? [
    { key: 'gf', dir: 'high', title: 'Most Goals For', desc: 'Most goals scored across a single completed season.', rows: recs.mostGF },
    { key: 'gf', dir: 'low', title: 'Fewest Goals For', desc: 'Fewest goals scored across a completed season.', rows: recs.fewestGF },
    { key: 'ga', dir: 'high', title: 'Most Goals Against', desc: 'Most goals conceded across a single completed season.', rows: recs.mostGA },
    { key: 'ga', dir: 'low', title: 'Fewest Goals Against', desc: 'Stingiest defense — fewest goals conceded in a season.', rows: recs.fewestGA },
    { key: 'gd', dir: 'high', title: 'Best Goal Differential', desc: 'Largest goals-for minus goals-against margin in a season.', rows: recs.bestGD },
    { key: 'gd', dir: 'low', title: 'Worst Goal Differential', desc: 'Most lopsided negative margin in a season.', rows: recs.worstGD },
    { key: 'pts', dir: 'high', title: 'Most Points', desc: 'Most league points earned in a single season.', rows: recs.mostPts },
  ] : []);

  const fmtDate = (iso) => {
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d)) return iso || '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  // In-page jump nav: one button per section, in document order.
  const jumpLinks = $derived(recs ? [
    ...seasonBoards.map((s) => ({ id: slug(s.title), label: s.title })),
    { id: 'most-clean-sheets-season', label: 'Most Clean Sheets (Season)' },
    { id: 'most-clean-sheets-all-time', label: 'Most Clean Sheets (All-Time)' },
    { id: 'perfect-seasons', label: 'Perfect Seasons' },
    { id: 'winless-seasons', label: 'Winless Seasons' },
    { id: 'longest-winning-streak', label: 'Longest Winning Streak' },
    { id: 'longest-unbeaten-streak', label: 'Longest Unbeaten Streak' },
    { id: 'biggest-win', label: 'Biggest Win' },
    { id: 'highest-scoring-game', label: 'Highest Scoring Game' },
  ] : []);

  // scrollIntoView aligns the target to the viewport top, but the sticky jump nav then overlaps
  // it -- measure the nav's actual (row-count-dependent) height and offset the scroll by that.
  function jumpTo(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const nav = document.querySelector('.jumpnav');
    const navH = nav ? nav.getBoundingClientRect().height : 0;
    const top = el.getBoundingClientRect().top + window.scrollY - navH - 10;
    window.scrollTo({ top, behavior: 'smooth' });
  }
</script>

<div class="pagehead">
  <div class="wrap">
    <h1>Team Records</h1>
    <div class="sub">Team records across BDSL league &amp; Over-35 league play &middot; cup results not included</div>
    <div class="sub detail" style="margin-top:3px">
      Season-total records (goals, differential, points, perfect/winless seasons) only count
      <b>completed</b> seasons, so the in-progress season can&rsquo;t claim a record on a partial
      schedule. Game-level records (biggest win, streaks) count every match already played.
    </div>
  </div>
</div>

{#if !loading && !error && jumpLinks.length}
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
    {#each seasonBoards as sec}
      <h2 class="section" id={slug(sec.title)}>{sec.title}</h2>
      <p class="recdesc">{sec.desc}</p>
      <section class="season">
        <div class="tablewrap">
          <table>
            <thead>
              <tr>
                <th class="l rank">#</th>
                <th class="l">Team</th>
                <th class="l mobhide">Season</th>
                <th class="mobhide">GP</th>
                <th class:act={sec.key === 'gf'}>GF</th>
                <th class:act={sec.key === 'ga'}>GA</th>
                <th class:act={sec.key === 'gd'}>GD</th>
                <th class:act={sec.key === 'pts'}>Pts</th>
              </tr>
            </thead>
            <tbody>
              {#each sec.rows as r, i}
                {@const rk = i + 1}
                <tr>
                  <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
                  <td class="l">
                    <a class="pname" href={`#/club/${r.clubId}`}>{r.name}</a>
                    {#if r.o35}<span class="o35tag">O35</span>{/if}
                    <div class="submeta">
                      <span class="season">{r.seasonLabel} &middot; {r.competition}</span>
                    </div>
                  </td>
                  <td class="l mobhide">{r.seasonLabel} &middot; {r.competition}</td>
                  <td class="mobhide">{r.gp}</td>
                  <td class:pts={sec.key === 'gf'}>{r.gf}</td>
                  <td class:pts={sec.key === 'ga'}>{r.ga}</td>
                  <td class:pts={sec.key === 'gd'}>{r.gd > 0 ? '+' : ''}{r.gd}</td>
                  <td class:pts={sec.key === 'pts'}>{r.pts}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if sec.rows.length === 0}
            <div class="empty">No completed seasons yet.</div>
          {/if}
        </div>
      </section>
    {/each}

    <h2 class="section" id="most-clean-sheets-season">Most Clean Sheets (Season)</h2>
    <p class="recdesc">Most games in a single completed season where the opponent was held scoreless.</p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l rank">#</th>
              <th class="l">Team</th>
              <th class="l mobhide">Season</th>
              <th class="mobhide">GP</th>
              <th>CS</th>
            </tr>
          </thead>
          <tbody>
            {#each recs.mostCleanSheets as r, i}
              {@const rk = i + 1}
              <tr>
                <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
                <td class="l">
                  <a class="pname" href={`#/club/${r.clubId}`}>{r.name}</a>
                  {#if r.o35}<span class="o35tag">O35</span>{/if}
                  <div class="submeta">
                    <span class="season">{r.seasonLabel} &middot; {r.competition}</span>
                  </div>
                </td>
                <td class="l mobhide">{r.seasonLabel} &middot; {r.competition}</td>
                <td class="mobhide">{r.gp}</td>
                <td class="pts">{r.cs}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if recs.mostCleanSheets.length === 0}
          <div class="empty">No completed seasons yet.</div>
        {/if}
      </div>
    </section>

    <h2 class="section" id="most-clean-sheets-all-time">Most Clean Sheets (All-Time)</h2>
    <p class="recdesc">Most career games where the opponent was held scoreless, spanning any number of seasons.</p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l rank">#</th>
              <th class="l">Team</th>
              <th class="mobhide">GP</th>
              <th>CS</th>
            </tr>
          </thead>
          <tbody>
            {#each recs.careerCleanSheets as r, i}
              {@const rk = i + 1}
              <tr>
                <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
                <td class="l">
                  <a class="pname" href={`#/club/${r.clubId}`}>{r.name}</a>
                  {#if r.o35}<span class="o35tag">O35</span>{/if}
                </td>
                <td class="mobhide">{r.gp}</td>
                <td class="pts">{r.cs}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if recs.careerCleanSheets.length === 0}
          <div class="empty">No clean sheets recorded yet.</div>
        {/if}
      </div>
    </section>

    <h2 class="section" id="perfect-seasons">Perfect Seasons</h2>
    <p class="recdesc">Every completed season a team finished with zero losses.</p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l">Team</th>
              <th class="l mobhide">Season</th>
              <th>GP</th>
              <th>W</th>
              <th>D</th>
              <th class="mobhide">GF</th>
              <th class="mobhide">GA</th>
              <th>Pts</th>
            </tr>
          </thead>
          <tbody>
            {#each recs.perfect as r}
              <tr>
                <td class="l">
                  <a class="pname" href={`#/club/${r.clubId}`}>{r.name}</a>
                  {#if r.o35}<span class="o35tag">O35</span>{/if}
                  <div class="submeta"><span class="season">{r.seasonLabel} &middot; {r.competition}</span></div>
                </td>
                <td class="l mobhide">{r.seasonLabel} &middot; {r.competition}</td>
                <td>{r.gp}</td>
                <td>{r.w}</td>
                <td>{r.d}</td>
                <td class="mobhide">{r.gf}</td>
                <td class="mobhide">{r.ga}</td>
                <td class="pts">{r.pts}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if recs.perfect.length === 0}
          <div class="empty">No unbeaten seasons yet.</div>
        {/if}
      </div>
    </section>

    <h2 class="section" id="winless-seasons">Winless Seasons</h2>
    <p class="recdesc">Every completed season a team finished with zero wins.</p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l">Team</th>
              <th class="l mobhide">Season</th>
              <th>GP</th>
              <th>L</th>
              <th>D</th>
              <th class="mobhide">GF</th>
              <th class="mobhide">GA</th>
              <th>Pts</th>
            </tr>
          </thead>
          <tbody>
            {#each recs.winless as r}
              <tr>
                <td class="l">
                  <a class="pname" href={`#/club/${r.clubId}`}>{r.name}</a>
                  {#if r.o35}<span class="o35tag">O35</span>{/if}
                  <div class="submeta"><span class="season">{r.seasonLabel} &middot; {r.competition}</span></div>
                </td>
                <td class="l mobhide">{r.seasonLabel} &middot; {r.competition}</td>
                <td>{r.gp}</td>
                <td>{r.l}</td>
                <td>{r.d}</td>
                <td class="mobhide">{r.gf}</td>
                <td class="mobhide">{r.ga}</td>
                <td class="pts">{r.pts}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if recs.winless.length === 0}
          <div class="empty">No winless seasons yet.</div>
        {/if}
      </div>
    </section>

    <h2 class="section" id="longest-winning-streak">Longest Winning Streak</h2>
    <p class="recdesc">Most consecutive league/O35 wins, spanning any number of seasons.</p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l rank">#</th>
              <th class="l">Team</th>
              <th class="l mobhide">Seasons</th>
              <th>Streak</th>
            </tr>
          </thead>
          <tbody>
            {#each recs.longestWinStreak as r, i}
              {@const rk = i + 1}
              {@const range = r.startLabel === r.endLabel ? r.startLabel : `${r.startLabel} – ${r.endLabel}`}
              <tr class:live={r.live}>
                <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
                <td class="l">
                  <a class="pname" href={`#/club/${r.clubId}`}>{r.name}</a>
                  {#if r.o35}<span class="o35tag">O35</span>{/if}
                  <div class="submeta"><span class="season">{range}</span></div>
                </td>
                <td class="l mobhide">{range}</td>
                <td class="pts">{r.len} games</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <h2 class="section" id="longest-unbeaten-streak">Longest Unbeaten Streak</h2>
    <p class="recdesc">Most consecutive league/O35 games without a loss (wins + draws), spanning any number of seasons.</p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l rank">#</th>
              <th class="l">Team</th>
              <th class="l mobhide">Seasons</th>
              <th>Streak</th>
            </tr>
          </thead>
          <tbody>
            {#each recs.longestUnbeatenStreak as r, i}
              {@const rk = i + 1}
              {@const range = r.startLabel === r.endLabel ? r.startLabel : `${r.startLabel} – ${r.endLabel}`}
              <tr class:live={r.live}>
                <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
                <td class="l">
                  <a class="pname" href={`#/club/${r.clubId}`}>{r.name}</a>
                  {#if r.o35}<span class="o35tag">O35</span>{/if}
                  <div class="submeta"><span class="season">{range}</span></div>
                </td>
                <td class="l mobhide">{range}</td>
                <td class="pts">{r.len} games</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <h2 class="section" id="biggest-win">Biggest Win</h2>
    <p class="recdesc">Largest margin of victory in a single league/O35 game.</p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l rank">#</th>
              <th class="l">Game</th>
              <th class="l mobhide">Date</th>
              <th class="l mobhide">Competition</th>
              <th>Score</th>
              <th>Margin</th>
            </tr>
          </thead>
          <tbody>
            {#each recs.biggestWins as g, i}
              {@const rk = i + 1}
              {@const homeWon = g.hs > g.as}
              <tr class:live={g.live}>
                <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
                <td class="l">
                  <span class:pts={homeWon}>{g.home}</span> vs <span class:pts={!homeWon}>{g.away}</span>
                  {#if g.o35}<span class="o35tag">O35</span>{/if}
                  <div class="submeta"><span class="season">{fmtDate(g.date)} &middot; {g.seasonLabel} &middot; {g.competition}</span></div>
                </td>
                <td class="l mobhide">{fmtDate(g.date)} &middot; {g.seasonLabel}</td>
                <td class="l mobhide">{g.competition}</td>
                <td>{g.hs}&ndash;{g.as}</td>
                <td class="pts">{g.margin}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if recs.biggestWins.length === 0}
          <div class="empty">No lopsided results yet.</div>
        {/if}
      </div>
    </section>

    <h2 class="section" id="highest-scoring-game">Highest Scoring Game</h2>
    <p class="recdesc">Most combined goals in a single league/O35 game.</p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l rank">#</th>
              <th class="l">Game</th>
              <th class="l mobhide">Date</th>
              <th class="l mobhide">Competition</th>
              <th>Score</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {#each recs.highestScoring as g, i}
              {@const rk = i + 1}
              <tr class:live={g.live}>
                <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
                <td class="l">
                  {g.home} vs {g.away}
                  {#if g.o35}<span class="o35tag">O35</span>{/if}
                  <div class="submeta"><span class="season">{fmtDate(g.date)} &middot; {g.seasonLabel} &middot; {g.competition}</span></div>
                </td>
                <td class="l mobhide">{fmtDate(g.date)} &middot; {g.seasonLabel}</td>
                <td class="l mobhide">{g.competition}</td>
                <td>{g.hs}&ndash;{g.as}</td>
                <td class="pts">{g.total}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}
</main>
