-- JornadaCerta: fechamento mensal para a folha (migration 0015) em um banco que já tem as migrations 0001 a 0014.
-- Rode UMA vez. Transação única: se falhar, nada é aplicado.
begin;
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
commit;
