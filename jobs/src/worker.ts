import { Pool } from 'pg';
import { armazenamentoSupabase } from './armazenamento';
import { iniciarFila, registrarWorkers } from './fila';

function exigir(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}

const databaseUrl = exigir('DATABASE_URL'); // conexão direta/session com papel privilegiado (somente servidor)
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const boss = await iniciarFila(databaseUrl);
// O otimizador é opcional: sem OPTIMIZER_URL/OPTIMIZER_TOKEN os pedidos de otimização terminam com erro claro.
const otimizador = process.env.OPTIMIZER_URL && process.env.OPTIMIZER_TOKEN ? { url: process.env.OPTIMIZER_URL, token: process.env.OPTIMIZER_TOKEN } : null;
if (!otimizador) console.warn('OPTIMIZER_URL/OPTIMIZER_TOKEN ausentes: a geração automática de escalas fica indisponível.');
await registrarWorkers(boss, pool, armazenamentoSupabase(exigir('SUPABASE_URL'), exigir('SUPABASE_SERVICE_ROLE_KEY')), otimizador);
console.log('Worker de jobs em execução.');

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, async () => {
    await boss.stop({ graceful: true, timeout: 20_000 });
    await pool.end();
    process.exit(0);
  });
}
