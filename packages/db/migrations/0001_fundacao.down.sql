drop table if exists acesso_suporte, auditoria, vinculo_empresa, empresa, membro, usuario, organizacao cascade;
drop function if exists criar_organizacao(text, tipo_org, text), pode_gerir_empresa(uuid), sou_admin_da_empresa(uuid),
  pode_acessar_empresa(uuid), tenho_papel(uuid, papel[]), minhas_organizacoes(), mfa_ok(papel),
  papel_exige_mfa(papel), auditoria_gravar(), auditoria_imutavel(), auditar_tabela(regclass);
drop type if exists porte, papel, tipo_org;
