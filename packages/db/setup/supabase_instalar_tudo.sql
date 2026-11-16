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
