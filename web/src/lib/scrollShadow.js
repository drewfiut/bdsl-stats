// Svelte action for horizontally-scrollable chip bars (header nav, Team Records jump nav). Toggles
// `scroll-left` / `scroll-right` classes on the scrollable element's parent whenever there's more
// content off-screen in that direction; paired CSS on the parent shows/hides an edge arrow.
export function hscroll(node) {
  const root = node.parentElement;

  const update = () => {
    root.classList.toggle('scroll-left', node.scrollLeft > 1);
    root.classList.toggle('scroll-right', node.scrollLeft < node.scrollWidth - node.clientWidth - 1);
  };

  update();
  node.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  // Catches content becoming wider/narrower without a window resize (e.g. async data loading in).
  const ro = new ResizeObserver(update);
  ro.observe(node);

  return {
    destroy() {
      node.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      ro.disconnect();
    },
  };
}
