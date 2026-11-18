-- JornadaCerta: instala o banco inteiro (migrations + regras legais + feriados).
-- Gerado por scripts/gerar-setup-supabase.sh. Rode UMA vez, num projeto Supabase vazio.
-- Tudo roda numa transação: se qualquer parte falhar, nada é aplicado e você pode corrigir e rodar de novo.
begin;

-- ===== 0001_fundacao.up.sql =====
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
language plpgsql security definer set search_path = public, auth, extensions as $$
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

-- ===== 0002_cadastros_regras.up.sql =====
-- Fase 1: regras legais versionadas, cadastros, diagnóstico. Reversível (0002_cadastros_regras.down.sql).
set local check_function_bodies = off;  -- funções referenciam tabelas criadas mais abaixo

-- ===== Organização da plataforma (dona dos dados globais: regras, feriados) =====
insert into organizacao (id, nome, tipo) values
  ('00000000-0000-0000-0000-000000000001', 'JornadaCerta (plataforma)', 'plataforma')
  on conflict do nothing;

-- Tabelas globais (sem organizacao_id) são auditadas na organização da plataforma.
create or replace function auditoria_gravar() returns trigger
language plpgsql security definer set search_path = public, auth, extensions as $$
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
  v_org := coalesce(v_org, '00000000-0000-0000-0000-000000000001'::uuid);
  v_id := coalesce(v_row ->> 'id', concat_ws(':', v_row ->> 'empresa_id', v_row ->> 'usuario_id', v_row ->> 'organizacao_id',
                                              v_row ->> 'colaborador_id', v_row ->> 'acordo_id'));
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

-- Evento de auditoria avulso (ex.: revelar PII), no mesmo encadeamento por organização.
create function auditoria_evento(p_org uuid, p_tabela text, p_id text, p_acao text) returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
declare v_prev text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_org::text, 0));
  select a.hash into v_prev from auditoria a where a.organizacao_id = p_org order by a.id desc limit 1;
  insert into auditoria (organizacao_id, usuario_id, tabela, registro_id, acao, hash_anterior, hash)
  values (p_org, auth.uid(), p_tabela, p_id, p_acao, v_prev,
          encode(digest(concat_ws('|', coalesce(v_prev,''), p_org, coalesce(auth.uid()::text,''), p_tabela, p_id, p_acao, clock_timestamp()::text), 'sha256'), 'hex'));
end $$;
revoke all on function auditoria_evento(uuid, text, text, text) from public, anon, authenticated;

-- ===== Correção de acesso: colaborador e líder NÃO têm acesso à empresa inteira =====
create function sou_superadmin() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from membro m where m.usuario_id = auth.uid()
                  and m.papel = 'superadmin' and mfa_ok(m.papel))
$$;

-- Organizações em que o usuário tem papel de gestão (exclui colaborador e líder).
create function minhas_organizacoes_gestao() returns setof uuid
language sql stable security definer set search_path = public, auth as $$
  select m.organizacao_id from membro m
   where m.usuario_id = auth.uid() and m.papel in ('admin','contador','advogado','rh') and mfa_ok(m.papel)
  union
  select s.organizacao_id from acesso_suporte s
   where s.superadmin_id = auth.uid() and s.expira_em > now() and sou_superadmin()
$$;

-- Empresas onde o usuário é colaborador ou líder de setor (leitura limitada da própria empresa).
create function empresa_do_usuario(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from colaborador c
                   left join setor s on s.id = c.setor_id
                  where c.empresa_id = p_empresa and (c.usuario_id = auth.uid() or s.lider_usuario_id = auth.uid()))
$$;

-- ===== Cadastros =====
alter table empresa add column sindicato_id uuid;

create table sindicato (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid references organizacao(id),   -- null = catálogo da plataforma
  nome text not null, cnpj text, categoria text, uf char(2)
);
create index sindicato_org_idx on sindicato (organizacao_id);
alter table empresa add constraint empresa_sindicato_fk foreign key (sindicato_id) references sindicato(id);
create index empresa_sindicato_idx on empresa (sindicato_id);

create table unidade (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  empresa_id uuid not null references empresa(id) on delete cascade,
  nome text not null, municipio_ibge text not null
);
create index unidade_empresa_idx on unidade (empresa_id);
create index unidade_org_idx on unidade (organizacao_id);

create table setor (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  unidade_id uuid not null references unidade(id) on delete cascade,
  nome text not null,
  lider_usuario_id uuid references usuario(id)
);
create index setor_unidade_idx on setor (unidade_id);
create index setor_org_idx on setor (organizacao_id);
create index setor_lider_idx on setor (lider_usuario_id);

create table acordo_coletivo (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  sindicato_id uuid references sindicato(id),
  empresa_id uuid references empresa(id),
  tipo text not null check (tipo in ('convencao','acordo')),
  numero_registro text,
  vigencia daterange not null,
  arquivo_path text,
  status text not null default 'rascunho' check (status in ('rascunho','revisado','vigente','expirado')),
  revisado_por uuid references usuario(id)
);
create index acordo_org_idx on acordo_coletivo (organizacao_id);
create index acordo_sindicato_idx on acordo_coletivo (sindicato_id);
create index acordo_empresa_idx on acordo_coletivo (empresa_id);

create table clausula_jornada (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  acordo_id uuid not null references acordo_coletivo(id) on delete cascade,
  tipo text not null check (tipo in ('regime_compensatorio','jornada_diaria_estendida','banco_horas','adicional_he','rodizio_domingo')),
  parametros jsonb not null,
  texto_original text
);
create index clausula_acordo_idx on clausula_jornada (acordo_id);

create table colaborador (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  empresa_id uuid not null references empresa(id) on delete cascade,
  setor_id uuid references setor(id),
  usuario_id uuid references usuario(id),
  nome text not null,
  cpf_cifrado bytea not null,
  cpf_hash text not null,
  matricula text, cargo text, cbo text,
  admissao date not null, desligamento date,
  escolaridade text check (escolaridade in ('fundamental','medio','superior','pos')),
  sindicato_id uuid references sindicato(id),
  telefone_cifrado bytea,
  unique (empresa_id, cpf_hash)
);
create index colaborador_org_idx on colaborador (organizacao_id);
create index colaborador_empresa_idx on colaborador (empresa_id);
create index colaborador_setor_idx on colaborador (setor_id);
create index colaborador_usuario_idx on colaborador (usuario_id);
create index colaborador_sindicato_idx on colaborador (sindicato_id);

create table contrato_versao (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  colaborador_id uuid not null references colaborador(id) on delete cascade,
  vigencia daterange not null,
  salario_base numeric(12,2) not null check (salario_base > 0),
  jornada_semanal_min int not null check (jornada_semanal_min between 1 and 3600),
  divisor int not null check (divisor > 0),
  tipo_escala text not null check (tipo_escala in ('6x1','5x2','12x36','personalizada')),
  folgas_semana smallint check (folgas_semana between 0 and 6),   -- null = padrão do tipo de escala
  turno text,
  horas_extras_mensais_min int not null default 0 check (horas_extras_mensais_min >= 0),
  exclude using gist (colaborador_id with =, vigencia with &&)
);
create index contrato_org_idx on contrato_versao (organizacao_id);

create table colaborador_acordo (
  organizacao_id uuid not null references organizacao(id),
  colaborador_id uuid not null references colaborador(id) on delete cascade,
  acordo_id uuid not null references acordo_coletivo(id) on delete cascade,
  primary key (colaborador_id, acordo_id)
);
create index colaborador_acordo_acordo_idx on colaborador_acordo (acordo_id);
create index colaborador_acordo_org_idx on colaborador_acordo (organizacao_id);

-- ===== Regras legais e feriados (globais, editáveis só pelo superadmin) =====
create table regra_jornada (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  descricao text not null,
  vigencia daterange not null,
  escopo jsonb not null default '{}',
  parametros jsonb not null,
  prioridade int not null default 100,   -- menor aplica primeiro; a maior prioridade, mais específica, vence na mescla
  fonte_url text,
  ativa boolean not null default true,
  unique (codigo, vigencia)
);
create index regra_jornada_codigo_idx on regra_jornada (codigo);
create index regra_jornada_vigencia_idx on regra_jornada using gist (vigencia);

create table feriado (
  id bigserial primary key,
  data date not null,
  nome text not null,
  abrangencia text not null check (abrangencia in ('nacional','estadual','municipal')),
  uf char(2), municipio_ibge text,
  unique nulls not distinct (data, abrangencia, uf, municipio_ibge)
);
create index feriado_data_idx on feriado (data);

-- ===== Diagnóstico, cenário, importação =====
create table diagnostico (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  empresa_id uuid not null references empresa(id) on delete cascade,
  data_referencia date not null,
  resumo jsonb not null,
  criado_por uuid references usuario(id),
  criado_em timestamptz not null default now()
);
create index diagnostico_empresa_idx on diagnostico (empresa_id, criado_em desc);
create index diagnostico_org_idx on diagnostico (organizacao_id);

create table diagnostico_item (
  id bigserial primary key,
  organizacao_id uuid not null references organizacao(id),
  diagnostico_id uuid not null references diagnostico(id) on delete cascade,
  colaborador_id uuid not null references colaborador(id),
  classificacao text not null,
  dados jsonb not null
);
create index diagnostico_item_diag_idx on diagnostico_item (diagnostico_id);
create index diagnostico_item_colab_idx on diagnostico_item (colaborador_id);
create index diagnostico_item_org_idx on diagnostico_item (organizacao_id);

create table cenario (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  diagnostico_id uuid not null references diagnostico(id) on delete cascade,
  nome text not null, parametros jsonb not null, resultado jsonb
);
create index cenario_diag_idx on cenario (diagnostico_id);
create index cenario_org_idx on cenario (organizacao_id);

create table importacao (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  empresa_id uuid references empresa(id) on delete cascade,
  tipo text not null check (tipo in ('colaboradores')),
  arquivo_path text not null,
  mapeamento jsonb,
  status text not null default 'processando' check (status in ('aguardando_mapeamento','processando','concluida','erro')),
  relatorio jsonb,
  criado_por uuid references usuario(id),
  criado_em timestamptz not null default now()
);
create index importacao_empresa_idx on importacao (empresa_id);
create index importacao_org_idx on importacao (organizacao_id);

-- ===== Organização herdada da empresa (impede organizacao_id incoerente) =====
create function herdar_organizacao() returns trigger language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  v_org := case tg_argv[0]
    when 'empresa'     then (select organizacao_id from empresa where id = (to_jsonb(new) ->> 'empresa_id')::uuid)
    when 'unidade'     then (select organizacao_id from unidade where id = (to_jsonb(new) ->> 'unidade_id')::uuid)
    when 'colaborador' then (select organizacao_id from colaborador where id = (to_jsonb(new) ->> 'colaborador_id')::uuid)
    when 'acordo'      then (select organizacao_id from acordo_coletivo where id = (to_jsonb(new) ->> 'acordo_id')::uuid)
    when 'diagnostico' then (select organizacao_id from diagnostico where id = (to_jsonb(new) ->> 'diagnostico_id')::uuid)
  end;
  if v_org is null then raise exception 'organização não encontrada para %', tg_table_name; end if;
  new.organizacao_id := v_org;
  return new;
end $$;
create trigger herdar_org before insert or update on unidade for each row execute function herdar_organizacao('empresa');
create trigger herdar_org before insert or update on setor for each row execute function herdar_organizacao('unidade');
create trigger herdar_org before insert or update on colaborador for each row execute function herdar_organizacao('empresa');
create trigger herdar_org before insert or update on contrato_versao for each row execute function herdar_organizacao('colaborador');
create trigger herdar_org before insert or update on clausula_jornada for each row execute function herdar_organizacao('acordo');
create trigger herdar_org before insert or update on colaborador_acordo for each row execute function herdar_organizacao('colaborador');
create trigger herdar_org before insert or update on diagnostico for each row execute function herdar_organizacao('empresa');
create trigger herdar_org before insert or update on diagnostico_item for each row execute function herdar_organizacao('diagnostico');
create trigger herdar_org before insert or update on cenario for each row execute function herdar_organizacao('diagnostico');
create trigger herdar_org before insert or update on importacao for each row
  when (new.empresa_id is not null) execute function herdar_organizacao('empresa');

-- Importação: o arquivo precisa estar na pasta da própria organização (o worker lê com service_role, então
-- um caminho forjado exporia arquivos de outro cliente) e o autor é sempre quem está autenticado (auditoria).
create function importacao_validar() returns trigger language plpgsql as $$
begin
  if new.arquivo_path !~ ('^' || new.organizacao_id::text || '/[^/]+$') or new.arquivo_path like '%..%' then
    raise exception 'arquivo_path deve estar na pasta da organização';
  end if;
  if auth.uid() is not null then new.criado_por := auth.uid(); end if;
  return new;
end $$;
create trigger importacao_validar before insert or update of arquivo_path, empresa_id, criado_por on importacao
  for each row execute function importacao_validar();

-- Um acordo só pode ser vinculado a colaborador da mesma organização ou de empresa cliente que tenha
-- concedido vínculo de nível "juridico" ao escritório dono do acordo.
create function validar_colaborador_acordo() returns trigger language plpgsql security definer set search_path = public as $$
declare v_org_acordo uuid;
begin
  select organizacao_id into v_org_acordo from acordo_coletivo where id = new.acordo_id;
  if v_org_acordo is distinct from new.organizacao_id and not exists (
       select 1 from colaborador c join vinculo_empresa v on v.empresa_id = c.empresa_id
        where c.id = new.colaborador_id and v.organizacao_id = v_org_acordo and v.nivel = 'juridico') then
    raise exception 'acordo de outra organização sem vínculo jurídico com a empresa';
  end if;
  return new;
end $$;
create trigger valida_org before insert or update on colaborador_acordo
  for each row execute function validar_colaborador_acordo();

-- ===== Criptografia de dados pessoais =====
-- A chave vem do Supabase Vault (segredo "chave_dados") ou, fora dele, da configuração app.chave_dados.
create function segredo(p_nome text) returns text
language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if to_regclass('vault.decrypted_secrets') is not null then
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v using p_nome;
  end if;
  v := coalesce(v, nullif(current_setting('app.' || p_nome, true), ''));
  if v is null then raise exception 'segredo % não configurado', p_nome; end if;
  return v;
end $$;

create function normalizar_cpf(p text) returns text language sql immutable as $$
  select regexp_replace(coalesce(p,''), '\D', '', 'g') $$;

create function hash_cpf(p text) returns text language sql stable security definer set search_path = public, extensions as $$
  select encode(hmac(normalizar_cpf(p), segredo('chave_dados'), 'sha256'), 'hex') $$;

create function cifrar_texto(p text) returns bytea language sql stable security definer set search_path = public, extensions as $$
  select case when p is null then null else pgp_sym_encrypt(p, segredo('chave_dados')) end $$;

create function decifrar_texto(p bytea) returns text language sql stable security definer set search_path = public, extensions as $$
  select case when p is null then null else pgp_sym_decrypt(p, segredo('chave_dados')) end $$;

-- Revelar CPF/telefone exige papel de RH/admin na empresa (ou gestão contábil), e fica auditado.
create function revelar_dados_colaborador(p_colaborador uuid)
returns table (cpf text, telefone text) language plpgsql security definer set search_path = public, auth as $$
declare c colaborador%rowtype;
begin
  select * into c from colaborador where id = p_colaborador;
  if not found or not pode_gerir_empresa(c.empresa_id) then raise exception 'sem permissão'; end if;
  perform auditoria_evento(c.organizacao_id, 'colaborador', c.id::text, 'revelar_pii');
  return query select decifrar_texto(c.cpf_cifrado), decifrar_texto(c.telefone_cifrado);
end $$;

-- Criação de colaborador pelo usuário: valida permissão e cifra CPF/telefone no banco.
create function inserir_colaborador(
  p_empresa uuid, p_nome text, p_cpf text, p_admissao date,
  p_setor uuid default null, p_matricula text default null, p_cargo text default null, p_cbo text default null,
  p_escolaridade text default null, p_telefone text default null, p_sindicato uuid default null)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare v_id uuid;
begin
  if not pode_gerir_empresa(p_empresa) then raise exception 'sem permissão'; end if;
  if length(normalizar_cpf(p_cpf)) <> 11 then raise exception 'CPF inválido'; end if;
  insert into colaborador (empresa_id, setor_id, nome, cpf_cifrado, cpf_hash, matricula, cargo, cbo, admissao,
                           escolaridade, sindicato_id, telefone_cifrado)
  values (p_empresa, p_setor, p_nome, cifrar_texto(normalizar_cpf(p_cpf)), hash_cpf(p_cpf), p_matricula, p_cargo, p_cbo,
          p_admissao, p_escolaridade, p_sindicato, cifrar_texto(p_telefone))
  returning id into v_id;
  return v_id;
end $$;

-- ===== Diagnóstico: leitura única dos dados e gravação do resultado =====
-- security definer + checagem explícita: o diagnóstico precisa enxergar acordos vinculados mesmo quando o
-- cadastro pertence ao escritório jurídico; ignorar uma exceção em silêncio classificaria o colaborador errado.
create function diagnostico_entrada(p_empresa uuid, p_data date) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare v jsonb;
begin
  if not pode_acessar_empresa(p_empresa) then raise exception 'sem permissão'; end if;
  select jsonb_build_object(
    'empresa', (select jsonb_build_object('id', e.id, 'porte', e.porte, 'terceirizada_publica', e.terceirizada_publica,
                                           'uf', e.uf, 'municipio_ibge', e.municipio_ibge) from empresa e where e.id = p_empresa),
    'regras', (select coalesce(jsonb_agg(jsonb_build_object('codigo', r.codigo, 'vigencia', r.vigencia::text, 'escopo', r.escopo,
                 'parametros', r.parametros, 'prioridade', r.prioridade, 'ativa', r.ativa) order by r.codigo, lower(r.vigencia)), '[]')
                 from regra_jornada r),
    'sem_contrato', (select count(*) from colaborador c
                      where c.empresa_id = p_empresa and (c.desligamento is null or c.desligamento >= p_data)
                        and not exists (select 1 from contrato_versao cv where cv.colaborador_id = c.id and cv.vigencia @> p_data)),
    'colaboradores', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'nome', c.nome, 'setor', s.nome, 'turno', cv.turno, 'escolaridade', c.escolaridade,
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
      join contrato_versao cv on cv.colaborador_id = c.id and cv.vigencia @> p_data
      left join setor s on s.id = c.setor_id
     where c.empresa_id = p_empresa and (c.desligamento is null or c.desligamento >= p_data))
  ) into v;
  return v;
end $$;

-- Security invoker: o RLS decide quem pode gravar. Garante que todos os itens pertencem à empresa.
create function salvar_diagnostico(p_empresa uuid, p_data date, p_resumo jsonb, p_itens jsonb) returns uuid
language plpgsql security invoker set search_path = public, auth as $$
declare v_id uuid;
begin
  if exists (select 1 from jsonb_array_elements(p_itens) i
              where not exists (select 1 from colaborador c where c.id = (i ->> 'colaboradorId')::uuid and c.empresa_id = p_empresa)) then
    raise exception 'item de diagnóstico de colaborador fora da empresa';
  end if;
  insert into diagnostico (empresa_id, data_referencia, resumo, criado_por)
  values (p_empresa, p_data, p_resumo, auth.uid()) returning id into v_id;
  insert into diagnostico_item (diagnostico_id, colaborador_id, classificacao, dados)
  select v_id, (i ->> 'colaboradorId')::uuid, i ->> 'classificacao', i from jsonb_array_elements(p_itens) i;
  return v_id;
end $$;
revoke all on function diagnostico_entrada(uuid, date), salvar_diagnostico(uuid, date, jsonb, jsonb) from public, anon;
grant execute on function diagnostico_entrada(uuid, date), salvar_diagnostico(uuid, date, jsonb, jsonb) to authenticated;

-- Leitura de um diagnóstico salvo com seus itens e cenários (RLS do usuário).
create function diagnostico_obter(p_id uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'id', d.id, 'empresa_id', d.empresa_id, 'data_referencia', d.data_referencia, 'criado_em', d.criado_em, 'resumo', d.resumo,
    'itens', (select coalesce(jsonb_agg(i.dados order by i.id), '[]') from diagnostico_item i where i.diagnostico_id = d.id),
    'cenarios', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'parametros', c.parametros, 'resultado', c.resultado) order by c.nome), '[]')
                   from cenario c where c.diagnostico_id = d.id))
  from diagnostico d where d.id = p_id $$;

create function salvar_cenario(p_diagnostico uuid, p_nome text, p_parametros jsonb, p_resultado jsonb) returns uuid
language sql security invoker set search_path = public as $$
  insert into cenario (diagnostico_id, nome, parametros, resultado) values (p_diagnostico, p_nome, p_parametros, p_resultado) returning id $$;
revoke all on function diagnostico_obter(uuid), salvar_cenario(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function diagnostico_obter(uuid), salvar_cenario(uuid, text, jsonb, jsonb) to authenticated;

-- Exportação de relatório é um evento auditável (quem exportou o quê e quando).
create function registrar_exportacao(p_diagnostico uuid, p_formato text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare d diagnostico%rowtype;
begin
  select * into d from diagnostico where id = p_diagnostico;
  if not found or not pode_acessar_empresa(d.empresa_id) then raise exception 'sem permissão'; end if;
  if p_formato not in ('pdf', 'xlsx') then raise exception 'formato inválido'; end if;
  perform auditoria_evento(d.organizacao_id, 'diagnostico', p_diagnostico::text, 'exportar_' || p_formato);
end $$;
revoke all on function registrar_exportacao(uuid, text) from public, anon;
grant execute on function registrar_exportacao(uuid, text) to authenticated;

-- ===== Alta renda ("hipersuficiente") sem placeholder =====
-- Cruza escolaridade, salário vigente e o parâmetro da regra EC141_ALTA_RENDA mais recente.
create view vw_colaborador_vigente with (security_invoker = true) as
select c.id as colaborador_id, c.organizacao_id, c.empresa_id, c.setor_id, s.nome as setor_nome, c.nome, c.matricula, c.cargo, c.escolaridade,
       cv.id as contrato_id, cv.salario_base, cv.jornada_semanal_min, cv.divisor, cv.tipo_escala,
       cv.folgas_semana, cv.turno,
       (c.escolaridade in ('superior','pos')
        and r.piso is not null and cv.salario_base >= r.piso) as hipersuficiente
  from colaborador c
  join contrato_versao cv on cv.colaborador_id = c.id and cv.vigencia @> current_date
  left join setor s on s.id = c.setor_id
  left join lateral (
    select (rj.parametros ->> 'salario_minimo')::numeric as piso
      from regra_jornada rj
     where rj.codigo = 'EC141_ALTA_RENDA' and rj.ativa
     order by lower(rj.vigencia) desc limit 1) r on true
 where c.desligamento is null or c.desligamento >= current_date;

-- ===== Auditoria =====
select auditar_tabela('sindicato'), auditar_tabela('unidade'), auditar_tabela('setor'),
       auditar_tabela('acordo_coletivo'), auditar_tabela('clausula_jornada'), auditar_tabela('colaborador'),
       auditar_tabela('contrato_versao'), auditar_tabela('colaborador_acordo'), auditar_tabela('regra_jornada'),
       auditar_tabela('feriado'), auditar_tabela('diagnostico'), auditar_tabela('cenario'), auditar_tabela('importacao');

-- ===== Funções de apoio a políticas =====
-- Acordo/convenção aplicado a colaboradores de uma empresa que o usuário gere (ex.: convenção cadastrada pelo escritório jurídico).
create function acordo_vinculado_a_minha_empresa(p_acordo uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from colaborador_acordo ca join colaborador c on c.id = ca.colaborador_id
                  where ca.acordo_id = p_acordo and pode_acessar_empresa(c.empresa_id)) $$;
create function pode_ver_acordo(p_acordo uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from acordo_coletivo a where a.id = p_acordo
    and (a.organizacao_id in (select minhas_organizacoes_gestao())
         or (a.empresa_id is not null and pode_acessar_empresa(a.empresa_id))
         or acordo_vinculado_a_minha_empresa(a.id))) $$;
create function pode_gerir_acordo(p_acordo uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from acordo_coletivo a where a.id = p_acordo
    and tenho_papel(a.organizacao_id, array['admin','advogado']::papel[])) $$;
create function eh_proprio_colaborador(p_colab uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from colaborador c where c.id = p_colab and c.usuario_id = auth.uid()) $$;
create function empresa_do_colaborador(p_colab uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select empresa_id from colaborador where id = p_colab $$;

-- pode_acessar_empresa agora só vale para papéis de gestão (ou vínculo de escritório).
create or replace function pode_acessar_empresa(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from empresa e
     where e.id = p_empresa
       and (e.organizacao_id in (select minhas_organizacoes_gestao())
            or exists (select 1 from vinculo_empresa v
                        where v.empresa_id = e.id
                          and v.organizacao_id in (select minhas_organizacoes_gestao()))))
$$;

-- empresa_select: gestão, vínculo, ou o próprio colaborador/líder (leitura da empresa onde trabalha)
drop policy empresa_select on empresa;
create policy empresa_select on empresa for select to authenticated
  using (organizacao_id in (select minhas_organizacoes_gestao())
         or exists (select 1 from vinculo_empresa v
                     where v.empresa_id = empresa.id and v.organizacao_id in (select minhas_organizacoes_gestao()))
         or empresa_do_usuario(id));

-- ===== RLS =====
alter table sindicato enable row level security;
alter table unidade enable row level security;
alter table setor enable row level security;
alter table acordo_coletivo enable row level security;
alter table clausula_jornada enable row level security;
alter table colaborador enable row level security;
alter table contrato_versao enable row level security;
alter table colaborador_acordo enable row level security;
alter table regra_jornada enable row level security;
alter table feriado enable row level security;
alter table diagnostico enable row level security;
alter table diagnostico_item enable row level security;
alter table cenario enable row level security;
alter table importacao enable row level security;

create policy sindicato_select on sindicato for select to authenticated
  using (organizacao_id is null or organizacao_id in (select minhas_organizacoes()));
create policy sindicato_write on sindicato for all to authenticated
  using (organizacao_id is not null and tenho_papel(organizacao_id, array['admin','rh','contador','advogado']::papel[]))
  with check (organizacao_id is not null and tenho_papel(organizacao_id, array['admin','rh','contador','advogado']::papel[]));

create policy unidade_select on unidade for select to authenticated using (pode_acessar_empresa(empresa_id) or empresa_do_usuario(empresa_id));
create policy unidade_insert on unidade for insert to authenticated with check (pode_gerir_empresa(empresa_id));
create policy unidade_update on unidade for update to authenticated using (pode_gerir_empresa(empresa_id)) with check (pode_gerir_empresa(empresa_id));
create policy unidade_delete on unidade for delete to authenticated using (pode_gerir_empresa(empresa_id));

create policy setor_select on setor for select to authenticated
  using (organizacao_id in (select minhas_organizacoes_gestao()) or lider_usuario_id = auth.uid()
         or exists (select 1 from unidade u where u.id = unidade_id and (pode_acessar_empresa(u.empresa_id) or empresa_do_usuario(u.empresa_id))));
create policy setor_insert on setor for insert to authenticated
  with check (exists (select 1 from unidade u where u.id = unidade_id and pode_gerir_empresa(u.empresa_id)));
create policy setor_update on setor for update to authenticated
  using (exists (select 1 from unidade u where u.id = unidade_id and pode_gerir_empresa(u.empresa_id)))
  with check (exists (select 1 from unidade u where u.id = unidade_id and pode_gerir_empresa(u.empresa_id)));
create policy setor_delete on setor for delete to authenticated
  using (exists (select 1 from unidade u where u.id = unidade_id and pode_gerir_empresa(u.empresa_id)));

-- Inline: pode_ver_acordo(id) não enxerga a linha recém-inserida (INSERT ... RETURNING).
create policy acordo_select on acordo_coletivo for select to authenticated
  using (organizacao_id in (select minhas_organizacoes_gestao())
         or (empresa_id is not null and pode_acessar_empresa(empresa_id))
         or acordo_vinculado_a_minha_empresa(id));
create policy acordo_insert on acordo_coletivo for insert to authenticated
  with check (tenho_papel(organizacao_id, array['admin','advogado']::papel[]));
create policy acordo_update on acordo_coletivo for update to authenticated
  using (pode_gerir_acordo(id)) with check (tenho_papel(organizacao_id, array['admin','advogado']::papel[]));
create policy acordo_delete on acordo_coletivo for delete to authenticated using (pode_gerir_acordo(id));

create policy clausula_select on clausula_jornada for select to authenticated using (pode_ver_acordo(acordo_id));
create policy clausula_insert on clausula_jornada for insert to authenticated with check (pode_gerir_acordo(acordo_id));
create policy clausula_update on clausula_jornada for update to authenticated using (pode_gerir_acordo(acordo_id)) with check (pode_gerir_acordo(acordo_id));
create policy clausula_delete on clausula_jornada for delete to authenticated using (pode_gerir_acordo(acordo_id));

create policy colaborador_select on colaborador for select to authenticated
  using (pode_acessar_empresa(empresa_id) or usuario_id = auth.uid()
         or exists (select 1 from setor s where s.id = setor_id and s.lider_usuario_id = auth.uid()));
create policy colaborador_insert on colaborador for insert to authenticated with check (pode_gerir_empresa(empresa_id));
create policy colaborador_update on colaborador for update to authenticated using (pode_gerir_empresa(empresa_id)) with check (pode_gerir_empresa(empresa_id));
create policy colaborador_delete on colaborador for delete to authenticated using (pode_gerir_empresa(empresa_id));

-- Salário e contrato: gestão da empresa ou o próprio colaborador (líder não vê salários).
create policy contrato_select on contrato_versao for select to authenticated
  using (pode_acessar_empresa(empresa_do_colaborador(colaborador_id)) or eh_proprio_colaborador(colaborador_id));
create policy contrato_insert on contrato_versao for insert to authenticated with check (pode_gerir_empresa(empresa_do_colaborador(colaborador_id)));
create policy contrato_update on contrato_versao for update to authenticated
  using (pode_gerir_empresa(empresa_do_colaborador(colaborador_id))) with check (pode_gerir_empresa(empresa_do_colaborador(colaborador_id)));
create policy contrato_delete on contrato_versao for delete to authenticated using (pode_gerir_empresa(empresa_do_colaborador(colaborador_id)));

create policy colab_acordo_select on colaborador_acordo for select to authenticated
  using (pode_acessar_empresa(empresa_do_colaborador(colaborador_id)));
create policy colab_acordo_write_i on colaborador_acordo for insert to authenticated
  with check (pode_gerir_acordo(acordo_id) or pode_gerir_empresa(empresa_do_colaborador(colaborador_id)));
create policy colab_acordo_write_d on colaborador_acordo for delete to authenticated
  using (pode_gerir_acordo(acordo_id) or pode_gerir_empresa(empresa_do_colaborador(colaborador_id)));

create policy regra_select on regra_jornada for select to authenticated using (true);
create policy regra_insert on regra_jornada for insert to authenticated with check (sou_superadmin());
create policy regra_update on regra_jornada for update to authenticated using (sou_superadmin()) with check (sou_superadmin());
create policy regra_delete on regra_jornada for delete to authenticated using (sou_superadmin());
create policy feriado_select on feriado for select to authenticated using (true);
create policy feriado_insert on feriado for insert to authenticated with check (sou_superadmin());
create policy feriado_update on feriado for update to authenticated using (sou_superadmin()) with check (sou_superadmin());
create policy feriado_delete on feriado for delete to authenticated using (sou_superadmin());

create policy diagnostico_select on diagnostico for select to authenticated using (pode_acessar_empresa(empresa_id));
create policy diagnostico_insert on diagnostico for insert to authenticated with check (pode_acessar_empresa(empresa_id));
create policy diagnostico_delete on diagnostico for delete to authenticated using (pode_gerir_empresa(empresa_id));
create policy diag_item_select on diagnostico_item for select to authenticated
  using (exists (select 1 from diagnostico d where d.id = diagnostico_id and pode_acessar_empresa(d.empresa_id)));
create policy diag_item_insert on diagnostico_item for insert to authenticated
  with check (exists (select 1 from diagnostico d where d.id = diagnostico_id and pode_acessar_empresa(d.empresa_id)));
create policy cenario_select on cenario for select to authenticated
  using (exists (select 1 from diagnostico d where d.id = diagnostico_id and pode_acessar_empresa(d.empresa_id)));
create policy cenario_insert on cenario for insert to authenticated
  with check (exists (select 1 from diagnostico d where d.id = diagnostico_id and pode_acessar_empresa(d.empresa_id)));
create policy cenario_update on cenario for update to authenticated
  using (exists (select 1 from diagnostico d where d.id = diagnostico_id and pode_acessar_empresa(d.empresa_id)))
  with check (exists (select 1 from diagnostico d where d.id = diagnostico_id and pode_acessar_empresa(d.empresa_id)));
create policy cenario_delete on cenario for delete to authenticated
  using (exists (select 1 from diagnostico d where d.id = diagnostico_id and pode_gerir_empresa(d.empresa_id)));

create policy importacao_select on importacao for select to authenticated
  using (empresa_id is not null and pode_gerir_empresa(empresa_id));
create policy importacao_insert on importacao for insert to authenticated
  with check (empresa_id is not null and pode_gerir_empresa(empresa_id));
create policy importacao_update on importacao for update to authenticated
  using (empresa_id is not null and pode_gerir_empresa(empresa_id))
  with check (empresa_id is not null and pode_gerir_empresa(empresa_id));

-- ===== Privilégios =====
grant select, insert, update, delete on sindicato, unidade, setor, acordo_coletivo, clausula_jornada,
  colaborador, contrato_versao, regra_jornada, feriado to authenticated;
grant select, insert, delete on colaborador_acordo to authenticated;
grant select, insert, delete on diagnostico to authenticated;
grant select, insert on diagnostico_item to authenticated;
grant select, insert, update, delete on cenario to authenticated;
grant select, insert, update on importacao to authenticated;
grant select on vw_colaborador_vigente to authenticated;
grant usage on all sequences in schema public to authenticated;
revoke all on function segredo(text), hash_cpf(text), cifrar_texto(text), decifrar_texto(bytea) from public, anon, authenticated;
grant execute on function normalizar_cpf(text), revelar_dados_colaborador(uuid),
  inserir_colaborador(uuid, text, text, date, uuid, text, text, text, text, text, uuid) to authenticated;
grant execute on function acordo_vinculado_a_minha_empresa(uuid), sou_superadmin(), minhas_organizacoes_gestao(), empresa_do_usuario(uuid), pode_ver_acordo(uuid),
  pode_gerir_acordo(uuid), eh_proprio_colaborador(uuid), empresa_do_colaborador(uuid) to authenticated;

-- ===== 0003_storage.up.sql =====
-- Buckets privados e políticas de Storage por pasta da organização (apenas no Supabase; ignorado em Postgres puro).
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'Schema storage ausente: políticas de Storage ignoradas';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit) values
    ('importacoes', 'importacoes', false, 10485760),   -- planilhas de colaboradores (10 MB)
    ('marca',       'marca',       false, 1048576)     -- logos de white label (1 MB)
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

  -- Convenção de caminho: <organizacao_id>/<arquivo>. O worker (service_role) só lê o que o banco validou.
  create policy importacoes_select on storage.objects for select to authenticated
    using (bucket_id = 'importacoes' and (storage.foldername(name))[1] in (select o::text from minhas_organizacoes_gestao() o));
  create policy importacoes_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'importacoes' and (storage.foldername(name))[1] in (select o::text from minhas_organizacoes_gestao() o));
  create policy importacoes_delete on storage.objects for delete to authenticated
    using (bucket_id = 'importacoes' and (storage.foldername(name))[1] in (select o::text from minhas_organizacoes_gestao() o));

  create policy marca_select on storage.objects for select to authenticated
    using (bucket_id = 'marca' and (storage.foldername(name))[1] in (select o::text from minhas_organizacoes() o));
  create policy marca_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'marca' and tenho_papel(((storage.foldername(name))[1])::uuid, array['admin']::papel[]));
  create policy marca_update on storage.objects for update to authenticated
    using (bucket_id = 'marca' and tenho_papel(((storage.foldername(name))[1])::uuid, array['admin']::papel[]))
    with check (bucket_id = 'marca' and tenho_papel(((storage.foldername(name))[1])::uuid, array['admin']::papel[]));
  create policy marca_delete on storage.objects for delete to authenticated
    using (bucket_id = 'marca' and tenho_papel(((storage.foldername(name))[1])::uuid, array['admin']::papel[]));
end $$;

-- ===== 0004_usuario_onboarding.up.sql =====
-- Todo usuário do Supabase Auth passa a ter a linha correspondente em public.usuario.
-- Sem isso, criar_organizacao falha (membro referencia usuario) e ninguém consegue começar.
create function criar_usuario_ao_cadastrar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into usuario (id, nome, email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'nome'), ''), nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1), 'Usuário'),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end $$;
revoke all on function criar_usuario_ao_cadastrar() from public, anon, authenticated;

create trigger ao_cadastrar_usuario after insert on auth.users
  for each row execute function criar_usuario_ao_cadastrar();

-- Usuários que já existiam antes desta migration.
insert into usuario (id, nome, email)
select u.id,
       coalesce(nullif(trim(u.raw_user_meta_data ->> 'nome'), ''), nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(u.email, ''), '@', 1), 'Usuário'),
       coalesce(u.email, '')
  from auth.users u
on conflict (id) do nothing;

-- ===== 0005_interruptor_mfa.up.sql =====
-- Interruptor da verificação em duas etapas (MFA).
--
-- Por regra, admin, contador, advogado e superadmin só enxergam dados com MFA (aal2). Este interruptor existe
-- para ambientes de TESTE, sem dados reais. Fonte única da verdade: esta tabela (o app e o RLS leem daqui).
--   * Padrão seguro: ligado. Linha ausente, valor inválido ou qualquer coisa diferente de false = ligado.
--   * Só quem tem acesso direto ao banco (SQL Editor / service_role) liga e desliga; usuários do app não leem
--     nem escrevem a tabela.
--   * Toda mudança fica na auditoria, com o motivo.
create table configuracao_sistema (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,
  valor jsonb not null,
  motivo text,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);
alter table configuracao_sistema enable row level security;   -- sem políticas: nenhum usuário do app acessa
revoke all on configuracao_sistema from anon, authenticated;
insert into configuracao_sistema (chave, valor, motivo) values ('mfa_obrigatorio', 'true'::jsonb, 'padrão seguro');
select auditar_tabela('configuracao_sistema');

-- true = MFA exigido. Só "false" exato desliga.
create function mfa_obrigatorio() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from configuracao_sistema where chave = 'mfa_obrigatorio' and valor = 'false'::jsonb)
$$;
revoke all on function mfa_obrigatorio() from public, anon;
grant execute on function mfa_obrigatorio() to authenticated;

-- mfa_ok agora respeita o interruptor.
create or replace function mfa_ok(p papel) returns boolean
language sql stable as $$
  select not papel_exige_mfa(p) or not mfa_obrigatorio() or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- Liga/desliga com motivo obrigatório. Só o dono do banco e o service_role executam.
create function definir_mfa_obrigatorio(p_ativo boolean, p_motivo text) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Informe o motivo (mínimo 5 caracteres).';
  end if;
  update configuracao_sistema
     set valor = to_jsonb(p_ativo), motivo = trim(p_motivo), atualizado_em = now(), atualizado_por = auth.uid()
   where chave = 'mfa_obrigatorio';
end $$;
revoke all on function definir_mfa_obrigatorio(boolean, text) from public, anon, authenticated;
grant execute on function definir_mfa_obrigatorio(boolean, text) to service_role;

-- ===== 0006_escalas.up.sql =====
-- Fase 2: escalas de trabalho (modelos de turno, demanda de cobertura, escala, alocações,
-- ausências, violações publicadas e ciência do colaborador).
--
-- Regras de segurança:
--   * Escala publicada é imutável (alocações, cabeçalho e violações). Mudar = nova versão.
--   * Publicar só pelo servidor (service_role): ele revalida com o motor de regras e entrega as
--     violações; o banco recusa se houver bloqueio, confere a revisão (trava otimista) e carimba o hash.
--   * Colaborador só enxerga a própria escala publicada; líder, a do seu setor.

-- ===== Cadastros de apoio =====
create table turno_modelo (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  empresa_id uuid not null references empresa(id) on delete cascade,
  nome text not null,
  inicio_min int not null check (inicio_min between 0 and 1439),
  fim_min int not null check (fim_min between 1 and 2879 and fim_min > inicio_min and fim_min - inicio_min <= 1440),
  intervalo_min int not null default 0 check (intervalo_min >= 0 and intervalo_min < fim_min - inicio_min),
  cor text not null default '#2563eb',
  ativo boolean not null default true,
  unique (empresa_id, nome)
);
create index turno_modelo_empresa_idx on turno_modelo (empresa_id);
create index turno_modelo_org_idx on turno_modelo (organizacao_id);

create table demanda_cobertura (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  empresa_id uuid not null references empresa(id) on delete cascade,
  setor_id uuid references setor(id) on delete cascade,
  dia_semana int not null check (dia_semana between 0 and 6),   -- 0 = domingo
  faixa_inicio_min int not null check (faixa_inicio_min between 0 and 1439),
  faixa_fim_min int not null check (faixa_fim_min between 1 and 1440),
  minimo int not null check (minimo >= 0),
  ideal int check (ideal is null or ideal >= minimo)
);
create index demanda_cobertura_empresa_idx on demanda_cobertura (empresa_id);
create index demanda_cobertura_setor_idx on demanda_cobertura (setor_id);
create index demanda_cobertura_org_idx on demanda_cobertura (organizacao_id);

create table ausencia (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  empresa_id uuid not null references empresa(id) on delete cascade,
  colaborador_id uuid not null references colaborador(id) on delete cascade,
  periodo daterange not null check (not isempty(periodo) and lower_inf(periodo) = false and upper_inf(periodo) = false),
  tipo text not null check (tipo in ('ferias','afastamento')),
  observacao text,
  exclude using gist (colaborador_id with =, periodo with &&)
);
create index ausencia_empresa_idx on ausencia (empresa_id);
create index ausencia_colab_idx on ausencia (colaborador_id);
create index ausencia_org_idx on ausencia (organizacao_id);

-- ===== Escala e alocações =====
create table escala (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  empresa_id uuid not null references empresa(id) on delete cascade,
  setor_id uuid references setor(id),
  nome text not null,
  periodo daterange not null check (not isempty(periodo) and lower_inf(periodo) = false and upper_inf(periodo) = false),
  status text not null default 'rascunho' check (status in ('rascunho','publicada','substituida')),
  versao int not null default 1,
  revisao int not null default 1,                -- sobe a cada mudança de alocação (trava otimista)
  criado_por uuid references usuario(id),
  criado_em timestamptz not null default now(),
  publicada_em timestamptz,
  publicada_por uuid references usuario(id),
  hash_publicado text,
  motor_versao text,
  check ((status = 'rascunho') = (publicada_em is null)),
  check (status = 'rascunho' or hash_publicado is not null)
);
create index escala_empresa_idx on escala (empresa_id);
create index escala_setor_idx on escala (setor_id);
create index escala_org_idx on escala (organizacao_id);
-- No máximo uma escala vigente por empresa/setor/período sobreposto.
alter table escala add constraint escala_publicada_unica
  exclude using gist (empresa_id with =, (coalesce(setor_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =, periodo with &&)
  where (status = 'publicada');

create table alocacao (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  escala_id uuid not null references escala(id) on delete cascade,
  colaborador_id uuid not null references colaborador(id),
  data date not null,                              -- dia em que o turno começa
  tipo text not null check (tipo in ('trabalho','folga','dsr','ferias','afastamento','feriado')),
  inicio_min int check (inicio_min between 0 and 1439),
  fim_min int check (fim_min between 1 and 2879),
  intervalo_min int not null default 0 check (intervalo_min >= 0),
  turno_modelo_id uuid references turno_modelo(id) on delete set null,
  check ((tipo = 'trabalho') = (inicio_min is not null and fim_min is not null)),
  check (tipo <> 'trabalho' or (fim_min > inicio_min and fim_min - inicio_min <= 1440 and intervalo_min < fim_min - inicio_min)),
  -- janela absoluta em minutos desde 2000-01-01, para impedir turnos sobrepostos da mesma pessoa
  janela int4range generated always as (
    case when tipo = 'trabalho'
         then int4range((data - date '2000-01-01') * 1440 + inicio_min, (data - date '2000-01-01') * 1440 + fim_min)
    end) stored,
  exclude using gist (escala_id with =, colaborador_id with =, janela with &&)
);
create index alocacao_escala_idx on alocacao (escala_id, data);
create index alocacao_colab_idx on alocacao (colaborador_id, data);
create index alocacao_org_idx on alocacao (organizacao_id);
create index alocacao_turno_idx on alocacao (turno_modelo_id);

-- Violações que existiam (alertas e infos) no momento da publicação: ficam como prova.
create table violacao (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  escala_id uuid not null references escala(id) on delete cascade,
  codigo text not null,
  severidade text not null check (severidade in ('bloqueio','alerta','info')),
  colaborador_id uuid references colaborador(id),
  data date,
  mensagem text not null,
  detalhe jsonb not null default '{}'
);
create index violacao_escala_idx on violacao (escala_id);
create index violacao_org_idx on violacao (organizacao_id);
create index violacao_colab_idx on violacao (colaborador_id);

create table ciencia (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  escala_id uuid not null references escala(id) on delete cascade,
  colaborador_id uuid not null references colaborador(id),
  usuario_id uuid not null references usuario(id),
  hash_escala text not null,
  ciente_em timestamptz not null default now(),
  unique (escala_id, colaborador_id)
);
create index ciencia_colab_idx on ciencia (colaborador_id);
create index ciencia_usuario_idx on ciencia (usuario_id);
create index ciencia_org_idx on ciencia (organizacao_id);

-- ===== Gatilhos de coerência =====
-- Organização sempre derivada da empresa (mesma ideia de herdar_organizacao).
create function escala_herdar() returns trigger language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_empresa uuid;
begin
  select organizacao_id into v_org from empresa where id = new.empresa_id;
  if v_org is null then raise exception 'empresa não encontrada'; end if;
  new.organizacao_id := v_org;
  if new.setor_id is not null and not exists (
       select 1 from setor s join unidade u on u.id = s.unidade_id where s.id = new.setor_id and u.empresa_id = new.empresa_id) then
    raise exception 'o setor não pertence à empresa da escala';
  end if;
  return new;
end $$;
create trigger herdar_org before insert or update on escala for each row execute function escala_herdar();
create trigger herdar_org before insert or update on turno_modelo for each row execute function herdar_organizacao('empresa');
create trigger herdar_org before insert or update on demanda_cobertura for each row execute function herdar_organizacao('empresa');
create trigger herdar_org before insert or update on ausencia for each row execute function herdar_organizacao('empresa');

create function ausencia_validar() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select empresa_id from colaborador where id = new.colaborador_id) is distinct from new.empresa_id then
    raise exception 'o colaborador não pertence à empresa informada';
  end if;
  return new;
end $$;
create trigger ausencia_validar before insert or update on ausencia for each row execute function ausencia_validar();

-- Cabeçalho da escala: publicada é imutável; só o servidor (função de publicação) muda o status.
create function escala_proteger() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'rascunho' then raise exception 'Escala publicada não pode ser apagada.'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'rascunho' and coalesce(current_setting('app.publicando', true), '') <> '1' then
      raise exception 'Escala só nasce como rascunho; publique pela função de publicação.';
    end if;
    return new;
  end if;
  if old.status = 'rascunho' and new.status <> 'rascunho' and coalesce(current_setting('app.publicando', true), '') <> '1' then
    raise exception 'Publique pela função de publicação (com revalidação no servidor).';
  end if;
  if old.status = 'publicada' and new.status = 'substituida' and coalesce(current_setting('app.publicando', true), '') = '1' then
    new.id := old.id;
    return new;
  end if;
  if old.status <> 'rascunho' then raise exception 'Escala publicada é imutável; crie uma nova versão.'; end if;
  return new;
end $$;
create trigger escala_proteger before insert or update or delete on escala for each row execute function escala_proteger();

-- Alocações: só em rascunho, só de colaborador da mesma empresa; cada mudança sobe a revisão.
create function alocacao_validar() returns trigger language plpgsql security definer set search_path = public as $$
declare v record; v_id uuid;
begin
  v_id := case when tg_op = 'DELETE' then old.escala_id else new.escala_id end;
  select * into v from escala where id = v_id;
  if v.id is null then return coalesce(new, old); end if;     -- cascade de exclusão da escala
  if v.status <> 'rascunho' then raise exception 'Escala publicada é imutável; crie uma nova versão.'; end if;
  if tg_op <> 'DELETE' then
    if (select empresa_id from colaborador where id = new.colaborador_id) is distinct from v.empresa_id then
      raise exception 'o colaborador não pertence à empresa da escala';
    end if;
    if not (v.periodo @> new.data) then raise exception 'a data % está fora do período da escala', new.data; end if;
    new.organizacao_id := v.organizacao_id;
  end if;
  update escala set revisao = revisao + 1 where id = v_id;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger alocacao_validar before insert or update or delete on alocacao for each row execute function alocacao_validar();

create function violacao_ciencia_proteger() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' or (tg_op = 'DELETE' and exists (select 1 from escala where id = old.escala_id)) then
    raise exception '% é registro histórico e não pode ser alterado.', tg_table_name;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger proteger before update or delete on violacao for each row execute function violacao_ciencia_proteger();
create trigger proteger before update or delete on ciencia for each row execute function violacao_ciencia_proteger();

-- ===== Funções de apoio para RLS =====
create function lider_do_colaborador(p_colab uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from colaborador c join setor s on s.id = c.setor_id
                  where c.id = p_colab and s.lider_usuario_id = auth.uid()) $$;

-- ===== Publicação (somente servidor) =====
-- O servidor revalida com o motor de regras e passa as violações. Aqui: autoriza o ator, confere a
-- revisão, recusa bloqueios, calcula o hash das alocações e congela a escala.
create function publicar_escala(p_escala uuid, p_revisao int, p_violacoes jsonb, p_ator uuid, p_motor text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare e escala%rowtype; v_hash text; v_versao int; v jsonb;
begin
  select * into e from escala where id = p_escala for update;
  if e.id is null then raise exception 'Escala não encontrada.'; end if;
  if not exists (
       select 1 from empresa em
        where em.id = e.empresa_id
          and (exists (select 1 from membro m where m.usuario_id = p_ator and m.organizacao_id = em.organizacao_id and m.papel in ('admin','rh'))
               or exists (select 1 from vinculo_empresa vi join membro m on m.organizacao_id = vi.organizacao_id
                           where vi.empresa_id = em.id and vi.nivel = 'gestao' and m.usuario_id = p_ator and m.papel in ('admin','contador')))) then
    raise exception 'Sem permissão para publicar esta escala.';
  end if;
  if e.status <> 'rascunho' then raise exception 'Só rascunho pode ser publicado.'; end if;
  if e.revisao <> p_revisao then raise exception 'A escala mudou desde a validação (revisão % → %). Valide de novo.', p_revisao, e.revisao; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_violacoes, '[]')) x where x ->> 'severidade' = 'bloqueio') then
    raise exception 'Escala com bloqueios não pode ser publicada.';
  end if;
  if not exists (select 1 from alocacao where escala_id = e.id) then raise exception 'Escala sem alocações.'; end if;

  -- auditoria e RLS passam a enxergar o ator
  perform set_config('request.jwt.claims', json_build_object('sub', p_ator, 'role', 'authenticated')::text, true);
  perform set_config('app.publicando', '1', true);

  select coalesce(max(versao), 0) + 1 into v_versao
    from escala where empresa_id = e.empresa_id and coalesce(setor_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(e.setor_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and periodo = e.periodo and id <> e.id;
  update escala set status = 'substituida'
   where empresa_id = e.empresa_id and status = 'publicada' and periodo && e.periodo
     and coalesce(setor_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(e.setor_id, '00000000-0000-0000-0000-000000000000'::uuid);

  select encode(digest(string_agg(concat_ws('|', a.colaborador_id, a.data, a.tipo, a.inicio_min, a.fim_min, a.intervalo_min), E'\n'
                                   order by a.colaborador_id, a.data, a.inicio_min nulls first, a.tipo), 'sha256'), 'hex')
    into v_hash from alocacao a where a.escala_id = e.id;

  for v in select * from jsonb_array_elements(coalesce(p_violacoes, '[]')) loop
    insert into violacao (organizacao_id, escala_id, codigo, severidade, colaborador_id, data, mensagem, detalhe)
    values (e.organizacao_id, e.id, v ->> 'codigo', v ->> 'severidade', nullif(v ->> 'colaboradorId', '')::uuid,
            nullif(v ->> 'data', '')::date, v ->> 'mensagem', coalesce(v -> 'detalhe', '{}'));
  end loop;

  update escala set status = 'publicada', versao = v_versao, publicada_em = now(), publicada_por = p_ator,
                    hash_publicado = v_hash, motor_versao = p_motor where id = e.id;
  perform auditoria_evento(e.organizacao_id, 'escala', e.id::text, 'publicar');
  return v_hash;
end $$;
revoke all on function publicar_escala(uuid, int, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function publicar_escala(uuid, int, jsonb, uuid, text) to service_role;

-- Ciência: o próprio colaborador confirma que leu a escala publicada.
create function registrar_ciencia(p_escala uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare e escala%rowtype; v_colab uuid;
begin
  select * into e from escala where id = p_escala;
  if e.id is null or e.status <> 'publicada' then raise exception 'Escala não está publicada.'; end if;
  select c.id into v_colab from colaborador c
   where c.usuario_id = auth.uid() and c.empresa_id = e.empresa_id
     and exists (select 1 from alocacao a where a.escala_id = e.id and a.colaborador_id = c.id);
  if v_colab is null then raise exception 'Você não está nesta escala.'; end if;
  insert into ciencia (organizacao_id, escala_id, colaborador_id, usuario_id, hash_escala)
  values (e.organizacao_id, e.id, v_colab, auth.uid(), e.hash_publicado)
  on conflict (escala_id, colaborador_id) do nothing;
  perform auditoria_evento(e.organizacao_id, 'ciencia', e.id::text, 'ciencia');
end $$;
revoke all on function registrar_ciencia(uuid) from public, anon;
grant execute on function registrar_ciencia(uuid), lider_do_colaborador(uuid) to authenticated;

-- ===== RLS =====
alter table turno_modelo enable row level security;
alter table demanda_cobertura enable row level security;
alter table ausencia enable row level security;
alter table escala enable row level security;
alter table alocacao enable row level security;
alter table violacao enable row level security;
alter table ciencia enable row level security;

create policy turno_select on turno_modelo for select to authenticated using (pode_acessar_empresa(empresa_id) or empresa_do_usuario(empresa_id));
create policy turno_insert on turno_modelo for insert to authenticated with check (pode_gerir_empresa(empresa_id));
create policy turno_update on turno_modelo for update to authenticated using (pode_gerir_empresa(empresa_id)) with check (pode_gerir_empresa(empresa_id));
create policy turno_delete on turno_modelo for delete to authenticated using (pode_gerir_empresa(empresa_id));

create policy demanda_select on demanda_cobertura for select to authenticated using (pode_acessar_empresa(empresa_id));
create policy demanda_insert on demanda_cobertura for insert to authenticated with check (pode_gerir_empresa(empresa_id));
create policy demanda_update on demanda_cobertura for update to authenticated using (pode_gerir_empresa(empresa_id)) with check (pode_gerir_empresa(empresa_id));
create policy demanda_delete on demanda_cobertura for delete to authenticated using (pode_gerir_empresa(empresa_id));

create policy ausencia_select on ausencia for select to authenticated
  using (pode_acessar_empresa(empresa_id) or eh_proprio_colaborador(colaborador_id));
create policy ausencia_insert on ausencia for insert to authenticated with check (pode_gerir_empresa(empresa_id));
create policy ausencia_update on ausencia for update to authenticated using (pode_gerir_empresa(empresa_id)) with check (pode_gerir_empresa(empresa_id));
create policy ausencia_delete on ausencia for delete to authenticated using (pode_gerir_empresa(empresa_id));

-- Gestão vê tudo; quem trabalha na empresa vê só o cabeçalho das escalas publicadas.
create policy escala_select on escala for select to authenticated
  using (pode_acessar_empresa(empresa_id) or (status = 'publicada' and empresa_do_usuario(empresa_id)));
create policy escala_insert on escala for insert to authenticated
  with check (status = 'rascunho' and pode_gerir_empresa(empresa_id) and criado_por = auth.uid());
create policy escala_update on escala for update to authenticated
  using (status = 'rascunho' and pode_gerir_empresa(empresa_id)) with check (status = 'rascunho' and pode_gerir_empresa(empresa_id));
create policy escala_delete on escala for delete to authenticated using (status = 'rascunho' and pode_gerir_empresa(empresa_id));

create function escala_da_empresa(p_escala uuid) returns uuid
language sql stable security definer set search_path = public as $$ select empresa_id from escala where id = p_escala $$;
create function escala_publicada(p_escala uuid) returns boolean
language sql stable security definer set search_path = public as $$ select exists (select 1 from escala where id = p_escala and status = 'publicada') $$;
grant execute on function escala_da_empresa(uuid), escala_publicada(uuid) to authenticated;

-- Colaborador vê a própria escala publicada; líder, a do seu setor; gestão vê todas.
create policy alocacao_select on alocacao for select to authenticated
  using (pode_acessar_empresa(escala_da_empresa(escala_id))
         or (escala_publicada(escala_id) and (eh_proprio_colaborador(colaborador_id) or lider_do_colaborador(colaborador_id))));
create policy alocacao_insert on alocacao for insert to authenticated with check (pode_gerir_empresa(escala_da_empresa(escala_id)));
create policy alocacao_update on alocacao for update to authenticated
  using (pode_gerir_empresa(escala_da_empresa(escala_id))) with check (pode_gerir_empresa(escala_da_empresa(escala_id)));
create policy alocacao_delete on alocacao for delete to authenticated using (pode_gerir_empresa(escala_da_empresa(escala_id)));

-- Violações e ciências: leitura; escrita só pelas funções (security definer).
create policy violacao_select on violacao for select to authenticated
  using (pode_acessar_empresa(escala_da_empresa(escala_id)));
create policy ciencia_select on ciencia for select to authenticated
  using (pode_acessar_empresa(escala_da_empresa(escala_id)) or usuario_id = auth.uid());

-- ===== Auditoria =====
select auditar_tabela('turno_modelo'), auditar_tabela('demanda_cobertura'), auditar_tabela('ausencia'),
       auditar_tabela('escala'), auditar_tabela('alocacao'), auditar_tabela('violacao'), auditar_tabela('ciencia');

-- ===== Permissões =====
grant select, insert, update, delete on turno_modelo, demanda_cobertura, ausencia, escala, alocacao to authenticated;
grant select on violacao, ciencia to authenticated;

-- ===== 0007_escala_entrada.up.sql =====
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

-- ===== 0008_salvar_alocacoes.up.sql =====
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

-- ===== 0009_convite_colaborador.up.sql =====
-- Convite do colaborador: o RH informa o e-mail; quem confirma esse e-mail no primeiro acesso
-- (link mágico, senha ou Google) passa a ser o dono do cadastro e ganha o papel "colaborador".
-- O vínculo só acontece com e-mail CONFIRMADO no Supabase Auth: digitar o e-mail de outra pessoa não basta.

create table convite_colaborador (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  colaborador_id uuid not null references colaborador(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  criado_por uuid references usuario(id),
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '14 days',
  aceito_em timestamptz
);
create unique index convite_pendente_colab_idx on convite_colaborador (colaborador_id) where aceito_em is null;
create index convite_email_idx on convite_colaborador (email) where aceito_em is null;
create index convite_org_idx on convite_colaborador (organizacao_id);
create index convite_criado_por_idx on convite_colaborador (criado_por);

-- Interno: liga o usuário ao cadastro e dá o papel de colaborador na organização (sem rebaixar quem já tem outro papel).
create function vincular_colaborador_usuario(p_colaborador uuid, p_usuario uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare v_org uuid;
begin
  update colaborador set usuario_id = p_usuario where id = p_colaborador and usuario_id is null returning organizacao_id into v_org;
  if v_org is null then raise exception 'Este colaborador já tem acesso.'; end if;
  insert into membro (organizacao_id, usuario_id, papel) values (v_org, p_usuario, 'colaborador') on conflict do nothing;
end $$;
revoke all on function vincular_colaborador_usuario(uuid, uuid) from public, anon, authenticated;

-- Interno: aceita os convites pendentes e válidos daquele e-mail (ignora, sem erro, o que não puder vincular).
create function aceitar_convites(p_usuario uuid, p_email text) returns int
language plpgsql security definer set search_path = public, auth as $$
declare c record; n int := 0;
begin
  for c in select cc.id, cc.colaborador_id, co.empresa_id from convite_colaborador cc join colaborador co on co.id = cc.colaborador_id
            where cc.email = lower(btrim(p_email)) and cc.aceito_em is null and cc.expira_em > now() loop
    if exists (select 1 from colaborador x where x.empresa_id = c.empresa_id and x.usuario_id = p_usuario) then continue; end if;
    begin
      perform vincular_colaborador_usuario(c.colaborador_id, p_usuario);
      update convite_colaborador set aceito_em = now() where id = c.id;
      n := n + 1;
    exception when others then continue;   -- cadastro que já tem outro dono: o convite fica como está
    end;
  end loop;
  return n;
end $$;
revoke all on function aceitar_convites(uuid, text) from public, anon, authenticated;

-- Cadastro no Auth: cria public.usuario (como em 0004) e, se o e-mail já vier confirmado (ex.: Google), aceita convites.
create or replace function criar_usuario_ao_cadastrar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into usuario (id, nome, email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'nome'), ''), nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1), 'Usuário'),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  if new.email_confirmed_at is not null and new.email is not null then perform aceitar_convites(new.id, new.email); end if;
  return new;
end $$;

-- Link mágico: o usuário nasce sem confirmação e é confirmado quando clica no link.
create function aceitar_convites_ao_confirmar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null and new.email is not null then
    perform aceitar_convites(new.id, new.email);
  end if;
  return new;
end $$;
revoke all on function aceitar_convites_ao_confirmar() from public, anon, authenticated;
create trigger ao_confirmar_usuario after update of email_confirmed_at on auth.users
  for each row execute function aceitar_convites_ao_confirmar();

-- Convidar (RH/admin da empresa). Conta já existente e confirmada: vincula na hora; senão fica pendente.
create function convidar_colaborador(p_colaborador uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare c colaborador%rowtype; v_email text := lower(btrim(coalesce(p_email, ''))); v_user uuid; v_id uuid;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  select * into c from colaborador where id = p_colaborador;
  if c.id is null or not pode_gerir_empresa(c.empresa_id) then raise exception 'sem permissão'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Informe um e-mail válido.'; end if;
  if c.usuario_id is not null then raise exception 'Este colaborador já tem acesso.'; end if;
  if exists (select 1 from convite_colaborador cc join colaborador o on o.id = cc.colaborador_id
              where cc.email = v_email and cc.aceito_em is null and cc.expira_em > now() and o.empresa_id = c.empresa_id and cc.colaborador_id <> c.id) then
    raise exception 'Este e-mail já foi convidado para outro colaborador desta empresa.';
  end if;

  select u.id into v_user from auth.users u where lower(u.email) = v_email and u.email_confirmed_at is not null limit 1;
  if v_user is not null then
    if exists (select 1 from colaborador x where x.empresa_id = c.empresa_id and x.usuario_id = v_user) then
      raise exception 'Este e-mail já está ligado a outro colaborador desta empresa.';
    end if;
    perform vincular_colaborador_usuario(c.id, v_user);
    update convite_colaborador set aceito_em = now() where colaborador_id = c.id and aceito_em is null;
    perform auditoria_evento(c.organizacao_id, 'colaborador', c.id::text, 'acesso_vinculado');
    return jsonb_build_object('estado', 'vinculado');
  end if;

  delete from convite_colaborador where colaborador_id = c.id and aceito_em is null;
  insert into convite_colaborador (organizacao_id, colaborador_id, email, criado_por) values (c.organizacao_id, c.id, v_email, auth.uid()) returning id into v_id;
  perform auditoria_evento(c.organizacao_id, 'colaborador', c.id::text, 'convite_enviado');
  return jsonb_build_object('estado', 'pendente', 'convite_id', v_id, 'email', v_email);
end $$;

-- Revogar o acesso (ex.: desligamento): desliga o usuário do cadastro e cancela convite pendente.
create function revogar_acesso_colaborador(p_colaborador uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare c colaborador%rowtype;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  select * into c from colaborador where id = p_colaborador;
  if c.id is null or not pode_gerir_empresa(c.empresa_id) then raise exception 'sem permissão'; end if;
  delete from convite_colaborador where colaborador_id = c.id and aceito_em is null;
  if c.usuario_id is not null then
    update colaborador set usuario_id = null where id = c.id;
    if not exists (select 1 from colaborador x where x.organizacao_id = c.organizacao_id and x.usuario_id = c.usuario_id) then
      delete from membro where organizacao_id = c.organizacao_id and usuario_id = c.usuario_id and papel = 'colaborador';
    end if;
  end if;
  perform auditoria_evento(c.organizacao_id, 'colaborador', c.id::text, 'acesso_revogado');
end $$;
revoke all on function convidar_colaborador(uuid, text), revogar_acesso_colaborador(uuid) from public, anon;
grant execute on function convidar_colaborador(uuid, text), revogar_acesso_colaborador(uuid) to authenticated;

alter table convite_colaborador enable row level security;
create policy convite_select on convite_colaborador for select to authenticated using (pode_acessar_empresa(empresa_do_colaborador(colaborador_id)));
select auditar_tabela('convite_colaborador');
grant select on convite_colaborador to authenticated;

-- ===== 0010_demanda_setor.up.sql =====
-- A demanda de cobertura só pode apontar para setor da própria empresa (o RLS só confere a empresa).
create function demanda_validar() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.setor_id is not null and not exists (
       select 1 from setor s join unidade u on u.id = s.unidade_id where s.id = new.setor_id and u.empresa_id = new.empresa_id) then
    raise exception 'o setor não pertence à empresa';
  end if;
  if new.faixa_inicio_min = new.faixa_fim_min then raise exception 'a faixa horária não pode ter duração zero'; end if;
  return new;
end $$;
create trigger demanda_validar before insert or update on demanda_cobertura for each row execute function demanda_validar();

-- ===== 0011_painel_carteira.up.sql =====
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

-- ===== 0012_otimizacao.up.sql =====
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

-- ===== 0013_solicitacoes.up.sql =====
-- Solicitações do colaborador: troca de turno com colega, troca de folga, férias e afastamento (atestado).
-- Fluxo: [troca de turno] aguardando_colega → pendente (RH) → aprovada | recusada; cancelável pelo solicitante enquanto aberta.
-- Toda mudança passa por função (nada de escrita direta). O efeito na escala/ausência é aplicado pelo servidor ao aprovar,
-- depois de o motor de regras validar o resultado; aqui o banco só garante quem pode pedir, o quê e o estado do fluxo.
create table solicitacao (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  empresa_id uuid not null references empresa(id) on delete cascade,
  solicitante_id uuid not null references colaborador(id),
  destinatario_id uuid references colaborador(id),
  solicitante_nome text not null,
  destinatario_nome text,
  tipo text not null check (tipo in ('troca_turno','troca_folga','ferias','afastamento')),
  payload jsonb not null,
  motivo text check (motivo is null or length(motivo) <= 300),
  status text not null default 'pendente' check (status in ('aguardando_colega','pendente','aprovada','recusada','cancelada')),
  decisao_motivo text,
  validacao jsonb,                                  -- resultado do motor de regras no momento da decisão
  colega_respondeu_em timestamptz,
  decidido_por uuid references usuario(id),
  decidido_em timestamptz,
  canal text not null default 'web' check (canal in ('web','app','whatsapp')),
  criado_em timestamptz not null default now(),
  check ((tipo = 'troca_turno') = (destinatario_id is not null))
);
create index solicitacao_empresa_idx on solicitacao (empresa_id, status, criado_em desc);
create index solicitacao_solicitante_idx on solicitacao (solicitante_id, criado_em desc);
create index solicitacao_destinatario_idx on solicitacao (destinatario_id) where destinatario_id is not null;
create index solicitacao_org_idx on solicitacao (organizacao_id);
create index solicitacao_decidido_idx on solicitacao (decidido_por);
-- Pedido idêntico em aberto não se repete.
create unique index solicitacao_aberta_unica on solicitacao (solicitante_id, tipo, (payload::text)) where status in ('aguardando_colega','pendente');

create function hoje_sp() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- Turnos de trabalho do colaborador numa escala publicada (apoio à validação dos pedidos).
create function trabalha_na_escala(p_escala uuid, p_colab uuid, p_data date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from alocacao a join escala e on e.id = a.escala_id
                  where a.escala_id = p_escala and a.colaborador_id = p_colab and a.data = p_data and a.tipo = 'trabalho' and e.status = 'publicada') $$;

create function criar_solicitacao(p_colaborador uuid, p_tipo text, p_payload jsonb, p_destinatario uuid default null, p_motivo text default null) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare c colaborador%rowtype; d colaborador%rowtype; e escala%rowtype; v_hoje date := hoje_sp(); v_id uuid; v_status text := 'pendente';
        v_esc uuid; v_a date; v_b date; v_ini date; v_fim date; v_max int;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  select * into c from colaborador where id = p_colaborador and usuario_id = auth.uid();
  if c.id is null then raise exception 'sem permissão'; end if;
  if (select count(*) from solicitacao where solicitante_id = c.id and status in ('aguardando_colega','pendente')) >= 10 then
    raise exception 'Você já tem 10 pedidos em aberto. Aguarde as respostas ou cancele algum.';
  end if;
  if jsonb_typeof(coalesce(p_payload, 'null'::jsonb)) <> 'object' then raise exception 'pedido inválido'; end if;

  if p_tipo in ('troca_turno', 'troca_folga') then
    v_esc := nullif(p_payload ->> 'escalaId', '')::uuid;
    select * into e from escala where id = v_esc;
    if e.id is null or e.empresa_id <> c.empresa_id or e.status <> 'publicada' then raise exception 'A escala informada não está publicada para você.'; end if;
    if p_tipo = 'troca_turno' then
      v_a := nullif(p_payload ->> 'dataSolicitante', '')::date; v_b := nullif(p_payload ->> 'dataColega', '')::date;
      if v_a is null or v_b is null or v_a < v_hoje or v_b < v_hoje then raise exception 'Só dá para trocar turnos de hoje em diante.'; end if;
      select * into d from colaborador where id = p_destinatario;
      if d.id is null or d.empresa_id <> c.empresa_id or d.id = c.id then raise exception 'Escolha um colega da sua empresa.'; end if;
      if d.usuario_id is null then raise exception 'Esse colega ainda não tem acesso ao aplicativo para aceitar a troca.'; end if;
      if not trabalha_na_escala(e.id, c.id, v_a) then raise exception 'Você não tem turno de trabalho em %.', to_char(v_a, 'DD/MM/YYYY'); end if;
      if not trabalha_na_escala(e.id, d.id, v_b) then raise exception 'O colega não tem turno de trabalho em %.', to_char(v_b, 'DD/MM/YYYY'); end if;
      v_status := 'aguardando_colega';
    else
      v_a := nullif(p_payload ->> 'trabalharEm', '')::date; v_b := nullif(p_payload ->> 'folgarEm', '')::date;
      if v_a is null or v_b is null or v_a = v_b or v_a < v_hoje or v_b < v_hoje then raise exception 'Escolha dois dias diferentes, de hoje em diante.'; end if;
      if not e.periodo @> v_a or not e.periodo @> v_b then raise exception 'Os dois dias precisam estar dentro do período da escala.'; end if;
      if not trabalha_na_escala(e.id, c.id, v_b) then raise exception 'Você não tem turno de trabalho em %.', to_char(v_b, 'DD/MM/YYYY'); end if;
      if trabalha_na_escala(e.id, c.id, v_a) then raise exception 'Você já trabalha em %.', to_char(v_a, 'DD/MM/YYYY'); end if;
    end if;
  elsif p_tipo in ('ferias', 'afastamento') then
    v_ini := nullif(p_payload ->> 'inicio', '')::date; v_fim := nullif(p_payload ->> 'fim', '')::date;
    if v_ini is null or v_fim is null or v_fim < v_ini then raise exception 'Informe o primeiro e o último dia.'; end if;
    if p_tipo = 'ferias' and v_ini < v_hoje then raise exception 'As férias precisam começar de hoje em diante.'; end if;
    if p_tipo = 'afastamento' and v_ini < v_hoje - 30 then raise exception 'O afastamento só pode ser informado até 30 dias depois do início.'; end if;
    v_max := case p_tipo when 'ferias' then 44 else 59 end;
    if v_fim - v_ini > v_max then raise exception 'O período é longo demais para um único pedido.'; end if;
    if exists (select 1 from ausencia x where x.colaborador_id = c.id and x.periodo && daterange(v_ini, v_fim + 1)) then
      raise exception 'Você já tem férias ou afastamento lançados nesse período.';
    end if;
    if p_destinatario is not null then raise exception 'Esse tipo de pedido não tem colega.'; end if;
  else
    raise exception 'tipo de pedido inválido';
  end if;

  if exists (select 1 from solicitacao x where x.solicitante_id = c.id and x.tipo = p_tipo and x.payload = p_payload and x.status in ('aguardando_colega', 'pendente')) then
    raise exception 'Você já fez esse pedido e ele ainda está em aberto.';
  end if;
  insert into solicitacao (organizacao_id, empresa_id, solicitante_id, destinatario_id, solicitante_nome, destinatario_nome, tipo, payload, motivo, status)
  values (c.organizacao_id, c.empresa_id, c.id, case when p_tipo = 'troca_turno' then d.id end, c.nome, case when p_tipo = 'troca_turno' then d.nome end,
          p_tipo, p_payload, nullif(btrim(coalesce(p_motivo, '')), ''), v_status)
  returning id into v_id;
  perform auditoria_evento(c.organizacao_id, 'solicitacao', v_id::text, 'criar');
  return v_id;
end $$;

-- O colega aceita ou recusa a troca de turno.
create function responder_solicitacao(p_id uuid, p_aceita boolean) returns void
language plpgsql security definer set search_path = public, auth as $$
declare s solicitacao%rowtype;
begin
  select * into s from solicitacao where id = p_id;
  if s.id is null or s.destinatario_id is null or not exists (select 1 from colaborador c where c.id = s.destinatario_id and c.usuario_id = auth.uid()) then raise exception 'sem permissão'; end if;
  if s.status <> 'aguardando_colega' then raise exception 'Este pedido não está mais aguardando a sua resposta.'; end if;
  update solicitacao set status = case when p_aceita then 'pendente' else 'recusada' end, colega_respondeu_em = now(),
         decisao_motivo = case when p_aceita then null else 'Recusada pelo colega.' end where id = p_id;
  perform auditoria_evento(s.organizacao_id, 'solicitacao', p_id::text, case when p_aceita then 'colega_aceitou' else 'colega_recusou' end);
end $$;

create function cancelar_solicitacao(p_id uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare s solicitacao%rowtype;
begin
  select * into s from solicitacao where id = p_id;
  if s.id is null or not exists (select 1 from colaborador c where c.id = s.solicitante_id and c.usuario_id = auth.uid()) then raise exception 'sem permissão'; end if;
  if s.status not in ('aguardando_colega', 'pendente') then raise exception 'Este pedido já foi encerrado.'; end if;
  update solicitacao set status = 'cancelada' where id = p_id;
  perform auditoria_evento(s.organizacao_id, 'solicitacao', p_id::text, 'cancelar');
end $$;

-- Decisão do RH. O servidor valida e aplica o efeito ANTES de chamar; aqui fica o registro e a trava do estado.
create function decidir_solicitacao(p_id uuid, p_aprovar boolean, p_motivo text default null, p_validacao jsonb default null) returns void
language plpgsql security definer set search_path = public, auth as $$
declare s solicitacao%rowtype;
begin
  select * into s from solicitacao where id = p_id for update;
  if s.id is null or not pode_gerir_empresa(s.empresa_id) then raise exception 'sem permissão'; end if;
  if s.status <> 'pendente' then raise exception 'Este pedido não está pendente de decisão.'; end if;
  if not p_aprovar and length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo da recusa.'; end if;
  if p_aprovar and s.tipo in ('ferias', 'afastamento') then
    -- o lançamento da ausência e a decisão acontecem juntos: se houver sobreposição, nada é gravado
    insert into ausencia (empresa_id, colaborador_id, periodo, tipo, observacao)
    values (s.empresa_id, s.solicitante_id, daterange((s.payload ->> 'inicio')::date, (s.payload ->> 'fim')::date + 1), s.tipo, 'Pedido aprovado');
  end if;
  update solicitacao set status = case when p_aprovar then 'aprovada' else 'recusada' end, decisao_motivo = nullif(btrim(coalesce(p_motivo, '')), ''),
         validacao = p_validacao, decidido_por = auth.uid(), decidido_em = now() where id = p_id;
  perform auditoria_evento(s.organizacao_id, 'solicitacao', p_id::text, case when p_aprovar then 'aprovar' else 'recusar' end);
end $$;

-- Versão vigente (publicada) da mesma escala: depois de uma troca aprovada a escala ganha uma nova versão, e pedidos
-- antigos continuam apontando para a versão em que foram feitos.
create function escala_vigente(p_escala uuid) returns uuid
language sql stable security definer set search_path = public, auth as $$
  select v.id from escala e join escala v on v.empresa_id = e.empresa_id and v.periodo = e.periodo and v.setor_id is not distinct from e.setor_id and v.status = 'publicada'
   where e.id = p_escala and pode_acessar_empresa(e.empresa_id) limit 1
$$;

-- Escalas publicadas que cobrem algum dia do período (para avisar o RH de turnos em conflito com férias/afastamento).
create function escalas_publicadas_no_periodo(p_empresa uuid, p_inicio date, p_fim date) returns uuid[]
language sql stable security definer set search_path = public, auth as $$
  select coalesce(array_agg(e.id order by e.id), '{}') from escala e
   where pode_acessar_empresa(p_empresa) and e.empresa_id = p_empresa and e.status = 'publicada' and e.periodo && daterange(p_inicio, p_fim + 1)
$$;

-- Nova versão em rascunho a partir de uma publicada (mesma lógica do botão "Criar nova versão", agora também para o servidor).
create function criar_versao_rascunho(p_escala uuid) returns uuid
language plpgsql security invoker set search_path = public, auth as $$
declare e escala%rowtype; v_id uuid;
begin
  select * into e from escala where id = p_escala;
  if e.id is null then raise exception 'Escala não encontrada ou sem permissão.'; end if;
  if e.status <> 'publicada' then raise exception 'Só uma escala publicada pode ganhar nova versão.'; end if;
  insert into escala (empresa_id, setor_id, nome, periodo, criado_por) values (e.empresa_id, e.setor_id, e.nome, e.periodo, auth.uid()) returning id into v_id;
  insert into alocacao (escala_id, colaborador_id, data, tipo, inicio_min, fim_min, intervalo_min, turno_modelo_id)
  select v_id, a.colaborador_id, a.data, a.tipo, a.inicio_min, a.fim_min, a.intervalo_min, a.turno_modelo_id from alocacao a where a.escala_id = p_escala;
  return v_id;
end $$;

create function descartar_versao_rascunho(p_escala uuid) returns void
language plpgsql security invoker set search_path = public, auth as $$
begin
  delete from escala where id = p_escala and status = 'rascunho';
end $$;

-- Colegas e turnos futuros da escala publicada em que EU trabalho (o RLS de alocacao só deixa ver os próprios turnos).
create function escala_colegas(p_escala uuid) returns table (colaborador_id uuid, nome text, data date, inicio_min int, fim_min int, intervalo_min int)
language sql stable security definer set search_path = public, auth as $$
  select c.id, c.nome, a.data, a.inicio_min, a.fim_min, a.intervalo_min
    from escala e
    join alocacao a on a.escala_id = e.id and a.tipo = 'trabalho' and a.data >= hoje_sp()
    join colaborador c on c.id = a.colaborador_id and c.usuario_id is not null
   where e.id = p_escala and e.status = 'publicada'
     and exists (select 1 from colaborador eu join alocacao ea on ea.colaborador_id = eu.id and ea.escala_id = e.id
                  where eu.usuario_id = auth.uid() and eu.empresa_id = e.empresa_id)
   order by a.data, c.nome
$$;

revoke all on function criar_solicitacao(uuid, text, jsonb, uuid, text), responder_solicitacao(uuid, boolean), cancelar_solicitacao(uuid),
  decidir_solicitacao(uuid, boolean, text, jsonb), escala_colegas(uuid), trabalha_na_escala(uuid, uuid, date), escala_vigente(uuid),
  escalas_publicadas_no_periodo(uuid, date, date), criar_versao_rascunho(uuid), descartar_versao_rascunho(uuid) from public, anon;
grant execute on function criar_solicitacao(uuid, text, jsonb, uuid, text), responder_solicitacao(uuid, boolean), cancelar_solicitacao(uuid),
  decidir_solicitacao(uuid, boolean, text, jsonb), escala_colegas(uuid), hoje_sp(), escala_vigente(uuid), escalas_publicadas_no_periodo(uuid, date, date), criar_versao_rascunho(uuid), descartar_versao_rascunho(uuid) to authenticated;
revoke execute on function trabalha_na_escala(uuid, uuid, date) from authenticated;

alter table solicitacao enable row level security;
create policy solicitacao_select on solicitacao for select to authenticated
  using (pode_acessar_empresa(empresa_id) or eh_proprio_colaborador(solicitante_id) or (destinatario_id is not null and eh_proprio_colaborador(destinatario_id)));
grant select on solicitacao to authenticated;
select auditar_tabela('solicitacao');

-- A entrada da escala passa a trazer o modelo de turno de cada alocação (uma nova versão preserva as cores/modelos).
-- Entrada completa da escala para o motor de validação (lida com o RLS/autorização do usuário).
create or replace function escala_entrada(p_escala uuid) returns jsonb
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
                   'inicioMin', a.inicio_min, 'fimMin', a.fim_min, 'intervaloMin', a.intervalo_min, 'turnoModeloId', a.turno_modelo_id) order by a.data, a.colaborador_id), '[]')
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

-- ===== 0014_banco_horas.up.sql =====
-- Banco de horas. Livro-razão imutável (só se acrescenta): crédito (+) e débito (−) em minutos. Crédito só existe com cláusula
-- de banco de horas em acordo vigente do colaborador (a lei exige acordo); a cláusula define o prazo de compensação
-- (vence_em) e os limites de saldo. Correção = estorno (novo lançamento), nunca edição.
--   parâmetros da cláusula `banco_horas`: prazo_meses (padrão 6), limite_saldo_min (teto do saldo positivo; ausente = sem teto),
--   limite_negativo_min (quanto o saldo pode ficar negativo; padrão 0).
create table banco_horas_lancamento (
  id bigserial primary key,
  organizacao_id uuid not null references organizacao(id),
  empresa_id uuid not null references empresa(id) on delete cascade,
  colaborador_id uuid not null references colaborador(id),
  data date not null,
  minutos int not null check (minutos <> 0 and abs(minutos) <= 1440),
  origem text not null check (origem in ('manual','compensacao','falta','ajuste','pagamento','estorno','ponto','escala')),
  descricao text check (descricao is null or length(descricao) <= 300),
  vence_em date,                                   -- só crédito
  acordo_id uuid references acordo_coletivo(id),
  estorna_id bigint references banco_horas_lancamento(id),
  criado_por uuid references usuario(id),
  criado_em timestamptz not null default now(),
  check ((minutos > 0) = (vence_em is not null) or origem = 'estorno')
);
create index banco_horas_colab_idx on banco_horas_lancamento (colaborador_id, data);
create index banco_horas_empresa_idx on banco_horas_lancamento (empresa_id);
create index banco_horas_org_idx on banco_horas_lancamento (organizacao_id);
create index banco_horas_acordo_idx on banco_horas_lancamento (acordo_id);
create index banco_horas_estorna_idx on banco_horas_lancamento (estorna_id);
create index banco_horas_criado_por_idx on banco_horas_lancamento (criado_por);
create unique index banco_horas_estorno_unico on banco_horas_lancamento (estorna_id) where estorna_id is not null;

create function banco_horas_imutavel() returns trigger language plpgsql as $$
begin raise exception 'O banco de horas é um livro-razão: corrija com um estorno, não editando.'; end $$;
create trigger imutavel before update or delete on banco_horas_lancamento for each row execute function banco_horas_imutavel();

-- Cláusula de banco de horas vigente do colaborador numa data (acordo vigente que o cobre).
create function banco_horas_clausula(p_colaborador uuid, p_data date) returns table (acordo_id uuid, parametros jsonb)
language sql stable security definer set search_path = public as $$
  select a.id, cl.parametros
    from colaborador_acordo ca
    join acordo_coletivo a on a.id = ca.acordo_id and a.status = 'vigente' and a.vigencia @> p_data
    join clausula_jornada cl on cl.acordo_id = a.id and cl.tipo = 'banco_horas'
   where ca.colaborador_id = p_colaborador
   order by lower(a.vigencia) desc limit 1
$$;

create function banco_horas_saldo(p_colaborador uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(minutos), 0)::int from banco_horas_lancamento where colaborador_id = p_colaborador
$$;

create function lancar_banco_horas(p_colaborador uuid, p_data date, p_minutos int, p_origem text, p_descricao text default null) returns bigint
language plpgsql security definer set search_path = public, auth as $$
declare c colaborador%rowtype; k record; v_hoje date := hoje_sp(); v_saldo int; v_prazo int; v_lim int; v_neg int; v_venc date; v_id bigint;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  select * into c from colaborador where id = p_colaborador;
  if c.id is null or not pode_gerir_empresa(c.empresa_id) then raise exception 'sem permissão'; end if;
  if p_origem not in ('manual','compensacao','falta','ajuste','pagamento') then raise exception 'origem inválida para lançamento manual'; end if;
  if p_minutos is null or p_minutos = 0 or abs(p_minutos) > 1440 then raise exception 'Informe de 1 minuto a 24 horas (positivo = crédito, negativo = débito).'; end if;
  if p_origem in ('manual') and p_minutos < 0 then raise exception 'Lançamento manual é crédito; use compensação, falta ou pagamento para débitos.'; end if;
  if p_origem in ('compensacao','falta','pagamento') and p_minutos > 0 then raise exception 'Esta origem é sempre débito (minutos negativos).'; end if;
  if p_minutos > 0 and p_data > v_hoje then raise exception 'Não dá para lançar crédito de data futura.'; end if;
  if p_data > v_hoje + 90 or p_data < v_hoje - 400 then raise exception 'Data fora do intervalo permitido.'; end if;
  if c.admissao > p_data then raise exception 'A data é anterior à admissão do colaborador.'; end if;

  select * into k from banco_horas_clausula(p_colaborador, case when p_minutos > 0 then p_data else least(p_data, v_hoje) end);
  v_saldo := banco_horas_saldo(p_colaborador);
  if p_minutos > 0 then
    if k.acordo_id is null then raise exception 'Este colaborador não tem acordo com banco de horas vigente. Cadastre o acordo e vincule-o antes de lançar crédito.'; end if;
    v_prazo := coalesce((k.parametros ->> 'prazo_meses')::int, 6);
    if v_prazo < 1 or v_prazo > 12 then raise exception 'A cláusula de banco de horas tem prazo inválido (1 a 12 meses).'; end if;
    v_lim := nullif(k.parametros ->> 'limite_saldo_min', '')::int;
    if v_lim is not null and v_saldo + p_minutos > v_lim then
      raise exception 'O saldo passaria do limite do acordo (% h). Saldo atual: % min.', round(v_lim / 60.0, 1), v_saldo;
    end if;
    v_venc := (p_data + make_interval(months => v_prazo))::date;
  else
    v_neg := coalesce((k.parametros ->> 'limite_negativo_min')::int, 0);
    if v_saldo + p_minutos < -v_neg then
      raise exception 'O saldo ficaria abaixo do permitido (saldo atual: % min; limite negativo: % min).', v_saldo, v_neg;
    end if;
  end if;
  insert into banco_horas_lancamento (organizacao_id, empresa_id, colaborador_id, data, minutos, origem, descricao, vence_em, acordo_id, criado_por)
  values (c.organizacao_id, c.empresa_id, c.id, p_data, p_minutos, p_origem, nullif(btrim(coalesce(p_descricao, '')), ''), v_venc, k.acordo_id, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Estorno: lançamento oposto, ligado ao original (um por lançamento), com motivo obrigatório.
create function estornar_banco_horas(p_id bigint, p_motivo text) returns bigint
language plpgsql security definer set search_path = public, auth as $$
declare l banco_horas_lancamento%rowtype; k record; v_venc date; v_id bigint;
begin
  select * into l from banco_horas_lancamento where id = p_id;
  if l.id is null or not pode_gerir_empresa(l.empresa_id) then raise exception 'sem permissão'; end if;
  if l.origem = 'estorno' then raise exception 'Um estorno não pode ser estornado; faça um novo lançamento.'; end if;
  if exists (select 1 from banco_horas_lancamento where estorna_id = p_id) then raise exception 'Este lançamento já foi estornado.'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo do estorno.'; end if;
  select * into k from banco_horas_clausula(l.colaborador_id, hoje_sp());
  if l.minutos > 0 and banco_horas_saldo(l.colaborador_id) - l.minutos < -coalesce((k.parametros ->> 'limite_negativo_min')::int, 0) then
    raise exception 'Estornar este crédito deixaria o saldo abaixo do permitido: parte dele já foi compensada.';
  end if;
  -- estorno de débito devolve crédito: o prazo de compensação recomeça pela cláusula vigente (padrão 6 meses)
  v_venc := case when l.minutos < 0 then (hoje_sp() + make_interval(months => coalesce((k.parametros ->> 'prazo_meses')::int, 6)))::date end;
  insert into banco_horas_lancamento (organizacao_id, empresa_id, colaborador_id, data, minutos, origem, descricao, vence_em, acordo_id, estorna_id, criado_por)
  values (l.organizacao_id, l.empresa_id, l.colaborador_id, hoje_sp(), -l.minutos, 'estorno', btrim(p_motivo), v_venc, l.acordo_id, l.id, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

revoke all on function lancar_banco_horas(uuid, date, int, text, text), estornar_banco_horas(bigint, text), banco_horas_clausula(uuid, date), banco_horas_saldo(uuid) from public, anon;
grant execute on function lancar_banco_horas(uuid, date, int, text, text), estornar_banco_horas(bigint, text) to authenticated;
revoke execute on function banco_horas_clausula(uuid, date), banco_horas_saldo(uuid) from authenticated;

alter table banco_horas_lancamento enable row level security;
create policy banco_horas_select on banco_horas_lancamento for select to authenticated
  using (pode_acessar_empresa(empresa_id) or eh_proprio_colaborador(colaborador_id));
grant select on banco_horas_lancamento to authenticated;
grant usage on sequence banco_horas_lancamento_id_seq to authenticated;
select auditar_tabela('banco_horas_lancamento');

-- ===== 0015_fechamento_folha.up.sql =====
-- Fechamento mensal de horas para a folha. O fechamento é um retrato IMUTÁVEL do mês (horas por colaborador, banco de horas,
-- ausências), com hash para provar que não mudou. Reabrir = nova versão com motivo; a anterior fica "substituída" e continua
-- guardada. Cada exportação (arquivo para a folha) é registrada na auditoria.
create table fechamento_folha (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id),
  empresa_id uuid not null references empresa(id) on delete cascade,
  competencia date not null check (competencia = date_trunc('month', competencia)::date),
  versao int not null check (versao >= 1),
  status text not null default 'fechado' check (status in ('fechado','substituido')),
  dados jsonb not null,
  dados_hash text not null,
  motivo text,                                    -- obrigatório a partir da 2ª versão (reabertura)
  criado_por uuid references usuario(id),
  criado_em timestamptz not null default now(),
  unique (empresa_id, competencia, versao)
);
create unique index fechamento_vigente_idx on fechamento_folha (empresa_id, competencia) where status = 'fechado';
create index fechamento_org_idx on fechamento_folha (organizacao_id);
create index fechamento_criado_por_idx on fechamento_folha (criado_por);

create function fechamento_proteger() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Fechamento não pode ser apagado; reabra com um novo fechamento.'; end if;
  if old.status = 'fechado' and new.status = 'substituido' and coalesce(current_setting('app.fechando', true), '') = '1'
     and new.dados = old.dados and new.dados_hash = old.dados_hash and new.versao = old.versao and new.competencia = old.competencia then
    return new;
  end if;
  raise exception 'Fechamento é imutável.';
end $$;
create trigger proteger before update or delete on fechamento_folha for each row execute function fechamento_proteger();

-- Tudo o que o cálculo precisa e as telas de escala não trazem: matrícula, cargo, setor, banco de horas e ausências do mês.
create function fechamento_entrada(p_empresa uuid, p_competencia date) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare v_ini date := date_trunc('month', p_competencia)::date; v_fim date := (date_trunc('month', p_competencia) + interval '1 month - 1 day')::date; v jsonb;
begin
  if not pode_acessar_empresa(p_empresa) then raise exception 'sem permissão'; end if;
  select jsonb_build_object(
    'inicio', v_ini, 'fim', v_fim,
    'colaboradores', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'matricula', c.matricula, 'cargo', c.cargo, 'setor', s.nome,
                        'admissao', c.admissao, 'desligamento', c.desligamento) order by c.nome), '[]')
                        from colaborador c left join setor s on s.id = c.setor_id
                       where c.empresa_id = p_empresa and c.admissao <= v_fim and (c.desligamento is null or c.desligamento >= v_ini)),
    'escalas', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'versao', e.versao, 'hash', e.hash_publicado,
                        'inicio', lower(e.periodo), 'fim', upper(e.periodo) - 1) order by lower(e.periodo), e.versao), '[]')
                 from escala e where e.empresa_id = p_empresa and e.status = 'publicada' and e.periodo && daterange(v_ini, v_fim + 1)),
    'ausencias', (select coalesce(jsonb_agg(jsonb_build_object('colaboradorId', a.colaborador_id, 'inicio', lower(a.periodo), 'fim', upper(a.periodo) - 1, 'tipo', a.tipo)), '[]')
                    from ausencia a where a.empresa_id = p_empresa and a.periodo && daterange(v_ini, v_fim + 1)),
    'banco', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'colaborador_id', l.colaborador_id, 'data', l.data, 'minutos', l.minutos, 'origem', l.origem,
                        'descricao', l.descricao, 'vence_em', l.vence_em, 'estorna_id', l.estorna_id, 'criado_em', l.criado_em) order by l.data, l.id), '[]')
                from banco_horas_lancamento l where l.empresa_id = p_empresa and l.data <= v_fim),
    'versao_vigente', (select max(f.versao) from fechamento_folha f where f.empresa_id = p_empresa and f.competencia = v_ini)
  ) into v;
  return v;
end $$;

create function fechar_folha(p_empresa uuid, p_competencia date, p_dados jsonb, p_motivo text default null) returns uuid
language plpgsql security definer set search_path = public, auth, extensions as $$
declare e empresa%rowtype; v_ini date := date_trunc('month', p_competencia)::date; v_ver int; v_id uuid;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  select * into e from empresa where id = p_empresa;
  if e.id is null or not pode_gerir_empresa(p_empresa) then raise exception 'sem permissão'; end if;
  if v_ini >= date_trunc('month', hoje_sp())::date then raise exception 'Só dá para fechar um mês já encerrado.'; end if;
  if coalesce(jsonb_typeof(p_dados), '') <> 'object' or coalesce(jsonb_typeof(p_dados -> 'linhas'), '') <> 'array' then
    raise exception 'O fechamento não tem nenhuma linha.';
  end if;
  if jsonb_array_length(p_dados -> 'linhas') = 0 then raise exception 'O fechamento não tem nenhuma linha.'; end if;
  select coalesce(max(versao), 0) + 1 into v_ver from fechamento_folha where empresa_id = p_empresa and competencia = v_ini;
  if v_ver > 1 and length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo da reabertura (mínimo 5 caracteres).'; end if;
  perform set_config('app.fechando', '1', true);
  update fechamento_folha set status = 'substituido' where empresa_id = p_empresa and competencia = v_ini and status = 'fechado';
  insert into fechamento_folha (organizacao_id, empresa_id, competencia, versao, dados, dados_hash, motivo, criado_por)
  values (e.organizacao_id, p_empresa, v_ini, v_ver, p_dados, encode(digest(p_dados::text, 'sha256'), 'hex'), nullif(btrim(coalesce(p_motivo, '')), ''), auth.uid())
  returning id into v_id;
  perform auditoria_evento(e.organizacao_id, 'fechamento_folha', v_id::text, 'fechar');
  return v_id;
end $$;

-- Confere se o conteúdo guardado ainda bate com o hash do fechamento.
create function fechamento_integro(p_id uuid) returns boolean
language sql stable security definer set search_path = public, auth, extensions as $$
  select encode(digest(f.dados::text, 'sha256'), 'hex') = f.dados_hash from fechamento_folha f where f.id = p_id and pode_acessar_empresa(f.empresa_id)
$$;

create function registrar_exportacao_folha(p_id uuid, p_formato text, p_layout text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare f fechamento_folha%rowtype;
begin
  select * into f from fechamento_folha where id = p_id;
  if f.id is null or not pode_gerir_empresa(f.empresa_id) then raise exception 'sem permissão'; end if;
  if p_formato not in ('csv','xlsx') or p_layout !~ '^[a-z0-9_]{1,40}$' then raise exception 'formato ou layout inválido'; end if;
  perform auditoria_evento(f.organizacao_id, 'fechamento_folha', p_id::text, 'exportar:' || p_layout || ':' || p_formato);
end $$;

revoke all on function fechamento_entrada(uuid, date), fechar_folha(uuid, date, jsonb, text), fechamento_integro(uuid), registrar_exportacao_folha(uuid, text, text) from public, anon;
grant execute on function fechamento_entrada(uuid, date), fechar_folha(uuid, date, jsonb, text), fechamento_integro(uuid), registrar_exportacao_folha(uuid, text, text) to authenticated;

alter table fechamento_folha enable row level security;
create policy fechamento_select on fechamento_folha for select to authenticated using (pode_acessar_empresa(empresa_id));
grant select on fechamento_folha to authenticated;
select auditar_tabela('fechamento_folha');

-- ===== 0016_ponto_afd.up.sql =====
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

-- ===== 0017_cadastro_colaborador.up.sql =====
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

-- ===== 0018_editar_desligar_colaborador.up.sql =====
-- Edição, mudança de contrato, desligamento e reativação de colaborador. Todas conferem a permissão e deixam rastro de auditoria.

-- Setor pela empresa e pelo nome (cria o setor, e a unidade "Matriz" se ainda não houver unidade).
create function setor_por_nome(p_empresa uuid, p_nome text) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare v_nome text := nullif(btrim(p_nome), ''); v_setor uuid; v_unidade uuid;
begin
  if not pode_gerir_empresa(p_empresa) then raise exception 'sem permissão'; end if;
  if v_nome is null then return null; end if;
  select s.id into v_setor from setor s join unidade u on u.id = s.unidade_id where u.empresa_id = p_empresa and lower(s.nome) = lower(v_nome) limit 1;
  if v_setor is null then
    select id into v_unidade from unidade where empresa_id = p_empresa order by nome limit 1;
    if v_unidade is null then
      insert into unidade (empresa_id, nome, municipio_ibge) select id, 'Matriz', municipio_ibge from empresa where id = p_empresa returning id into v_unidade;
    end if;
    insert into setor (unidade_id, nome) values (v_unidade, v_nome) returning id into v_setor;
  end if;
  return v_setor;
end $$;

-- Dados da pessoa (o CPF não muda: é a identidade). Telefone vazio apaga o telefone.
create function atualizar_colaborador(
  p_colaborador uuid, p_nome text, p_setor_nome text default null, p_matricula text default null, p_cargo text default null,
  p_cbo text default null, p_escolaridade text default null, p_telefone text default null)
returns void language plpgsql security definer set search_path = public, auth as $$
declare c colaborador%rowtype;
begin
  select * into c from colaborador where id = p_colaborador;
  if c.id is null or not pode_gerir_empresa(c.empresa_id) then raise exception 'sem permissão'; end if;
  if length(btrim(coalesce(p_nome, ''))) < 2 then raise exception 'Nome obrigatório'; end if;
  update colaborador set nome = btrim(p_nome), setor_id = setor_por_nome(c.empresa_id, p_setor_nome), matricula = nullif(btrim(p_matricula), ''),
         cargo = nullif(btrim(p_cargo), ''), cbo = nullif(btrim(p_cbo), ''), escolaridade = p_escolaridade, telefone_cifrado = cifrar_texto(nullif(btrim(p_telefone), ''))
   where id = p_colaborador;
end $$;

-- Nova versão do contrato a partir de uma data (salário, jornada, escala...). O histórico é preservado.
create function alterar_contrato(
  p_colaborador uuid, p_a_partir_de date, p_salario numeric, p_jornada_min int, p_divisor int, p_tipo_escala text,
  p_turno text default null, p_folgas smallint default null, p_horas_extras_min int default 0)
returns void language plpgsql security definer set search_path = public, auth as $$
declare c colaborador%rowtype; u contrato_versao%rowtype; v_fim date;
begin
  select * into c from colaborador where id = p_colaborador;
  if c.id is null or not pode_gerir_empresa(c.empresa_id) then raise exception 'sem permissão'; end if;
  if p_a_partir_de < c.admissao then raise exception 'A data é anterior à admissão'; end if;
  if c.desligamento is not null and p_a_partir_de > c.desligamento then raise exception 'Colaborador desligado: reative antes de alterar o contrato'; end if;
  select * into u from contrato_versao where colaborador_id = p_colaborador order by lower(vigencia) desc limit 1;
  if u.id is null then raise exception 'Colaborador sem contrato'; end if;
  if p_a_partir_de < lower(u.vigencia) then raise exception 'A data é anterior ao início do contrato atual (%)', lower(u.vigencia); end if;
  v_fim := upper(u.vigencia);                       -- null = em aberto
  if v_fim is not null and p_a_partir_de >= v_fim then raise exception 'Não há contrato vigente nessa data'; end if;
  if p_a_partir_de = lower(u.vigencia) then
    update contrato_versao set salario_base = p_salario, jornada_semanal_min = p_jornada_min, divisor = p_divisor, tipo_escala = p_tipo_escala,
           folgas_semana = p_folgas, turno = nullif(btrim(p_turno), ''), horas_extras_mensais_min = coalesce(p_horas_extras_min, 0) where id = u.id;
  else
    update contrato_versao set vigencia = daterange(lower(vigencia), p_a_partir_de, '[)') where id = u.id;
    insert into contrato_versao (colaborador_id, vigencia, salario_base, jornada_semanal_min, divisor, tipo_escala, folgas_semana, turno, horas_extras_mensais_min)
    values (p_colaborador, daterange(p_a_partir_de, v_fim, '[)'), p_salario, p_jornada_min, p_divisor, p_tipo_escala, p_folgas, nullif(btrim(p_turno), ''), coalesce(p_horas_extras_min, 0));
  end if;
end $$;

-- Desligamento: registra a data (último dia de trabalho), encerra o contrato e remove o acesso ao aplicativo.
-- Devolve quantos dias de trabalho ainda estão em escalas (rascunho ou publicadas) depois da data, para a gestão ajustar.
create function desligar_colaborador(p_colaborador uuid, p_data date) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare c colaborador%rowtype; u contrato_versao%rowtype; v_dias int;
begin
  select * into c from colaborador where id = p_colaborador;
  if c.id is null or not pode_gerir_empresa(c.empresa_id) then raise exception 'sem permissão'; end if;
  if c.desligamento is not null then raise exception 'Colaborador já desligado'; end if;
  if p_data < c.admissao then raise exception 'O desligamento não pode ser anterior à admissão'; end if;
  select * into u from contrato_versao where colaborador_id = p_colaborador order by lower(vigencia) desc limit 1;
  if u.id is not null then
    if lower(u.vigencia) > p_data then raise exception 'Há um contrato que começa depois dessa data (%)', lower(u.vigencia); end if;
    if upper_inf(u.vigencia) or upper(u.vigencia) > p_data + 1 then
      update contrato_versao set vigencia = daterange(lower(vigencia), p_data + 1, '[)') where id = u.id;
    end if;
  end if;
  update colaborador set desligamento = p_data where id = p_colaborador;
  if c.usuario_id is not null then perform revogar_acesso_colaborador(p_colaborador); end if;
  perform auditoria_evento(c.organizacao_id, 'colaborador', c.id::text, 'desligamento');
  select count(*) into v_dias from alocacao a join escala e on e.id = a.escala_id
   where a.colaborador_id = p_colaborador and a.tipo = 'trabalho' and a.data > p_data and e.status in ('rascunho', 'publicada');
  return jsonb_build_object('dias_em_escala', v_dias);
end $$;

-- Reativação (desligamento lançado por engano ou recontratação): reabre o último contrato.
create function reativar_colaborador(p_colaborador uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare c colaborador%rowtype; u contrato_versao%rowtype;
begin
  select * into c from colaborador where id = p_colaborador;
  if c.id is null or not pode_gerir_empresa(c.empresa_id) then raise exception 'sem permissão'; end if;
  if c.desligamento is null then raise exception 'Colaborador não está desligado'; end if;
  select * into u from contrato_versao where colaborador_id = p_colaborador order by lower(vigencia) desc limit 1;
  if u.id is not null and not upper_inf(u.vigencia) then
    update contrato_versao set vigencia = daterange(lower(vigencia), null, '[)') where id = u.id;
  end if;
  update colaborador set desligamento = null where id = p_colaborador;
  perform auditoria_evento(c.organizacao_id, 'colaborador', c.id::text, 'reativacao');
end $$;

revoke all on function setor_por_nome(uuid, text), atualizar_colaborador(uuid, text, text, text, text, text, text, text),
  alterar_contrato(uuid, date, numeric, int, int, text, text, smallint, int), desligar_colaborador(uuid, date), reativar_colaborador(uuid) from public, anon;
grant execute on function atualizar_colaborador(uuid, text, text, text, text, text, text, text),
  alterar_contrato(uuid, date, numeric, int, int, text, text, smallint, int), desligar_colaborador(uuid, date), reativar_colaborador(uuid) to authenticated;

-- ===== 0019_banco_horas_ponto.up.sql =====
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

-- ===== 0020_notificacoes.up.sql =====
-- Notificações dentro do sistema. Quem recebe: o usuário (login). Geradas por gatilhos nas tabelas de origem (pedidos e escalas),
-- então nenhum caminho de código esquece de avisar. A pessoa só enxerga as próprias e só pode marcar como lida.
create table notificacao (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id) on delete cascade,
  usuario_id uuid not null references usuario(id) on delete cascade,
  empresa_id uuid references empresa(id) on delete cascade,
  tipo text not null check (tipo ~ '^[a-z_]{3,40}$'),
  titulo text not null check (length(titulo) between 1 and 200),
  texto text check (texto is null or length(texto) <= 500),
  href text check (href is null or href ~ '^/[A-Za-z0-9/_?=&.-]*$'),
  criado_em timestamptz not null default now(),
  lida_em timestamptz
);
create index notificacao_usuario_idx on notificacao (usuario_id, criado_em desc);
create index notificacao_nao_lida_idx on notificacao (usuario_id) where lida_em is null;
create index notificacao_org_idx on notificacao (organizacao_id);
create index notificacao_empresa_idx on notificacao (empresa_id) where empresa_id is not null;

-- Só a marcação de leitura pode mudar (e só de "não lida" para "lida").
create function notificacao_proteger() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Notificação não pode ser apagada.'; end if;
  if old.lida_em is null and new.lida_em is not null
     and (new.id, new.organizacao_id, new.usuario_id, new.empresa_id, new.tipo, new.titulo, new.texto, new.href, new.criado_em)
         is not distinct from (old.id, old.organizacao_id, old.usuario_id, old.empresa_id, old.tipo, old.titulo, old.texto, old.href, old.criado_em) then
    return new;
  end if;
  raise exception 'A notificação só pode ser marcada como lida.';
end $$;
create trigger proteger before update or delete on notificacao for each row execute function notificacao_proteger();

alter table notificacao enable row level security;
create policy notificacao_select on notificacao for select to authenticated using (usuario_id = auth.uid());
create policy notificacao_update on notificacao for update to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select on notificacao to authenticated;
grant update (lida_em) on notificacao to authenticated;

-- Quem gere a empresa (mesma regra de pode_gerir_empresa, mas devolvendo as pessoas).
create function usuarios_gestores_empresa(p_empresa uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.usuario_id from empresa e join membro m on m.organizacao_id = e.organizacao_id and m.papel in ('admin','rh') where e.id = p_empresa
  union
  select m.usuario_id from vinculo_empresa v join membro m on m.organizacao_id = v.organizacao_id and m.papel in ('admin','contador') where v.empresa_id = p_empresa and v.nivel = 'gestao'
$$;

create function notificar(p_usuario uuid, p_empresa uuid, p_tipo text, p_titulo text, p_texto text default null, p_href text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if p_usuario is null then return; end if;
  select organizacao_id into v_org from empresa where id = p_empresa;
  if v_org is null then return; end if;
  insert into notificacao (organizacao_id, usuario_id, empresa_id, tipo, titulo, texto, href) values (v_org, p_usuario, p_empresa, p_tipo, left(p_titulo, 200), left(p_texto, 500), p_href);
end $$;

revoke all on function usuarios_gestores_empresa(uuid), notificar(uuid, uuid, text, text, text, text) from public, anon, authenticated;

-- ===== Pedidos (solicitações) =====
create function solicitacao_notificar() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tipo text := case new.tipo when 'troca_turno' then 'troca de turno' when 'troca_folga' then 'troca de folga' when 'ferias' then 'férias' else 'afastamento' end;
  v_solic uuid := (select usuario_id from colaborador where id = new.solicitante_id);
  v_dest uuid := (select usuario_id from colaborador where id = new.destinatario_id);
  g uuid; v_rh text := '/empresas/' || new.empresa_id || '/solicitacoes';
begin
  if tg_op = 'INSERT' then
    if new.status = 'aguardando_colega' then
      perform notificar(v_dest, new.empresa_id, 'pedido_para_voce', new.solicitante_nome || ' pediu uma ' || v_tipo || ' com você', 'Responda ao pedido: se você aceitar, ele segue para o RH decidir.', '/minha-escala/pedidos');
    elsif new.status = 'pendente' then
      for g in select * from usuarios_gestores_empresa(new.empresa_id) loop
        perform notificar(g, new.empresa_id, 'pedido_novo', 'Novo pedido de ' || v_tipo || ': ' || new.solicitante_nome, 'Aguarda a sua decisão.', v_rh);
      end loop;
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status then return new; end if;
  if old.status = 'aguardando_colega' and new.status = 'pendente' then
    perform notificar(v_solic, new.empresa_id, 'pedido_colega_aceitou', coalesce(new.destinatario_nome, 'O colega') || ' aceitou a sua ' || v_tipo, 'O pedido agora aguarda a decisão do RH.', '/minha-escala/pedidos');
    for g in select * from usuarios_gestores_empresa(new.empresa_id) loop
      perform notificar(g, new.empresa_id, 'pedido_novo', 'Novo pedido de ' || v_tipo || ': ' || new.solicitante_nome, 'O colega aceitou; aguarda a sua decisão.', v_rh);
    end loop;
  elsif new.status in ('aprovada', 'recusada') then
    perform notificar(v_solic, new.empresa_id, 'pedido_decidido',
      case when new.status = 'aprovada' then 'Seu pedido de ' || v_tipo || ' foi aprovado' when old.status = 'aguardando_colega' then 'O colega recusou a sua ' || v_tipo else 'Seu pedido de ' || v_tipo || ' foi recusado' end,
      nullif(btrim(coalesce(new.decisao_motivo, '')), ''), '/minha-escala/pedidos');
    if new.status = 'aprovada' and new.tipo = 'troca_turno' then
      perform notificar(v_dest, new.empresa_id, 'pedido_decidido', 'A troca de turno com ' || new.solicitante_nome || ' foi aprovada', 'Confira a sua escala.', '/minha-escala');
    end if;
  elsif new.status = 'cancelada' and old.status = 'aguardando_colega' then
    perform notificar(v_dest, new.empresa_id, 'pedido_cancelado', new.solicitante_nome || ' cancelou o pedido de ' || v_tipo || ' com você', null, '/minha-escala/pedidos');
  end if;
  return new;
end $$;
create trigger notificar after insert or update of status on solicitacao for each row execute function solicitacao_notificar();

-- ===== Escala publicada (inclui a nova versão criada por uma troca aprovada) =====
create function escala_notificar() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; v_ini date := lower(new.periodo); v_nome text;
begin
  if new.status <> 'publicada' or old.status = 'publicada' then return new; end if;
  v_nome := to_char(v_ini, 'MM/YYYY');
  for u in select distinct c.usuario_id from alocacao a join colaborador c on c.id = a.colaborador_id where a.escala_id = new.id and c.usuario_id is not null and (c.desligamento is null or c.desligamento >= v_ini) loop
    perform notificar(u, new.empresa_id, 'escala_publicada', 'Escala de ' || v_nome || ' publicada' || case when new.versao > 1 then ' (nova versão)' else '' end, 'Confira os seus horários e confirme a ciência.', '/minha-escala');
  end loop;
  return new;
end $$;
create trigger notificar after update of status on escala for each row execute function escala_notificar();

-- ===== 0021_aviso_vencimento_banco.up.sql =====
-- Aviso de vencimento do banco de horas. Um job diário (worker) calcula o saldo por colaborador e chama `avisar_vencimento_banco`.
-- Para não repetir aviso a cada execução, a notificação ganha uma `chave` (única por pessoa): o mesmo aviso na mesma semana/mês não duplica.
alter table notificacao add column chave text check (chave is null or length(chave) <= 120);
create unique index notificacao_chave_idx on notificacao (usuario_id, chave) where chave is not null;

-- A proteção da notificação passa a cobrir também a chave.
create or replace function notificacao_proteger() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Notificação não pode ser apagada.'; end if;
  if old.lida_em is null and new.lida_em is not null
     and (new.id, new.organizacao_id, new.usuario_id, new.empresa_id, new.tipo, new.titulo, new.texto, new.href, new.criado_em, new.chave)
         is not distinct from (old.id, old.organizacao_id, old.usuario_id, old.empresa_id, old.tipo, old.titulo, old.texto, old.href, old.criado_em, old.chave) then
    return new;
  end if;
  raise exception 'A notificação só pode ser marcada como lida.';
end $$;

-- `notificar` passa a aceitar a chave (quem chama com 6 argumentos continua funcionando).
drop function notificar(uuid, uuid, text, text, text, text);
create function notificar(p_usuario uuid, p_empresa uuid, p_tipo text, p_titulo text, p_texto text default null, p_href text default null, p_chave text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if p_usuario is null then return; end if;
  select organizacao_id into v_org from empresa where id = p_empresa;
  if v_org is null then return; end if;
  insert into notificacao (organizacao_id, usuario_id, empresa_id, tipo, titulo, texto, href, chave)
  values (v_org, p_usuario, p_empresa, p_tipo, left(p_titulo, 200), left(p_texto, 500), p_href, p_chave)
  on conflict (usuario_id, chave) where chave is not null do nothing;
end $$;
revoke all on function notificar(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;

create function horas_texto(p_min int) returns text language sql immutable as $$
  select case when p_min % 60 = 0 then (p_min / 60)::text || 'h' when p_min < 60 then p_min::text || 'min' else (p_min / 60)::text || 'h' || lpad((p_min % 60)::text, 2, '0') end
$$;

-- Chamada só pelo worker (papel privilegiado). Itens: [{colaboradorId, aVencerMin, venceEm, vencidoMin}] da empresa.
--  · cada colaborador com acesso: um aviso por semana enquanto houver crédito vencendo em 30 dias e um por mês enquanto houver vencido;
--  · a gestão: um resumo por semana.
create function avisar_vencimento_banco(p_empresa uuid, p_hoje date, p_itens jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  it jsonb; c colaborador%rowtype; g uuid; v_sem text := to_char(p_hoje, 'IYYY-"W"IW'); v_mes text := to_char(p_hoje, 'YYYY-MM');
  v_vencer int; v_vencido int; v_data date; v_n int := 0; v_tot_vencer int := 0; v_tot_vencido int := 0; v_pessoas int := 0; v_href text := '/empresas/' || p_empresa || '/banco-horas';
begin
  if coalesce(jsonb_typeof(p_itens), '') <> 'array' then raise exception 'itens inválidos'; end if;
  for it in select * from jsonb_array_elements(p_itens) loop
    select * into c from colaborador where id = (it ->> 'colaboradorId')::uuid and empresa_id = p_empresa;
    if c.id is null then continue; end if;
    v_vencer := coalesce((it ->> 'aVencerMin')::int, 0); v_vencido := coalesce((it ->> 'vencidoMin')::int, 0); v_data := nullif(it ->> 'venceEm', '')::date;
    if v_vencer <= 0 and v_vencido <= 0 then continue; end if;
    v_pessoas := v_pessoas + 1; v_tot_vencer := v_tot_vencer + greatest(v_vencer, 0); v_tot_vencido := v_tot_vencido + greatest(v_vencido, 0);
    if c.usuario_id is null then continue; end if;
    if v_vencer > 0 then
      perform notificar(c.usuario_id, p_empresa, 'banco_vencendo', 'Banco de horas: ' || horas_texto(v_vencer) || ' vencem em breve',
        'O crédito mais próximo vence em ' || to_char(v_data, 'DD/MM/YYYY') || '. Combine a compensação com o RH para não perder as horas.', '/minha-escala/banco-horas', 'banco_vencendo:' || c.id || ':' || v_sem);
      v_n := v_n + 1;
    end if;
    if v_vencido > 0 then
      perform notificar(c.usuario_id, p_empresa, 'banco_vencido', 'Banco de horas: ' || horas_texto(v_vencido) || ' vencidas',
        'Horas vencidas e não compensadas são pagas como hora extra. Fale com o RH.', '/minha-escala/banco-horas', 'banco_vencido:' || c.id || ':' || v_mes);
      v_n := v_n + 1;
    end if;
  end loop;
  if v_pessoas > 0 then
    for g in select * from usuarios_gestores_empresa(p_empresa) loop
      perform notificar(g, p_empresa, 'banco_gestao',
        'Banco de horas: ' || v_pessoas || case when v_pessoas = 1 then ' colaborador com horas vencendo ou vencidas' else ' colaboradores com horas vencendo ou vencidas' end,
        case when v_tot_vencer > 0 then horas_texto(v_tot_vencer) || ' vencem em até 30 dias' else '' end
          || case when v_tot_vencer > 0 and v_tot_vencido > 0 then '; ' else '' end
          || case when v_tot_vencido > 0 then horas_texto(v_tot_vencido) || ' já vencidas (a pagar como hora extra)' else '' end || '.',
        v_href, 'banco_gestao:' || p_empresa || ':' || v_sem);
    end loop;
  end if;
  return jsonb_build_object('colaboradores', v_pessoas, 'avisosColaborador', v_n);
end $$;
revoke all on function horas_texto(int), avisar_vencimento_banco(uuid, date, jsonb) from public, anon, authenticated;

-- ===== 0022_cobranca.up.sql =====
-- Cobrança da plataforma: planos, assinatura de cada organização (com teste grátis), faturas e o registro dos eventos do provedor
-- de pagamento (webhook). O provedor (Asaas) é plugável: aqui ficam só dados normalizados. Quem escreve é o servidor (papel de serviço);
-- o usuário só lê.
create table plano (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[a-z0-9_-]{2,30}$'),
  nome text not null,
  descricao text,
  preco_centavos int not null check (preco_centavos >= 0),
  limite_colaboradores int check (limite_colaboradores is null or limite_colaboradores > 0),   -- null = sem limite
  ativo boolean not null default true,
  ordem int not null default 0
);

create table assinatura (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null unique references organizacao(id) on delete cascade,
  plano_id uuid references plano(id),
  status text not null check (status in ('teste','aguardando_pagamento','ativa','inadimplente','cancelada')),
  teste_ate date,
  provedor text check (provedor is null or provedor ~ '^[a-z]{3,20}$'),
  cliente_externo text,
  assinatura_externa text,
  forma text check (forma is null or forma in ('pix','boleto','cartao','indefinida')),
  proximo_vencimento date,
  cancelada_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index assinatura_externa_idx on assinatura (provedor, assinatura_externa) where assinatura_externa is not null;
create index assinatura_plano_idx on assinatura (plano_id);

create table fatura (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id) on delete cascade,
  assinatura_id uuid not null references assinatura(id) on delete cascade,
  provedor text not null,
  fatura_externa text not null,
  valor_centavos int not null check (valor_centavos >= 0),
  vencimento date not null,
  status text not null check (status in ('pendente','paga','vencida','estornada','cancelada')),
  pago_em timestamptz,
  forma text check (forma is null or forma in ('pix','boleto','cartao','indefinida')),
  url text check (url is null or url ~ '^https://'),
  criado_em timestamptz not null default now(),
  unique (provedor, fatura_externa)
);
create index fatura_org_idx on fatura (organizacao_id, vencimento desc);
create index fatura_assinatura_idx on fatura (assinatura_id);

create table evento_cobranca (
  id bigserial primary key,
  provedor text not null,
  evento_id text not null,
  tipo text not null,
  dados jsonb not null,
  recebido_em timestamptz not null default now(),
  unique (provedor, evento_id)
);

-- Planos de EXEMPLO: ajuste preços e limites antes de cobrar (update plano set preco_centavos = ... where codigo = ...).
insert into plano (codigo, nome, descricao, preco_centavos, limite_colaboradores, ordem) values
  ('inicial', 'Inicial', 'Até 25 colaboradores. Valor de exemplo: ajuste antes de cobrar.', 14900, 25, 1),
  ('profissional', 'Profissional', 'Até 100 colaboradores. Valor de exemplo: ajuste antes de cobrar.', 39900, 100, 2),
  ('empresarial', 'Empresarial', 'Até 500 colaboradores. Valor de exemplo: ajuste antes de cobrar.', 99900, 500, 3);

-- Toda organização nova (e as que já existem) começa com 14 dias de teste no plano inicial.
create function assinatura_inicial() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tipo <> 'plataforma' then
    insert into assinatura (organizacao_id, plano_id, status, teste_ate)
    values (new.id, (select id from plano where codigo = 'inicial'), 'teste', hoje_sp() + 14) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger assinatura_inicial after insert on organizacao for each row execute function assinatura_inicial();
insert into assinatura (organizacao_id, plano_id, status, teste_ate)
  select o.id, (select id from plano where codigo = 'inicial'), 'teste', hoje_sp() + 14 from organizacao o where o.tipo <> 'plataforma' on conflict do nothing;

create function assinatura_tocar() returns trigger language plpgsql as $$ begin new.atualizado_em := now(); return new; end $$;
create trigger tocar before update on assinatura for each row execute function assinatura_tocar();

-- Leitura: qualquer membro vê o estado da assinatura da sua organização (para o aviso de teste/bloqueio); faturas, só o admin.
alter table plano enable row level security;
alter table assinatura enable row level security;
alter table fatura enable row level security;
alter table evento_cobranca enable row level security;
create policy plano_select on plano for select to authenticated using (ativo);
create policy assinatura_select on assinatura for select to authenticated using (organizacao_id in (select minhas_organizacoes()));
create policy fatura_select on fatura for select to authenticated using (tenho_papel(organizacao_id, array['admin']::papel[]));
grant select on plano, assinatura to authenticated;
grant select on fatura to authenticated;
select auditar_tabela('assinatura');

-- Escritas (só o servidor, com a chave de serviço) ----------------------------------------------------------------------------
-- O admin escolheu o plano e o provedor criou a assinatura: guarda os identificadores e passa a aguardar o primeiro pagamento.
create function definir_assinatura(p_org uuid, p_plano uuid, p_provedor text, p_cliente text, p_assinatura text, p_forma text, p_vencimento date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from plano where id = p_plano and ativo) then raise exception 'plano inválido'; end if;
  update assinatura set plano_id = p_plano, provedor = p_provedor, cliente_externo = p_cliente, assinatura_externa = p_assinatura, forma = p_forma,
         proximo_vencimento = p_vencimento, status = case when status = 'ativa' then 'ativa' else 'aguardando_pagamento' end, cancelada_em = null
   where organizacao_id = p_org;
  if not found then raise exception 'organização sem assinatura'; end if;
end $$;

create function trocar_plano_assinatura(p_org uuid, p_plano uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from plano where id = p_plano and ativo) then raise exception 'plano inválido'; end if;
  update assinatura set plano_id = p_plano where organizacao_id = p_org;
end $$;

create function cancelar_assinatura_cobranca(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update assinatura set status = 'cancelada', cancelada_em = now() where organizacao_id = p_org and status <> 'cancelada';
end $$;

-- Evento já normalizado vindo do provedor. Idempotente (o mesmo evento_id nunca é aplicado duas vezes) e tolerante a ordem
-- (um aviso atrasado de "pendente" não desfaz um "pago"). tipo: fatura_criada | fatura_paga | fatura_vencida | fatura_estornada |
-- fatura_cancelada | assinatura_cancelada.  dados: assinaturaExterna, referencia (id da assinatura), faturaExterna, valorCentavos,
-- vencimento, pagoEm, forma, url.
create function aplicar_evento_cobranca(p_provedor text, p_evento_id text, p_tipo text, p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a assinatura%rowtype; f fatura%rowtype; v_novo text; v_forma text; g uuid; v_titulo text; v_texto text; v_ref uuid;
begin
  insert into evento_cobranca (provedor, evento_id, tipo, dados) values (p_provedor, p_evento_id, p_tipo, p_dados) on conflict do nothing;
  if not found then return jsonb_build_object('duplicado', true); end if;
  if p_tipo not in ('fatura_criada','fatura_paga','fatura_vencida','fatura_estornada','fatura_cancelada','assinatura_cancelada') then
    return jsonb_build_object('ignorado', 'tipo desconhecido');
  end if;

  select * into a from assinatura where provedor = p_provedor and assinatura_externa = p_dados ->> 'assinaturaExterna';
  if a.id is null then
    begin v_ref := nullif(p_dados ->> 'referencia', '')::uuid; exception when others then v_ref := null; end;
    if v_ref is not null then select * into a from assinatura where id = v_ref and provedor = p_provedor; end if;
  end if;
  if a.id is null then return jsonb_build_object('ignorado', 'assinatura desconhecida'); end if;

  if p_tipo = 'assinatura_cancelada' then
    update assinatura set status = 'cancelada', cancelada_em = coalesce(cancelada_em, now()) where id = a.id;
    return jsonb_build_object('assinatura', a.id, 'status', 'cancelada');
  end if;

  v_novo := case p_tipo when 'fatura_criada' then 'pendente' when 'fatura_paga' then 'paga' when 'fatura_vencida' then 'vencida' when 'fatura_estornada' then 'estornada' else 'cancelada' end;
  v_forma := case when p_dados ->> 'forma' in ('pix','boleto','cartao') then p_dados ->> 'forma' else 'indefinida' end;
  select * into f from fatura where provedor = p_provedor and fatura_externa = p_dados ->> 'faturaExterna';
  if f.id is null then
    insert into fatura (organizacao_id, assinatura_id, provedor, fatura_externa, valor_centavos, vencimento, status, pago_em, forma, url)
    values (a.organizacao_id, a.id, p_provedor, p_dados ->> 'faturaExterna', (p_dados ->> 'valorCentavos')::int, (p_dados ->> 'vencimento')::date, v_novo,
            nullif(p_dados ->> 'pagoEm', '')::timestamptz, v_forma, nullif(p_dados ->> 'url', ''))
    returning * into f;
  else
    -- situação final não volta atrás por aviso atrasado
    if f.status in ('paga','estornada','cancelada') and v_novo in ('pendente','vencida') then v_novo := f.status; end if;
    if f.status = 'paga' and v_novo = 'cancelada' then v_novo := 'paga'; end if;
    update fatura set status = v_novo, valor_centavos = coalesce((p_dados ->> 'valorCentavos')::int, valor_centavos), vencimento = coalesce((p_dados ->> 'vencimento')::date, vencimento),
           pago_em = coalesce(nullif(p_dados ->> 'pagoEm', '')::timestamptz, pago_em), forma = case when v_forma <> 'indefinida' then v_forma else forma end,
           url = coalesce(nullif(p_dados ->> 'url', ''), url)
     where id = f.id returning * into f;
  end if;

  if f.status = 'paga' and a.status <> 'cancelada' then
    update assinatura set status = 'ativa', proximo_vencimento = (f.vencimento + interval '1 month')::date where id = a.id;
    v_titulo := 'Pagamento confirmado'; v_texto := 'Recebemos o pagamento da fatura com vencimento em ' || to_char(f.vencimento, 'DD/MM/YYYY') || '. Obrigado!';
  elsif f.status = 'vencida' and a.status in ('ativa','aguardando_pagamento','inadimplente') then
    update assinatura set status = 'inadimplente' where id = a.id;
    v_titulo := 'Fatura vencida'; v_texto := 'A fatura com vencimento em ' || to_char(f.vencimento, 'DD/MM/YYYY') || ' não foi paga. Regularize para não perder o acesso.';
  elsif f.status = 'estornada' then
    v_titulo := 'Pagamento estornado'; v_texto := 'O pagamento da fatura de ' || to_char(f.vencimento, 'DD/MM/YYYY') || ' foi estornado.';
  end if;
  if v_titulo is not null then
    for g in select usuario_id from membro where organizacao_id = a.organizacao_id and papel = 'admin' loop
      insert into notificacao (organizacao_id, usuario_id, tipo, titulo, texto, href, chave)
      values (a.organizacao_id, g, 'cobranca_' || f.status, v_titulo, v_texto, '/cobranca', 'cobranca:' || p_evento_id) on conflict do nothing;
    end loop;
  end if;
  return jsonb_build_object('assinatura', a.id, 'fatura', f.id, 'status', f.status);
end $$;

revoke all on function definir_assinatura(uuid, uuid, text, text, text, text, date), trocar_plano_assinatura(uuid, uuid), cancelar_assinatura_cobranca(uuid),
  aplicar_evento_cobranca(text, text, text, jsonb), assinatura_inicial(), assinatura_tocar() from public, anon, authenticated;

-- ===== 0023_alertas_conformidade.up.sql =====
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

-- ===== seeds/regras.sql =====
-- Seed idempotente das regras da EC 141/2026. Tudo editável pelo superadmin (sem deploy).
-- Convenção de prioridade: 100 = regra geral; 200 = por escopo (porte, terceirizada); 300 = exceção individual
-- (alta renda, acordo). Na mescla, aplica-se em ordem crescente e a MAIOR prioridade vence.
insert into regra_jornada (codigo, descricao, vigencia, escopo, parametros, prioridade, fonte_url, ativa) values
('LEGADO_44H', '44h semanais, 8h diárias, 1 repouso semanal, divisor 220',
 '[1970-01-01,2026-12-15)', '{}',
 '{"max_semanal_min":2640,"max_diaria_min":480,"folgas_semana":1,"divisor":220,"interjornada_min":660,"max_he_dia_min":120,"he_percentual_min":50}',
 100, null, true),
('EC141_F1', 'Escala 5x2 obrigatória, máximo 42h semanais, divisor 210',
 '[2026-12-15,2027-12-15)', '{}',
 '{"max_semanal_min":2520,"max_diaria_min":480,"folgas_semana":2,"divisor":210,"interjornada_min":660,"max_he_dia_min":120,"he_percentual_min":50}',
 100, null, true),
('EC141_F2', 'Escala 5x2, máximo 40h semanais e 8h diárias, divisor 200 (data de início parametrizável; confirmar com advogado)',
 '[2027-12-15,)', '{}',
 '{"max_semanal_min":2400,"max_diaria_min":480,"folgas_semana":2,"divisor":200,"interjornada_min":660,"max_he_dia_min":120,"he_percentual_min":50}',
 100, null, true),
('EC141_TERC_PUBLICO', 'Terceirizadas da administração pública: 12 meses para eliminar a 6x1 (mantém regras do legado até o prazo)',
 '[2026-12-15,2027-10-16)', '{"terceirizada_publica":true}',
 '{"max_semanal_min":2640,"max_diaria_min":480,"folgas_semana":1,"divisor":220,"interjornada_min":660,"max_he_dia_min":120,"he_percentual_min":50,"prazo_eliminar_6x1":"2027-10-16"}',
 200, null, true),
('EC141_ALTA_RENDA', 'Jornada diferenciada permitida, mantida a 5x2: diploma superior e salário igual ou superior ao piso',
 '[2026-12-15,)', '{"alta_renda":true}',
 '{"salario_minimo":21188.87,"exige_superior":true,"jornada_diferenciada":true,"folgas_semana":2}',
 300, null, true),
('EC141_ACORDO_COMP', 'Regime compensatório com escala diferente da 5x2, enquanto o acordo ou convenção vigorar',
 '[1970-01-01,)', '{"acordo":"regime_compensatorio"}', '{}', 300, null, true),
('EC141_ACORDO_DIARIA', 'Jornada diária acima de 8h por acordo coletivo, respeitado o teto semanal da fase de transição',
 '[2026-12-15,2027-12-15)', '{"acordo":"jornada_diaria_estendida"}', '{}', 300, null, true),
('EC141_PEQUENA_EMPRESA', 'Placeholder inativo: transição de MEI, ME e EPP, aguardando lei complementar',
 '[2026-12-15,)', '{"porte":["mei","me","epp"]}', '{}', 200, null, false)
on conflict (codigo, vigencia) do update
  set descricao = excluded.descricao, escopo = excluded.escopo, parametros = excluded.parametros,
      prioridade = excluded.prioridade, ativa = excluded.ativa;

-- ===== seeds/feriados.sql =====
-- Feriados nacionais 2026–2028 (fixos + Sexta-feira Santa). Estaduais e municipais: cadastro manual.
insert into feriado (data, nome, abrangencia)
select make_date(a, m, d), nome, 'nacional'
  from generate_series(2026, 2028) a,
       (values (1,1,'Confraternização Universal'), (4,21,'Tiradentes'), (5,1,'Dia do Trabalho'),
               (9,7,'Independência do Brasil'), (10,12,'Nossa Senhora Aparecida'), (11,2,'Finados'),
               (11,15,'Proclamação da República'), (11,20,'Consciência Negra'), (12,25,'Natal')) f(m, d, nome)
on conflict do nothing;
insert into feriado (data, nome, abrangencia) values
  ('2026-04-03','Sexta-feira Santa','nacional'),
  ('2027-03-26','Sexta-feira Santa','nacional'),
  ('2028-04-14','Sexta-feira Santa','nacional')
on conflict do nothing;

-- ===== conferência =====
select 'regras legais' as item, count(*)::text as valor from public.regra_jornada
union all select 'feriados', count(*)::text from public.feriado
union all select 'tabelas com RLS ligado', count(*)::text from pg_tables where schemaname = 'public' and rowsecurity
union all select 'tabelas sem RLS (deve ser 0)', count(*)::text from pg_tables where schemaname = 'public' and not rowsecurity
union all select 'buckets de storage', coalesce((select count(*)::text from storage.buckets where id in ('importacoes', 'marca')), '0');
commit;
