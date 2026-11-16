-- Painel da carteira: uma linha por empresa visível ao usuário (próprias e as vinculadas ao escritório),
-- com o que o contador precisa para priorizar. SECURITY INVOKER: o RLS decide quais empresas e números aparecem.
create function painel_carteira(p_mes date default current_date) returns table (
  empresa_id uuid, razao_social text, cnpj text, porte text, uf text, status_adequacao text, organizacao_nome text,
  colaboradores int, sem_contrato int,
  diagnostico_id uuid, diagnostico_em date, diagnostico_total int, diagnostico_a_adequar int,
  escalas_publicadas int, escalas_rascunho int, ciencias_pendentes int, sem_acesso int,
  importacao_erro boolean
) language sql stable security invoker set search_path = public, auth as $$
  with mes as (select date_trunc('month', p_mes)::date as ini, (date_trunc('month', p_mes) + interval '1 month')::date as fim)
  select e.id, e.razao_social, e.cnpj, e.porte::text, e.uf::text, e.status_adequacao::text, o.nome,
         (select count(*)::int from colaborador c
           where c.empresa_id = e.id and (c.desligamento is null or c.desligamento >= p_mes)
             and exists (select 1 from contrato_versao cv where cv.colaborador_id = c.id and cv.vigencia @> p_mes)),
         (select count(*)::int from colaborador c
           where c.empresa_id = e.id and (c.desligamento is null or c.desligamento >= p_mes)
             and not exists (select 1 from contrato_versao cv where cv.colaborador_id = c.id and cv.vigencia @> p_mes)),
         d.id, d.data_referencia, nullif(d.resumo -> 'resumo' ->> 'total', '')::int,
         case when d.resumo -> 'resumo' -> 'porClassificacao' is null then null
              else coalesce((d.resumo -> 'resumo' -> 'porClassificacao' ->> 'adequacao_f1')::int, 0)
                 + coalesce((d.resumo -> 'resumo' -> 'porClassificacao' ->> 'adequacao_f2')::int, 0) end,
         (select count(*)::int from escala s, mes where s.empresa_id = e.id and s.status = 'publicada' and s.periodo && daterange(mes.ini, mes.fim)),
         (select count(*)::int from escala s, mes where s.empresa_id = e.id and s.status = 'rascunho' and s.periodo && daterange(mes.ini, mes.fim)),
         -- quem tem acesso ao app, está em escala publicada do mês e ainda não deu ciência
         (select count(distinct (s.id, a.colaborador_id))::int from escala s join alocacao a on a.escala_id = s.id cross join mes
           where s.empresa_id = e.id and s.status = 'publicada' and s.periodo && daterange(mes.ini, mes.fim)
             and exists (select 1 from colaborador c where c.id = a.colaborador_id and c.usuario_id is not null)
             and not exists (select 1 from ciencia ci where ci.escala_id = s.id and ci.colaborador_id = a.colaborador_id)),
         (select count(distinct a.colaborador_id)::int from escala s join alocacao a on a.escala_id = s.id cross join mes
           where s.empresa_id = e.id and s.status = 'publicada' and s.periodo && daterange(mes.ini, mes.fim)
             and exists (select 1 from colaborador c where c.id = a.colaborador_id and c.usuario_id is null)),
         coalesce((select i.status = 'erro' from importacao i where i.empresa_id = e.id order by i.criado_em desc limit 1), false)
    from empresa e
    left join organizacao o on o.id = e.organizacao_id   -- o RLS esconde a organização-cliente do escritório: nome nulo
    left join lateral (select dg.id, dg.data_referencia, dg.resumo from diagnostico dg where dg.empresa_id = e.id order by dg.criado_em desc limit 1) d on true
   order by e.razao_social
$$;
revoke all on function painel_carteira(date) from public, anon;
grant execute on function painel_carteira(date) to authenticated;
