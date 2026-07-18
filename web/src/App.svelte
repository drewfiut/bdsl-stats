<script>
  import { parse } from './lib/router.js';
  import { hscroll } from './lib/scrollShadow.js';
  import { loadBoard } from './lib/data.js';
  import Home from './routes/Home.svelte';
  import BestSingleSeasons from './routes/BestSingleSeasons.svelte';
  import Players from './routes/Players.svelte';
  import Player from './routes/Player.svelte';
  import Clubs from './routes/Clubs.svelte';
  import Club from './routes/Club.svelte';
  import TeamSeason from './routes/TeamSeason.svelte';
  import Compare from './routes/Compare.svelte';
  import TeamRecords from './routes/TeamRecords.svelte';
  import PowerRankings from './routes/PowerRankings.svelte';
  import PlayerRecords from './routes/PlayerRecords.svelte';
  import Champions from './routes/Champions.svelte';
  import Seasons from './routes/Seasons.svelte';
  import Season from './routes/Season.svelte';
  import Trends from './routes/Trends.svelte';
  import MatchReport from './routes/MatchReport.svelte';

  // Reactive current hash; kept in sync with the address bar.
  let hash = $state(typeof location !== 'undefined' ? location.hash : '');
  $effect(() => {
    const onChange = () => (hash = location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  });

  const route = $derived(parse(hash));

  // Scroll to top whenever the page (not just query params within the same page) changes.
  let prevRouteName = route.name;
  $effect(() => {
    if (route.name !== prevRouteName) {
      prevRouteName = route.name;
      window.scrollTo(0, 0);
    }
  });

  // Header nav groups pages into two dropdowns: Team stats vs Individual stats.
  const TEAM_PAGES = [
    { href: '#/champions', label: 'Champions', name: 'champions' },
    { href: '#/clubs', label: 'Clubs', name: 'clubs' },
    { href: '#/power-rankings', label: 'Power Rankings', name: 'powerRankings' },
    { href: '#/team-records', label: 'Team Records', name: 'teamRecords' },
    { href: '#/compare', label: 'Head-to-Head', name: 'compare' },
  ];
  const INDIVIDUAL_PAGES = [
    { href: '#/players', label: 'Players', name: 'players' },
    { href: '#/best-single-seasons', label: 'Best Single Season (All Comps)', name: 'board' },
    { href: '#/player-records', label: 'Player Records', name: 'playerRecords' },
  ];
  const teamActive = $derived(
    TEAM_PAGES.some((p) => p.name === route.name) || route.name === 'club' || route.name === 'teamSeason'
  );
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
    teamSeason: 'Team Season · BDSL Stats',
    compare: 'Head-to-Head · BDSL Stats',
    teamRecords: 'Team Records · BDSL Stats',
    powerRankings: 'Power Rankings · BDSL Stats',
    playerRecords: 'Player Records · BDSL Stats',
    champions: 'Champions · BDSL Stats',
    seasons: 'Seasons · BDSL Stats',
    season: 'Season · BDSL Stats',
    trends: 'Trends · BDSL Stats',
    game: 'Match Report · BDSL Stats',
  };
  $effect(() => {
    document.title = TITLES[route.name] || 'BDSL Stats';
  });

  // Data-refreshed timestamp, shown in the header on every page.
  let dataAsOf = $state('');
  $effect(() => {
    loadBoard().then((b) => (dataAsOf = b.dataAsOf)).catch(() => {});
  });
  const fmtDataAsOf = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${date} at ${time}`;
  };
</script>

<svelte:window onclick={(e) => {
  if (openMenu && !e.target.closest('.dropdown')) closeMenu();
}} />

<header class="site">
  <div class="wrap">
    <div class="brandrow">
      <a class="brand" href="#/">BDSL Stats</a>
      {#if dataAsOf}
        <div class="refreshed">Data refreshed {fmtDataAsOf(dataAsOf)}</div>
      {/if}
    </div>
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
{:else if route.name === 'teamSeason'}
  {#key `${route.params.clubId}|${route.params.sid}`}
    <TeamSeason clubId={route.params.clubId} sid={route.params.sid} />
  {/key}
{:else if route.name === 'compare'}
  {#key `${route.params.clubAId}|${route.params.clubBId}`}
    <Compare clubAId={route.params.clubAId} clubBId={route.params.clubBId} />
  {/key}
{:else if route.name === 'teamRecords'}
  <TeamRecords />
{:else if route.name === 'powerRankings'}
  <PowerRankings />
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
{:else if route.name === 'game'}
  {#key `${route.params.sid}|${route.params.gameKey}`}
    <MatchReport sid={route.params.sid} gameKey={route.params.gameKey} />
  {/key}
{:else}
  <Home />
{/if}
