-- JornadaCerta: solicitações e trocas (migration 0013) em um banco que já tem as migrations 0001 a 0012.
-- Rode UMA vez. Transação única: se falhar, nada é aplicado.
begin;
-- Solicitações do colaborador: troca de turno com colega, troca de folga, férias e afastamento (atestado).
-- Fluxo: [troca de turno] aguardando_colega → pendente (RH) → aprovada | recusada; cancelável pelo solicitante enquanto aberta.
-- Toda mudança passa por função (nada de escrita direta). O efeito na escala/ausência é aplicado pelo servidor ao aprovar,
-- depois de o motor de regras validar o resultado; aqui o banco só garante quem pode pedir, o quê e o estado do fluxo.
create table solicitacao (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  empresa_id uuid not null references empresa(id) on delete cascade,
  solicitante_id uuid not null references colaborador(id),
  destinatario_id uuid references colaborador(id),
  solicitante_nome text not null,
  destinatario_nome text,
  tipo text not null check (tipo in ('troca_turno','troca_folga','ferias','afastamento')),
  payload jsonb not null,
  motivo text check (motivo is null or length(motivo) <= 300),
  status text not null default 'pendente' check (status in ('aguardando_colega','pendente','aprovada','recusada','cancelada')),
  decisao_motivo text,
  validacao jsonb,                                  -- resultado do motor de regras no momento da decisão
  colega_respondeu_em timestamptz,
  decidido_por uuid references usuario(id),
  decidido_em timestamptz,
  canal text not null default 'web' check (canal in ('web','app','whatsapp')),
  criado_em timestamptz not null default now(),
  check ((tipo = 'troca_turno') = (destinatario_id is not null))
);
create index solicitacao_empresa_idx on solicitacao (empresa_id, status, criado_em desc);
create index solicitacao_solicitante_idx on solicitacao (solicitante_id, criado_em desc);
create index solicitacao_destinatario_idx on solicitacao (destinatario_id) where destinatario_id is not null;
create index solicitacao_org_idx on solicitacao (organizacao_id);
create index solicitacao_decidido_idx on solicitacao (decidido_por);
-- Pedido idêntico em aberto não se repete.
create unique index solicitacao_aberta_unica on solicitacao (solicitante_id, tipo, (payload::text)) where status in ('aguardando_colega','pendente');

create function hoje_sp() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- Turnos de trabalho do colaborador numa escala publicada (apoio à validação dos pedidos).
create function trabalha_na_escala(p_escala uuid, p_colab uuid, p_data date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from alocacao a join escala e on e.id = a.escala_id
                  where a.escala_id = p_escala and a.colaborador_id = p_colab and a.data = p_data and a.tipo = 'trabalho' and e.status = 'publicada') $$;

create function criar_solicitacao(p_colaborador uuid, p_tipo text, p_payload jsonb, p_destinatario uuid default null, p_motivo text default null) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare c colaborador%rowtype; d colaborador%rowtype; e escala%rowtype; v_hoje date := hoje_sp(); v_id uuid; v_status text := 'pendente';
        v_esc uuid; v_a date; v_b date; v_ini date; v_fim date; v_max int;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  select * into c from colaborador where id = p_colaborador and usuario_id = auth.uid();
  if c.id is null then raise exception 'sem permissão'; end if;
  if (select count(*) from solicitacao where solicitante_id = c.id and status in ('aguardando_colega','pendente')) >= 10 then
    raise exception 'Você já tem 10 pedidos em aberto. Aguarde as respostas ou cancele algum.';
  end if;
  if jsonb_typeof(coalesce(p_payload, 'null'::jsonb)) <> 'object' then raise exception 'pedido inválido'; end if;

  if p_tipo in ('troca_turno', 'troca_folga') then
    v_esc := nullif(p_payload ->> 'escalaId', '')::uuid;
    select * into e from escala where id = v_esc;
    if e.id is null or e.empresa_id <> c.empresa_id or e.status <> 'publicada' then raise exception 'A escala informada não está publicada para você.'; end if;
    if p_tipo = 'troca_turno' then
      v_a := nullif(p_payload ->> 'dataSolicitante', '')::date; v_b := nullif(p_payload ->> 'dataColega', '')::date;
      if v_a is null or v_b is null or v_a < v_hoje or v_b < v_hoje then raise exception 'Só dá para trocar turnos de hoje em diante.'; end if;
      select * into d from colaborador where id = p_destinatario;
      if d.id is null or d.empresa_id <> c.empresa_id or d.id = c.id then raise exception 'Escolha um colega da sua empresa.'; end if;
      if d.usuario_id is null then raise exception 'Esse colega ainda não tem acesso ao aplicativo para aceitar a troca.'; end if;
      if not trabalha_na_escala(e.id, c.id, v_a) then raise exception 'Você não tem turno de trabalho em %.', to_char(v_a, 'DD/MM/YYYY'); end if;
      if not trabalha_na_escala(e.id, d.id, v_b) then raise exception 'O colega não tem turno de trabalho em %.', to_char(v_b, 'DD/MM/YYYY'); end if;
      v_status := 'aguardando_colega';
    else
      v_a := nullif(p_payload ->> 'trabalharEm', '')::date; v_b := nullif(p_payload ->> 'folgarEm', '')::date;
      if v_a is null or v_b is null or v_a = v_b or v_a < v_hoje or v_b < v_hoje then raise exception 'Escolha dois dias diferentes, de hoje em diante.'; end if;
      if not e.periodo @> v_a or not e.periodo @> v_b then raise exception 'Os dois dias precisam estar dentro do período da escala.'; end if;
      if not trabalha_na_escala(e.id, c.id, v_b) then raise exception 'Você não tem turno de trabalho em %.', to_char(v_b, 'DD/MM/YYYY'); end if;
      if trabalha_na_escala(e.id, c.id, v_a) then raise exception 'Você já trabalha em %.', to_char(v_a, 'DD/MM/YYYY'); end if;
    end if;
  elsif p_tipo in ('ferias', 'afastamento') then
    v_ini := nullif(p_payload ->> 'inicio', '')::date; v_fim := nullif(p_payload ->> 'fim', '')::date;
    if v_ini is null or v_fim is null or v_fim < v_ini then raise exception 'Informe o primeiro e o último dia.'; end if;
    if p_tipo = 'ferias' and v_ini < v_hoje then raise exception 'As férias precisam começar de hoje em diante.'; end if;
    if p_tipo = 'afastamento' and v_ini < v_hoje - 30 then raise exception 'O afastamento só pode ser informado até 30 dias depois do início.'; end if;
    v_max := case p_tipo when 'ferias' then 44 else 59 end;
    if v_fim - v_ini > v_max then raise exception 'O período é longo demais para um único pedido.'; end if;
    if exists (select 1 from ausencia x where x.colaborador_id = c.id and x.periodo && daterange(v_ini, v_fim + 1)) then
      raise exception 'Você já tem férias ou afastamento lançados nesse período.';
    end if;
    if p_destinatario is not null then raise exception 'Esse tipo de pedido não tem colega.'; end if;
  else
    raise exception 'tipo de pedido inválido';
  end if;

  if exists (select 1 from solicitacao x where x.solicitante_id = c.id and x.tipo = p_tipo and x.payload = p_payload and x.status in ('aguardando_colega', 'pendente')) then
    raise exception 'Você já fez esse pedido e ele ainda está em aberto.';
  end if;
  insert into solicitacao (organizacao_id, empresa_id, solicitante_id, destinatario_id, solicitante_nome, destinatario_nome, tipo, payload, motivo, status)
  values (c.organizacao_id, c.empresa_id, c.id, case when p_tipo = 'troca_turno' then d.id end, c.nome, case when p_tipo = 'troca_turno' then d.nome end,
          p_tipo, p_payload, nullif(btrim(coalesce(p_motivo, '')), ''), v_status)
  returning id into v_id;
  perform auditoria_evento(c.organizacao_id, 'solicitacao', v_id::text, 'criar');
  return v_id;
end $$;

-- O colega aceita ou recusa a troca de turno.
create function responder_solicitacao(p_id uuid, p_aceita boolean) returns void
language plpgsql security definer set search_path = public, auth as $$
declare s solicitacao%rowtype;
begin
  select * into s from solicitacao where id = p_id;
  if s.id is null or s.destinatario_id is null or not exists (select 1 from colaborador c where c.id = s.destinatario_id and c.usuario_id = auth.uid()) then raise exception 'sem permissão'; end if;
  if s.status <> 'aguardando_colega' then raise exception 'Este pedido não está mais aguardando a sua resposta.'; end if;
  update solicitacao set status = case when p_aceita then 'pendente' else 'recusada' end, colega_respondeu_em = now(),
         decisao_motivo = case when p_aceita then null else 'Recusada pelo colega.' end where id = p_id;
  perform auditoria_evento(s.organizacao_id, 'solicitacao', p_id::text, case when p_aceita then 'colega_aceitou' else 'colega_recusou' end);
end $$;

create function cancelar_solicitacao(p_id uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare s solicitacao%rowtype;
begin
  select * into s from solicitacao where id = p_id;
  if s.id is null or not exists (select 1 from colaborador c where c.id = s.solicitante_id and c.usuario_id = auth.uid()) then raise exception 'sem permissão'; end if;
  if s.status not in ('aguardando_colega', 'pendente') then raise exception 'Este pedido já foi encerrado.'; end if;
  update solicitacao set status = 'cancelada' where id = p_id;
  perform auditoria_evento(s.organizacao_id, 'solicitacao', p_id::text, 'cancelar');
end $$;

-- Decisão do RH. O servidor valida e aplica o efeito ANTES de chamar; aqui fica o registro e a trava do estado.
create function decidir_solicitacao(p_id uuid, p_aprovar boolean, p_motivo text default null, p_validacao jsonb default null) returns void
language plpgsql security definer set search_path = public, auth as $$
declare s solicitacao%rowtype;
begin
  select * into s from solicitacao where id = p_id for update;
  if s.id is null or not pode_gerir_empresa(s.empresa_id) then raise exception 'sem permissão'; end if;
  if s.status <> 'pendente' then raise exception 'Este pedido não está pendente de decisão.'; end if;
  if not p_aprovar and length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo da recusa.'; end if;
  if p_aprovar and s.tipo in ('ferias', 'afastamento') then
    -- o lançamento da ausência e a decisão acontecem juntos: se houver sobreposição, nada é gravado
    insert into ausencia (empresa_id, colaborador_id, periodo, tipo, observacao)
    values (s.empresa_id, s.solicitante_id, daterange((s.payload ->> 'inicio')::date, (s.payload ->> 'fim')::date + 1), s.tipo, 'Pedido aprovado');
  end if;
  update solicitacao set status = case when p_aprovar then 'aprovada' else 'recusada' end, decisao_motivo = nullif(btrim(coalesce(p_motivo, '')), ''),
         validacao = p_validacao, decidido_por = auth.uid(), decidido_em = now() where id = p_id;
  perform auditoria_evento(s.organizacao_id, 'solicitacao', p_id::text, case when p_aprovar then 'aprovar' else 'recusar' end);
end $$;

-- Versão vigente (publicada) da mesma escala: depois de uma troca aprovada a escala ganha uma nova versão, e pedidos
-- antigos continuam apontando para a versão em que foram feitos.
create function escala_vigente(p_escala uuid) returns uuid
language sql stable security definer set search_path = public, auth as $$
  select v.id from escala e join escala v on v.empresa_id = e.empresa_id and v.periodo = e.periodo and v.setor_id is not distinct from e.setor_id and v.status = 'publicada'
   where e.id = p_escala and pode_acessar_empresa(e.empresa_id) limit 1
$$;

-- Escalas publicadas que cobrem algum dia do período (para avisar o RH de turnos em conflito com férias/afastamento).
create function escalas_publicadas_no_periodo(p_empresa uuid, p_inicio date, p_fim date) returns uuid[]
language sql stable security definer set search_path = public, auth as $$
  select coalesce(array_agg(e.id order by e.id), '{}') from escala e
   where pode_acessar_empresa(p_empresa) and e.empresa_id = p_empresa and e.status = 'publicada' and e.periodo && daterange(p_inicio, p_fim + 1)
$$;

-- Nova versão em rascunho a partir de uma publicada (mesma lógica do botão "Criar nova versão", agora também para o servidor).
create function criar_versao_rascunho(p_escala uuid) returns uuid
language plpgsql security invoker set search_path = public, auth as $$
declare e escala%rowtype; v_id uuid;
begin
  select * into e from escala where id = p_escala;
  if e.id is null then raise exception 'Escala não encontrada ou sem permissão.'; end if;
  if e.status <> 'publicada' then raise exception 'Só uma escala publicada pode ganhar nova versão.'; end if;
  insert into escala (empresa_id, setor_id, nome, periodo, criado_por) values (e.empresa_id, e.setor_id, e.nome, e.periodo, auth.uid()) returning id into v_id;
  insert into alocacao (escala_id, colaborador_id, data, tipo, inicio_min, fim_min, intervalo_min, turno_modelo_id)
  select v_id, a.colaborador_id, a.data, a.tipo, a.inicio_min, a.fim_min, a.intervalo_min, a.turno_modelo_id from alocacao a where a.escala_id = p_escala;
  return v_id;
end $$;

create function descartar_versao_rascunho(p_escala uuid) returns void
language plpgsql security invoker set search_path = public, auth as $$
begin
  delete from escala where id = p_escala and status = 'rascunho';
end $$;

-- Colegas e turnos futuros da escala publicada em que EU trabalho (o RLS de alocacao só deixa ver os próprios turnos).
create function escala_colegas(p_escala uuid) returns table (colaborador_id uuid, nome text, data date, inicio_min int, fim_min int, intervalo_min int)
language sql stable security definer set search_path = public, auth as $$
  select c.id, c.nome, a.data, a.inicio_min, a.fim_min, a.intervalo_min
    from escala e
    join alocacao a on a.escala_id = e.id and a.tipo = 'trabalho' and a.data >= hoje_sp()
    join colaborador c on c.id = a.colaborador_id and c.usuario_id is not null
   where e.id = p_escala and e.status = 'publicada'
     and exists (select 1 from colaborador eu join alocacao ea on ea.colaborador_id = eu.id and ea.escala_id = e.id
                  where eu.usuario_id = auth.uid() and eu.empresa_id = e.empresa_id)
   order by a.data, c.nome
$$;

revoke all on function criar_solicitacao(uuid, text, jsonb, uuid, text), responder_solicitacao(uuid, boolean), cancelar_solicitacao(uuid),
  decidir_solicitacao(uuid, boolean, text, jsonb), escala_colegas(uuid), trabalha_na_escala(uuid, uuid, date), escala_vigente(uuid),
  escalas_publicadas_no_periodo(uuid, date, date), criar_versao_rascunho(uuid), descartar_versao_rascunho(uuid) from public, anon;
grant execute on function criar_solicitacao(uuid, text, jsonb, uuid, text), responder_solicitacao(uuid, boolean), cancelar_solicitacao(uuid),
  decidir_solicitacao(uuid, boolean, text, jsonb), escala_colegas(uuid), hoje_sp(), escala_vigente(uuid), escalas_publicadas_no_periodo(uuid, date, date), criar_versao_rascunho(uuid), descartar_versao_rascunho(uuid) to authenticated;
revoke execute on function trabalha_na_escala(uuid, uuid, date) from authenticated;

alter table solicitacao enable row level security;
create policy solicitacao_select on solicitacao for select to authenticated
  using (pode_acessar_empresa(empresa_id) or eh_proprio_colaborador(solicitante_id) or (destinatario_id is not null and eh_proprio_colaborador(destinatario_id)));
grant select on solicitacao to authenticated;
select auditar_tabela('solicitacao');

-- A entrada da escala passa a trazer o modelo de turno de cada alocação (uma nova versão preserva as cores/modelos).
-- Entrada completa da escala para o motor de validação (lida com o RLS/autorização do usuário).
create or replace function escala_entrada(p_escala uuid) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare e escala%rowtype; emp empresa%rowtype; v jsonb; v_ini date; v_fim date;
begin
  select * into e from escala where id = p_escala;
  if e.id is null or not pode_acessar_empresa(e.empresa_id) then raise exception 'sem permissão'; end if;
  select * into emp from empresa where id = e.empresa_id;
  v_ini := lower(e.periodo); v_fim := upper(e.periodo) - 1;
  select jsonb_build_object(
    'escala', jsonb_build_object('id', e.id, 'empresa_id', e.empresa_id, 'setor_id', e.setor_id, 'nome', e.nome, 'status', e.status,
                                  'revisao', e.revisao, 'versao', e.versao, 'inicio', v_ini, 'fim', v_fim),
    'empresa', jsonb_build_object('id', emp.id, 'porte', emp.porte, 'terceirizada_publica', emp.terceirizada_publica,
                                   'uf', emp.uf, 'municipio_ibge', emp.municipio_ibge),
    'regras', (select coalesce(jsonb_agg(jsonb_build_object('codigo', r.codigo, 'vigencia', r.vigencia::text, 'escopo', r.escopo,
                 'parametros', r.parametros, 'prioridade', r.prioridade, 'ativa', r.ativa) order by r.codigo, lower(r.vigencia)), '[]')
                 from regra_jornada r),
    'colaboradores', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'nome', c.nome, 'setor', s.nome, 'turno', cv.turno, 'escolaridade', c.escolaridade,
        'admissao', c.admissao, 'desligamento', c.desligamento,
        'salario_centavos', round(cv.salario_base * 100)::bigint, 'jornada_semanal_min', cv.jornada_semanal_min,
        'divisor', cv.divisor, 'tipo_escala', cv.tipo_escala, 'folgas_semana', cv.folgas_semana,
        'horas_extras_mensais_min', cv.horas_extras_mensais_min,
        'acordos', (select coalesce(jsonb_agg(jsonb_build_object(
            'id', a.id, 'vigencia', a.vigencia::text, 'status', a.status,
            'clausulas', (select coalesce(jsonb_agg(jsonb_build_object('tipo', cl.tipo, 'parametros', cl.parametros)), '[]')
                            from clausula_jornada cl where cl.acordo_id = a.id))), '[]')
                      from colaborador_acordo ca join acordo_coletivo a on a.id = ca.acordo_id where ca.colaborador_id = c.id)
      ) order by c.nome), '[]')
      from colaborador c
      join lateral (select * from contrato_versao x where x.colaborador_id = c.id and x.vigencia && e.periodo
                     order by lower(x.vigencia) desc limit 1) cv on true
      left join setor s on s.id = c.setor_id
     where c.empresa_id = e.empresa_id
       and c.admissao <= v_fim and (c.desligamento is null or c.desligamento >= v_ini)
       and (e.setor_id is null or c.setor_id = e.setor_id
            or exists (select 1 from alocacao a where a.escala_id = e.id and a.colaborador_id = c.id))),
    'sem_contrato', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome) order by c.nome), '[]')
                       from colaborador c
                      where c.empresa_id = e.empresa_id and c.admissao <= v_fim and (c.desligamento is null or c.desligamento >= v_ini)
                        and (e.setor_id is null or c.setor_id = e.setor_id)
                        and not exists (select 1 from contrato_versao x where x.colaborador_id = c.id and x.vigencia && e.periodo)),
    'alocacoes', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'colaboradorId', a.colaborador_id, 'data', a.data, 'tipo', a.tipo,
                   'inicioMin', a.inicio_min, 'fimMin', a.fim_min, 'intervaloMin', a.intervalo_min, 'turnoModeloId', a.turno_modelo_id) order by a.data, a.colaborador_id), '[]')
                   from alocacao a where a.escala_id = e.id),
    -- turnos já publicados nos 8 dias anteriores (interjornada e semanas que atravessam a virada)
    'anteriores', (select coalesce(jsonb_agg(jsonb_build_object('colaboradorId', a.colaborador_id, 'data', a.data, 'tipo', a.tipo,
                   'inicioMin', a.inicio_min, 'fimMin', a.fim_min, 'intervaloMin', a.intervalo_min) order by a.data), '[]')
                   from alocacao a join escala o on o.id = a.escala_id
                  where o.empresa_id = e.empresa_id and o.status = 'publicada' and o.id <> e.id
                    and a.data between v_ini - 8 and v_ini - 1),
    'ausencias', (select coalesce(jsonb_agg(jsonb_build_object('colaboradorId', x.colaborador_id, 'inicio', lower(x.periodo),
                   'fim', upper(x.periodo) - 1, 'tipo', x.tipo)), '[]')
                   from ausencia x where x.empresa_id = e.empresa_id and x.periodo && daterange(v_ini - 8, v_fim + 1)),
    'feriados', (select coalesce(jsonb_agg(jsonb_build_object('data', f.data, 'nome', f.nome, 'abrangencia', f.abrangencia) order by f.data), '[]')
                   from feriado f where f.data between v_ini - 8 and v_fim
                    and (f.abrangencia = 'nacional' or (f.abrangencia = 'estadual' and f.uf = emp.uf)
                         or (f.abrangencia = 'municipal' and f.municipio_ibge = emp.municipio_ibge))),
    'cobertura', (select coalesce(jsonb_agg(jsonb_build_object('diaSemana', d.dia_semana, 'faixaInicioMin', d.faixa_inicio_min,
                   'faixaFimMin', d.faixa_fim_min, 'minimo', d.minimo, 'ideal', d.ideal)), '[]')
                   from demanda_cobertura d where d.empresa_id = e.empresa_id and (d.setor_id is null or d.setor_id = e.setor_id))
  ) into v;
  return v;
end $$;
commit;
