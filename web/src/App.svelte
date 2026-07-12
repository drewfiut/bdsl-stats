<script>
  import { parse } from './lib/router.js';
  import { hscroll } from './lib/scrollShadow.js';
  import Home from './routes/Home.svelte';
  import BestSingleSeasons from './routes/BestSingleSeasons.svelte';
  import Players from './routes/Players.svelte';
  import Player from './routes/Player.svelte';
  import Clubs from './routes/Clubs.svelte';
  import Club from './routes/Club.svelte';
  import Records from './routes/Records.svelte';

  // Reactive current hash; kept in sync with the address bar.
  let hash = $state(typeof location !== 'undefined' ? location.hash : '');
  $effect(() => {
    const onChange = () => (hash = location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  });

  const route = $derived(parse(hash));

  const TITLES = {
    home: 'BDSL Stats',
    board: 'Best Single Seasons · BDSL Stats',
    players: 'Players · BDSL Stats',
    player: 'Player · BDSL Stats',
    clubs: 'Clubs · BDSL Stats',
    club: 'Club · BDSL Stats',
    records: 'Records · BDSL Stats',
  };
  $effect(() => {
    document.title = TITLES[route.name] || 'BDSL Stats';
  });
</script>

<header class="site">
  <div class="wrap">
    <a class="brand" href="#/">BDSL Stats</a>
    <div class="navscroll">
      <nav use:hscroll>
        <a href="#/" class:on={route.name === 'home'}>Home</a>
        <a href="#/best-single-seasons" class:on={route.name === 'board'}>Best Single Seasons</a>
        <a href="#/players" class:on={route.name === 'players'}>Players</a>
        <a href="#/clubs" class:on={route.name === 'clubs'}>Clubs</a>
        <a href="#/records" class:on={route.name === 'records'}>Records</a>
      </nav>
      <span class="scrollarrow left" aria-hidden="true">&#9666;</span>
      <span class="scrollarrow right" aria-hidden="true">&#9656;</span>
    </div>
  </div>
</header>

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
{:else if route.name === 'records'}
  <Records />
{:else}
  <Home />
{/if}
