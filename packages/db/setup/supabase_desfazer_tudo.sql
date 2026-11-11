-- JornadaCerta: desfaz a instalação (apaga as tabelas do app). Use só em projeto de testes.
begin;

-- ===== 0004_usuario_onboarding.down.sql =====
drop trigger if exists ao_cadastrar_usuario on auth.users;
drop function if exists criar_usuario_ao_cadastrar();

-- ===== 0003_storage.down.sql =====
do $$
begin
  if to_regclass('storage.objects') is null then return; end if;
  drop policy if exists importacoes_select on storage.objects;
  drop policy if exists importacoes_insert on storage.objects;
  drop policy if exists importacoes_delete on storage.objects;
  drop policy if exists marca_select on storage.objects;
  drop policy if exists marca_insert on storage.objects;
  drop policy if exists marca_update on storage.objects;
  drop policy if exists marca_delete on storage.objects;
end $$;

-- ===== 0002_cadastros_regras.down.sql =====
drop view if exists vw_colaborador_vigente;
drop function if exists importacao_validar() cascade;
drop function if exists registrar_exportacao(uuid, text);
drop table if exists importacao, cenario, diagnostico_item, diagnostico, feriado, regra_jornada,
  colaborador_acordo, contrato_versao, colaborador, clausula_jornada, acordo_coletivo, setor, unidade cascade;
alter table empresa drop constraint if exists empresa_sindicato_fk;
alter table empresa drop column if exists sindicato_id;
drop table if exists sindicato cascade;
drop function if exists diagnostico_obter(uuid), salvar_cenario(uuid, text, jsonb, jsonb), salvar_diagnostico(uuid, date, jsonb, jsonb), diagnostico_entrada(uuid, date), acordo_vinculado_a_minha_empresa(uuid), inserir_colaborador(uuid, text, text, date, uuid, text, text, text, text, text, uuid), revelar_dados_colaborador(uuid), decifrar_texto(bytea), cifrar_texto(text), hash_cpf(text),
  normalizar_cpf(text), segredo(text), validar_colaborador_acordo(), herdar_organizacao(),
  empresa_do_colaborador(uuid), eh_proprio_colaborador(uuid), pode_gerir_acordo(uuid), pode_ver_acordo(uuid),
  empresa_do_usuario(uuid), minhas_organizacoes_gestao(), sou_superadmin() cascade;
-- restaura a definição da Fase 0
create or replace function pode_acessar_empresa(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from empresa e
     where e.id = p_empresa
       and (e.organizacao_id in (select minhas_organizacoes())
            or exists (select 1 from vinculo_empresa v
                        where v.empresa_id = e.id
                          and v.organizacao_id in (select minhas_organizacoes()))))
$$;
create policy empresa_select on empresa for select to authenticated
  using (organizacao_id in (select minhas_organizacoes())
         or exists (select 1 from vinculo_empresa v
                     where v.empresa_id = empresa.id
                       and v.organizacao_id in (select minhas_organizacoes())));
delete from organizacao where id = '00000000-0000-0000-0000-000000000001';
drop function if exists auditoria_evento(uuid, text, text, text);

-- ===== 0001_fundacao.down.sql =====
drop table if exists acesso_suporte, auditoria, vinculo_empresa, empresa, membro, usuario, organizacao cascade;
drop function if exists criar_organizacao(text, tipo_org, text), pode_gerir_empresa(uuid), sou_admin_da_empresa(uuid),
  pode_acessar_empresa(uuid), tenho_papel(uuid, papel[]), minhas_organizacoes(), mfa_ok(papel),
  papel_exige_mfa(papel), auditoria_gravar(), auditoria_imutavel(), auditar_tabela(regclass);
drop type if exists porte, papel, tipo_org;
commit;
