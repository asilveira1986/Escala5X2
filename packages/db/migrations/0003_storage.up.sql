-- Buckets privados e políticas de Storage por pasta da organização (apenas no Supabase; ignorado em Postgres puro).
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'Schema storage ausente: políticas de Storage ignoradas';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit) values
    ('importacoes', 'importacoes', false, 10485760),   -- planilhas de colaboradores (10 MB)
    ('marca',       'marca',       false, 1048576)     -- logos de white label (1 MB)
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

  -- Convenção de caminho: <organizacao_id>/<arquivo>. O worker (service_role) só lê o que o banco validou.
  create policy importacoes_select on storage.objects for select to authenticated
    using (bucket_id = 'importacoes' and (storage.foldername(name))[1] in (select o::text from minhas_organizacoes_gestao() o));
  create policy importacoes_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'importacoes' and (storage.foldername(name))[1] in (select o::text from minhas_organizacoes_gestao() o));
  create policy importacoes_delete on storage.objects for delete to authenticated
    using (bucket_id = 'importacoes' and (storage.foldername(name))[1] in (select o::text from minhas_organizacoes_gestao() o));

  create policy marca_select on storage.objects for select to authenticated
    using (bucket_id = 'marca' and (storage.foldername(name))[1] in (select o::text from minhas_organizacoes() o));
  create policy marca_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'marca' and tenho_papel(((storage.foldername(name))[1])::uuid, array['admin']::papel[]));
  create policy marca_update on storage.objects for update to authenticated
    using (bucket_id = 'marca' and tenho_papel(((storage.foldername(name))[1])::uuid, array['admin']::papel[]))
    with check (bucket_id = 'marca' and tenho_papel(((storage.foldername(name))[1])::uuid, array['admin']::papel[]));
  create policy marca_delete on storage.objects for delete to authenticated
    using (bucket_id = 'marca' and tenho_papel(((storage.foldername(name))[1])::uuid, array['admin']::papel[]));
end $$;
