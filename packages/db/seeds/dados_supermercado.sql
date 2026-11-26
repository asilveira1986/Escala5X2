-- JornadaCerta: DADOS FICTÍCIOS DE UM SUPERMERCADO (organização "Demo Supermercado").
-- 60 colaboradores em 6 setores (Açougue 8, Fruteira 6, Padaria 8, Repositores 12, Caixas 18, Empacotadores 8).
-- Funcionamento: segunda a sábado das 8h às 21h; domingo das 8h às 12h e das 16h às 21h (cobertura mínima só nessas faixas).
-- Cria também os turnos, uma escala em RASCUNHO do mês que vem (rodízio de domingo, sem bloqueios) e férias de 3 pessoas.
-- Tudo inventado: nomes, CNPJ e CPFs (os números têm dígito verificador válido, mas não são de ninguém).
--
-- Como usar: cole no SQL Editor do Supabase e rode. Pode rodar de novo: se a organização já existe, nada é duplicado.
--   * Por padrão, o usuário mais antigo do sistema vira administrador. Para escolher outro, troque `null` em v_email_admin.
--   * Opcional: v_email_colaborador liga um usuário já criado no Authentication à primeira pessoa dos Caixas (testar o app do colaborador).
-- Para apagar: supabase_remover_dados_de_teste.sql (remove as organizações demo).
begin;
do $demo$
declare
  v_email_admin text := null;          -- null = usuário mais antigo
  v_email_colaborador text := null;    -- opcional
  v_admin uuid; v_colab_user uuid; v_org uuid; v_emp uuid; v_unid uuid;
  v_setor uuid; v_escala uuid; v_rev int;
  v_t_abre uuid; v_t_abre_pad uuid; v_t_abre_cx uuid; v_t_fecha uuid; v_t_dom_m uuid; v_t_dom_t uuid;
  setores text[] := array['Açougue','Fruteira','Padaria','Repositores','Caixas','Empacotadores'];
  qtd int[]      := array[8, 6, 8, 12, 18, 8];
  cargos text[]  := array['Açougueiro','Fruteiro','Padeiro','Repositor','Operador de caixa','Empacotador'];
  salarios numeric[] := array[3200, 2300, 2900, 2200, 2400, 1900];
  nomes text[] := array['Lucas','Mariana','Rafael','Juliana','Thiago','Patrícia','Gustavo','Camila','Eduardo','Fernanda','Marcelo','Aline','Renato','Bianca','Leandro','Tatiane','Rodrigo','Vanessa','Felipe','Larissa'];
  sobrenomes text[] := array['Ferreira','Barbosa','Cardoso','Teixeira','Moreira','Araújo','Ribeiro','Gomes','Martins','Freitas','Castro','Campos','Batista','Monteiro','Nogueira','Pacheco','Siqueira','Vasconcelos','Fonseca','Machado'];
  v_ids uuid[] := '{}'; v_set_i int[] := '{}'; v_grupo int[] := '{}'; v_k int[] := '{}';   -- por pessoa: setor, grupo (0 manhã, 1 tarde) e posição no grupo
  v_aloc jsonb := '[]'::jsonb;
  s int; j int; n int := 0; g int; k int; ini date; fim date; d date; dow int; sem int; trabalha_dom boolean; folga_f int; folga_g int;
  cpf text; dv1 int; dv2 int; soma int; kk int; v_id uuid; v_nome text; v_i int;
  v_ini_t int; v_fim_t int; v_tm uuid; v_dom boolean;
begin
  select id into v_admin from usuario where (v_email_admin is null or lower(email) = lower(v_email_admin)) order by criado_em limit 1;
  if v_admin is null then raise exception 'Nenhum usuário encontrado. Crie um em Authentication → Users e rode de novo.'; end if;
  if v_email_colaborador is not null then
    select id into v_colab_user from usuario where lower(email) = lower(v_email_colaborador);
    if v_colab_user is null then raise exception 'Usuário % não encontrado em Authentication.', v_email_colaborador; end if;
  end if;
  if exists (select 1 from organizacao o join membro m on m.organizacao_id = o.id where o.nome = 'Demo Supermercado' and m.usuario_id = v_admin) then
    raise notice 'A organização "Demo Supermercado" já existe para este usuário: nada a fazer.'; return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'aal', 'aal1', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  v_org := criar_organizacao('Demo Supermercado', 'empresa');
  insert into empresa (organizacao_id, razao_social, cnpj, porte, cnae, municipio_ibge, uf, status_adequacao)
  values (v_org, 'Supermercado Bom Preço Demo Ltda', '45723174000110', 'medio', '4711-3/02', '3550308', 'SP', 'em_risco') returning id into v_emp;
  insert into unidade (organizacao_id, empresa_id, nome, municipio_ibge) values (v_org, v_emp, 'Loja Principal', '3550308') returning id into v_unid;

  -- Turnos (8 h líquidas, 1 h de intervalo) e os dois turnos curtos de domingo (4 h sem intervalo; 5 h com 15 min).
  insert into turno_modelo (organizacao_id, empresa_id, nome, inicio_min, fim_min, intervalo_min, cor) values (v_org, v_emp, 'Abertura 07h-16h', 420, 960, 60, '#2563eb') returning id into v_t_abre;
  insert into turno_modelo (organizacao_id, empresa_id, nome, inicio_min, fim_min, intervalo_min, cor) values (v_org, v_emp, 'Abertura padaria 06h-15h', 360, 900, 60, '#c2410c') returning id into v_t_abre_pad;
  insert into turno_modelo (organizacao_id, empresa_id, nome, inicio_min, fim_min, intervalo_min, cor) values (v_org, v_emp, 'Manhã 08h-17h', 480, 1020, 60, '#0d9488') returning id into v_t_abre_cx;
  insert into turno_modelo (organizacao_id, empresa_id, nome, inicio_min, fim_min, intervalo_min, cor) values (v_org, v_emp, 'Fechamento 12h-21h', 720, 1260, 60, '#7c3aed') returning id into v_t_fecha;
  insert into turno_modelo (organizacao_id, empresa_id, nome, inicio_min, fim_min, intervalo_min, cor) values (v_org, v_emp, 'Domingo manhã 08h-12h', 480, 720, 0, '#be185d') returning id into v_t_dom_m;
  insert into turno_modelo (organizacao_id, empresa_id, nome, inicio_min, fim_min, intervalo_min, cor) values (v_org, v_emp, 'Domingo tarde 16h-21h', 960, 1260, 15, '#4d7c0f') returning id into v_t_dom_t;

  -- Setores, cobertura mínima e colaboradores.
  for s in 1..array_length(setores, 1) loop
    insert into setor (organizacao_id, unidade_id, nome) values (v_org, v_unid, setores[s]) returning id into v_setor;
    -- faixas de segunda a sábado: manhã (só o grupo da abertura), meio do dia (os dois grupos) e noite (só o fechamento)
    for dow in 1..6 loop
      insert into demanda_cobertura (organizacao_id, empresa_id, setor_id, dia_semana, faixa_inicio_min, faixa_fim_min, minimo, ideal) values
        (v_org, v_emp, v_setor, dow, 480, 720,  (array[2,1,2,3,4,2])[s], (array[3,2,3,4,6,3])[s]),
        (v_org, v_emp, v_setor, dow, 720, 960,  (array[3,2,3,4,6,3])[s], (array[4,3,4,5,8,4])[s]),
        (v_org, v_emp, v_setor, dow, 960, 1260, (array[2,1,2,3,4,2])[s], (array[3,2,3,4,6,3])[s]);
    end loop;
    -- domingo: só 8h-12h e 16h-21h
    insert into demanda_cobertura (organizacao_id, empresa_id, setor_id, dia_semana, faixa_inicio_min, faixa_fim_min, minimo, ideal) values
      (v_org, v_emp, v_setor, 0, 480, 720,  (array[1,1,1,2,3,1])[s], (array[2,2,2,3,4,2])[s]),
      (v_org, v_emp, v_setor, 0, 960, 1260, (array[1,1,1,2,3,1])[s], (array[2,2,2,3,4,2])[s]);

    for j in 0..qtd[s] - 1 loop
      n := n + 1;
      v_nome := nomes[(n - 1) % 20 + 1] || ' ' || sobrenomes[((n - 1) / 20 + (n - 1) * 3) % 20 + 1];
      cpf := lpad((100000001 + n * 1234567)::text, 9, '0');
      soma := 0; for kk in 1..9 loop soma := soma + substr(cpf, kk, 1)::int * (11 - kk); end loop;
      dv1 := (soma * 10) % 11 % 10; cpf := cpf || dv1::text;
      soma := 0; for kk in 1..10 loop soma := soma + substr(cpf, kk, 1)::int * (12 - kk); end loop;
      dv2 := (soma * 10) % 11 % 10; cpf := cpf || dv2::text;
      v_id := cadastrar_colaborador(v_emp, v_nome, cpf, date '2025-03-03' + (n % 9) * 30, salarios[s] + (j % 3) * 100, 2400, 200, '5x2', setores[s],
                                    'S' || lpad(n::text, 3, '0'), case when s = 5 and j = 0 then 'Operador de caixa (líder)' else cargos[s] end, null, 'medio', null,
                                    case when j % 2 = 0 then 'abertura' else 'fechamento' end);
      v_ids := v_ids || v_id; v_set_i := v_set_i || s; v_grupo := v_grupo || (j % 2); v_k := v_k || (j / 2);
    end loop;
  end loop;
  if v_colab_user is not null then update colaborador set usuario_id = v_colab_user where id = v_ids[array_position(v_set_i, 5)]; end if;

  -- Férias de 3 pessoas (Caixas, Padaria e Repositores) na segunda quinzena do mês que vem.
  ini := date_trunc('month', current_date + interval '1 month')::date;
  fim := (date_trunc('month', current_date + interval '2 month'))::date;
  for v_i in select unnest(array[array_position(v_set_i, 5) + 3, array_position(v_set_i, 3) + 2, array_position(v_set_i, 4) + 4]) loop
    insert into ausencia (organizacao_id, empresa_id, colaborador_id, periodo, tipo, observacao)
    values (v_org, v_emp, v_ids[v_i], daterange(ini + 14, ini + 24, '[]'), 'ferias', 'Férias fictícias de teste');
  end loop;

  -- Escala em RASCUNHO do mês que vem. Cada pessoa tem um turno fixo (abertura ou fechamento) e, de semana em semana:
  --   semana (segunda a domingo) com domingo trabalhado: folga dois dias de segunda a sábado; com domingo livre: folga o domingo e um dia fixo.
  --   Rodízio: cada pessoa trabalha um domingo sim, um não (8h-12h para a abertura, 16h-21h para o fechamento).
  insert into escala (organizacao_id, empresa_id, nome, periodo, criado_por)
  values (v_org, v_emp, 'Escala demo do supermercado', daterange(ini, fim, '[)'), v_admin) returning id, revisao into v_escala, v_rev;
  for v_i in 1..array_length(v_ids, 1) loop
    s := v_set_i[v_i]; g := v_grupo[v_i]; k := v_k[v_i];
    folga_f := (k % 6) + 1; folga_g := ((k + 3) % 6) + 1;
    if g = 0 then
      v_ini_t := case when s = 3 then 360 when s in (5, 6) then 480 else 420 end;
      v_fim_t := case when s = 3 then 900 when s in (5, 6) then 1020 else 960 end;
      v_tm := case when s = 3 then v_t_abre_pad when s in (5, 6) then v_t_abre_cx else v_t_abre end;
    else
      v_ini_t := 720; v_fim_t := 1260; v_tm := v_t_fecha;
    end if;
    for d in select x::date from generate_series(ini, fim - 1, interval '1 day') x loop
      dow := extract(dow from d)::int;
      sem := ((d - ((dow + 6) % 7)) - date '2000-01-03') / 7;   -- número da semana da lei: segunda a domingo (o domingo fecha a semana)
      trabalha_dom := (sem + k + g) % 2 = 0;
      continue when exists (select 1 from ausencia a where a.colaborador_id = v_ids[v_i] and a.periodo @> d);
      if dow = 0 then
        if trabalha_dom then
          v_aloc := v_aloc || jsonb_build_object('colaboradorId', v_ids[v_i], 'data', d, 'tipo', 'trabalho', 'inicioMin', case when g = 0 then 480 else 960 end,
            'fimMin', case when g = 0 then 720 else 1260 end, 'intervaloMin', case when g = 0 then 0 else 15 end, 'turnoModeloId', case when g = 0 then v_t_dom_m else v_t_dom_t end);
        else
          v_aloc := v_aloc || jsonb_build_object('colaboradorId', v_ids[v_i], 'data', d, 'tipo', 'folga');
        end if;
      else
        -- semana (segunda a domingo) com domingo trabalhado: folga em f e g; com domingo livre: folga só em f (mais o domingo).
        if dow = folga_f or (trabalha_dom and dow = folga_g) then
          v_aloc := v_aloc || jsonb_build_object('colaboradorId', v_ids[v_i], 'data', d, 'tipo', 'folga');
        else
          v_aloc := v_aloc || jsonb_build_object('colaboradorId', v_ids[v_i], 'data', d, 'tipo', 'trabalho', 'inicioMin', v_ini_t, 'fimMin', v_fim_t, 'intervaloMin', 60, 'turnoModeloId', v_tm);
        end if;
      end if;
    end loop;
  end loop;
  perform salvar_alocacoes(v_escala, v_rev, v_aloc);
  raise notice 'Supermercado demo criado: % colaboradores em % setores, escala em rascunho.', n, array_length(setores, 1);
end
$demo$;
commit;
