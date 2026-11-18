-- JornadaCerta: alertas proativos de conformidade (migration 0023) em um banco que já tem as migrations 0001 a 0022.
-- Rode UMA vez. Transação única: se falhar, nada é aplicado.
begin;
-- Alertas proativos de conformidade para a gestão. Um job diário (worker) chama `avisar_conformidade`, que cria notificações
-- (com chave, sem repetir) em dois casos:
--  · EC 141: a fase da nova jornada se aproxima (90, 60, 30, 15 e 7 dias) ou já está em vigor (um aviso por semana) e ainda há
--    colaboradores com jornada acima do teto ou com menos folgas do que a fase exige. Datas e limites vêm de `regra_jornada`.
--  · Escala: faltam 10 ou 3 dias para o mês que vem e nenhuma escala publicada cobre o primeiro dia dele.
-- Só a gestão da empresa é avisada. Chamada pelo worker (papel privilegiado); ninguém mais executa.
create function nome_mes_pt(p_data date) returns text language sql immutable as $$
  select (array['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'])[extract(month from p_data)::int]
$$;

create function avisar_conformidade(p_hoje date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  emp record; f record; g uuid;
  v_sem text := to_char(p_hoje, 'IYYY-"W"IW');
  v_antes bigint; v_depois bigint; v_empresas int := 0;
  v_ini date; v_fim date; v_dias int; v_marco int; v_pend int; v_total int; v_teto int; v_folgas int; v_nome text; v_chave text; v_titulo text;
  v_prox date := (date_trunc('month', p_hoje) + interval '1 month')::date; v_falta int;
begin
  select count(*) into v_antes from notificacao where tipo in ('conformidade_ec', 'escala_pendente');
  for emp in select e.id from empresa e where exists (select 1 from colaborador c where c.empresa_id = e.id and (c.desligamento is null or c.desligamento >= p_hoje)) loop
    v_empresas := v_empresas + 1;

    -- ---- fases da EC 141
    for f in select codigo, vigencia, parametros from regra_jornada where ativa and codigo in ('EC141_F1', 'EC141_F2') and escopo = '{}'::jsonb order by codigo loop
      v_ini := lower(f.vigencia); v_fim := upper(f.vigencia);
      if v_ini is null then continue; end if;
      v_dias := v_ini - p_hoje;
      if v_dias > 90 or (v_fim is not null and p_hoje >= v_fim) then continue; end if;
      v_teto := coalesce((f.parametros ->> 'max_semanal_min')::int, 0);
      v_folgas := coalesce((f.parametros ->> 'folgas_semana')::int, 2);
      if v_teto <= 0 then continue; end if;
      select count(*) filter (where cv.jornada_semanal_min > v_teto
                                or coalesce(cv.folgas_semana, case cv.tipo_escala when '6x1' then 1 when '5x2' then 2 when '12x36' then 3 else 1 end) < v_folgas),
             count(*)
        into v_pend, v_total
        from colaborador c join contrato_versao cv on cv.colaborador_id = c.id and cv.vigencia @> p_hoje
       where c.empresa_id = emp.id and (c.desligamento is null or c.desligamento >= p_hoje);
      if v_pend = 0 then continue; end if;
      v_nome := case f.codigo when 'EC141_F1' then 'fase 1' else 'fase 2' end;
      if v_dias > 0 then
        v_marco := (select min(m) from unnest(array[7, 15, 30, 60, 90]) m where m >= v_dias);
        v_chave := 'ec141:' || emp.id || ':' || f.codigo || ':' || v_marco;
        v_titulo := 'EC 141: faltam ' || v_dias || case when v_dias = 1 then ' dia' else ' dias' end || ' para a ' || v_nome;
      else
        v_chave := 'ec141:' || emp.id || ':' || f.codigo || ':vigor:' || v_sem;
        v_titulo := 'EC 141: a ' || v_nome || ' já está em vigor';
      end if;
      for g in select * from usuarios_gestores_empresa(emp.id) loop
        perform notificar(g, emp.id, 'conformidade_ec', v_titulo,
          v_pend || ' de ' || v_total || case when v_total = 1 then ' colaborador ainda não atende' else ' colaboradores ainda não atendem' end
            || ' a jornada e as folgas da ' || v_nome || ' (' || to_char(v_ini, 'DD/MM/YYYY') || '). Veja a prontidão e gere a escala 5x2.',
          '/empresas/' || emp.id || '/prontidao', v_chave);
      end loop;
    end loop;

    -- ---- escala do mês que vem
    v_falta := v_prox - p_hoje;
    if v_falta <= 10 and not exists (select 1 from escala s where s.empresa_id = emp.id and s.status = 'publicada' and s.periodo @> v_prox) then
      v_marco := case when v_falta <= 3 then 3 else 10 end;
      for g in select * from usuarios_gestores_empresa(emp.id) loop
        perform notificar(g, emp.id, 'escala_pendente', 'Escala de ' || nome_mes_pt(v_prox) || ' ainda não foi publicada',
          'O mês começa em ' || v_falta || case when v_falta = 1 then ' dia' else ' dias' end || ' e nenhuma escala publicada cobre o dia ' || to_char(v_prox, 'DD/MM') || '. Gere, confira e publique para avisar a equipe.',
          '/empresas/' || emp.id || '/escalas', 'escala_pendente:' || emp.id || ':' || to_char(v_prox, 'YYYY-MM') || ':' || v_marco);
      end loop;
    end if;
  end loop;
  select count(*) into v_depois from notificacao where tipo in ('conformidade_ec', 'escala_pendente');
  return jsonb_build_object('empresas', v_empresas, 'avisos', v_depois - v_antes);
end $$;
revoke all on function nome_mes_pt(date), avisar_conformidade(date) from public, anon, authenticated;
commit;
