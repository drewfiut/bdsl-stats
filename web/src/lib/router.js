// Minimal hash-based router. Hash routing needs no server rewrite, so deep links and refreshes
// work on GitHub Pages (base /bdsl-stats/) with no 404.html trick. Everything stays on index.html.
// The reactive current-hash state lives in App.svelte (runes); this module just parses it.

// Parse "#/player/123" -> { name, params }. Unknown/empty hash -> home.
export function parse(hash) {
  const path = (hash || '').replace(/^#/, '') || '/';
  const parts = path.split('/').filter(Boolean); // e.g. ["player", "123"]

  if (parts.length === 0) return { name: 'home', params: {} };
  if (parts[0] === 'best-single-seasons') return { name: 'board', params: {} };
  if (parts[0] === 'players') return { name: 'players', params: {} };
  if (parts[0] === 'player' && parts[1]) {
    return { name: 'player', params: { personKey: decodeURIComponent(parts[1]) } };
  }
  if (parts[0] === 'team-records') return { name: 'teamRecords', params: {} };
  if (parts[0] === 'player-records') return { name: 'playerRecords', params: {} };
  if (parts[0] === 'clubs') return { name: 'clubs', params: {} };
  if (parts[0] === 'club' && parts[1]) {
    return { name: 'club', params: { clubId: decodeURIComponent(parts[1]) } };
  }
  if (parts[0] === 'compare') {
    return { name: 'compare', params: {
      clubAId: parts[1] ? decodeURIComponent(parts[1]) : '',
      clubBId: parts[2] ? decodeURIComponent(parts[2]) : '',
    } };
  }
  if (parts[0] === 'champions') return { name: 'champions', params: {} };
  if (parts[0] === 'trends') return { name: 'trends', params: {} };
  if (parts[0] === 'seasons') return { name: 'seasons', params: {} };
  if (parts[0] === 'season' && parts[1])
    return { name: 'season', params: { sid: decodeURIComponent(parts[1]) } };
  return { name: 'home', params: {} };
}
