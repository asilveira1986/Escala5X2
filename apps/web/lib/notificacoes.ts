import type { IconeId } from './menu';

export type Notificacao = { id: string; tipo: string; titulo: string; texto: string | null; href: string | null; criado_em: string; lida_em: string | null };

/** Só caminhos internos (nada de link para outro site, mesmo que um dado ruim chegasse até aqui). */
export const hrefSeguro = (h: unknown): string | null => (typeof h === 'string' && /^\/(?!\/)[A-Za-z0-9/_?=&.-]*$/.test(h) ? h : null);

/** "agora", "há 5 min", "há 3 h", "ontem" ou a data. */
export function tempoRelativo(iso: string, agora: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const min = Math.floor((agora - t) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ontem';
  if (d < 7) return `há ${d} dias`;
  const data = new Date(t - 3 * 3600_000);
  return `${String(data.getUTCDate()).padStart(2, '0')}/${String(data.getUTCMonth() + 1).padStart(2, '0')}/${data.getUTCFullYear()}`;
}

export function iconeDoTipo(tipo: string): IconeId {
  if (tipo.startsWith('pedido')) return 'pedidos';
  if (tipo === 'escala_publicada') return 'calendario';
  return 'inicio';
}

/** Lê o corpo de POST /lidas: lista de ids (opcional); sem lista = todas. */
export function lerIdsLidas(corpo: unknown): { ok: true; ids: string[] | null } | { ok: false } {
  if (corpo == null || (typeof corpo === 'object' && !('ids' in (corpo as object)))) return { ok: true, ids: null };
  const ids = (corpo as { ids?: unknown }).ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || !ids.every((i) => typeof i === 'string' && /^[0-9a-f-]{36}$/i.test(i))) return { ok: false };
  return { ok: true, ids: ids as string[] };
}
