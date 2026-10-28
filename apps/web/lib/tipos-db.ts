export type EmpresaRow = {
  id: string; organizacao_id: string; razao_social: string; cnpj: string; porte: 'mei' | 'me' | 'epp' | 'medio' | 'grande';
  municipio_ibge: string; uf: string; terceirizada_publica: boolean; status_adequacao: 'nao_iniciado' | 'em_risco' | 'adequado';
};
export type OrganizacaoRow = { id: string; nome: string; tipo: 'empresa' | 'contabilidade' | 'juridico' | 'plataforma'; white_label: { nome?: string; cor?: string; logo_path?: string } | null };
export type ColaboradorVigenteRow = {
  colaborador_id: string; nome: string; matricula: string | null; cargo: string | null; setor_nome: string | null; turno: string | null;
  salario_base: number | string; jornada_semanal_min: number; divisor: number; tipo_escala: string; hipersuficiente: boolean;
};
export type DiagnosticoResumoRow = { id: string; data_referencia: string; criado_em: string; resumo: { resumo?: { total: number; porClassificacao: Record<string, number> } } };
export type ImportacaoRow = {
  id: string; status: 'aguardando_mapeamento' | 'processando' | 'concluida' | 'erro'; criado_em: string;
  relatorio: null | { mensagem?: string; totalLinhas?: number; criados?: number; atualizados?: number; semAlteracao?: number; ignoradas?: number; setoresCriados?: number; errosTotal?: number; avisosTotal?: number; erros?: Array<{ linha: number; campo: string; valor: string; mensagem: string }> };
};
export const ROTULO_PORTE = { mei: 'MEI', me: 'Microempresa', epp: 'Empresa de pequeno porte', medio: 'Médio porte', grande: 'Grande porte' } as const;
export const ROTULO_STATUS = { nao_iniciado: 'Não iniciado', em_risco: 'Em risco', adequado: 'Adequado' } as const;
