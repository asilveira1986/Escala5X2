-- Edição, mudança de contrato, desligamento e reativação de colaborador. Todas conferem a permissão e deixam rastro de auditoria.

-- Setor pela empresa e pelo nome (cria o setor, e a unidade "Matriz" se ainda não houver unidade).
create function setor_por_nome(p_empresa uuid, p_nome text) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare v_nome text := nullif(btrim(p_nome), ''); v_setor uuid; v_unidade uuid;
begin
  if not pode_gerir_empresa(p_empresa) then raise exception 'sem permissão'; end if;
  if v_nome is null then return null; end if;
  select s.id into v_setor from setor s join unidade u on u.id = s.unidade_id where u.empresa_id = p_empresa and lower(s.nome) = lower(v_nome) limit 1;
  if v_setor is null then
    select id into v_unidade from unidade where empresa_id = p_empresa order by nome limit 1;
    if v_unidade is null then
      insert into unidade (empresa_id, nome, municipio_ibge) select id, 'Matriz', municipio_ibge from empresa where id = p_empresa returning id into v_unidade;
    end if;
    insert into setor (unidade_id, nome) values (v_unidade, v_nome) returning id into v_setor;
  end if;
  return v_setor;
end $$;

-- Dados da pessoa (o CPF não muda: é a identidade). Telefone vazio apaga o telefone.
create function atualizar_colaborador(
  p_colaborador uuid, p_nome text, p_setor_nome text default null, p_matricula text default null, p_cargo text default null,
  p_cbo text default null, p_escolaridade text default null, p_telefone text default null)
returns void language plpgsql security definer set search_path = public, auth as $$
declare c colaborador%rowtype;
begin
  select * into c from colaborador where id = p_colaborador;
  if c.id is null or not pode_gerir_empresa(c.empresa_id) then raise exception 'sem permissão'; end if;
  if length(btrim(coalesce(p_nome, ''))) < 2 then raise exception 'Nome obrigatório'; end if;
  update colaborador set nome = btrim(p_nome), setor_id = setor_por_nome(c.empresa_id, p_setor_nome), matricula = nullif(btrim(p_matricula), ''),
         cargo = nullif(btrim(p_cargo), ''), cbo = nullif(btrim(p_cbo), ''), escolaridade = p_escolaridade, telefone_cifrado = cifrar_texto(nullif(btrim(p_telefone), ''))
   where id = p_colaborador;
end $$;

-- Nova versão do contrato a partir de uma data (salário, jornada, escala...). O histórico é preservado.
create function alterar_contrato(
  p_colaborador uuid, p_a_partir_de date, p_salario numeric, p_jornada_min int, p_divisor int, p_tipo_escala text,
  p_turno text default null, p_folgas smallint default null, p_horas_extras_min int default 0)
returns void language plpgsql security definer set search_path = public, auth as $$
declare c colaborador%rowtype; u contrato_versao%rowtype; v_fim date;
begin
  select * into c from colaborador where id = p_colaborador;
  if c.id is null or not pode_gerir_empresa(c.empresa_id) then raise exception 'sem permissão'; end if;
  if p_a_partir_de < c.admissao then raise exception 'A data é anterior à admissão'; end if;
  if c.desligamento is not null and p_a_partir_de > c.desligamento then raise exception 'Colaborador desligado: reative antes de alterar o contrato'; end if;
  select * into u from contrato_versao where colaborador_id = p_colaborador order by lower(vigencia) desc limit 1;
  if u.id is null then raise exception 'Colaborador sem contrato'; end if;
  if p_a_partir_de < lower(u.vigencia) then raise exception 'A data é anterior ao início do contrato atual (%)', lower(u.vigencia); end if;
  v_fim := upper(u.vigencia);                       -- null = em aberto
  if v_fim is not null and p_a_partir_de >= v_fim then raise exception 'Não há contrato vigente nessa data'; end if;
  if p_a_partir_de = lower(u.vigencia) then
    update contrato_versao set salario_base = p_salario, jornada_semanal_min = p_jornada_min, divisor = p_divisor, tipo_escala = p_tipo_escala,
           folgas_semana = p_folgas, turno = nullif(btrim(p_turno), ''), horas_extras_mensais_min = coalesce(p_horas_extras_min, 0) where id = u.id;
  else
    update contrato_versao set vigencia = daterange(lower(vigencia), p_a_partir_de, '[)') where id = u.id;
    insert into contrato_versao (colaborador_id, vigencia, salario_base, jornada_semanal_min, divisor, tipo_escala, folgas_semana, turno, horas_extras_mensais_min)
    values (p_colaborador, daterange(p_a_partir_de, v_fim, '[)'), p_salario, p_jornada_min, p_divisor, p_tipo_escala, p_folgas, nullif(btrim(p_turno), ''), coalesce(p_horas_extras_min, 0));
  end if;
end $$;

-- Desligamento: registra a data (último dia de trabalho), encerra o contrato e remove o acesso ao aplicativo.
-- Devolve quantos dias de trabalho ainda estão em escalas (rascunho ou publicadas) depois da data, para a gestão ajustar.
create function desligar_colaborador(p_colaborador uuid, p_data date) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare c colaborador%rowtype; u contrato_versao%rowtype; v_dias int;
begin
  select * into c from colaborador where id = p_colaborador;
  if c.id is null or not pode_gerir_empresa(c.empresa_id) then raise exception 'sem permissão'; end if;
  if c.desligamento is not null then raise exception 'Colaborador já desligado'; end if;
  if p_data < c.admissao then raise exception 'O desligamento não pode ser anterior à admissão'; end if;
  select * into u from contrato_versao where colaborador_id = p_colaborador order by lower(vigencia) desc limit 1;
  if u.id is not null then
    if lower(u.vigencia) > p_data then raise exception 'Há um contrato que começa depois dessa data (%)', lower(u.vigencia); end if;
    if upper_inf(u.vigencia) or upper(u.vigencia) > p_data + 1 then
      update contrato_versao set vigencia = daterange(lower(vigencia), p_data + 1, '[)') where id = u.id;
    end if;
  end if;
  update colaborador set desligamento = p_data where id = p_colaborador;
  if c.usuario_id is not null then perform revogar_acesso_colaborador(p_colaborador); end if;
  perform auditoria_evento(c.organizacao_id, 'colaborador', c.id::text, 'desligamento');
  select count(*) into v_dias from alocacao a join escala e on e.id = a.escala_id
   where a.colaborador_id = p_colaborador and a.tipo = 'trabalho' and a.data > p_data and e.status in ('rascunho', 'publicada');
  return jsonb_build_object('dias_em_escala', v_dias);
end $$;

-- Reativação (desligamento lançado por engano ou recontratação): reabre o último contrato.
create function reativar_colaborador(p_colaborador uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare c colaborador%rowtype; u contrato_versao%rowtype;
begin
  select * into c from colaborador where id = p_colaborador;
  if c.id is null or not pode_gerir_empresa(c.empresa_id) then raise exception 'sem permissão'; end if;
  if c.desligamento is null then raise exception 'Colaborador não está desligado'; end if;
  select * into u from contrato_versao where colaborador_id = p_colaborador order by lower(vigencia) desc limit 1;
  if u.id is not null and not upper_inf(u.vigencia) then
    update contrato_versao set vigencia = daterange(lower(vigencia), null, '[)') where id = u.id;
  end if;
  update colaborador set desligamento = null where id = p_colaborador;
  perform auditoria_evento(c.organizacao_id, 'colaborador', c.id::text, 'reativacao');
end $$;

revoke all on function setor_por_nome(uuid, text), atualizar_colaborador(uuid, text, text, text, text, text, text, text),
  alterar_contrato(uuid, date, numeric, int, int, text, text, smallint, int), desligar_colaborador(uuid, date), reativar_colaborador(uuid) from public, anon;
grant execute on function atualizar_colaborador(uuid, text, text, text, text, text, text, text),
  alterar_contrato(uuid, date, numeric, int, int, text, text, smallint, int), desligar_colaborador(uuid, date), reativar_colaborador(uuid) to authenticated;
