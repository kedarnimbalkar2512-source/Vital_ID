-- Private storage buckets. Objects are stored under "<patient_id>/<file>", and access
-- follows the same rules as the record itself. Files are served only via signed URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('documents', 'documents', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
  ('photos', 'photos', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "vitalid read own patient files" on storage.objects for select to authenticated
  using (
    bucket_id in ('documents', 'photos')
    and app.can_read_patient(((storage.foldername(name))[1])::uuid)
  );

create policy "vitalid upload own patient files" on storage.objects for insert to authenticated
  with check (
    bucket_id in ('documents', 'photos')
    and app.can_write_patient(((storage.foldername(name))[1])::uuid)
  );

create policy "vitalid replace own patient files" on storage.objects for update to authenticated
  using (
    bucket_id in ('documents', 'photos')
    and app.can_write_patient(((storage.foldername(name))[1])::uuid)
  );

create policy "vitalid delete own patient files" on storage.objects for delete to authenticated
  using (
    bucket_id in ('documents', 'photos')
    and app.can_write_patient(((storage.foldername(name))[1])::uuid)
  );
