<script>
  import { loadBoard, buildPlayerRecords, buildChampionAgeRecords, buildCareerShapeRecords } from '../lib/data.js';
  import { hscroll } from '../lib/scrollShadow.js';

  let loading = $state(true);
  let error = $state('');
  let recs = $state(null);
  let champRecs = $state(null);
  let shapeRecs = $state(null);

  $effect(() => {
    loadBoard()
      .then((b) => {
        recs = buildPlayerRecords(b.allPlayers, b.playersRegistry);
        champRecs = buildChampionAgeRecords(b.allCompetitions, b.allPlayers, b.playersRegistry);
        shapeRecs = buildCareerShapeRecords(b.allPlayers, b.playersRegistry, b.allTeamStandings, b.allCompetitions);
      })
      .catch((e) => (error = e.message || String(e)))
      .finally(() => (loading = false));
  });

  // Career leaderboards: same row shape, one highlighted stat column each.
  const careerBoards = $derived(recs ? [
    { key: 'g', title: 'Career Goals', desc: 'Most goals scored across every competition (league, cups and Over-35) in a BDSL career.', rows: recs.topGoals },
    { key: 'a', title: 'Career Assists', desc: 'Most assists across every competition in a BDSL career.', rows: recs.topAssists },
    { key: 'pts', title: 'Career Points', desc: 'Most career points (goals × 2 + assists) across every competition.', rows: recs.topPoints },
    { key: 'gp', title: 'Career Games Played', desc: 'Most games played across every competition in a BDSL career.', rows: recs.mostGP },
    { key: 'seasons', title: 'Most Seasons Played', desc: 'Most distinct BDSL seasons appeared in.', rows: recs.mostSeasons },
  ] : []);

  // Best goals-per-game: interactive min-GP filter so small sample sizes don't dominate.
  const GP_OPTIONS = [10, 20, 30, 50];
  let minGp = $state(25);

  const bestGpg = $derived.by(() => {
    if (!recs) return [];
    return recs.careerList
      .filter((p) => p.gp >= minGp)
      .slice()
      .sort((a, b) => b.gpg - a.gpg || b.g - a.g || a.name.localeCompare(b.name))
      .slice(0, 10);
  });

  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  // In-page jump nav: one button per section, in document order.
  const jumpLinks = $derived(recs ? [
    ...careerBoards.map((s) => ({ id: slug(s.title), label: s.title })),
    { id: 'best-goals-per-game', label: 'Best Goals per Game' },
    { id: 'golden-boot', label: 'Golden Boot' },
    { id: 'youngest-scorer', label: 'Youngest Scorer' },
    { id: 'oldest-scorer', label: 'Oldest Scorer' },
    { id: 'oldest-player-to-appear', label: 'Oldest Player to Appear' },
    { id: 'youngest-champion', label: 'Youngest Champion' },
    { id: 'oldest-champion', label: 'Oldest Champion' },
    { id: 'one-club-players', label: 'One-Club Players' },
    { id: 'journeymen', label: 'Journeymen' },
    { id: 'longest-career-span', label: 'Longest Career Span' },
    { id: 'longest-gap-between-appearances', label: 'Longest Gap Between Appearances' },
    { id: 'most-cup-goals', label: 'Most Cup Goals' },
    { id: 'triple-crown-seasons', label: 'Triple Crown Seasons' },
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
    <h1>Player Records</h1>
    <div class="sub">All-time individual leaderboards &middot; career totals span league, cups and Over-35 play</div>
    <div class="sub detail" style="margin-top:3px">
      Ages are computed as of each season (July&nbsp;1) from registered birthdates and may be
      approximate; the in-progress season&rsquo;s career and Golden Boot totals are provisional.
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
    {#each careerBoards as sec}
      <h2 class="section" id={slug(sec.title)}>{sec.title}</h2>
      <p class="recdesc">{sec.desc}</p>
      <section class="season">
        <div class="tablewrap">
          <table>
            <thead>
              <tr>
                <th class="l rank">#</th>
                <th class="l">Player</th>
                <th class:act={sec.key === 'g'}>G</th>
                <th class:act={sec.key === 'a'}>A</th>
                <th class:act={sec.key === 'pts'}>Pts</th>
                <th class:act={sec.key === 'gp'}>GP</th>
                <th class="mobhide" class:act={sec.key === 'seasons'}>Seasons</th>
              </tr>
            </thead>
            <tbody>
              {#each sec.rows as r, i}
                {@const rk = i + 1}
                <tr>
                  <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
                  <td class="l">
                    <a class="pname" href={`#/player/${r.pk}`}>{r.name}</a>
                  </td>
                  <td class:pts={sec.key === 'g'}>{r.g}</td>
                  <td class:pts={sec.key === 'a'}>{r.a}</td>
                  <td class:pts={sec.key === 'pts'}>{r.pts}</td>
                  <td class:pts={sec.key === 'gp'}>{r.gp}</td>
                  <td class="mobhide" class:pts={sec.key === 'seasons'}>{r.seasons}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if sec.rows.length === 0}
            <div class="empty">No players recorded yet.</div>
          {/if}
        </div>
      </section>
    {/each}

    <h2 class="section" id="best-goals-per-game">Best Goals per Game</h2>
    <p class="recdesc">Highest career goals-per-game ratio among players meeting a minimum games-played threshold.</p>
    <div class="leadctrl">
      <label>
        Min. GP
        <select bind:value={minGp}>
          {#each GP_OPTIONS as opt}
            <option value={opt}>{opt}+</option>
          {/each}
        </select>
      </label>
    </div>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l rank">#</th>
              <th class="l">Player</th>
              <th>G/GP</th>
              <th class="mobhide">G</th>
              <th class="mobhide">GP</th>
            </tr>
          </thead>
          <tbody>
            {#each bestGpg as r, i}
              {@const rk = i + 1}
              <tr>
                <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
                <td class="l"><a class="pname" href={`#/player/${r.pk}`}>{r.name}</a></td>
                <td class="pts">{r.gpg.toFixed(2)}</td>
                <td class="mobhide">{r.g}</td>
                <td class="mobhide">{r.gp}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if bestGpg.length === 0}
          <div class="empty">No players meet this GP threshold yet.</div>
        {/if}
      </div>
    </section>

    <h2 class="section" id="golden-boot">Golden Boot</h2>
    <p class="recdesc">The top scorer(s) in every league and Over-35 division, by season. Cups have no division and aren&rsquo;t included.</p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l">Season</th>
              <th class="l">Division</th>
              <th class="l">Winner(s)</th>
              <th>Goals</th>
            </tr>
          </thead>
          <tbody>
            {#each recs.goldenBoots as gb}
              <tr class:live={gb.live}>
                <td class="l">{gb.seasonLabel}</td>
                <td class="l">{gb.division}</td>
                <td class="l">
                  {#each gb.winners as w, i}
                    {#if i > 0}, {/if}<a class="pname" href={`#/player/${w.pk}`}>{w.name}</a>
                  {/each}
                </td>
                <td class="pts">{gb.winners[0]?.g}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if recs.goldenBoots.length === 0}
          <div class="empty">No division scoring recorded yet.</div>
        {/if}
      </div>
    </section>

    <h2 class="section" id="youngest-scorer">Youngest Scorer</h2>
    <p class="recdesc">Youngest age at which a player scored a goal in a BDSL season.</p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l rank">#</th>
              <th class="l">Player</th>
              <th>Age</th>
              <th class="l mobhide">Season</th>
              <th>G</th>
            </tr>
          </thead>
          <tbody>
            {#each recs.youngestScorers as r, i}
              {@const rk = i + 1}
              <tr>
                <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
                <td class="l">
                  <a class="pname" href={`#/player/${r.pk}`}>{r.name}</a>
                  <div class="submeta"><span class="season">{r.seasonLabel}</span></div>
                </td>
                <td class="pts">{r.age}</td>
                <td class="l mobhide">{r.seasonLabel}</td>
                <td>{r.g}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if recs.youngestScorers.length === 0}
          <div class="empty">No qualifying birthdates on record.</div>
        {/if}
      </div>
    </section>

    <h2 class="section" id="oldest-scorer">Oldest Scorer</h2>
    <p class="recdesc">Oldest age at which a player scored a goal in a BDSL season.</p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l rank">#</th>
              <th class="l">Player</th>
              <th>Age</th>
              <th class="l mobhide">Season</th>
              <th>G</th>
            </tr>
          </thead>
          <tbody>
            {#each recs.oldestScorers as r, i}
              {@const rk = i + 1}
              <tr>
                <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
                <td class="l">
                  <a class="pname" href={`#/player/${r.pk}`}>{r.name}</a>
                  <div class="submeta"><span class="season">{r.seasonLabel}</span></div>
                </td>
                <td class="pts">{r.age}</td>
                <td class="l mobhide">{r.seasonLabel}</td>
                <td>{r.g}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if recs.oldestScorers.length === 0}
          <div class="empty">No qualifying birthdates on record.</div>
        {/if}
      </div>
    </section>

    <h2 class="section" id="oldest-player-to-appear">Oldest Player to Appear</h2>
    <p class="recdesc">Oldest age at which a player appeared in a BDSL match.</p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l rank">#</th>
              <th class="l">Player</th>
              <th>Age</th>
              <th class="l mobhide">Season</th>
              <th>G</th>
            </tr>
          </thead>
          <tbody>
            {#each recs.oldestAppearances as r, i}
              {@const rk = i + 1}
              <tr>
                <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
                <td class="l">
                  <a class="pname" href={`#/player/${r.pk}`}>{r.name}</a>
                  <div class="submeta"><span class="season">{r.seasonLabel}</span></div>
                </td>
                <td class="pts">{r.age}</td>
                <td class="l mobhide">{r.seasonLabel}</td>
                <td>{r.g}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if recs.oldestAppearances.length === 0}
          <div class="empty">No qualifying birthdates on record.</div>
        {/if}
      </div>
    </section>

    <h2 class="section" id="youngest-champion">Youngest Champion</h2>
    <p class="recdesc">Youngest age at which a player actually appeared for a title-winning club.</p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l rank">#</th>
              <th class="l">Player</th>
              <th>Age</th>
              <th class="l mobhide">Season</th>
              <th class="l">Title</th>
            </tr>
          </thead>
          <tbody>
            {#each champRecs?.youngestChampions || [] as r, i}
              {@const rk = i + 1}
              <tr>
                <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
                <td class="l">
                  <a class="pname" href={`#/player/${r.pk}`}>{r.name}</a>
                  <div class="submeta"><span class="season">{r.seasonLabel}</span></div>
                </td>
                <td class="pts">{r.age}</td>
                <td class="l mobhide">{r.seasonLabel}</td>
                <td class="l">{r.competition} &middot; <a class="pname" href={`#/club/${r.clubId}`}>{r.clubName}</a></td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if !champRecs || champRecs.youngestChampions.length === 0}
          <div class="empty">No qualifying birthdates on record.</div>
        {/if}
      </div>
    </section>

    <h2 class="section" id="oldest-champion">Oldest Champion</h2>
    <p class="recdesc">Oldest age at which a player actually appeared for a title-winning club.</p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l rank">#</th>
              <th class="l">Player</th>
              <th>Age</th>
              <th class="l mobhide">Season</th>
              <th class="l">Title</th>
            </tr>
          </thead>
          <tbody>
            {#each champRecs?.oldestChampions || [] as r, i}
              {@const rk = i + 1}
              <tr>
                <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
                <td class="l">
                  <a class="pname" href={`#/player/${r.pk}`}>{r.name}</a>
                  <div class="submeta"><span class="season">{r.seasonLabel}</span></div>
                </td>
                <td class="pts">{r.age}</td>
                <td class="l mobhide">{r.seasonLabel}</td>
                <td class="l">{r.competition} &middot; <a class="pname" href={`#/club/${r.clubId}`}>{r.clubName}</a></td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if !champRecs || champRecs.oldestChampions.length === 0}
          <div class="empty">No qualifying birthdates on record.</div>
        {/if}
      </div>
    </section>

    <h2 class="section" id="one-club-players">One-Club Players</h2>
    <p class="recdesc">Most games played by a player who has only ever appeared for a single BDSL club.</p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l rank">#</th>
              <th class="l">Player</th>
              <th class="l">Club</th>
              <th>GP</th>
              <th class="mobhide">Seasons</th>
            </tr>
          </thead>
          <tbody>
            {#each shapeRecs?.oneClubPlayers || [] as r, i}
              {@const rk = i + 1}
              <tr>
                <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
                <td class="l"><a class="pname" href={`#/player/${r.pk}`}>{r.name}</a></td>
                <td class="l">{r.clubName}</td>
                <td class="pts">{r.gp}</td>
                <td class="mobhide">{r.seasons}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if !shapeRecs || shapeRecs.oneClubPlayers.length === 0}
          <div class="empty">No qualifying players on record.</div>
        {/if}
      </div>
    </section>

    <h2 class="section" id="journeymen">Journeymen</h2>
    <p class="recdesc">Most distinct BDSL clubs a single player has appeared for.</p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l rank">#</th>
              <th class="l">Player</th>
              <th>Clubs</th>
              <th class="l mobhide">Clubs Played For</th>
              <th class="mobhide">GP</th>
            </tr>
          </thead>
          <tbody>
            {#each shapeRecs?.journeymen || [] as r, i}
              {@const rk = i + 1}
              <tr>
                <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
                <td class="l"><a class="pname" href={`#/player/${r.pk}`}>{r.name}</a></td>
                <td class="pts">{r.clubCount}</td>
                <td class="l mobhide">{r.clubNames.join(', ')}</td>
                <td class="mobhide">{r.gp}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if !shapeRecs || shapeRecs.journeymen.length === 0}
          <div class="empty">No qualifying players on record.</div>
        {/if}
      </div>
    </section>

    <h2 class="section" id="longest-career-span">Longest Career Span</h2>
    <p class="recdesc">Most BDSL seasons elapsed between a player&rsquo;s debut and their most recent appearance.</p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l rank">#</th>
              <th class="l">Player</th>
              <th>Seasons</th>
              <th class="l mobhide">Debut</th>
              <th class="l mobhide">Last Seen</th>
            </tr>
          </thead>
          <tbody>
            {#each shapeRecs?.longestSpans || [] as r, i}
              {@const rk = i + 1}
              <tr>
                <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
                <td class="l">
                  <a class="pname" href={`#/player/${r.pk}`}>{r.name}</a>
                  <div class="submeta"><span class="season">{r.debutLabel} &ndash; {r.finalLabel}</span></div>
                </td>
                <td class="pts">{r.span}</td>
                <td class="l mobhide">{r.debutLabel}</td>
                <td class="l mobhide">{r.finalLabel}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if !shapeRecs || shapeRecs.longestSpans.length === 0}
          <div class="empty">No qualifying players on record.</div>
        {/if}
      </div>
    </section>

    <h2 class="section" id="longest-gap-between-appearances">Longest Gap Between Appearances</h2>
    <p class="recdesc">Most BDSL seasons skipped between two appearances by the same player &mdash; the biggest comebacks.</p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l rank">#</th>
              <th class="l">Player</th>
              <th>Seasons Skipped</th>
              <th class="l mobhide">Before</th>
              <th class="l mobhide">After</th>
            </tr>
          </thead>
          <tbody>
            {#each shapeRecs?.longestGaps || [] as r, i}
              {@const rk = i + 1}
              <tr>
                <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
                <td class="l">
                  <a class="pname" href={`#/player/${r.pk}`}>{r.name}</a>
                  <div class="submeta"><span class="season">{r.gapBeforeLabel} &rarr; {r.gapAfterLabel}</span></div>
                </td>
                <td class="pts">{r.maxGap}</td>
                <td class="l mobhide">{r.gapBeforeLabel}</td>
                <td class="l mobhide">{r.gapAfterLabel}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if !shapeRecs || shapeRecs.longestGaps.length === 0}
          <div class="empty">No qualifying players on record.</div>
        {/if}
      </div>
    </section>

    <h2 class="section" id="most-cup-goals">Most Cup Goals</h2>
    <p class="recdesc">Most goals scored across every BDSL cup competition in a career.</p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l rank">#</th>
              <th class="l">Player</th>
              <th>Cup G</th>
              <th class="mobhide">Cup GP</th>
            </tr>
          </thead>
          <tbody>
            {#each shapeRecs?.topCupGoals || [] as r, i}
              {@const rk = i + 1}
              <tr>
                <td class="l rank" class:m1={rk === 1} class:m2={rk === 2} class:m3={rk === 3}>{rk}</td>
                <td class="l"><a class="pname" href={`#/player/${r.pk}`}>{r.name}</a></td>
                <td class="pts">{r.cupG}</td>
                <td class="mobhide">{r.cupGp}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if !shapeRecs || shapeRecs.topCupGoals.length === 0}
          <div class="empty">No cup goals recorded yet.</div>
        {/if}
      </div>
    </section>

    <h2 class="section" id="triple-crown-seasons">Triple Crown Seasons</h2>
    <p class="recdesc">Every season a player scored in league, cup <em>and</em> Over-35 play.</p>
    <section class="season">
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th class="l">Season</th>
              <th class="l">Player</th>
              <th>League G</th>
              <th>Cup G</th>
              <th>Over-35 G</th>
            </tr>
          </thead>
          <tbody>
            {#each shapeRecs?.tripleCrowns || [] as r}
              <tr>
                <td class="l">{r.seasonLabel}</td>
                <td class="l"><a class="pname" href={`#/player/${r.pk}`}>{r.name}</a></td>
                <td class="pts">{r.lg}</td>
                <td class="pts">{r.cup}</td>
                <td class="pts">{r.o35}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if !shapeRecs || shapeRecs.tripleCrowns.length === 0}
          <div class="empty">No triple crown seasons recorded yet.</div>
        {/if}
      </div>
    </section>
  {/if}
</main>

<style>
  /* Min-GP control for the goals-per-game leaderboard (mirrors Season.svelte's .leadctrl). */
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
  .leadctrl select {
    font: inherit;
    font-size: 14px;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text);
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 5px 10px;
    cursor: pointer;
  }
</style>
