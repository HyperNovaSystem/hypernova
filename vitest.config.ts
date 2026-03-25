import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      include: ['src/core/**'],
      thresholds: {
        lines: 80,
      },
    },
  },
  resolve: {
    alias: {
      // Allow .js imports to resolve .ts files
    },
  },
});
