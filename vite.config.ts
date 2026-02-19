import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@nova/core': resolve(__dirname, 'src/core/index.ts'),
    },
  },
  server: {
    open: false,
  },
});
