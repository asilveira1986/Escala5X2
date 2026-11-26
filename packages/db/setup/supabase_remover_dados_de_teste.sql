-- JornadaCerta: APAGA os dados fictícios criados por dados_de_teste.sql (organização "Demo JornadaCerta"). Só mexe nessa organização.
begin;
do $rm$
declare v_org uuid;
begin
  for v_org in select id from organizacao where nome = 'Demo JornadaCerta' loop
    delete from alocacao where organizacao_id = v_org;
    delete from escala where organizacao_id = v_org;
    delete from ausencia where organizacao_id = v_org;
    delete from demanda_cobertura where organizacao_id = v_org;
    delete from turno_modelo where organizacao_id = v_org;
    delete from contrato_versao where organizacao_id = v_org;
    delete from colaborador where organizacao_id = v_org;
    delete from setor where organizacao_id = v_org;
    delete from unidade where organizacao_id = v_org;
    delete from empresa where organizacao_id = v_org;
    delete from organizacao where id = v_org;
    raise notice 'Organização demo % removida.', v_org;
  end loop;
end
$rm$;
commit;
