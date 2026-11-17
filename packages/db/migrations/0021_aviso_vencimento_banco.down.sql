drop function if exists avisar_vencimento_banco(uuid, date, jsonb), horas_texto(int);
drop function if exists notificar(uuid, uuid, text, text, text, text, text);
create function notificar(p_usuario uuid, p_empresa uuid, p_tipo text, p_titulo text, p_texto text default null, p_href text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if p_usuario is null then return; end if;
  select organizacao_id into v_org from empresa where id = p_empresa;
  if v_org is null then return; end if;
  insert into notificacao (organizacao_id, usuario_id, empresa_id, tipo, titulo, texto, href) values (v_org, p_usuario, p_empresa, p_tipo, left(p_titulo, 200), left(p_texto, 500), p_href);
end $$;
revoke all on function notificar(uuid, uuid, text, text, text, text) from public, anon, authenticated;
drop index if exists notificacao_chave_idx;
alter table notificacao drop column if exists chave;
create or replace function notificacao_proteger() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Notificação não pode ser apagada.'; end if;
  if old.lida_em is null and new.lida_em is not null
     and (new.id, new.organizacao_id, new.usuario_id, new.empresa_id, new.tipo, new.titulo, new.texto, new.href, new.criado_em)
         is not distinct from (old.id, old.organizacao_id, old.usuario_id, old.empresa_id, old.tipo, old.titulo, old.texto, old.href, old.criado_em) then
    return new;
  end if;
  raise exception 'A notificação só pode ser marcada como lida.';
end $$;
