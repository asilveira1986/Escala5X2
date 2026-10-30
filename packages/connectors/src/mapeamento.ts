export type CampoColaborador =
  | 'nome' | 'cpf' | 'matricula' | 'cargo' | 'cbo' | 'admissao' | 'desligamento' | 'salario'
  | 'escolaridade' | 'telefone' | 'setor' | 'turno' | 'jornada_semanal' | 'divisor' | 'tipo_escala'
  | 'folgas_semana' | 'horas_extras_mensais';

export type DefCampo = { chave: CampoColaborador; rotulo: string; obrigatorio: boolean; apelidos: string[] };

export const CAMPOS_COLABORADOR: DefCampo[] = [
  { chave: 'nome', rotulo: 'Nome', obrigatorio: true, apelidos: ['nome', 'nomecompleto', 'funcionario', 'colaborador', 'empregado'] },
  { chave: 'cpf', rotulo: 'CPF', obrigatorio: true, apelidos: ['cpf', 'cpffuncionario', 'documento'] },
  { chave: 'admissao', rotulo: 'Data de admissão', obrigatorio: true, apelidos: ['admissao', 'dataadmissao', 'datadeadmissao', 'dtadmissao', 'dataadm', 'admitidoem'] },
  { chave: 'salario', rotulo: 'Salário base', obrigatorio: true, apelidos: ['salario', 'salariobase', 'remuneracao', 'salariomensal', 'vencimento'] },
  { chave: 'jornada_semanal', rotulo: 'Jornada semanal (horas)', obrigatorio: true, apelidos: ['jornada', 'jornadasemanal', 'horassemanais', 'cargahorariasemanal', 'chsemanal', 'horasporsemana'] },
  { chave: 'tipo_escala', rotulo: 'Tipo de escala', obrigatorio: true, apelidos: ['escala', 'tipoescala', 'tipodeescala', 'regimedetrabalho', 'regime'] },
  { chave: 'matricula', rotulo: 'Matrícula', obrigatorio: false, apelidos: ['matricula', 'mat', 'registro', 'codigo'] },
  { chave: 'cargo', rotulo: 'Cargo', obrigatorio: false, apelidos: ['cargo', 'funcao'] },
  { chave: 'cbo', rotulo: 'CBO', obrigatorio: false, apelidos: ['cbo', 'codigocbo'] },
  { chave: 'desligamento', rotulo: 'Data de desligamento', obrigatorio: false, apelidos: ['desligamento', 'datadesligamento', 'datadedesligamento', 'demissao', 'datademissao', 'rescisao'] },
  { chave: 'escolaridade', rotulo: 'Escolaridade', obrigatorio: false, apelidos: ['escolaridade', 'grauinstrucao', 'instrucao', 'formacao'] },
  { chave: 'telefone', rotulo: 'Telefone / WhatsApp', obrigatorio: false, apelidos: ['telefone', 'celular', 'whatsapp', 'fone'] },
  { chave: 'setor', rotulo: 'Setor', obrigatorio: false, apelidos: ['setor', 'departamento', 'area', 'secao'] },
  { chave: 'turno', rotulo: 'Turno', obrigatorio: false, apelidos: ['turno', 'horario'] },
  { chave: 'divisor', rotulo: 'Divisor da hora', obrigatorio: false, apelidos: ['divisor', 'divisorhora'] },
  { chave: 'folgas_semana', rotulo: 'Folgas por semana', obrigatorio: false, apelidos: ['folgas', 'folgassemana', 'folgasporsemana', 'diasdefolga'] },
  { chave: 'horas_extras_mensais', rotulo: 'Horas extras mensais', obrigatorio: false, apelidos: ['horasextras', 'horasextrasmensais', 'he', 'hemensais'] },
];

export type Mapeamento = Partial<Record<CampoColaborador, string | null>>;

export function normalizarCabecalho(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Sugere o mapeamento campo → coluna pela similaridade do nome; o usuário confirma ou corrige no assistente. */
export function sugerirMapeamento(colunas: string[]): Mapeamento {
  const norm = colunas.map((c) => [c, normalizarCabecalho(c)] as const);
  const usadas = new Set<string>();
  const out: Mapeamento = {};
  for (const campo of CAMPOS_COLABORADOR) {
    const achada = norm.find(([c, n]) => !usadas.has(c) && campo.apelidos.includes(n));
    out[campo.chave] = achada ? achada[0] : null;
    if (achada) usadas.add(achada[0]);
  }
  return out;
}

export function camposObrigatoriosSemColuna(m: Mapeamento): CampoColaborador[] {
  return CAMPOS_COLABORADOR.filter((c) => c.obrigatorio && !m[c.chave]).map((c) => c.chave);
}
