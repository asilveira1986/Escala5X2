-- Salva a grade do editor de uma vez, com trava otimista (revisão) e gravando só o que mudou
-- (a auditoria registra cada linha alterada; regravar tudo a cada clique inflaria a trilha).
-- Security invoker: o RLS e os gatilhos de 0006 decidem quem pode gravar e em qual escala.
create function salvar_alocacoes(p_escala uuid, p_revisao int, p_alocacoes jsonb) returns int
language plpgsql security invoker set search_path = public, auth as $$
declare v_rev int; v_status text; v_removidas int; v_novas int;
begin
  if jsonb_typeof(coalesce(p_alocacoes, '[]'::jsonb)) <> 'array' then raise exception 'alocações inválidas'; end if;
  select revisao, status into v_rev, v_status from escala where id = p_escala for update;
  if v_rev is null then raise exception 'Escala não encontrada ou sem permissão.'; end if;
  if v_status <> 'rascunho' then raise exception 'Escala publicada é imutável; crie uma nova versão.'; end if;
  if v_rev <> p_revisao then raise exception 'A escala foi alterada por outra pessoa (revisão % → %). Recarregue a página.', p_revisao, v_rev; end if;

  create temp table if not exists _novas_alocacoes (colaborador_id uuid, data date, tipo text, inicio_min int, fim_min int, intervalo_min int, turno_modelo_id uuid) on commit drop;
  truncate _novas_alocacoes;
  insert into _novas_alocacoes
  select (x ->> 'colaboradorId')::uuid, (x ->> 'data')::date, x ->> 'tipo', nullif(x ->> 'inicioMin', '')::int, nullif(x ->> 'fimMin', '')::int,
         coalesce(nullif(x ->> 'intervaloMin', '')::int, 0), nullif(x ->> 'turnoModeloId', '')::uuid
    from jsonb_array_elements(coalesce(p_alocacoes, '[]'::jsonb)) x;

  delete from alocacao a where a.escala_id = p_escala
     and not exists (select 1 from _novas_alocacoes n
                      where n.colaborador_id = a.colaborador_id and n.data = a.data and n.tipo = a.tipo
                        and n.inicio_min is not distinct from a.inicio_min and n.fim_min is not distinct from a.fim_min
                        and n.intervalo_min = a.intervalo_min and n.turno_modelo_id is not distinct from a.turno_modelo_id);
  get diagnostics v_removidas = row_count;
  insert into alocacao (escala_id, colaborador_id, data, tipo, inicio_min, fim_min, intervalo_min, turno_modelo_id)
  select p_escala, n.colaborador_id, n.data, n.tipo, n.inicio_min, n.fim_min, n.intervalo_min, n.turno_modelo_id
    from _novas_alocacoes n
   where not exists (select 1 from alocacao a where a.escala_id = p_escala and n.colaborador_id = a.colaborador_id and n.data = a.data and n.tipo = a.tipo
                        and n.inicio_min is not distinct from a.inicio_min and n.fim_min is not distinct from a.fim_min
                        and n.intervalo_min = a.intervalo_min and n.turno_modelo_id is not distinct from a.turno_modelo_id);
  get diagnostics v_novas = row_count;
  select revisao into v_rev from escala where id = p_escala;
  return v_rev;
end $$;
revoke all on function salvar_alocacoes(uuid, int, jsonb) from public, anon;
grant execute on function salvar_alocacoes(uuid, int, jsonb) to authenticated;
