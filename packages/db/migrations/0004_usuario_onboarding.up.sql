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
