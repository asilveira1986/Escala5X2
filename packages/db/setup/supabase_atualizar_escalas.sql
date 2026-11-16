-- JornadaCerta: adiciona as tabelas de escalas (Fase 2) a um banco já instalado (migrations 0001 a 0005).
-- Rode UMA vez. Transação única: se falhar, nada é aplicado.
begin;
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

-- conferência: deve listar as 7 tabelas novas
select table_name from information_schema.tables
 where table_schema = 'public' and table_name in ('turno_modelo','demanda_cobertura','ausencia','escala','alocacao','violacao','ciencia')
 order by 1;
commit;
