<script>
  // Landing page. Lists the stats pages available on the site, grouped to match the header nav;
  // add a card to the matching group here as new pages ship.
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
      href: '#/team-records',
      title: 'Team Records',
      blurb:
        'Team records across league and Over-35 league play — most/fewest goals, best and ' +
        'worst goal differentials, perfect seasons, winning streaks and more.',
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
  ];
</script>

<main class="home">
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
