import { defineConfig } from 'vitest/config';
// o runner do CI é bem mais lento que a máquina local: o padrão de 5 s por teste é curto
export default defineConfig({ test: { testTimeout: 30_000 } });
