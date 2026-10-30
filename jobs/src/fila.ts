import PgBoss from 'pg-boss';
import type { Pool } from 'pg';
import type { Armazenamento } from './armazenamento';
import { FILA_IMPORTAR_COLABORADORES, processarImportacao } from './importar-colaboradores';

export type PayloadImportacao = { importacaoId: string };

/**
 * Atenção ao conectar: o pg-boss precisa de conexão direta ou "session mode" do pooler do Supabase.
 * O modo transaction (porta 6543) quebra os locks de sessão usados pelo agendador.
 */
export async function iniciarFila(connectionString: string): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString, schema: 'pgboss', application_name: 'jornadacerta-jobs' });
  boss.on('error', (e) => console.error('[pg-boss]', e));
  await boss.start();
  await boss.createQueue(FILA_IMPORTAR_COLABORADORES);
  return boss;
}

export function enfileirarImportacao(boss: PgBoss, importacaoId: string) {
  // O id do job é o da importação: enfileirar de novo devolve null (sem duplicar).
  return boss.send(FILA_IMPORTAR_COLABORADORES, { importacaoId } satisfies PayloadImportacao, {
    id: importacaoId,
    retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 15 * 60,
  });
}

/**
 * Enfileiramento a partir do app web (serverless): conexão curta, sem supervisor, agendador nem migração
 * (o schema e as filas são criados pelo worker em `iniciarFila`).
 */
export async function enfileirarImportacaoAvulsa(connectionString: string, importacaoId: string): Promise<string | null> {
  const boss = new PgBoss({ connectionString, max: 1, supervise: false, schedule: false, migrate: false, application_name: 'jornadacerta-web' });
  boss.on('error', (e) => console.error('[pg-boss/web]', e));
  await boss.start();
  try {
    return await enfileirarImportacao(boss, importacaoId);
  } finally {
    await boss.stop({ graceful: false, wait: true });
  }
}

export async function registrarWorkers(boss: PgBoss, pool: Pool, armazenamento: Armazenamento) {
  await boss.work<PayloadImportacao>(FILA_IMPORTAR_COLABORADORES, { batchSize: 1 }, async ([job]) => {
    if (!job) return;
    await processarImportacao(pool, job.data.importacaoId, armazenamento);
  });
}
