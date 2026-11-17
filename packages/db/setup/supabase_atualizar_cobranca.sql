-- JornadaCerta: cobrança da plataforma (migration 0022) em um banco que já tem as migrations 0001 a 0021.
-- Rode UMA vez. Transação única: se falhar, nada é aplicado.
begin;
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
commit;
