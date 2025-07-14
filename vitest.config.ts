import path from 'node:path';

import { loadEnv } from 'vite';
import { defineConfig, mergeConfig } from 'vitest/config';

import configuration from './vite.config';

export default defineConfig(({ mode }) =>
  mergeConfig(configuration, {
    test: {
      env: loadEnv(mode, process.cwd(), ''),
      globals: true,
      environment: 'node',
      include: ['src/**/*.{test,spec}.{js,ts,tsx}'],
      exclude: ['node_modules', 'dist', 'tests', 'coverage'],
      testTimeout: 30000,
      hookTimeout: 10000,
      teardownTimeout: 10000,
      pool: 'forks',
      reporters: ['verbose'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        exclude: [
          'node_modules/',
          'src/test/',
          '**/*.d.ts',
          '**/*.config.*',
          '**/coverage/**',
          'scripts/**',
          'tests/**',
        ],
      },
    },
    resolve: {
      alias: {
        '@': path.resolve('src'),
        '$tools': path.resolve('src/tools/index.ts'),
        '$styles': path.resolve('src/components/styles/index.ts'),
      },
    },
  }),
);
