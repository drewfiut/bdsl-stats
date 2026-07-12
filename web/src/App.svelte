<script>
  import { parse } from './lib/router.js';
  import { hscroll } from './lib/scrollShadow.js';
  import Home from './routes/Home.svelte';
  import BestSingleSeasons from './routes/BestSingleSeasons.svelte';
  import Players from './routes/Players.svelte';
  import Player from './routes/Player.svelte';
  import Clubs from './routes/Clubs.svelte';
  import Club from './routes/Club.svelte';
  import TeamRecords from './routes/TeamRecords.svelte';
  import PlayerRecords from './routes/PlayerRecords.svelte';
  import Champions from './routes/Champions.svelte';
  import Seasons from './routes/Seasons.svelte';
  import Season from './routes/Season.svelte';
  import Trends from './routes/Trends.svelte';

  // Reactive current hash; kept in sync with the address bar.
  let hash = $state(typeof location !== 'undefined' ? location.hash : '');
  $effect(() => {
    const onChange = () => (hash = location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  });

  const route = $derived(parse(hash));

  // Header nav groups pages into two dropdowns: Team stats vs Individual stats.
  const TEAM_PAGES = [
    { href: '#/champions', label: 'Champions', name: 'champions' },
    { href: '#/clubs', label: 'Clubs', name: 'clubs' },
    { href: '#/team-records', label: 'Team Records', name: 'teamRecords' },
  ];
  const INDIVIDUAL_PAGES = [
    { href: '#/players', label: 'Players', name: 'players' },
    { href: '#/best-single-seasons', label: 'Best Single Season (All Comps)', name: 'board' },
    { href: '#/player-records', label: 'Player Records', name: 'playerRecords' },
  ];
  const teamActive = $derived(TEAM_PAGES.some((p) => p.name === route.name) || route.name === 'club');
  const individualActive = $derived(
    INDIVIDUAL_PAGES.some((p) => p.name === route.name) || route.name === 'player'
  );

  let openMenu = $state(null); // 'team' | 'individual' | null
  let menuPos = $state({ top: 0, left: 0 });

  function toggleMenu(name, event) {
    if (openMenu === name) {
      openMenu = null;
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    menuPos = { top: rect.bottom + 6, left: rect.left };
    openMenu = name;
  }

  function closeMenu() {
    openMenu = null;
  }

  $effect(() => {
    // Close the open dropdown whenever the route changes.
    void route;
    openMenu = null;
  });

  const TITLES = {
    home: 'BDSL Stats',
    board: 'Best Single Season (All Comps) · BDSL Stats',
    players: 'Players · BDSL Stats',
    player: 'Player · BDSL Stats',
    clubs: 'Clubs · BDSL Stats',
    club: 'Club · BDSL Stats',
    teamRecords: 'Team Records · BDSL Stats',
    playerRecords: 'Player Records · BDSL Stats',
    champions: 'Champions · BDSL Stats',
    seasons: 'Seasons · BDSL Stats',
    season: 'Season · BDSL Stats',
    trends: 'Trends · BDSL Stats',
  };
  $effect(() => {
    document.title = TITLES[route.name] || 'BDSL Stats';
  });
</script>

<svelte:window onclick={(e) => {
  if (openMenu && !e.target.closest('.dropdown')) closeMenu();
}} />

<header class="site">
  <div class="wrap">
    <a class="brand" href="#/">BDSL Stats</a>
    <div class="navscroll">
      <nav use:hscroll>
        <a href="#/" class:on={route.name === 'home'}>Home</a>
        <a href="#/seasons" class:on={route.name === 'seasons' || route.name === 'season'}>Seasons</a>
        <a href="#/trends" class:on={route.name === 'trends'}>Trends</a>
        <div class="dropdown">
          <button type="button" class:on={teamActive} onclick={(e) => toggleMenu('team', e)}>
            Team <span class="caret">&#9662;</span>
          </button>
        </div>
        <div class="dropdown">
          <button type="button" class:on={individualActive} onclick={(e) => toggleMenu('individual', e)}>
            Individual <span class="caret">&#9662;</span>
          </button>
        </div>
      </nav>
      <span class="scrollarrow left" aria-hidden="true">&#9666;</span>
      <span class="scrollarrow right" aria-hidden="true">&#9656;</span>
    </div>
  </div>
</header>

{#if openMenu}
  <div
    class="dropdown-menu"
    style="top:{menuPos.top}px; left:{menuPos.left}px;"
    role="menu"
  >
    {#each (openMenu === 'team' ? TEAM_PAGES : INDIVIDUAL_PAGES) as p}
      <a href={p.href} class:on={route.name === p.name} role="menuitem">{p.label}</a>
    {/each}
  </div>
{/if}

{#if route.name === 'board'}
  <BestSingleSeasons />
{:else if route.name === 'players'}
  <Players />
{:else if route.name === 'player'}
  {#key route.params.personKey}
    <Player personKey={route.params.personKey} />
  {/key}
{:else if route.name === 'clubs'}
  <Clubs />
{:else if route.name === 'club'}
  {#key route.params.clubId}
    <Club clubId={route.params.clubId} />
  {/key}
{:else if route.name === 'teamRecords'}
  <TeamRecords />
{:else if route.name === 'playerRecords'}
  <PlayerRecords />
{:else if route.name === 'champions'}
  <Champions />
{:else if route.name === 'trends'}
  <Trends />
{:else if route.name === 'seasons'}
  <Seasons />
{:else if route.name === 'season'}
  {#key route.params.sid}
    <Season sid={route.params.sid} />
  {/key}
{:else}
  <Home />
{/if}
