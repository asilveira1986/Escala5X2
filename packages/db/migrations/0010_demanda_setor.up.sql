-- A demanda de cobertura só pode apontar para setor da própria empresa (o RLS só confere a empresa).
create function demanda_validar() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.setor_id is not null and not exists (
       select 1 from setor s join unidade u on u.id = s.unidade_id where s.id = new.setor_id and u.empresa_id = new.empresa_id) then
    raise exception 'o setor não pertence à empresa';
  end if;
  if new.faixa_inicio_min = new.faixa_fim_min then raise exception 'a faixa horária não pode ter duração zero'; end if;
  return new;
end $$;
create trigger demanda_validar before insert or update on demanda_cobertura for each row execute function demanda_validar();
