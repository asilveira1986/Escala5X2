import Link from 'next/link';
import { notFound } from 'next/navigation';
import { carregarEntradaEscala } from '@jc/servicos';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import type { Modelo } from '@/lib/escala-editor';
import { EditorEscala } from './EditorEscala';
import type { EstadoOtimizacao } from '../actions';

type ModeloLinha = { id: string; nome: string; inicio_min: number; fim_min: number; intervalo_min: number; cor: string };
const PALETA = ['#2563eb', '#0d9488', '#7c3aed', '#c2410c', '#be185d', '#4d7c0f'];

export default async function PaginaEscala({ params }: { params: Promise<{ id: string; escalaId: string }> }) {
  const p = await params;
  const empresaId = idOu404(p.id), escalaId = idOu404(p.escalaId);
  const { supabase } = await exigirUsuario();
  let entrada;
  try {
    entrada = await carregarEntradaEscala(supabase, escalaId);
  } catch {
    notFound();
  }
  if (entrada.escala.empresaId !== empresaId) notFound();
  const { data } = await supabase.from('turno_modelo').select('id, nome, inicio_min, fim_min, intervalo_min, cor').eq('empresa_id', empresaId).eq('ativo', true).order('inicio_min');
  // Última geração de propostas desta escala (se houver e ainda for recente), para a tela abrir já mostrando o resultado.
  const { data: ot } = await supabase.from('otimizacao').select('id, status, erro, resumo, criado_em').eq('escala_id', escalaId).order('criado_em', { ascending: false }).limit(1);
  const ultima = linhas<EstadoOtimizacao & { criado_em: string }>(ot)[0];
  const recente = ultima && Date.now() - Date.parse(ultima.criado_em) < 6 * 60 * 60 * 1000 ? ultima : null;
  const modelos: Modelo[] = linhas<ModeloLinha>(data).map((m, i) => ({
    id: m.id, nome: m.nome, inicioMin: m.inicio_min, fimMin: m.fim_min, intervaloMin: m.intervalo_min, cor: m.cor || PALETA[i % PALETA.length]!,
  }));
  return (
    <>
      <Link href={`/empresas/${empresaId}/escalas`} className="inline-flex min-h-9 items-center text-sm font-semibold text-marca hover:underline">← Todas as escalas</Link>
      <EditorEscala key={`${entrada.escala.id}-${entrada.escala.revisao}-${entrada.escala.status}`} empresaId={empresaId} entrada={entrada} modelos={modelos} otimizacao={recente ? { id: recente.id, status: recente.status, erro: recente.erro, resumo: recente.resumo } : null} />
    </>
  );
}
