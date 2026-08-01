import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

/**
 * The editor. Vite's own esbuild handles the JSX, so there is no React plugin
 * and no Fast Refresh: editing a component reloads the page. For a tool with
 * one user that is a fair trade for one fewer dependency to keep in step.
 */
export default defineConfig({
  root: 'src/editor',
  // Relative asset paths, so a build can be opened straight off the disk.
  base: './',
  plugins: [tailwindcss()],
  esbuild: { jsx: 'automatic' },
  server: {
    port: 5180,
    open: true,
    // The API runs beside the dev server; in a build the same server serves both.
    // Anchored on the trailing slash so the editor's own /api.ts module is not
    // mistaken for an API route and proxied away.
    proxy: { '^/api/': 'http://localhost:5179' },
  },
  build: { outDir: '../../dist/editor', emptyOutDir: true },
});
