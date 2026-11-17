-- Cadastro manual de colaborador: pessoa + primeiro contrato (e setor, se for novo) em uma única operação.
create function cadastrar_colaborador(
  p_empresa uuid, p_nome text, p_cpf text, p_admissao date,
  p_salario numeric, p_jornada_min int, p_divisor int, p_tipo_escala text,
  p_setor_nome text default null, p_matricula text default null, p_cargo text default null, p_cbo text default null,
  p_escolaridade text default null, p_telefone text default null, p_turno text default null,
  p_folgas smallint default null, p_horas_extras_min int default 0)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare
  v_setor uuid; v_unidade uuid; v_id uuid; v_nome_setor text := nullif(btrim(p_setor_nome), '');
begin
  if not pode_gerir_empresa(p_empresa) then raise exception 'sem permissão'; end if;
  if length(normalizar_cpf(p_cpf)) <> 11 then raise exception 'CPF inválido'; end if;
  if exists (select 1 from colaborador where empresa_id = p_empresa and cpf_hash = hash_cpf(p_cpf)) then
    raise exception 'CPF já cadastrado nesta empresa';
  end if;

  if v_nome_setor is not null then
    select s.id into v_setor from setor s join unidade u on u.id = s.unidade_id
     where u.empresa_id = p_empresa and lower(s.nome) = lower(v_nome_setor) limit 1;
    if v_setor is null then
      select id into v_unidade from unidade where empresa_id = p_empresa order by nome limit 1;
      if v_unidade is null then
        insert into unidade (empresa_id, nome, municipio_ibge) select id, 'Matriz', municipio_ibge from empresa where id = p_empresa returning id into v_unidade;
      end if;
      insert into setor (unidade_id, nome) values (v_unidade, v_nome_setor) returning id into v_setor;
    end if;
  end if;

  insert into colaborador (empresa_id, setor_id, nome, cpf_cifrado, cpf_hash, matricula, cargo, cbo, admissao, escolaridade, telefone_cifrado)
  values (p_empresa, v_setor, btrim(p_nome), cifrar_texto(normalizar_cpf(p_cpf)), hash_cpf(p_cpf), nullif(btrim(p_matricula), ''), nullif(btrim(p_cargo), ''),
          nullif(btrim(p_cbo), ''), p_admissao, p_escolaridade, cifrar_texto(p_telefone))
  returning id into v_id;

  insert into contrato_versao (colaborador_id, vigencia, salario_base, jornada_semanal_min, divisor, tipo_escala, folgas_semana, turno, horas_extras_mensais_min)
  values (v_id, daterange(p_admissao, null, '[)'), p_salario, p_jornada_min, p_divisor, p_tipo_escala, p_folgas, nullif(btrim(p_turno), ''), coalesce(p_horas_extras_min, 0));
  return v_id;
end $$;

revoke all on function cadastrar_colaborador(uuid, text, text, date, numeric, int, int, text, text, text, text, text, text, text, text, smallint, int) from public, anon;
grant execute on function cadastrar_colaborador(uuid, text, text, date, numeric, int, int, text, text, text, text, text, text, text, text, smallint, int) to authenticated;
