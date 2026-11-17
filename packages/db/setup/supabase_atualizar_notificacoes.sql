-- JornadaCerta: notificações dentro do sistema (migration 0020) em um banco que já tem as migrations 0001 a 0019.
-- Rode UMA vez. Transação única: se falhar, nada é aplicado.
begin;
-- Notificações dentro do sistema. Quem recebe: o usuário (login). Geradas por gatilhos nas tabelas de origem (pedidos e escalas),
-- então nenhum caminho de código esquece de avisar. A pessoa só enxerga as próprias e só pode marcar como lida.
create table notificacao (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacao(id) on delete cascade,
  usuario_id uuid not null references usuario(id) on delete cascade,
  empresa_id uuid references empresa(id) on delete cascade,
  tipo text not null check (tipo ~ '^[a-z_]{3,40}$'),
  titulo text not null check (length(titulo) between 1 and 200),
  texto text check (texto is null or length(texto) <= 500),
  href text check (href is null or href ~ '^/[A-Za-z0-9/_?=&.-]*$'),
  criado_em timestamptz not null default now(),
  lida_em timestamptz
);
create index notificacao_usuario_idx on notificacao (usuario_id, criado_em desc);
create index notificacao_nao_lida_idx on notificacao (usuario_id) where lida_em is null;
create index notificacao_org_idx on notificacao (organizacao_id);
create index notificacao_empresa_idx on notificacao (empresa_id) where empresa_id is not null;

-- Só a marcação de leitura pode mudar (e só de "não lida" para "lida").
create function notificacao_proteger() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Notificação não pode ser apagada.'; end if;
  if old.lida_em is null and new.lida_em is not null
     and (new.id, new.organizacao_id, new.usuario_id, new.empresa_id, new.tipo, new.titulo, new.texto, new.href, new.criado_em)
         is not distinct from (old.id, old.organizacao_id, old.usuario_id, old.empresa_id, old.tipo, old.titulo, old.texto, old.href, old.criado_em) then
    return new;
  end if;
  raise exception 'A notificação só pode ser marcada como lida.';
end $$;
create trigger proteger before update or delete on notificacao for each row execute function notificacao_proteger();

alter table notificacao enable row level security;
create policy notificacao_select on notificacao for select to authenticated using (usuario_id = auth.uid());
create policy notificacao_update on notificacao for update to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select on notificacao to authenticated;
grant update (lida_em) on notificacao to authenticated;

-- Quem gere a empresa (mesma regra de pode_gerir_empresa, mas devolvendo as pessoas).
create function usuarios_gestores_empresa(p_empresa uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.usuario_id from empresa e join membro m on m.organizacao_id = e.organizacao_id and m.papel in ('admin','rh') where e.id = p_empresa
  union
  select m.usuario_id from vinculo_empresa v join membro m on m.organizacao_id = v.organizacao_id and m.papel in ('admin','contador') where v.empresa_id = p_empresa and v.nivel = 'gestao'
$$;

create function notificar(p_usuario uuid, p_empresa uuid, p_tipo text, p_titulo text, p_texto text default null, p_href text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if p_usuario is null then return; end if;
  select organizacao_id into v_org from empresa where id = p_empresa;
  if v_org is null then return; end if;
  insert into notificacao (organizacao_id, usuario_id, empresa_id, tipo, titulo, texto, href) values (v_org, p_usuario, p_empresa, p_tipo, left(p_titulo, 200), left(p_texto, 500), p_href);
end $$;

revoke all on function usuarios_gestores_empresa(uuid), notificar(uuid, uuid, text, text, text, text) from public, anon, authenticated;

-- ===== Pedidos (solicitações) =====
create function solicitacao_notificar() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tipo text := case new.tipo when 'troca_turno' then 'troca de turno' when 'troca_folga' then 'troca de folga' when 'ferias' then 'férias' else 'afastamento' end;
  v_solic uuid := (select usuario_id from colaborador where id = new.solicitante_id);
  v_dest uuid := (select usuario_id from colaborador where id = new.destinatario_id);
  g uuid; v_rh text := '/empresas/' || new.empresa_id || '/solicitacoes';
begin
  if tg_op = 'INSERT' then
    if new.status = 'aguardando_colega' then
      perform notificar(v_dest, new.empresa_id, 'pedido_para_voce', new.solicitante_nome || ' pediu uma ' || v_tipo || ' com você', 'Responda ao pedido: se você aceitar, ele segue para o RH decidir.', '/minha-escala/pedidos');
    elsif new.status = 'pendente' then
      for g in select * from usuarios_gestores_empresa(new.empresa_id) loop
        perform notificar(g, new.empresa_id, 'pedido_novo', 'Novo pedido de ' || v_tipo || ': ' || new.solicitante_nome, 'Aguarda a sua decisão.', v_rh);
      end loop;
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status then return new; end if;
  if old.status = 'aguardando_colega' and new.status = 'pendente' then
    perform notificar(v_solic, new.empresa_id, 'pedido_colega_aceitou', coalesce(new.destinatario_nome, 'O colega') || ' aceitou a sua ' || v_tipo, 'O pedido agora aguarda a decisão do RH.', '/minha-escala/pedidos');
    for g in select * from usuarios_gestores_empresa(new.empresa_id) loop
      perform notificar(g, new.empresa_id, 'pedido_novo', 'Novo pedido de ' || v_tipo || ': ' || new.solicitante_nome, 'O colega aceitou; aguarda a sua decisão.', v_rh);
    end loop;
  elsif new.status in ('aprovada', 'recusada') then
    perform notificar(v_solic, new.empresa_id, 'pedido_decidido',
      case when new.status = 'aprovada' then 'Seu pedido de ' || v_tipo || ' foi aprovado' when old.status = 'aguardando_colega' then 'O colega recusou a sua ' || v_tipo else 'Seu pedido de ' || v_tipo || ' foi recusado' end,
      nullif(btrim(coalesce(new.decisao_motivo, '')), ''), '/minha-escala/pedidos');
    if new.status = 'aprovada' and new.tipo = 'troca_turno' then
      perform notificar(v_dest, new.empresa_id, 'pedido_decidido', 'A troca de turno com ' || new.solicitante_nome || ' foi aprovada', 'Confira a sua escala.', '/minha-escala');
    end if;
  elsif new.status = 'cancelada' and old.status = 'aguardando_colega' then
    perform notificar(v_dest, new.empresa_id, 'pedido_cancelado', new.solicitante_nome || ' cancelou o pedido de ' || v_tipo || ' com você', null, '/minha-escala/pedidos');
  end if;
  return new;
end $$;
create trigger notificar after insert or update of status on solicitacao for each row execute function solicitacao_notificar();

-- ===== Escala publicada (inclui a nova versão criada por uma troca aprovada) =====
create function escala_notificar() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; v_ini date := lower(new.periodo); v_nome text;
begin
  if new.status <> 'publicada' or old.status = 'publicada' then return new; end if;
  v_nome := to_char(v_ini, 'MM/YYYY');
  for u in select distinct c.usuario_id from alocacao a join colaborador c on c.id = a.colaborador_id where a.escala_id = new.id and c.usuario_id is not null and (c.desligamento is null or c.desligamento >= v_ini) loop
    perform notificar(u, new.empresa_id, 'escala_publicada', 'Escala de ' || v_nome || ' publicada' || case when new.versao > 1 then ' (nova versão)' else '' end, 'Confira os seus horários e confirme a ciência.', '/minha-escala');
  end loop;
  return new;
end $$;
create trigger notificar after update of status on escala for each row execute function escala_notificar();
commit;
