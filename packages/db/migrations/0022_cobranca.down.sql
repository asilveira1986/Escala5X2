drop trigger if exists assinatura_inicial on organizacao;
drop function if exists aplicar_evento_cobranca(text, text, text, jsonb), cancelar_assinatura_cobranca(uuid), trocar_plano_assinatura(uuid, uuid),
  definir_assinatura(uuid, uuid, text, text, text, text, date), assinatura_inicial() cascade;
drop table if exists evento_cobranca, fatura, assinatura, plano cascade;
drop function if exists assinatura_tocar();
