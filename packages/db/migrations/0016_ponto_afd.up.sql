-- Importação do AFD (marcações do relógio de ponto). O arquivo é lido no servidor; aqui ficam as importações, as marcações
-- (sem CPF/PIS em claro: só um hash e os 4 últimos dígitos para o RH reconhecer) e o vínculo identificador → colaborador.
--   CPF (leiaute 671): vincula sozinho pelo hash do CPF já cadastrado.
--   PIS (leiaute 1.510): o RH informa uma vez qual colaborador é cada PIS; as próximas importações já reconhecem.
create table afd_importacao (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  empresa_id uuid not null references empresa(id) on delete cascade,
  arquivo_nome text not null check (length(arquivo_nome) <= 200),
  arquivo_hash text not null check (arquivo_hash ~ '^[0-9a-f]{64}$'),
  dialeto text check (dialeto in ('portaria_1510','portaria_671')),
  status text not null default 'processando' check (status in ('processando','concluida','erro','desfeita')),
  relatorio jsonb,
  criado_por uuid references usuario(id),
  criado_em timestamptz not null default now(),
  concluido_em timestamptz
);
create unique index afd_importacao_arquivo_idx on afd_importacao (empresa_id, arquivo_hash) where status in ('processando','concluida');
create index afd_importacao_org_idx on afd_importacao (organizacao_id);
create index afd_importacao_criado_por_idx on afd_importacao (criado_por);

create table ponto_identificador (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  empresa_id uuid not null references empresa(id) on delete cascade,
  tipo text not null check (tipo in ('pis','cpf')),
  identificador_hash text not null,
  colaborador_id uuid not null references colaborador(id) on delete cascade,
  criado_por uuid references usuario(id),
  criado_em timestamptz not null default now(),
  unique (empresa_id, tipo, identificador_hash)
);
create index ponto_identificador_colab_idx on ponto_identificador (colaborador_id);
create index ponto_identificador_org_idx on ponto_identificador (organizacao_id);
create index ponto_identificador_criado_por_idx on ponto_identificador (criado_por);

create table marcacao_ponto (
  id bigserial primary key,
  organizacao_id uuid not null references organizacao(id),
  empresa_id uuid not null references empresa(id) on delete cascade,
  colaborador_id uuid references colaborador(id),
  importacao_id uuid references afd_importacao(id),
  momento timestamptz not null,
  origem text not null default 'afd' check (origem in ('afd','api','manual')),
  nsr bigint,
  tipo_identificador text not null check (tipo_identificador in ('pis','cpf')),
  identificador_hash text not null,
  identificador_final text not null check (length(identificador_final) = 4),
  unique (empresa_id, tipo_identificador, identificador_hash, momento)
);
create index marcacao_colab_momento_idx on marcacao_ponto (colaborador_id, momento);
create index marcacao_empresa_momento_idx on marcacao_ponto (empresa_id, momento);
create index marcacao_importacao_idx on marcacao_ponto (importacao_id);
create index marcacao_org_idx on marcacao_ponto (organizacao_id);
create index marcacao_pendente_idx on marcacao_ponto (empresa_id, tipo_identificador, identificador_hash) where colaborador_id is null;

-- Marcação é um registro do relógio: só se vincula (colaborador) e só se apaga ao desfazer a importação inteira.
create function marcacao_proteger() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.desfazendo', true), '') = '1' then return old; end if;
    raise exception 'Marcação de ponto não pode ser apagada; desfaça a importação inteira, com motivo.';
  end if;
  if coalesce(current_setting('app.vinculando', true), '') = '1' and old.colaborador_id is null and new.colaborador_id is not null
     and (new.momento, new.nsr, new.identificador_hash, new.empresa_id, new.importacao_id) is not distinct from (old.momento, old.nsr, old.identificador_hash, old.empresa_id, old.importacao_id) then
    return new;
  end if;
  raise exception 'Marcação de ponto é imutável.';
end $$;
create trigger proteger before update or delete on marcacao_ponto for each row execute function marcacao_proteger();

create function hash_identificador_ponto(p_tipo text, p_valor text) returns text
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if p_tipo = 'cpf' then return hash_cpf(p_valor); end if;
  return encode(hmac('pis:' || regexp_replace(coalesce(p_valor, ''), '\D', '', 'g'), segredo('chave_dados'), 'sha256'), 'hex');
end $$;
revoke all on function hash_identificador_ponto(text, text) from public, anon, authenticated;

-- Liga marcações sem dono aos colaboradores: CPF pelo hash do cadastro e demais pelo mapeamento feito pelo RH.
create function vincular_marcacoes(p_empresa uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int; m int;
begin
  perform set_config('app.vinculando', '1', true);
  update marcacao_ponto mp set colaborador_id = c.id from colaborador c
   where mp.empresa_id = p_empresa and mp.colaborador_id is null and mp.tipo_identificador = 'cpf' and c.empresa_id = p_empresa and c.cpf_hash = mp.identificador_hash;
  get diagnostics n = row_count;
  update marcacao_ponto mp set colaborador_id = pi.colaborador_id from ponto_identificador pi
   where mp.empresa_id = p_empresa and mp.colaborador_id is null and pi.empresa_id = p_empresa and pi.tipo = mp.tipo_identificador and pi.identificador_hash = mp.identificador_hash;
  get diagnostics m = row_count;
  return n + m;
end $$;
revoke all on function vincular_marcacoes(uuid) from public, anon, authenticated;

create function iniciar_importacao_afd(p_empresa uuid, p_nome text, p_hash text, p_dialeto text) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare e empresa%rowtype; v_id uuid; v_antes timestamptz;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  select * into e from empresa where id = p_empresa;
  if e.id is null or not pode_gerir_empresa(p_empresa) then raise exception 'sem permissão'; end if;
  select criado_em into v_antes from afd_importacao where empresa_id = p_empresa and arquivo_hash = p_hash and status in ('processando','concluida');
  if v_antes is not null then raise exception 'Este mesmo arquivo já foi importado em %.', to_char(v_antes at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'); end if;
  insert into afd_importacao (organizacao_id, empresa_id, arquivo_nome, arquivo_hash, dialeto, criado_por)
  values (e.organizacao_id, p_empresa, left(coalesce(nullif(btrim(p_nome), ''), 'afd.txt'), 200), p_hash, p_dialeto, auth.uid()) returning id into v_id;
  perform auditoria_evento(e.organizacao_id, 'afd_importacao', v_id::text, 'iniciar');
  return v_id;
end $$;

create function importar_marcacoes_afd(p_importacao uuid, p_marcacoes jsonb) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare i afd_importacao%rowtype; v_total int; v_ins int; v_vinc int;
begin
  select * into i from afd_importacao where id = p_importacao;
  if i.id is null or not pode_gerir_empresa(i.empresa_id) then raise exception 'sem permissão'; end if;
  if i.status <> 'processando' then raise exception 'Esta importação já foi encerrada.'; end if;
  if jsonb_typeof(p_marcacoes) <> 'array' then raise exception 'marcações inválidas'; end if;
  v_total := jsonb_array_length(p_marcacoes);
  if v_total > 5000 then raise exception 'Envie no máximo 5000 marcações por vez.'; end if;
  insert into marcacao_ponto (organizacao_id, empresa_id, importacao_id, momento, nsr, tipo_identificador, identificador_hash, identificador_final)
  select i.organizacao_id, i.empresa_id, i.id, (x.momento)::timestamptz, x.nsr, x.tipo, hash_identificador_ponto(x.tipo, x.identificador), right(regexp_replace(x.identificador, '\D', '', 'g'), 4)
    from jsonb_to_recordset(p_marcacoes) as x(momento text, nsr bigint, tipo text, identificador text)
   where x.tipo in ('cpf','pis') and length(regexp_replace(coalesce(x.identificador, ''), '\D', '', 'g')) = 11
  on conflict (empresa_id, tipo_identificador, identificador_hash, momento) do nothing;
  get diagnostics v_ins = row_count;
  v_vinc := vincular_marcacoes(i.empresa_id);
  return jsonb_build_object('recebidas', v_total, 'inseridas', v_ins, 'jaExistiam', v_total - v_ins);
end $$;

create function finalizar_importacao_afd(p_importacao uuid, p_status text, p_relatorio jsonb) returns void
language plpgsql security definer set search_path = public, auth as $$
declare i afd_importacao%rowtype;
begin
  select * into i from afd_importacao where id = p_importacao;
  if i.id is null or not pode_gerir_empresa(i.empresa_id) then raise exception 'sem permissão'; end if;
  if i.status <> 'processando' or p_status not in ('concluida','erro') then raise exception 'Estado inválido para encerrar a importação.'; end if;
  update afd_importacao set status = p_status, relatorio = p_relatorio, concluido_em = now() where id = p_importacao;
  perform auditoria_evento(i.organizacao_id, 'afd_importacao', p_importacao::text, case p_status when 'concluida' then 'concluir' else 'falhar' end);
end $$;

create function desfazer_importacao_afd(p_importacao uuid, p_motivo text) returns int
language plpgsql security definer set search_path = public, auth as $$
declare i afd_importacao%rowtype; n int;
begin
  select * into i from afd_importacao where id = p_importacao;
  if i.id is null or not pode_gerir_empresa(i.empresa_id) then raise exception 'sem permissão'; end if;
  if i.status not in ('concluida','erro','processando') then raise exception 'Esta importação já foi desfeita.'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo (mínimo 5 caracteres).'; end if;
  perform set_config('app.desfazendo', '1', true);
  delete from marcacao_ponto where importacao_id = p_importacao;
  get diagnostics n = row_count;
  update afd_importacao set status = 'desfeita', relatorio = coalesce(relatorio, '{}'::jsonb) || jsonb_build_object('desfeitaMotivo', btrim(p_motivo), 'marcacoesRemovidas', n), concluido_em = now() where id = p_importacao;
  perform auditoria_evento(i.organizacao_id, 'afd_importacao', p_importacao::text, 'desfazer');
  return n;
end $$;

-- Quem ainda não foi reconhecido: o RH escolhe o colaborador de cada identificador.
create function identificadores_pendentes(p_empresa uuid) returns table (tipo text, identificador_hash text, final4 text, marcacoes bigint, primeira timestamptz, ultima timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select m.tipo_identificador, m.identificador_hash, max(m.identificador_final), count(*), min(m.momento), max(m.momento)
    from marcacao_ponto m where m.empresa_id = p_empresa and m.colaborador_id is null and pode_acessar_empresa(p_empresa)
   group by m.tipo_identificador, m.identificador_hash order by count(*) desc limit 500
$$;

create function mapear_identificador_ponto(p_empresa uuid, p_tipo text, p_hash text, p_colaborador uuid) returns int
language plpgsql security definer set search_path = public, auth as $$
declare e empresa%rowtype; n int;
begin
  select * into e from empresa where id = p_empresa;
  if e.id is null or not pode_gerir_empresa(p_empresa) then raise exception 'sem permissão'; end if;
  if p_tipo not in ('pis','cpf') or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'identificador inválido'; end if;
  if not exists (select 1 from colaborador where id = p_colaborador and empresa_id = p_empresa) then raise exception 'O colaborador não pertence a esta empresa.'; end if;
  if not exists (select 1 from marcacao_ponto where empresa_id = p_empresa and tipo_identificador = p_tipo and identificador_hash = p_hash) then raise exception 'Identificador desconhecido nesta empresa.'; end if;
  insert into ponto_identificador (organizacao_id, empresa_id, tipo, identificador_hash, colaborador_id, criado_por)
  values (e.organizacao_id, p_empresa, p_tipo, p_hash, p_colaborador, auth.uid())
  on conflict (empresa_id, tipo, identificador_hash) do update set colaborador_id = excluded.colaborador_id, criado_por = excluded.criado_por, criado_em = now();
  n := vincular_marcacoes(p_empresa);
  perform auditoria_evento(e.organizacao_id, 'ponto_identificador', p_colaborador::text, 'mapear');
  return n;
end $$;

revoke all on function iniciar_importacao_afd(uuid, text, text, text), importar_marcacoes_afd(uuid, jsonb), finalizar_importacao_afd(uuid, text, jsonb),
  desfazer_importacao_afd(uuid, text), identificadores_pendentes(uuid), mapear_identificador_ponto(uuid, text, text, uuid) from public, anon;
grant execute on function iniciar_importacao_afd(uuid, text, text, text), importar_marcacoes_afd(uuid, jsonb), finalizar_importacao_afd(uuid, text, jsonb),
  desfazer_importacao_afd(uuid, text), identificadores_pendentes(uuid), mapear_identificador_ponto(uuid, text, text, uuid) to authenticated;

alter table afd_importacao enable row level security;
alter table ponto_identificador enable row level security;
alter table marcacao_ponto enable row level security;
create policy afd_importacao_select on afd_importacao for select to authenticated using (pode_acessar_empresa(empresa_id));
create policy ponto_identificador_select on ponto_identificador for select to authenticated using (pode_acessar_empresa(empresa_id));
create policy marcacao_select on marcacao_ponto for select to authenticated using (pode_acessar_empresa(empresa_id) or (colaborador_id is not null and eh_proprio_colaborador(colaborador_id)));
grant select on afd_importacao, ponto_identificador, marcacao_ponto to authenticated;
select auditar_tabela('afd_importacao'), auditar_tabela('ponto_identificador');   -- marcações: volume alto, auditadas pelas ações da importação
