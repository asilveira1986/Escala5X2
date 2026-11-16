drop function if exists iniciar_importacao_afd(uuid, text, text, text), importar_marcacoes_afd(uuid, jsonb), finalizar_importacao_afd(uuid, text, jsonb),
  desfazer_importacao_afd(uuid, text), identificadores_pendentes(uuid), mapear_identificador_ponto(uuid, text, text, uuid), vincular_marcacoes(uuid), hash_identificador_ponto(text, text);
drop table if exists marcacao_ponto, ponto_identificador, afd_importacao cascade;
drop function if exists marcacao_proteger();
