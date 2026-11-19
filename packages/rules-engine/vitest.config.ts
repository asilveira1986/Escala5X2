import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,   // o runner do CI é bem mais lento que a máquina local
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/fixtures/**', 'src/index.ts', 'src/tipos.ts'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
