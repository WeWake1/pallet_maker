import { defineConfig } from 'vitest/config';

/**
 * Kept separate from vite.config.ts, which roots itself in the editor. The
 * tests cover the whole project, not just the UI.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
