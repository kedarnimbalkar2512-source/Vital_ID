-- Row Level Security, privileges, signup trigger and the edit-audit trigger.
-- The browser talks to Supabase with the anon key + the user's JWT, so these policies are
-- the security boundary for direct reads/writes. Everything cross-user (doctor reads,
-- consent, QR, emergency view, AI) goes through the FastAPI backend instead.

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so policies don't recurse through RLS)
-- ---------------------------------------------------------------------------
create or replace function app.current_profile_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles where user_id = auth.uid()
$$;

create or replace function app.current_app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where user_id = auth.uid()
$$;

create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where user_id = auth.uid()), false)
$$;

create or replace function app.owns_patient(p_patient uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.patients pt join public.profiles pr on pr.id = pt.profile_id
    where pt.id = p_patient and pr.user_id = auth.uid()
  )
$$;

create or replace function app.is_caregiver_of(p_patient uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.caregiver_links cl join public.profiles pr on pr.id = cl.caregiver_profile_id
    where cl.patient_id = p_patient and cl.status = 'active' and pr.user_id = auth.uid()
  )
$$;

create or replace function app.current_doctor_id() returns uuid
language sql stable security definer set search_path = public as $$
  select d.id from public.doctors d join public.profiles pr on pr.id = d.profile_id
  where pr.user_id = auth.uid() and d.verification_status = 'verified'
$$;

create or replace function app.doctor_has_grant(p_patient uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.access_grants g
    where g.patient_id = p_patient
      and g.doctor_id = app.current_doctor_id()
      and g.scope = 'full'
      and g.revoked_at is null
      and g.expires_at > now()
  )
$$;

create or replace function app.can_read_patient(p_patient uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.owns_patient(p_patient) or app.is_caregiver_of(p_patient) or app.doctor_has_grant(p_patient)
$$;

create or replace function app.can_write_patient(p_patient uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.owns_patient(p_patient) or app.is_caregiver_of(p_patient)
$$;

grant usage on schema app to authenticated, anon;
grant execute on all functions in schema app to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges: start from nothing, then grant only what the browser needs.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

grant select, update (full_name, phone) on public.profiles to authenticated;
grant select, update (dob, gender, blood_group, photo_url, has_cognitive_condition, emergency_note, city, preferred_language)
  on public.patients to authenticated;
grant select on public.doctors to authenticated;
grant update (council, hospital, specialty) on public.doctors to authenticated;
grant select on public.caregiver_links, public.access_grants, public.access_requests,
  public.cognitive_tests, public.cognitive_alerts, public.ai_summaries, public.audit_logs,
  public.clinician_notes, public.drug_classes, public.drug_interactions, public.allergy_cross_reactivity
  to authenticated;
grant select, insert, update, delete on public.emergency_contacts, public.conditions, public.medications,
  public.allergies, public.history_entries, public.documents to authenticated;
grant select, update (read_at) on public.notifications to authenticated;
-- patient_secrets and qr_tokens: no browser access at all.

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'patients', 'patient_secrets', 'doctors', 'caregiver_links', 'emergency_contacts',
    'conditions', 'medications', 'allergies', 'history_entries', 'documents', 'clinician_notes',
    'access_requests', 'access_grants', 'qr_tokens', 'cognitive_tests', 'cognitive_alerts',
    'ai_summaries', 'audit_logs', 'notifications', 'drug_classes', 'drug_interactions', 'allergy_cross_reactivity'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- profiles: your own row; admins see all
create policy profiles_select on public.profiles for select to authenticated
  using (user_id = auth.uid() or app.is_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- patients: readable by anyone allowed to read the record; only the owner/caregiver edits
create policy patients_select on public.patients for select to authenticated
  using (app.can_read_patient(id));
create policy patients_update on public.patients for update to authenticated
  using (app.can_write_patient(id)) with check (app.can_write_patient(id));

-- doctors: own row, admins
create policy doctors_select on public.doctors for select to authenticated
  using (profile_id = app.current_profile_id() or app.is_admin());
create policy doctors_update on public.doctors for update to authenticated
  using (profile_id = app.current_profile_id()) with check (profile_id = app.current_profile_id());

-- caregiver links: the patient and the caregiver in the link
create policy caregiver_links_select on public.caregiver_links for select to authenticated
  using (app.owns_patient(patient_id) or caregiver_profile_id = app.current_profile_id());

-- Patient record tables. Browser inserts/edits are always "patient-reported";
-- doctor-entered and AI-extracted rows are written by the backend and read-only here.
do $$
declare t text;
begin
  foreach t in array array['conditions', 'medications', 'allergies', 'history_entries'] loop
    execute format('create policy %I on public.%I for select to authenticated using (app.can_read_patient(patient_id))', t || '_select', t);
    execute format($p$create policy %I on public.%I for insert to authenticated
      with check (app.can_write_patient(patient_id) and source = 'patient-reported' and recorded_by = app.current_profile_id())$p$, t || '_insert', t);
    execute format($p$create policy %I on public.%I for update to authenticated
      using (app.can_write_patient(patient_id) and source = 'patient-reported')
      with check (app.can_write_patient(patient_id) and source = 'patient-reported')$p$, t || '_update', t);
    execute format($p$create policy %I on public.%I for delete to authenticated
      using (app.can_write_patient(patient_id) and source = 'patient-reported')$p$, t || '_delete', t);
  end loop;
end $$;

create policy emergency_contacts_select on public.emergency_contacts for select to authenticated
  using (app.can_read_patient(patient_id));
create policy emergency_contacts_write on public.emergency_contacts for all to authenticated
  using (app.can_write_patient(patient_id)) with check (app.can_write_patient(patient_id));

create policy documents_select on public.documents for select to authenticated
  using (app.can_read_patient(patient_id));
create policy documents_insert on public.documents for insert to authenticated
  with check (app.can_write_patient(patient_id) and uploaded_by = app.current_profile_id()
              and extraction_status = 'none' and extracted_json is null);
create policy documents_update on public.documents for update to authenticated
  using (app.can_write_patient(patient_id)) with check (app.can_write_patient(patient_id));
create policy documents_delete on public.documents for delete to authenticated
  using (app.can_write_patient(patient_id));

-- Clinician notes: doctors with access see all; patients/caregivers see non-sensitive or released notes.
create policy clinician_notes_select on public.clinician_notes for select to authenticated
  using (
    app.doctor_has_grant(patient_id)
    or doctor_id = app.current_doctor_id()
    or (app.can_write_patient(patient_id) and (sensitive = false or released_at is not null))
  );

-- Consent records
create policy access_grants_select on public.access_grants for select to authenticated
  using (app.can_write_patient(patient_id) or doctor_id = app.current_doctor_id());
create policy access_requests_select on public.access_requests for select to authenticated
  using (app.can_write_patient(patient_id) or doctor_id = app.current_doctor_id());

-- Cognitive data (tests are written by the backend, which scores them)
create policy cognitive_tests_select on public.cognitive_tests for select to authenticated
  using (app.can_read_patient(patient_id));
create policy cognitive_alerts_select on public.cognitive_alerts for select to authenticated
  using (app.can_read_patient(patient_id));
create policy ai_summaries_select on public.ai_summaries for select to authenticated
  using (app.can_read_patient(patient_id));

-- Audit log: insert-only from triggers/backend; readable by the patient (own) and admins.
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (app.owns_patient(patient_id) or app.is_admin());

-- Notifications: your own
create policy notifications_select on public.notifications for select to authenticated
  using (profile_id = app.current_profile_id());
create policy notifications_update on public.notifications for update to authenticated
  using (profile_id = app.current_profile_id()) with check (profile_id = app.current_profile_id());

-- Reference data: readable by any signed-in user
create policy drug_classes_select on public.drug_classes for select to authenticated using (true);
create policy drug_interactions_select on public.drug_interactions for select to authenticated using (true);
create policy allergy_cross_select on public.allergy_cross_reactivity for select to authenticated using (true);

-- patient_secrets, qr_tokens: RLS on, no policies => only the backend (service role) can touch them.

-- ---------------------------------------------------------------------------
-- New auth user => profile row (+ pending doctor row). Admin can never be self-assigned.
-- ---------------------------------------------------------------------------
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce(new.raw_user_meta_data->>'role', 'patient');
  v_profile uuid;
begin
  if v_role not in ('patient', 'caregiver', 'doctor') then
    v_role := 'patient';
  end if;
  insert into public.profiles (user_id, role, full_name, phone)
  values (new.id, v_role, coalesce(new.raw_user_meta_data->>'full_name', ''), new.raw_user_meta_data->>'phone')
  returning id into v_profile;

  if v_role = 'doctor' then
    insert into public.doctors (profile_id, licence_no, council, hospital, specialty)
    values (
      v_profile,
      coalesce(nullif(new.raw_user_meta_data->>'licence_no', ''), 'NOT-PROVIDED'),
      new.raw_user_meta_data->>'council',
      new.raw_user_meta_data->>'hospital',
      new.raw_user_meta_data->>'specialty'
    );
  end if;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------
-- Every create/edit/delete of record data lands in audit_logs, whether it came from the
-- browser (actor = auth.uid()) or the backend (actor = app.actor_profile_id setting).
-- ---------------------------------------------------------------------------
create or replace function app.actor_profile_id() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  v := app.current_profile_id();
  if v is null then
    v := nullif(current_setting('app.actor_profile_id', true), '')::uuid;
  end if;
  return v;
end $$;

create or replace function app.audit_record_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_action text;
  v_actor uuid;
  v_changed jsonb := '{}'::jsonb;
begin
  if current_setting('app.skip_audit', true) = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    v_row := old; v_action := 'delete';
    -- the whole patient is being deleted (account removal cascades): nothing left to audit against
    if not exists (select 1 from public.patients where id = old.patient_id) then
      return old;
    end if;
  elsif tg_op = 'UPDATE' then v_row := new; v_action := 'edit';
    select coalesce(jsonb_agg(key), '[]'::jsonb) into v_changed
      from jsonb_each(to_jsonb(new)) n
      where n.key not in ('updated_at') and n.value is distinct from (to_jsonb(old) -> n.key);
  else v_row := new; v_action := 'create';
  end if;
  v_actor := app.actor_profile_id();
  insert into public.audit_logs (actor_profile_id, actor_role, action, target_type, target_id, patient_id, meta)
  values (
    v_actor,
    (select role from public.profiles where id = v_actor),
    v_action,
    tg_table_name,
    v_row.id,
    v_row.patient_id,
    case when tg_op = 'UPDATE' then jsonb_build_object('fields', v_changed) else '{}'::jsonb end
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['emergency_contacts', 'conditions', 'medications', 'allergies', 'history_entries', 'documents', 'clinician_notes'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_record_change()', t || '_audit', t);
  end loop;
end $$;
