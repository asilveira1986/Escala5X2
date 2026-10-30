import Link from 'next/link';
import { Cartao, Selo } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import type { ImportacaoRow } from '@/lib/tipos-db';
import { data as dataBr } from '@jc/documents/formatar';
import { AssistenteImportacao } from './AssistenteImportacao';

const tom = { aguardando_mapeamento: 'cinza', processando: 'amarelo', concluida: 'verde', erro: 'vermelho' } as const;
const rotulo = { aguardando_mapeamento: 'Aguardando confirmação', processando: 'Processando', concluida: 'Concluída', erro: 'Com falha' } as const;

export default async function Importar({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const { data } = await supabase.from('importacao').select('id, status, criado_em').eq('empresa_id', empresaId).order('criado_em', { ascending: false }).limit(10);
  const historico = linhas<Pick<ImportacaoRow, 'id' | 'status' | 'criado_em'>>(data);
  return (
    <>
      <AssistenteImportacao empresaId={empresaId} />
      {historico.length > 0 && (
        <Cartao titulo="Importações recentes">
          <ul className="space-y-1 text-sm">
            {historico.map((h) => (
              <li key={h.id}><Link className="text-marca hover:underline" href={`/empresas/${empresaId}/importar/${h.id}`}>{dataBr(h.criado_em)}</Link> <Selo tom={tom[h.status]}>{rotulo[h.status]}</Selo></li>
            ))}
          </ul>
        </Cartao>
      )}
    </>
  );
}
