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
