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

-- Colaborador e acordo vinculados precisam ser da mesma organização.
create function validar_colaborador_acordo() returns trigger language plpgsql as $$
begin
  if (select organizacao_id from acordo_coletivo where id = new.acordo_id) is distinct from new.organizacao_id then
    raise exception 'acordo de outra organização';
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

-- ===== Alta renda ("hipersuficiente") sem placeholder =====
-- Cruza escolaridade, salário vigente e o parâmetro da regra EC141_ALTA_RENDA mais recente.
create view vw_colaborador_vigente with (security_invoker = true) as
select c.id as colaborador_id, c.organizacao_id, c.empresa_id, c.setor_id, c.nome, c.escolaridade,
       cv.id as contrato_id, cv.salario_base, cv.jornada_semanal_min, cv.divisor, cv.tipo_escala,
       cv.folgas_semana, cv.turno,
       (c.escolaridade in ('superior','pos')
        and r.piso is not null and cv.salario_base >= r.piso) as hipersuficiente
  from colaborador c
  join contrato_versao cv on cv.colaborador_id = c.id and cv.vigencia @> current_date
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
create function pode_ver_acordo(p_acordo uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from acordo_coletivo a where a.id = p_acordo
    and (a.organizacao_id in (select minhas_organizacoes_gestao())
         or (a.empresa_id is not null and pode_acessar_empresa(a.empresa_id)))) $$;
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
         or (empresa_id is not null and pode_acessar_empresa(empresa_id)));
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
grant execute on function sou_superadmin(), minhas_organizacoes_gestao(), empresa_do_usuario(uuid), pode_ver_acordo(uuid),
  pode_gerir_acordo(uuid), eh_proprio_colaborador(uuid), empresa_do_colaborador(uuid) to authenticated;
