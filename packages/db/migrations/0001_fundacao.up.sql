-- Fase 0: tenancy, RLS, auditoria imutável. Reversível (ver 0001_fundacao.down.sql).
create extension if not exists "pgcrypto";
create extension if not exists "btree_gist";

create type tipo_org as enum ('empresa','contabilidade','juridico','plataforma');
create type papel as enum ('superadmin','admin','contador','advogado','rh','lider','colaborador');
create type porte as enum ('mei','me','epp','medio','grande');

create table organizacao (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo tipo_org not null,
  cnpj text unique,
  plano text not null default 'trial',
  white_label jsonb not null default '{}',
  criado_em timestamptz not null default now()
);

create table usuario (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text not null,
  telefone text,
  criado_em timestamptz not null default now()
);

create table membro (
  organizacao_id uuid not null references organizacao(id) on delete cascade,
  usuario_id uuid not null references usuario(id) on delete cascade,
  papel papel not null,
  primary key (organizacao_id, usuario_id)
);
create index membro_usuario_idx on membro (usuario_id);

create table empresa (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  razao_social text not null,
  cnpj text not null,
  porte porte not null,
  cnae text,
  municipio_ibge text not null,
  uf char(2) not null,
  terceirizada_publica boolean not null default false,
  status_adequacao text not null default 'nao_iniciado'
    check (status_adequacao in ('nao_iniciado','em_risco','adequado')),
  unique (organizacao_id, cnpj)
);
create index empresa_organizacao_idx on empresa (organizacao_id);

create table vinculo_empresa (
  empresa_id uuid not null references empresa(id) on delete cascade,
  organizacao_id uuid not null references organizacao(id) on delete cascade,
  nivel text not null check (nivel in ('leitura','gestao','juridico')),
  primary key (empresa_id, organizacao_id)
);
create index vinculo_empresa_org_idx on vinculo_empresa (organizacao_id);

-- Acesso de suporte (superadmin) somente com motivo e prazo.
create table acesso_suporte (
  id uuid primary key default gen_random_uuid(),
  superadmin_id uuid not null references usuario(id),
  organizacao_id uuid not null references organizacao(id) on delete cascade,
  motivo text not null check (length(trim(motivo)) >= 10),
  expira_em timestamptz not null,
  criado_em timestamptz not null default now(),
  check (expira_em > criado_em and expira_em <= criado_em + interval '7 days')
);
create index acesso_suporte_idx on acesso_suporte (superadmin_id, organizacao_id);

create table auditoria (
  id bigserial primary key,
  organizacao_id uuid not null,
  usuario_id uuid,
  tabela text not null,
  registro_id text not null,
  acao text not null,
  antes jsonb,
  depois jsonb,
  ip inet,
  momento timestamptz not null default now(),
  hash_anterior text,
  hash text not null
);
create index auditoria_org_idx on auditoria (organizacao_id, id);

-- ===== Funções de acesso =====
-- Papéis sensíveis exigem MFA (aal2) também na camada de banco.
create function papel_exige_mfa(p papel) returns boolean
language sql immutable as $$ select p in ('superadmin','admin','contador','advogado') $$;

create function mfa_ok(p papel) returns boolean
language sql stable as $$
  select not papel_exige_mfa(p) or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- Organizações às quais o usuário atual tem acesso (membro com MFA ok, ou suporte vigente).
create function minhas_organizacoes() returns setof uuid
language sql stable security definer set search_path = public, auth as $$
  select m.organizacao_id from membro m
   where m.usuario_id = auth.uid() and mfa_ok(m.papel)
  union
  select s.organizacao_id from acesso_suporte s
   where s.superadmin_id = auth.uid() and s.expira_em > now()
     and exists (select 1 from membro m where m.usuario_id = auth.uid()
                  and m.papel = 'superadmin' and mfa_ok(m.papel))
$$;

create function tenho_papel(org uuid, papeis papel[]) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from membro m
                  where m.organizacao_id = org and m.usuario_id = auth.uid()
                    and m.papel = any(papeis) and mfa_ok(m.papel))
$$;

create function pode_acessar_empresa(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from empresa e
     where e.id = p_empresa
       and (e.organizacao_id in (select minhas_organizacoes())
            or exists (select 1 from vinculo_empresa v
                        where v.empresa_id = e.id
                          and v.organizacao_id in (select minhas_organizacoes()))))
$$;

create function pode_gerir_empresa(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from empresa e
     where e.id = p_empresa
       and (tenho_papel(e.organizacao_id, array['admin','rh']::papel[])
            or exists (select 1 from vinculo_empresa v
                        where v.empresa_id = e.id and v.nivel = 'gestao'
                          and tenho_papel(v.organizacao_id, array['admin','contador']::papel[]))))
$$;

create function sou_admin_da_empresa(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from empresa e where e.id = p_empresa
                  and tenho_papel(e.organizacao_id, array['admin']::papel[]))
$$;

-- Criação de organização: o criador vira admin (evita o ovo-e-galinha do RLS).
create function criar_organizacao(p_nome text, p_tipo tipo_org, p_cnpj text default null)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  if p_tipo = 'plataforma' then raise exception 'tipo plataforma não pode ser criado por usuários'; end if;
  insert into organizacao (nome, tipo, cnpj) values (p_nome, p_tipo, p_cnpj) returning id into v_id;
  insert into membro (organizacao_id, usuario_id, papel) values (v_id, auth.uid(), 'admin');
  return v_id;
end $$;

-- ===== Auditoria encadeada =====
create function auditoria_gravar() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_org uuid;
  v_prev text;
  v_ip inet;
  v_id text;
  v_hash text;
  v_antes jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_depois jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
begin
  v_org := case when tg_table_name = 'organizacao' then (v_row ->> 'id')::uuid
                else (v_row ->> 'organizacao_id')::uuid end;
  v_id := coalesce(v_row ->> 'id', concat_ws(':', v_row ->> 'empresa_id', v_row ->> 'usuario_id', v_row ->> 'organizacao_id'));
  begin
    v_ip := nullif(split_part(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ',', 1), '')::inet;
  exception when others then v_ip := null; end;

  perform pg_advisory_xact_lock(hashtextextended(v_org::text, 0));
  select a.hash into v_prev from auditoria a where a.organizacao_id = v_org order by a.id desc limit 1;
  v_hash := encode(digest(
    concat_ws('|', coalesce(v_prev,''), v_org, coalesce(auth.uid()::text,''), tg_table_name, v_id,
              lower(tg_op), coalesce(v_antes::text,''), coalesce(v_depois::text,''), clock_timestamp()::text),
    'sha256'), 'hex');
  insert into auditoria (organizacao_id, usuario_id, tabela, registro_id, acao, antes, depois, ip, hash_anterior, hash)
  values (v_org, auth.uid(), tg_table_name, v_id, lower(tg_op), v_antes, v_depois, v_ip, v_prev, v_hash);
  return coalesce(new, old);
end $$;

create function auditoria_imutavel() returns trigger language plpgsql as $$
begin raise exception 'auditoria é append-only'; end $$;
create trigger auditoria_sem_update before update or delete on auditoria
  for each row execute function auditoria_imutavel();
create trigger auditoria_sem_truncate before truncate on auditoria
  for each statement execute function auditoria_imutavel();

-- Aplica o gatilho de auditoria a uma tabela de negócio (usar em toda tabela nova).
create function auditar_tabela(p_tabela regclass) returns void language plpgsql as $$
begin
  execute format('create trigger auditoria_%s after insert or update or delete on %s
                  for each row execute function auditoria_gravar()',
                 replace(p_tabela::text, '.', '_'), p_tabela);
end $$;

select auditar_tabela('organizacao'), auditar_tabela('membro'), auditar_tabela('empresa'),
       auditar_tabela('vinculo_empresa'), auditar_tabela('acesso_suporte');

-- ===== RLS =====
alter table organizacao enable row level security;
alter table usuario enable row level security;
alter table membro enable row level security;
alter table empresa enable row level security;
alter table vinculo_empresa enable row level security;
alter table acesso_suporte enable row level security;
alter table auditoria enable row level security;

create policy org_select on organizacao for select to authenticated
  using (id in (select minhas_organizacoes()));
create policy org_update on organizacao for update to authenticated
  using (tenho_papel(id, array['admin']::papel[])) with check (tenho_papel(id, array['admin']::papel[]));

create policy usuario_select on usuario for select to authenticated
  using (id = auth.uid() or exists (
    select 1 from membro m where m.usuario_id = usuario.id
       and m.organizacao_id in (select minhas_organizacoes())));
create policy usuario_insert on usuario for insert to authenticated with check (id = auth.uid());
create policy usuario_update on usuario for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy membro_select on membro for select to authenticated
  using (organizacao_id in (select minhas_organizacoes()) or usuario_id = auth.uid());
create policy membro_insert on membro for insert to authenticated
  with check (tenho_papel(organizacao_id, array['admin']::papel[]) and papel <> 'superadmin');
create policy membro_update on membro for update to authenticated
  using (tenho_papel(organizacao_id, array['admin']::papel[]))
  with check (tenho_papel(organizacao_id, array['admin']::papel[]) and papel <> 'superadmin');
create policy membro_delete on membro for delete to authenticated
  using (tenho_papel(organizacao_id, array['admin']::papel[]));

-- Inline (sem pode_acessar_empresa): a função não enxerga a linha recém-inserida em INSERT ... RETURNING.
create policy empresa_select on empresa for select to authenticated
  using (organizacao_id in (select minhas_organizacoes())
         or exists (select 1 from vinculo_empresa v
                     where v.empresa_id = empresa.id
                       and v.organizacao_id in (select minhas_organizacoes())));
create policy empresa_insert on empresa for insert to authenticated
  with check (tenho_papel(organizacao_id, array['admin','rh','contador']::papel[]));
create policy empresa_update on empresa for update to authenticated
  using (pode_gerir_empresa(id)) with check (pode_gerir_empresa(id));
create policy empresa_delete on empresa for delete to authenticated
  using (tenho_papel(organizacao_id, array['admin']::papel[]));

create policy vinculo_select on vinculo_empresa for select to authenticated
  using (organizacao_id in (select minhas_organizacoes())
         or pode_acessar_empresa(empresa_id));
create policy vinculo_insert on vinculo_empresa for insert to authenticated
  with check (sou_admin_da_empresa(empresa_id));
create policy vinculo_update on vinculo_empresa for update to authenticated
  using (sou_admin_da_empresa(empresa_id)) with check (sou_admin_da_empresa(empresa_id));
create policy vinculo_delete on vinculo_empresa for delete to authenticated
  using (sou_admin_da_empresa(empresa_id));

create policy suporte_select on acesso_suporte for select to authenticated
  using (superadmin_id = auth.uid() or tenho_papel(organizacao_id, array['admin']::papel[]));
create policy suporte_insert on acesso_suporte for insert to authenticated
  with check (superadmin_id = auth.uid() and exists (
    select 1 from membro m where m.usuario_id = auth.uid() and m.papel = 'superadmin' and mfa_ok(m.papel)));

create policy auditoria_select on auditoria for select to authenticated
  using (tenho_papel(organizacao_id, array['admin','advogado']::papel[]));

-- ===== Privilégios =====
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on function auditoria_gravar(), auditar_tabela(regclass) from public, anon, authenticated;
grant select, insert, update, delete on organizacao, usuario, membro, empresa, vinculo_empresa to authenticated;
revoke insert, delete on organizacao from authenticated;
grant select, insert on acesso_suporte to authenticated;
grant select on auditoria to authenticated;   -- sem update/delete/truncate
grant execute on function criar_organizacao(text, tipo_org, text) to authenticated;
grant execute on function minhas_organizacoes(), tenho_papel(uuid, papel[]),
  pode_acessar_empresa(uuid), pode_gerir_empresa(uuid), sou_admin_da_empresa(uuid), mfa_ok(papel) to authenticated;
