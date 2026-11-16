drop function if exists publicar_escala(uuid, int, jsonb, uuid, text);
drop function if exists registrar_ciencia(uuid);
drop table if exists ciencia, violacao, alocacao, escala, ausencia, demanda_cobertura, turno_modelo cascade;
drop function if exists escala_da_empresa(uuid), escala_publicada(uuid), lider_do_colaborador(uuid),
  escala_herdar(), ausencia_validar(), escala_proteger(), alocacao_validar(), violacao_ciencia_proteger();
