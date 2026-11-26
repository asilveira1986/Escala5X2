-- Volta a exigir MFA (aal2) dos papéis sensíveis: recria o interruptor da migration 0005 (ligado, o padrão seguro).
-- Interruptor da verificação em duas etapas (MFA).
--
-- Por regra, admin, contador, advogado e superadmin só enxergam dados com MFA (aal2). Este interruptor existe
-- para ambientes de TESTE, sem dados reais. Fonte única da verdade: esta tabela (o app e o RLS leem daqui).
--   * Padrão seguro: ligado. Linha ausente, valor inválido ou qualquer coisa diferente de false = ligado.
--   * Só quem tem acesso direto ao banco (SQL Editor / service_role) liga e desliga; usuários do app não leem
--     nem escrevem a tabela.
--   * Toda mudança fica na auditoria, com o motivo.
create table configuracao_sistema (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,
  valor jsonb not null,
  motivo text,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);
alter table configuracao_sistema enable row level security;   -- sem políticas: nenhum usuário do app acessa
revoke all on configuracao_sistema from anon, authenticated;
insert into configuracao_sistema (chave, valor, motivo) values ('mfa_obrigatorio', 'true'::jsonb, 'padrão seguro');
select auditar_tabela('configuracao_sistema');

-- true = MFA exigido. Só "false" exato desliga.
create function mfa_obrigatorio() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from configuracao_sistema where chave = 'mfa_obrigatorio' and valor = 'false'::jsonb)
$$;
revoke all on function mfa_obrigatorio() from public, anon;
grant execute on function mfa_obrigatorio() to authenticated;

-- mfa_ok agora respeita o interruptor.
create or replace function mfa_ok(p papel) returns boolean
language sql stable as $$
  select not papel_exige_mfa(p) or not mfa_obrigatorio() or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- Liga/desliga com motivo obrigatório. Só o dono do banco e o service_role executam.
create function definir_mfa_obrigatorio(p_ativo boolean, p_motivo text) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Informe o motivo (mínimo 5 caracteres).';
  end if;
  update configuracao_sistema
     set valor = to_jsonb(p_ativo), motivo = trim(p_motivo), atualizado_em = now(), atualizado_por = auth.uid()
   where chave = 'mfa_obrigatorio';
end $$;
revoke all on function definir_mfa_obrigatorio(boolean, text) from public, anon, authenticated;
grant execute on function definir_mfa_obrigatorio(boolean, text) to service_role;
