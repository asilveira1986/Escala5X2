-- Entrada completa da escala para o motor de validação (lida com o RLS/autorização do usuário).
create function escala_entrada(p_escala uuid) returns jsonb
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
                   'inicioMin', a.inicio_min, 'fimMin', a.fim_min, 'intervaloMin', a.intervalo_min) order by a.data, a.colaborador_id), '[]')
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
revoke all on function escala_entrada(uuid) from public, anon;
grant execute on function escala_entrada(uuid) to authenticated;
