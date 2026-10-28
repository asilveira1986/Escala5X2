import type { Client } from 'pg';
import type { ClienteRpc } from '../src';

/** Executa funções do Postgres como o usuário (papel authenticated + claims), como o PostgREST faz. */
export function rpcPg(db: Client, uid: string, aal: 'aal1' | 'aal2' = 'aal2'): ClienteRpc {
  return {
    async rpc(nome, args) {
      const chaves = Object.keys(args);
      const sql = `select ${nome}(${chaves.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
      const valores = chaves.map((k) => { const v = args[k]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v; });
      await db.query('begin');
      try {
        await db.query('set local role authenticated');
        await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, aal })]);
        const r = await db.query(sql, valores as unknown[]);
        await db.query('commit');
        return { data: r.rows[0]?.r ?? null, error: null };
      } catch (e) {
        await db.query('rollback');
        return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
      }
    },
  };
}
