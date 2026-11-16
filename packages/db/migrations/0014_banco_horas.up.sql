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
