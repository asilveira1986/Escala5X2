-- Banco de horas alimentado pelo ponto: lançamentos de origem 'ponto' em lote, conferidos pela gestão.
-- Cada item segue as MESMAS regras do lançamento manual (acordo com cláusula de banco de horas para crédito, limite de saldo,
-- prazo de compensação, saldo negativo permitido), mas um item recusado não derruba os demais: volta com o motivo.
-- Um dia só recebe um lançamento de ponto por colaborador (a menos que o anterior tenha sido estornado).
create function lancar_banco_horas_ponto(p_empresa uuid, p_itens jsonb) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  e empresa%rowtype; it jsonb; c colaborador%rowtype; k record; v_hoje date := hoje_sp(); v_data date; v_min int; v_saldo int; v_prazo int; v_lim int; v_neg int; v_venc date;
  v_ok int := 0; v_recusados jsonb := '[]'::jsonb; v_desc text;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  select * into e from empresa where id = p_empresa;
  if e.id is null or not pode_gerir_empresa(p_empresa) then raise exception 'sem permissão'; end if;
  if coalesce(jsonb_typeof(p_itens), '') <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Nenhum item para lançar.'; end if;
  if jsonb_array_length(p_itens) > 2000 then raise exception 'Itens demais de uma vez (máximo 2000).'; end if;

  for it in select * from jsonb_array_elements(p_itens) loop
    begin
      select * into c from colaborador where id = (it ->> 'colaboradorId')::uuid and empresa_id = p_empresa;
      if c.id is null then raise exception 'Colaborador não encontrado nesta empresa.'; end if;
      v_data := (it ->> 'data')::date; v_min := (it ->> 'minutos')::int;
      if v_min is null or v_min = 0 or abs(v_min) > 1440 then raise exception 'Minutos inválidos.'; end if;
      if v_data > v_hoje then raise exception 'Não dá para lançar data futura.'; end if;
      if v_data < v_hoje - 400 then raise exception 'Data fora do intervalo permitido.'; end if;
      if c.admissao > v_data then raise exception 'A data é anterior à admissão.'; end if;
      if exists (select 1 from banco_horas_lancamento l where l.colaborador_id = c.id and l.data = v_data and l.origem = 'ponto'
                    and not exists (select 1 from banco_horas_lancamento x where x.estorna_id = l.id)) then
        raise exception 'Este dia já foi lançado pelo ponto.';
      end if;
      select * into k from banco_horas_clausula(c.id, v_data);
      v_saldo := banco_horas_saldo(c.id);
      v_venc := null;
      if v_min > 0 then
        if k.acordo_id is null then raise exception 'Sem acordo com banco de horas vigente: as horas a mais devem ser pagas como extra.'; end if;
        v_prazo := coalesce((k.parametros ->> 'prazo_meses')::int, 6);
        if v_prazo < 1 or v_prazo > 12 then raise exception 'A cláusula de banco de horas tem prazo inválido.'; end if;
        v_lim := nullif(k.parametros ->> 'limite_saldo_min', '')::int;
        if v_lim is not null and v_saldo + v_min > v_lim then raise exception 'O saldo passaria do limite do acordo.'; end if;
        v_venc := (v_data + make_interval(months => v_prazo))::date;
      else
        v_neg := coalesce((k.parametros ->> 'limite_negativo_min')::int, 0);
        if v_saldo + v_min < -v_neg then raise exception 'O saldo ficaria abaixo do permitido.'; end if;
      end if;
      v_desc := left(coalesce(nullif(btrim(it ->> 'descricao'), ''), 'Apurado pelo ponto'), 300);
      insert into banco_horas_lancamento (organizacao_id, empresa_id, colaborador_id, data, minutos, origem, descricao, vence_em, acordo_id, criado_por)
      values (c.organizacao_id, c.empresa_id, c.id, v_data, v_min, 'ponto', v_desc, v_venc, k.acordo_id, auth.uid());
      v_ok := v_ok + 1;
    exception when others then
      v_recusados := v_recusados || jsonb_build_object('colaboradorId', it ->> 'colaboradorId', 'data', it ->> 'data', 'motivo', sqlerrm);
    end;
  end loop;
  perform auditoria_evento(e.organizacao_id, 'banco_horas_lancamento', p_empresa::text, 'lote_ponto:' || v_ok || '/' || jsonb_array_length(p_itens));
  return jsonb_build_object('lancados', v_ok, 'recusados', v_recusados);
end $$;

revoke all on function lancar_banco_horas_ponto(uuid, jsonb) from public, anon;
grant execute on function lancar_banco_horas_ponto(uuid, jsonb) to authenticated;
