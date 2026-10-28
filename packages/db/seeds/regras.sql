-- Seed idempotente das regras da EC 141/2026. Tudo editável pelo superadmin (sem deploy).
-- Convenção de prioridade: 100 = regra geral; 200 = por escopo (porte, terceirizada); 300 = exceção individual
-- (alta renda, acordo). Na mescla, aplica-se em ordem crescente e a MAIOR prioridade vence.
insert into regra_jornada (codigo, descricao, vigencia, escopo, parametros, prioridade, fonte_url, ativa) values
('LEGADO_44H', '44h semanais, 8h diárias, 1 repouso semanal, divisor 220',
 '[1970-01-01,2026-12-15)', '{}',
 '{"max_semanal_min":2640,"max_diaria_min":480,"folgas_semana":1,"divisor":220,"interjornada_min":660,"max_he_dia_min":120,"he_percentual_min":50}',
 100, null, true),
('EC141_F1', 'Escala 5x2 obrigatória, máximo 42h semanais, divisor 210',
 '[2026-12-15,2027-12-15)', '{}',
 '{"max_semanal_min":2520,"max_diaria_min":480,"folgas_semana":2,"divisor":210,"interjornada_min":660,"max_he_dia_min":120,"he_percentual_min":50}',
 100, null, true),
('EC141_F2', 'Escala 5x2, máximo 40h semanais e 8h diárias, divisor 200 (data de início parametrizável; confirmar com advogado)',
 '[2027-12-15,)', '{}',
 '{"max_semanal_min":2400,"max_diaria_min":480,"folgas_semana":2,"divisor":200,"interjornada_min":660,"max_he_dia_min":120,"he_percentual_min":50}',
 100, null, true),
('EC141_TERC_PUBLICO', 'Terceirizadas da administração pública: 12 meses para eliminar a 6x1 (mantém regras do legado até o prazo)',
 '[2026-12-15,2027-10-16)', '{"terceirizada_publica":true}',
 '{"max_semanal_min":2640,"max_diaria_min":480,"folgas_semana":1,"divisor":220,"interjornada_min":660,"max_he_dia_min":120,"he_percentual_min":50,"prazo_eliminar_6x1":"2027-10-16"}',
 200, null, true),
('EC141_ALTA_RENDA', 'Jornada diferenciada permitida, mantida a 5x2: diploma superior e salário igual ou superior ao piso',
 '[2026-12-15,)', '{"alta_renda":true}',
 '{"salario_minimo":21188.87,"exige_superior":true,"jornada_diferenciada":true,"folgas_semana":2}',
 300, null, true),
('EC141_ACORDO_COMP', 'Regime compensatório com escala diferente da 5x2, enquanto o acordo ou convenção vigorar',
 '[1970-01-01,)', '{"acordo":"regime_compensatorio"}', '{}', 300, null, true),
('EC141_ACORDO_DIARIA', 'Jornada diária acima de 8h por acordo coletivo, respeitado o teto semanal da fase de transição',
 '[2026-12-15,2027-12-15)', '{"acordo":"jornada_diaria_estendida"}', '{}', 300, null, true),
('EC141_PEQUENA_EMPRESA', 'Placeholder inativo: transição de MEI, ME e EPP, aguardando lei complementar',
 '[2026-12-15,)', '{"porte":["mei","me","epp"]}', '{}', 200, null, false)
on conflict (codigo, vigencia) do update
  set descricao = excluded.descricao, escopo = excluded.escopo, parametros = excluded.parametros,
      prioridade = excluded.prioridade, ativa = excluded.ativa;
