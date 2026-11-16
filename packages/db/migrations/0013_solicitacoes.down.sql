drop function if exists criar_solicitacao(uuid, text, jsonb, uuid, text), responder_solicitacao(uuid, boolean), cancelar_solicitacao(uuid),
  decidir_solicitacao(uuid, boolean, text, jsonb), escala_colegas(uuid), trabalha_na_escala(uuid, uuid, date), hoje_sp(), escala_vigente(uuid), escalas_publicadas_no_periodo(uuid, date, date), criar_versao_rascunho(uuid), descartar_versao_rascunho(uuid);
drop table if exists solicitacao cascade;
