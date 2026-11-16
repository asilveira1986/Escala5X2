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
  async headers() {
    return [
      // O service worker precisa ser sempre revalidado, senão uma versão com defeito fica presa nos aparelhos.
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, max-age=0' }, { key: 'Service-Worker-Allowed', value: '/' }] },
      { source: '/sw-core.js', headers: [{ key: 'Cache-Control', value: 'no-cache, max-age=0' }] },
    ];
  },
  serverExternalPackages: ['pg', 'pg-boss', 'exceljs', '@react-pdf/renderer'],
};
export default config;
