<script>
  // Landing page. Lists the stats pages available on the site; add a card here as new pages ship.
  const pages = [
    {
      href: '#/best-single-seasons',
      title: 'Best Single Seasons',
      blurb:
        'Every player’s single-season totals — goals, assists, points — across league, ' +
        'cups and Over-35, ranked to surface the best individual seasons in BDSL history.',
    },
    {
      href: '#/champions',
      title: 'Champions',
      blurb:
        'Every league division, Over-35 and cup champion by season, plus a most-decorated-clubs ' +
        'leaderboard with titles broken down by type and each club’s current title drought.',
    },
    {
      href: '#/players',
      title: 'Players',
      blurb:
        'Every player in BDSL history with their all-time totals. Search by name and open ' +
        'any player’s full profile.',
    },
    {
      href: '#/clubs',
      title: 'Clubs',
      blurb:
        'Every club in BDSL history with all-time records, season-by-season competition ' +
        'history and the full roster of players who suited up.',
    },
    {
      href: '#/records',
      title: 'Records',
      blurb:
        'Team records across league and Over-35 league play — most/fewest goals, best and ' +
        'worst goal differentials, perfect seasons, winning streaks and more.',
    },
  ];
</script>

<main class="home">
  <div class="cards">
    {#each pages as p}
      <a class="card" href={p.href}>
        <h2>{p.title}</h2>
        <p>{p.blurb}</p>
        <span class="go">Open &rarr;</span>
      </a>
    {/each}
  </div>
</main>
