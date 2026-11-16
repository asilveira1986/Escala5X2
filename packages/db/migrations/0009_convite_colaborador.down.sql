drop trigger if exists ao_confirmar_usuario on auth.users;
drop function if exists convidar_colaborador(uuid, text), revogar_acesso_colaborador(uuid), aceitar_convites_ao_confirmar(), aceitar_convites(uuid, text), vincular_colaborador_usuario(uuid, uuid);
drop table if exists convite_colaborador;
-- restaura o gatilho de 0004
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
  return new;
end $$;
