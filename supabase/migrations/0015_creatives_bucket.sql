-- 0015: storage for creatives.
--
-- Creatives live in a public bucket: they are assets on their way to a public
-- post, and the Graph API fetches them by URL. Upload and delete are
-- manager-gated; the bucket being public is what lets Facebook read the file.
--
-- Free-tier limits worth knowing: ~1GB total storage and 50MB per file. Fine
-- for images; big videos should be pasted as a direct URL instead until the
-- Regency-owned Pro org exists.
insert into storage.buckets (id, name, public)
values ('creatives', 'creatives', true)
on conflict (id) do nothing;

create policy creatives_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'creatives' and public.pm_is_manager('regency-shalina'));
create policy creatives_read on storage.objects for select to authenticated
  using (bucket_id = 'creatives');
create policy creatives_delete on storage.objects for delete to authenticated
  using (bucket_id = 'creatives' and public.pm_is_manager('regency-shalina'));
