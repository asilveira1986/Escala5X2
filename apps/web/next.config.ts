import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Container (Railway): gera um servidor Node mínimo em .next/standalone, incluindo os pacotes do monorepo.
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  poweredByHeader: false,
  transpilePackages: ['@jc/rules-engine', '@jc/servicos', '@jc/documents', '@jc/connectors', '@jc/jobs'],
  // Bibliotecas pesadas/nativas ficam fora do bundle do servidor.
  serverExternalPackages: ['pg', 'pg-boss', 'exceljs', '@react-pdf/renderer'],
};
export default config;
