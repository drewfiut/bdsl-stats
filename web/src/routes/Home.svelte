<script>
  // Landing page. Lists the stats pages available on the site, grouped to match the header nav;
  // add a card to the matching group here as new pages ship.
  const seasonsPage = {
    href: '#/seasons',
    title: 'Seasons',
    blurb:
      'Every BDSL season in one hub — final standings for each division, every champion, and ' +
      'that year’s top scorers and assisters.',
  };
  const trendsPage = {
    href: '#/trends',
    title: 'Trends',
    blurb:
      'League-wide metrics tracked across every BDSL season — starting with goals per game, ' +
      'with more trends to come.',
  };
  const teamPages = [
    {
      href: '#/champions',
      title: 'Champions',
      blurb:
        'Every league division, Over-35 and cup champion by season, plus a most-decorated-clubs ' +
        'leaderboard with titles broken down by type and each club’s current title drought.',
    },
    {
      href: '#/clubs',
      title: 'Clubs',
      blurb:
        'Every club in BDSL history with all-time records, season-by-season competition ' +
        'history and the full roster of players who suited up.',
    },
    {
      href: '#/power-rankings',
      title: 'Power Rankings',
      blurb:
        'All-time Elo ratings from every league and cup result — current power rankings for the ' +
        'live season, the strongest teams ever by peak rating, and rating-over-time charts.',
    },
    {
      href: '#/team-records',
      title: 'Team Records',
      blurb:
        'Team records across league and Over-35 league play — most/fewest goals, best and ' +
        'worst goal differentials, perfect seasons, winning streaks and more.',
    },
    {
      href: '#/compare',
      title: 'Head-to-Head',
      blurb:
        'Pick any two clubs and see their all-time record — meetings, wins/losses/draws, ' +
        'biggest wins and the full history of every game they’ve played against each other.',
    },
  ];
  const individualPages = [
    {
      href: '#/players',
      title: 'Players',
      blurb:
        'Every player in BDSL history with their all-time totals. Search by name and open ' +
        'any player’s full profile.',
    },
    {
      href: '#/best-single-seasons',
      title: 'Best Single Season (All Comps)',
      blurb:
        'Every player’s single-season totals — goals, assists, points — across league, ' +
        'cups and Over-35, ranked to surface the best individual seasons in BDSL history.',
    },
    {
      href: '#/player-records',
      title: 'Player Records',
      blurb:
        'All-time individual leaderboards — career goals, assists, points and games played, ' +
        'best goals-per-game, Golden Boot winners by season, and youngest/oldest age records.',
    },
  ];
</script>

<main class="home">
  <section class="welcome">
    <h1>Welcome to BDSL Stats</h1>
    <p class="lede">
      An unofficial stats hub for the Buffalo District Soccer League &mdash; standings, champions,
      club and player records pulled together across every season on record. Pick a page below to
      dive in.
    </p>

    <div class="reliability">
      <h2>How complete is the data?</h2>
      <p>
        BDSL&rsquo;s record-keeping has improved over the years, so how much you&rsquo;ll find
        depends on the season:
      </p>
      <ul>
        <li>
          <span class="tag good">2017&ndash;present</span>
          Everything &mdash; standings, champions, and full individual goal/assist stats. This is
          the most reliable era.
        </li>
        <li>
          <span class="tag ok">2014&ndash;2016</span>
          Individual player scoring (goals &amp; assists) begins in 2014. Coverage is solid but a
          little thinner in these first few years.
        </li>
        <li>
          <span class="tag team">2008&ndash;2013</span>
          Team data only &mdash; standings, champions, and team goals. Individual scorers
          weren&rsquo;t tracked, so these seasons are flagged &ldquo;team data only.&rdquo;
        </li>
        <li>
          <span class="tag none">Before 2008</span>
          No data exists.
        </li>
      </ul>
      <div class="caveats">
        <h2>Caveats</h2>
        <ul>
          <li>
            Games-played (GP) counts are never fully reliable. Take statistics and records relying
            on individual games played with a grain of salt.
          </li>
          <li>
            Season goal and assist totals are the reliable source for individual scoring. Per-game
            breakdowns come from match reports, which managers didn&rsquo;t always fill in &mdash;
            so game-by-game and cup scoring can be undercounted.
          </li>
          <li>
            There is no 2020 season &mdash; it was cancelled due to COVID-19.
          </li>
        </ul>
      </div>
    </div>
  </section>

  <div class="cards">
    <a class="card" href={seasonsPage.href}>
      <h2>{seasonsPage.title}</h2>
      <p>{seasonsPage.blurb}</p>
      <span class="go">Open &rarr;</span>
    </a>
    <a class="card" href={trendsPage.href}>
      <h2>{trendsPage.title}</h2>
      <p>{trendsPage.blurb}</p>
      <span class="go">Open &rarr;</span>
    </a>
  </div>

  <h2 class="section-head">Team</h2>
  <div class="cards">
    {#each teamPages as p}
      <a class="card" href={p.href}>
        <h2>{p.title}</h2>
        <p>{p.blurb}</p>
        <span class="go">Open &rarr;</span>
      </a>
    {/each}
  </div>

  <h2 class="section-head">Individual</h2>
  <div class="cards">
    {#each individualPages as p}
      <a class="card" href={p.href}>
        <h2>{p.title}</h2>
        <p>{p.blurb}</p>
        <span class="go">Open &rarr;</span>
      </a>
    {/each}
  </div>
</main>

<style>
  .welcome { margin: 4px 0 30px; }
  .welcome h1 { margin: 0 0 10px; font-size: 26px; color: var(--navy2); }
  .welcome .lede { margin: 0 0 22px; max-width: 70ch; color: var(--text);
    font-size: 15px; line-height: 1.55; }

  .reliability { background: var(--card); border: 1px solid var(--line); border-radius: 12px;
    padding: 18px 20px; box-shadow: 0 1px 3px rgba(0, 0, 0, .05); }
  .reliability h2 { margin: 0 0 6px; font-size: 15px; font-weight: 800; color: var(--text); }
  .reliability > p { margin: 0 0 14px; color: var(--muted); font-size: 13.5px; line-height: 1.5; }
  .reliability > ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  .reliability > ul > li { display: grid; grid-template-columns: 132px 1fr; gap: 12px; align-items: baseline;
    color: var(--text); font-size: 13.5px; line-height: 1.5; }
  .caveats { margin: 22px 0 0; padding-top: 16px; border-top: 1px solid var(--line); }
  .caveats h2 { margin: 0 0 8px; font-size: 15px; font-weight: 800; color: var(--text); }
  .caveats ul { list-style: disc; margin: 0; padding-left: 20px; display: grid; gap: 8px; }
  .caveats li { color: var(--muted); font-size: 13px; line-height: 1.5; }

  .tag { justify-self: start; display: inline-block; font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: .4px; white-space: nowrap; line-height: 1;
    padding: 4px 8px; border-radius: 999px; border: 1px solid; }
  .tag.good { color: var(--g); border-color: var(--g); background: color-mix(in srgb, var(--g) 12%, transparent); }
  .tag.ok { color: var(--a); border-color: var(--a); background: color-mix(in srgb, var(--a) 12%, transparent); }
  .tag.team { color: var(--gold); border-color: var(--gold); background: var(--live); }
  .tag.none { color: var(--muted); border-color: var(--line); background: var(--row); }

  @media (max-width: 520px) {
    .reliability > ul > li { grid-template-columns: 1fr; gap: 4px; }
  }
</style>
