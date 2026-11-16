drop function if exists fechamento_entrada(uuid, date), fechar_folha(uuid, date, jsonb, text), fechamento_integro(uuid), registrar_exportacao_folha(uuid, text, text);
drop table if exists fechamento_folha cascade;
drop function if exists fechamento_proteger();
