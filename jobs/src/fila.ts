import PgBoss from 'pg-boss';
import type { Pool } from 'pg';
import type { Armazenamento } from './armazenamento';
import { AGENDA_ALERTAS_CONFORMIDADE, FILA_ALERTAS_CONFORMIDADE, processarAlertasConformidade } from './avisar-conformidade';
import { AGENDA_AVISO_BANCO, FILA_AVISO_BANCO, processarAvisoVencimento } from './avisar-vencimento-banco';
import { FILA_IMPORTAR_COLABORADORES, processarImportacao } from './importar-colaboradores';
import { FILA_OTIMIZAR_ESCALA, processarOtimizacao, type ConfigOtimizadorJob } from './otimizar-escala';

export type PayloadImportacao = { importacaoId: string };
export type PayloadOtimizacao = { otimizacaoId: string };

/**
 * Atenção ao conectar: o pg-boss precisa de conexão direta ou "session mode" do pooler do Supabase.
 * O modo transaction (porta 6543) quebra os locks de sessão usados pelo agendador.
 */
export async function iniciarFila(connectionString: string): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString, schema: 'pgboss', application_name: 'jornadacerta-jobs' });
  boss.on('error', (e) => console.error('[pg-boss]', e));
  await boss.start();
  await boss.createQueue(FILA_IMPORTAR_COLABORADORES);
  await boss.createQueue(FILA_OTIMIZAR_ESCALA);
  await boss.createQueue(FILA_AVISO_BANCO);
  await boss.createQueue(FILA_ALERTAS_CONFORMIDADE);
  // Aviso diário de vencimento do banco de horas (o pg-boss garante uma execução por agendamento, mesmo com mais de um worker).
  await boss.schedule(FILA_AVISO_BANCO, AGENDA_AVISO_BANCO.cron, {}, { tz: AGENDA_AVISO_BANCO.tz });
  await boss.schedule(FILA_ALERTAS_CONFORMIDADE, AGENDA_ALERTAS_CONFORMIDADE.cron, {}, { tz: AGENDA_ALERTAS_CONFORMIDADE.tz });
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

export function enfileirarOtimizacao(boss: PgBoss, otimizacaoId: string) {
  // Sem nova tentativa automática: o pedido já cuida das próprias tentativas e uma otimização repetida custa até 1 minuto de CPU.
  return boss.send(FILA_OTIMIZAR_ESCALA, { otimizacaoId } satisfies PayloadOtimizacao, { id: otimizacaoId, retryLimit: 0, expireInSeconds: 10 * 60 });
}

/** Enfileiramento a partir do app web (mesmo formato de `enfileirarImportacaoAvulsa`). */
export async function enfileirarOtimizacaoAvulsa(connectionString: string, otimizacaoId: string): Promise<string | null> {
  const boss = new PgBoss({ connectionString, max: 1, supervise: false, schedule: false, migrate: false, application_name: 'jornadacerta-web' });
  boss.on('error', (e) => console.error('[pg-boss/web]', e));
  await boss.start();
  try {
    return await enfileirarOtimizacao(boss, otimizacaoId);
  } finally {
    await boss.stop({ graceful: false, wait: true });
  }
}

export async function registrarWorkers(boss: PgBoss, pool: Pool, armazenamento: Armazenamento, otimizador: ConfigOtimizadorJob | null = null) {
  await boss.work<PayloadOtimizacao>(FILA_OTIMIZAR_ESCALA, { batchSize: 1 }, async ([job]) => {
    if (!job) return;
    await processarOtimizacao(pool, job.data.otimizacaoId, otimizador);
  });
  await boss.work(FILA_AVISO_BANCO, { batchSize: 1 }, async () => {
    const r = await processarAvisoVencimento(pool);
    console.log(`[aviso-banco] ${r.empresas} empresa(s), ${r.colaboradores} colaborador(es), ${r.avisos} aviso(s) novo(s).`);
  });
  await boss.work(FILA_ALERTAS_CONFORMIDADE, { batchSize: 1 }, async () => {
    const r = await processarAlertasConformidade(pool);
    console.log(`[alertas-conformidade] ${r.empresas} empresa(s), ${r.avisos} aviso(s) novo(s).`);
  });
  await boss.work<PayloadImportacao>(FILA_IMPORTAR_COLABORADORES, { batchSize: 1 }, async ([job]) => {
    if (!job) return;
    await processarImportacao(pool, job.data.importacaoId, armazenamento);
  });
}
