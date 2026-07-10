import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Project Pages are served from https://<user>.github.io/bdsl-stats/, so every asset and
// data fetch must resolve under this base. Use import.meta.env.BASE_URL in app code.
export default defineConfig({
  base: '/bdsl-stats/',
  plugins: [svelte()],
});
