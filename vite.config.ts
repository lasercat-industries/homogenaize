import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'Homogenaize',
      fileName: 'homogenaize',
      formats: ['es', 'cjs', 'umd'],
    },
    rollupOptions: {
      external: ['zod'],
      output: {
        globals: {
          zod: 'Zod',
        },
      },
    },
    target: 'esnext',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
