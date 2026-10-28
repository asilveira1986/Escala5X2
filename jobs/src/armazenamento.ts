import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createClient } from '@supabase/supabase-js';

export interface Armazenamento {
  ler(caminho: string): Promise<Uint8Array>;
}

/** Bucket privado do Supabase Storage, acessado com a service_role (somente no worker). */
export function armazenamentoSupabase(url: string, serviceRoleKey: string, bucket = 'importacoes'): Armazenamento {
  const cliente = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  return {
    async ler(caminho) {
      const { data, error } = await cliente.storage.from(bucket).download(caminho);
      if (error || !data) throw new Error(`Falha ao baixar ${caminho}: ${error?.message ?? 'arquivo ausente'}`);
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}

/** Para testes e desenvolvimento local. Impede sair do diretório raiz. */
export function armazenamentoLocal(raiz: string): Armazenamento {
  const base = resolve(raiz);
  return {
    async ler(caminho) {
      const alvo = resolve(join(base, caminho));
      if (!alvo.startsWith(base + sep)) throw new Error('Caminho fora do diretório permitido');
      return new Uint8Array(await readFile(alvo));
    },
  };
}
