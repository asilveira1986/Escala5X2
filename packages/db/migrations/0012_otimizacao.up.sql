-- Otimização automática de escalas (Fase 3). O usuário pede (RPC); o worker processa (papel privilegiado) e grava o
-- resultado; a tela lê (RLS). Nenhuma proposta chega à grade sem passar pela revalidação do motor TypeScript.
create table otimizacao (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  empresa_id uuid not null references empresa(id) on delete cascade,
  escala_id uuid not null references escala(id) on delete cascade,
  status text not null default 'pendente' check (status in ('pendente','processando','concluida','erro')),
  revisao_escala int not null,
  entrada jsonb not null,            -- retrato da escala no momento do pedido (escala_entrada)
  opcoes jsonb not null,             -- turnos, tempo limite, número de propostas
  resumo jsonb,                      -- métricas das propostas (sem alocações), para a tela
  resultado jsonb,                   -- propostas completas, já revalidadas
  erro text,
  criado_por uuid references usuario(id),
  criado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  concluido_em timestamptz
);
create index otimizacao_escala_idx on otimizacao (escala_id, criado_em desc);
create index otimizacao_empresa_idx on otimizacao (empresa_id);
create index otimizacao_org_idx on otimizacao (organizacao_id);
create index otimizacao_criado_por_idx on otimizacao (criado_por);
-- Uma otimização ativa por escala (evita disparar várias em paralelo).
create unique index otimizacao_ativa_idx on otimizacao (escala_id) where status in ('pendente','processando');

create function solicitar_otimizacao(p_escala uuid, p_opcoes jsonb default '{}') returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare e escala%rowtype; v_entrada jsonb; v_turnos jsonb; v_opc jsonb; v_id uuid; v_tempo numeric; v_num int;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  select * into e from escala where id = p_escala;
  if e.id is null or not pode_gerir_empresa(e.empresa_id) then raise exception 'sem permissão'; end if;
  if e.status <> 'rascunho' then raise exception 'Só rascunhos podem receber propostas automáticas.'; end if;
  -- limpa otimizações presas (worker caiu no meio) antes de checar a concorrência
  update otimizacao set status = 'erro', concluido_em = now(),
         erro = case status when 'pendente' then 'O pedido não foi processado a tempo (fila indisponível).' else 'Tempo esgotado: o processamento não terminou.' end
   where escala_id = p_escala
     and ((status = 'pendente' and criado_em < now() - interval '2 minutes') or (status = 'processando' and criado_em < now() - interval '10 minutes'));
  if exists (select 1 from otimizacao where escala_id = p_escala and status in ('pendente','processando')) then
    raise exception 'Já há uma geração de propostas em andamento para esta escala.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'inicioMin', t.inicio_min, 'fimMin', t.fim_min, 'intervaloMin', t.intervalo_min) order by t.inicio_min), '[]')
    into v_turnos from turno_modelo t where t.empresa_id = e.empresa_id and t.ativo;
  if jsonb_array_length(v_turnos) = 0 then raise exception 'Cadastre ao menos um turno antes de gerar propostas.'; end if;
  v_tempo := least(greatest(coalesce((p_opcoes ->> 'tempoLimiteS')::numeric, 30), 5), 60);
  v_num := least(greatest(coalesce((p_opcoes ->> 'numSolucoes')::int, 3), 1), 3);
  v_opc := jsonb_build_object('turnos', v_turnos, 'tempoLimiteS', v_tempo, 'numSolucoes', v_num,
                              'usarRascunhoComoReferencia', coalesce((p_opcoes ->> 'usarRascunhoComoReferencia')::boolean, false));
  v_entrada := escala_entrada(p_escala);
  insert into otimizacao (organizacao_id, empresa_id, escala_id, revisao_escala, entrada, opcoes, criado_por)
  values (e.organizacao_id, e.empresa_id, e.id, e.revisao, v_entrada, v_opc, auth.uid()) returning id into v_id;
  perform auditoria_evento(e.organizacao_id, 'otimizacao', v_id::text, 'solicitar');
  return v_id;
end $$;
revoke all on function solicitar_otimizacao(uuid, jsonb) from public, anon;
grant execute on function solicitar_otimizacao(uuid, jsonb) to authenticated;

-- Cancelar (ou liberar um pedido que não entrou na fila). Quem gere a empresa pode; só vale para pedido ainda ativo.
create function cancelar_otimizacao(p_id uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare o otimizacao%rowtype;
begin
  select * into o from otimizacao where id = p_id;
  if o.id is null or not pode_gerir_empresa(o.empresa_id) then raise exception 'sem permissão'; end if;
  update otimizacao set status = 'erro', erro = 'Cancelada.', concluido_em = now() where id = p_id and status in ('pendente','processando');
  perform auditoria_evento(o.organizacao_id, 'otimizacao', p_id::text, 'cancelar');
end $$;
revoke all on function cancelar_otimizacao(uuid) from public, anon;
grant execute on function cancelar_otimizacao(uuid) to authenticated;

alter table otimizacao enable row level security;
create policy otimizacao_select on otimizacao for select to authenticated using (pode_gerir_empresa(empresa_id));
grant select on otimizacao to authenticated;
select auditar_tabela('otimizacao');
