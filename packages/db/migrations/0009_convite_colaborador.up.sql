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
