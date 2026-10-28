-- Feriados nacionais 2026–2028 (fixos + Sexta-feira Santa). Estaduais e municipais: cadastro manual.
insert into feriado (data, nome, abrangencia)
select make_date(a, m, d), nome, 'nacional'
  from generate_series(2026, 2028) a,
       (values (1,1,'Confraternização Universal'), (4,21,'Tiradentes'), (5,1,'Dia do Trabalho'),
               (9,7,'Independência do Brasil'), (10,12,'Nossa Senhora Aparecida'), (11,2,'Finados'),
               (11,15,'Proclamação da República'), (11,20,'Consciência Negra'), (12,25,'Natal')) f(m, d, nome)
on conflict do nothing;
insert into feriado (data, nome, abrangencia) values
  ('2026-04-03','Sexta-feira Santa','nacional'),
  ('2027-03-26','Sexta-feira Santa','nacional'),
  ('2028-04-14','Sexta-feira Santa','nacional')
on conflict do nothing;
