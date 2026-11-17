-- Aviso de vencimento do banco de horas. Um job diário (worker) calcula o saldo por colaborador e chama `avisar_vencimento_banco`.
-- Para não repetir aviso a cada execução, a notificação ganha uma `chave` (única por pessoa): o mesmo aviso na mesma semana/mês não duplica.
alter table notificacao add column chave text check (chave is null or length(chave) <= 120);
create unique index notificacao_chave_idx on notificacao (usuario_id, chave) where chave is not null;

-- A proteção da notificação passa a cobrir também a chave.
create or replace function notificacao_proteger() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Notificação não pode ser apagada.'; end if;
  if old.lida_em is null and new.lida_em is not null
     and (new.id, new.organizacao_id, new.usuario_id, new.empresa_id, new.tipo, new.titulo, new.texto, new.href, new.criado_em, new.chave)
         is not distinct from (old.id, old.organizacao_id, old.usuario_id, old.empresa_id, old.tipo, old.titulo, old.texto, old.href, old.criado_em, old.chave) then
    return new;
  end if;
  raise exception 'A notificação só pode ser marcada como lida.';
end $$;

-- `notificar` passa a aceitar a chave (quem chama com 6 argumentos continua funcionando).
drop function notificar(uuid, uuid, text, text, text, text);
create function notificar(p_usuario uuid, p_empresa uuid, p_tipo text, p_titulo text, p_texto text default null, p_href text default null, p_chave text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if p_usuario is null then return; end if;
  select organizacao_id into v_org from empresa where id = p_empresa;
  if v_org is null then return; end if;
  insert into notificacao (organizacao_id, usuario_id, empresa_id, tipo, titulo, texto, href, chave)
  values (v_org, p_usuario, p_empresa, p_tipo, left(p_titulo, 200), left(p_texto, 500), p_href, p_chave)
  on conflict (usuario_id, chave) where chave is not null do nothing;
end $$;
revoke all on function notificar(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;

create function horas_texto(p_min int) returns text language sql immutable as $$
  select case when p_min % 60 = 0 then (p_min / 60)::text || 'h' when p_min < 60 then p_min::text || 'min' else (p_min / 60)::text || 'h' || lpad((p_min % 60)::text, 2, '0') end
$$;

-- Chamada só pelo worker (papel privilegiado). Itens: [{colaboradorId, aVencerMin, venceEm, vencidoMin}] da empresa.
--  · cada colaborador com acesso: um aviso por semana enquanto houver crédito vencendo em 30 dias e um por mês enquanto houver vencido;
--  · a gestão: um resumo por semana.
create function avisar_vencimento_banco(p_empresa uuid, p_hoje date, p_itens jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  it jsonb; c colaborador%rowtype; g uuid; v_sem text := to_char(p_hoje, 'IYYY-"W"IW'); v_mes text := to_char(p_hoje, 'YYYY-MM');
  v_vencer int; v_vencido int; v_data date; v_n int := 0; v_tot_vencer int := 0; v_tot_vencido int := 0; v_pessoas int := 0; v_href text := '/empresas/' || p_empresa || '/banco-horas';
begin
  if coalesce(jsonb_typeof(p_itens), '') <> 'array' then raise exception 'itens inválidos'; end if;
  for it in select * from jsonb_array_elements(p_itens) loop
    select * into c from colaborador where id = (it ->> 'colaboradorId')::uuid and empresa_id = p_empresa;
    if c.id is null then continue; end if;
    v_vencer := coalesce((it ->> 'aVencerMin')::int, 0); v_vencido := coalesce((it ->> 'vencidoMin')::int, 0); v_data := nullif(it ->> 'venceEm', '')::date;
    if v_vencer <= 0 and v_vencido <= 0 then continue; end if;
    v_pessoas := v_pessoas + 1; v_tot_vencer := v_tot_vencer + greatest(v_vencer, 0); v_tot_vencido := v_tot_vencido + greatest(v_vencido, 0);
    if c.usuario_id is null then continue; end if;
    if v_vencer > 0 then
      perform notificar(c.usuario_id, p_empresa, 'banco_vencendo', 'Banco de horas: ' || horas_texto(v_vencer) || ' vencem em breve',
        'O crédito mais próximo vence em ' || to_char(v_data, 'DD/MM/YYYY') || '. Combine a compensação com o RH para não perder as horas.', '/minha-escala/banco-horas', 'banco_vencendo:' || c.id || ':' || v_sem);
      v_n := v_n + 1;
    end if;
    if v_vencido > 0 then
      perform notificar(c.usuario_id, p_empresa, 'banco_vencido', 'Banco de horas: ' || horas_texto(v_vencido) || ' vencidas',
        'Horas vencidas e não compensadas são pagas como hora extra. Fale com o RH.', '/minha-escala/banco-horas', 'banco_vencido:' || c.id || ':' || v_mes);
      v_n := v_n + 1;
    end if;
  end loop;
  if v_pessoas > 0 then
    for g in select * from usuarios_gestores_empresa(p_empresa) loop
      perform notificar(g, p_empresa, 'banco_gestao',
        'Banco de horas: ' || v_pessoas || case when v_pessoas = 1 then ' colaborador com horas vencendo ou vencidas' else ' colaboradores com horas vencendo ou vencidas' end,
        case when v_tot_vencer > 0 then horas_texto(v_tot_vencer) || ' vencem em até 30 dias' else '' end
          || case when v_tot_vencer > 0 and v_tot_vencido > 0 then '; ' else '' end
          || case when v_tot_vencido > 0 then horas_texto(v_tot_vencido) || ' já vencidas (a pagar como hora extra)' else '' end || '.',
        v_href, 'banco_gestao:' || p_empresa || ':' || v_sem);
    end loop;
  end if;
  return jsonb_build_object('colaboradores', v_pessoas, 'avisosColaborador', v_n);
end $$;
revoke all on function horas_texto(int), avisar_vencimento_banco(uuid, date, jsonb) from public, anon, authenticated;
