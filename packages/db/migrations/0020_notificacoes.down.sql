drop trigger if exists notificar on escala;
drop trigger if exists notificar on solicitacao;
drop function if exists escala_notificar(), solicitacao_notificar(), notificar(uuid, uuid, text, text, text, text), usuarios_gestores_empresa(uuid);
drop table if exists notificacao cascade;
drop function if exists notificacao_proteger();
