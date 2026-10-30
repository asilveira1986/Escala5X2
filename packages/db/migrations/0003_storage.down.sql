do $$
begin
  if to_regclass('storage.objects') is null then return; end if;
  drop policy if exists importacoes_select on storage.objects;
  drop policy if exists importacoes_insert on storage.objects;
  drop policy if exists importacoes_delete on storage.objects;
  drop policy if exists marca_select on storage.objects;
  drop policy if exists marca_insert on storage.objects;
  drop policy if exists marca_update on storage.objects;
  drop policy if exists marca_delete on storage.objects;
end $$;
