-- Comunicados de adequação de jornada (EC 141): a gestão emite, o colaborador dá ciência dentro do sistema e tudo fica auditado.
-- A tabela só é alterada pelas funções abaixo (sem políticas de escrita): ninguém edita nem apaga um comunicado pelo cliente.
create table comunicado_jornada (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id) on delete cascade,
  empresa_id uuid not null references empresa(id) on delete cascade,
  colaborador_id uuid not null references colaborador(id) on delete cascade,
  fase text not null check (fase in ('F1', 'F2')),
  inicio date not null,
  jornada_atual_min int not null check (jornada_atual_min > 0),
  nova_jornada_min int not null check (nova_jornada_min > 0),
  dias_trabalho smallint not null check (dias_trabalho between 1 and 7),
  dias_repouso smallint not null check (dias_repouso between 0 and 6),
  emitido_por uuid references usuario(id),
  emitido_em timestamptz not null default now(),
  ciente_em timestamptz,
  ciente_por uuid references usuario(id),
  unique (colaborador_id, fase)
);
create index comunicado_empresa_idx on comunicado_jornada (empresa_id, fase);
create index comunicado_org_idx on comunicado_jornada (organizacao_id);
alter table comunicado_jornada enable row level security;
grant select on comunicado_jornada to authenticated;
create policy comunicado_select on comunicado_jornada for select to authenticated
  using (pode_acessar_empresa(empresa_id) or eh_proprio_colaborador(colaborador_id));

-- Emite (ou reemite) os comunicados de uma fase. Itens: [{colaboradorId, inicio, jornadaAtualMin, novaJornadaMin, diasTrabalho, diasRepouso}].
-- Quem já tem o mesmo comunicado (mesmos valores) fica como está, com a ciência; se algum valor mudou, o comunicado é atualizado e a
-- ciência volta a ser exigida. Quem tem acesso ao sistema é avisado (sino).
create function emitir_comunicados(p_empresa uuid, p_fase text, p_itens jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; it jsonb; c colaborador%rowtype; x comunicado_jornada%rowtype;
  v_novos int := 0; v_atualizados int := 0; v_mantidos int := 0;
  v_ini date; v_atual int; v_nova int; v_dt int; v_dr int;
begin
  if not pode_gerir_empresa(p_empresa) then raise exception 'Sem permissão para emitir comunicados desta empresa.'; end if;
  if p_fase not in ('F1', 'F2') then raise exception 'Fase inválida.'; end if;
  if coalesce(jsonb_typeof(p_itens), '') <> 'array' then raise exception 'Itens inválidos.'; end if;
  if jsonb_array_length(p_itens) > 2000 then raise exception 'Muitos comunicados de uma vez (máximo 2000).'; end if;
  select organizacao_id into v_org from empresa where id = p_empresa;
  for it in select * from jsonb_array_elements(p_itens) loop
    select * into c from colaborador where id = (it ->> 'colaboradorId')::uuid and empresa_id = p_empresa;
    if c.id is null then continue; end if;
    v_ini := (it ->> 'inicio')::date; v_atual := (it ->> 'jornadaAtualMin')::int; v_nova := (it ->> 'novaJornadaMin')::int;
    v_dt := (it ->> 'diasTrabalho')::int; v_dr := (it ->> 'diasRepouso')::int;
    select * into x from comunicado_jornada where colaborador_id = c.id and fase = p_fase;
    if x.id is null then
      insert into comunicado_jornada (organizacao_id, empresa_id, colaborador_id, fase, inicio, jornada_atual_min, nova_jornada_min, dias_trabalho, dias_repouso, emitido_por)
      values (v_org, p_empresa, c.id, p_fase, v_ini, v_atual, v_nova, v_dt, v_dr, auth.uid()) returning * into x;
      v_novos := v_novos + 1;
    elsif (x.inicio, x.jornada_atual_min, x.nova_jornada_min, x.dias_trabalho, x.dias_repouso) is distinct from (v_ini, v_atual, v_nova, v_dt, v_dr) then
      update comunicado_jornada set inicio = v_ini, jornada_atual_min = v_atual, nova_jornada_min = v_nova, dias_trabalho = v_dt, dias_repouso = v_dr,
             emitido_por = auth.uid(), emitido_em = now(), ciente_em = null, ciente_por = null where id = x.id returning * into x;
      v_atualizados := v_atualizados + 1;
    else
      v_mantidos := v_mantidos + 1; continue;
    end if;
    perform notificar(c.usuario_id, p_empresa, 'comunicado_jornada', 'Comunicado: a sua jornada de trabalho vai mudar',
      'A partir de ' || to_char(v_ini, 'DD/MM/YYYY') || ' a sua jornada passa a ' || horas_texto(v_nova) || ' por semana. Leia e confirme a ciência.',
      '/minha-escala/comunicados', 'comunicado:' || x.id || ':' || (extract(epoch from x.emitido_em) * 1000000)::bigint);
  end loop;
  perform auditoria_evento(v_org, 'comunicado_jornada', p_empresa::text, 'emitir_' || lower(p_fase));
  return jsonb_build_object('novos', v_novos, 'atualizados', v_atualizados, 'mantidos', v_mantidos);
end $$;

-- O próprio colaborador confirma que leu o comunicado.
create function registrar_ciencia_comunicado(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare x comunicado_jornada%rowtype;
begin
  select * into x from comunicado_jornada where id = p_id;
  if x.id is null or not eh_proprio_colaborador(x.colaborador_id) then raise exception 'Comunicado não encontrado.'; end if;
  update comunicado_jornada set ciente_em = now(), ciente_por = auth.uid() where id = x.id and ciente_em is null;
  if found then perform auditoria_evento(x.organizacao_id, 'comunicado_jornada', x.id::text, 'ciencia'); end if;
end $$;

-- Quem baixou o PDF dos comunicados (a emissão acima já é auditada; o download é outro evento).
create function registrar_download_comunicados(p_empresa uuid, p_fase text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if not pode_gerir_empresa(p_empresa) then raise exception 'Sem permissão.'; end if;
  if p_fase not in ('F1', 'F2') then raise exception 'Fase inválida.'; end if;
  select organizacao_id into v_org from empresa where id = p_empresa;
  perform auditoria_evento(v_org, 'comunicado_jornada', p_empresa::text, 'baixar_pdf_' || lower(p_fase));
end $$;

revoke all on function emitir_comunicados(uuid, text, jsonb), registrar_ciencia_comunicado(uuid), registrar_download_comunicados(uuid, text) from public, anon;
grant execute on function emitir_comunicados(uuid, text, jsonb), registrar_ciencia_comunicado(uuid), registrar_download_comunicados(uuid, text) to authenticated;
