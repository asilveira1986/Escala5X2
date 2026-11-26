-- JornadaCerta: DADOS FICTÍCIOS PARA TESTE (organização "Demo JornadaCerta").
-- Cria uma organização à parte, com empresa, setores, turnos, 8 colaboradores, cobertura mínima, férias e uma escala em rascunho.
-- Todos os nomes, CNPJ e CPFs são inventados (os números têm dígito verificador válido, mas não são de ninguém).
--
-- Como usar: cole no SQL Editor do Supabase e rode. Pode rodar de novo: se a organização já existe, nada é duplicado.
--   * Quem entra: por padrão, o usuário mais antigo do sistema vira administrador da organização demo.
--     Para escolher outro, troque `null` por 'email@exemplo.com' em v_email_admin (precisa já existir em Authentication → Users).
--   * Para testar o app do colaborador: coloque em v_email_colaborador o e-mail de OUTRO usuário já criado no Authentication;
--     ele é ligado à colaboradora "Ana Souza Demo" e passa a ver "Minha escala" (depois de você publicar a escala).
-- Para apagar tudo isto depois: supabase_remover_dados_de_teste.sql.
begin;
do $demo$
declare
  v_email_admin text := null;          -- null = usuário mais antigo
  v_email_colaborador text := null;    -- opcional: usuário que será a "Ana Souza Demo"
  v_admin uuid; v_colab_user uuid; v_org uuid; v_emp uuid; v_unid uuid; v_set_atend uuid; v_set_coz uuid;
  v_manha uuid; v_tarde uuid; v_escala uuid; v_rev int;
  v_cnpj text := '11222333000181';
  v_ids uuid[] := '{}'; v_id uuid;
  v_aloc jsonb := '[]'::jsonb;
  d date; i int; dow int;
  pessoas text[][] := array[
    ['Ana Souza Demo','Atendimento','Atendente','2800.00','tarde'],
    ['Bruno Lima Demo','Atendimento','Atendente','2700.00','manha'],
    ['Carla Mendes Demo','Atendimento','Caixa','3000.00','manha'],
    ['Diego Alves Demo','Atendimento','Atendente','2650.00','tarde'],
    ['Elisa Rocha Demo','Atendimento','Líder de loja','3900.00','manha'],
    ['Fabio Nunes Demo','Cozinha','Padeiro','3400.00','manha'],
    ['Gabriela Dias Demo','Cozinha','Confeiteira','3300.00','manha'],
    ['Hugo Pires Demo','Cozinha','Auxiliar de cozinha','2500.00','manha']];
  base int[] := array[111444777, 222555888, 333666999, 123456789, 987654321, 246813579, 135792468, 112233445];
  cpf text; dv1 int; dv2 int; soma int; k int;
begin
  select id into v_admin from usuario where (v_email_admin is null or lower(email) = lower(v_email_admin)) order by criado_em limit 1;
  if v_admin is null then raise exception 'Nenhum usuário encontrado. Crie um em Authentication → Users e rode de novo.'; end if;
  if v_email_colaborador is not null then
    select id into v_colab_user from usuario where lower(email) = lower(v_email_colaborador);
    if v_colab_user is null then raise exception 'Usuário % não encontrado em Authentication.', v_email_colaborador; end if;
  end if;

  -- Já existe? Não duplica.
  if exists (select 1 from organizacao o join membro m on m.organizacao_id = o.id where o.nome = 'Demo JornadaCerta' and m.usuario_id = v_admin) then
    raise notice 'A organização "Demo JornadaCerta" já existe para este usuário: nada a fazer.'; return;
  end if;

  -- Age como o administrador (as funções do sistema conferem quem está logado).
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'aal', 'aal1', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  v_org := criar_organizacao('Demo JornadaCerta', 'empresa');
  insert into empresa (organizacao_id, razao_social, cnpj, porte, cnae, municipio_ibge, uf, status_adequacao)
  values (v_org, 'Padaria Estrela Demo Ltda', v_cnpj, 'me', '1091-1/02', '3550308', 'SP', 'em_risco') returning id into v_emp;
  insert into unidade (organizacao_id, empresa_id, nome, municipio_ibge) values (v_org, v_emp, 'Loja Centro', '3550308') returning id into v_unid;
  insert into setor (organizacao_id, unidade_id, nome) values (v_org, v_unid, 'Atendimento') returning id into v_set_atend;
  insert into setor (organizacao_id, unidade_id, nome) values (v_org, v_unid, 'Cozinha') returning id into v_set_coz;

  insert into turno_modelo (organizacao_id, empresa_id, nome, inicio_min, fim_min, intervalo_min, cor) values (v_org, v_emp, 'Manhã', 480, 1020, 60, '#2563eb') returning id into v_manha;
  insert into turno_modelo (organizacao_id, empresa_id, nome, inicio_min, fim_min, intervalo_min, cor) values (v_org, v_emp, 'Tarde', 600, 1140, 60, '#7c3aed') returning id into v_tarde;
  insert into turno_modelo (organizacao_id, empresa_id, nome, inicio_min, fim_min, intervalo_min, cor) values (v_org, v_emp, 'Madrugada (padaria)', 300, 840, 60, '#c2410c');

  -- Colaboradores (CPF fictício com dígitos verificadores válidos), jornada de 40 h, escala 5x2.
  for i in 1..array_length(pessoas, 1) loop
    cpf := lpad(base[i]::text, 9, '0');
    soma := 0; for k in 1..9 loop soma := soma + substr(cpf, k, 1)::int * (11 - k); end loop;
    dv1 := (soma * 10) % 11 % 10; cpf := cpf || dv1::text;
    soma := 0; for k in 1..10 loop soma := soma + substr(cpf, k, 1)::int * (12 - k); end loop;
    dv2 := (soma * 10) % 11 % 10; cpf := cpf || dv2::text;
    v_id := cadastrar_colaborador(v_emp, pessoas[i][1], cpf, date '2025-02-03', pessoas[i][4]::numeric, 2400, 200, '5x2', pessoas[i][2],
                                  'D' || lpad(i::text, 3, '0'), pessoas[i][3], null, 'medio', null, pessoas[i][5]);
    v_ids := v_ids || v_id;
  end loop;
  if v_colab_user is not null then update colaborador set usuario_id = v_colab_user where id = v_ids[1]; end if;

  -- Cobertura mínima: atendimento das 8h às 18h (seg a sáb) e cozinha das 6h às 14h.
  for dow in 1..6 loop
    insert into demanda_cobertura (organizacao_id, empresa_id, setor_id, dia_semana, faixa_inicio_min, faixa_fim_min, minimo, ideal) values (v_org, v_emp, v_set_atend, dow, 480, 1080, 2, 3);
    insert into demanda_cobertura (organizacao_id, empresa_id, setor_id, dia_semana, faixa_inicio_min, faixa_fim_min, minimo, ideal) values (v_org, v_emp, v_set_coz, dow, 360, 840, 1, 2);
  end loop;

  -- Férias da Carla (3ª pessoa) na segunda quinzena do mês que vem.
  insert into ausencia (organizacao_id, empresa_id, colaborador_id, periodo, tipo, observacao)
  values (v_org, v_emp, v_ids[3], daterange(date_trunc('month', current_date + interval '1 month')::date + 13, date_trunc('month', current_date + interval '1 month')::date + 27, '[]'), 'ferias', 'Férias fictícias de teste');

  -- Escala em RASCUNHO do mês que vem: seg a sáb alternando as folgas, domingo fechado, e uma folga no feriado de 25/12 se cair no mês.
  insert into escala (organizacao_id, empresa_id, nome, periodo, criado_por)
  values (v_org, v_emp, 'Escala demo do mês', daterange(date_trunc('month', current_date + interval '1 month')::date, (date_trunc('month', current_date + interval '2 month'))::date, '[)'), v_admin) returning id, revisao into v_escala, v_rev;
  for i in 1..array_length(v_ids, 1) loop
    for d in select g::date from generate_series(date_trunc('month', current_date + interval '1 month')::date, (date_trunc('month', current_date + interval '2 month')::date) - 1, interval '1 day') g loop
      dow := extract(dow from d)::int;
      continue when exists (select 1 from ausencia a where a.colaborador_id = v_ids[i] and a.periodo @> d);
      -- cada pessoa folga o domingo e mais um dia fixo da semana (segunda a sábado, escalonado)
      if dow = 0 or dow = ((i - 1) % 6) + 1 or (extract(month from d) = 12 and extract(day from d) = 25) or (extract(month from d) = 1 and extract(day from d) = 1) then
        v_aloc := v_aloc || jsonb_build_object('colaboradorId', v_ids[i], 'data', d, 'tipo', 'folga');
      else
        v_aloc := v_aloc || jsonb_build_object('colaboradorId', v_ids[i], 'data', d, 'tipo', 'trabalho',
          'inicioMin', case when pessoas[i][5] = 'tarde' then 600 else 480 end, 'fimMin', case when pessoas[i][5] = 'tarde' then 1140 else 1020 end,
          'intervaloMin', 60, 'turnoModeloId', case when pessoas[i][5] = 'tarde' then v_tarde else v_manha end);
      end if;
    end loop;
  end loop;
  perform salvar_alocacoes(v_escala, v_rev, v_aloc);
  raise notice 'Dados de teste criados na organização "Demo JornadaCerta" (empresa Padaria Estrela Demo Ltda, 8 colaboradores, escala em rascunho).';
end
$demo$;
commit;
