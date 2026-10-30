import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@jc/rules-engine', '@jc/servicos', '@jc/documents', '@jc/connectors', '@jc/jobs'],
  // Bibliotecas pesadas/nativas ficam fora do bundle do servidor.
  serverExternalPackages: ['pg', 'pg-boss', 'exceljs', '@react-pdf/renderer'],
};
export default config;
