-- 0016_atomic_registration.sql
-- Atomic child registration + nursery operations that were missing.
--
-- createChild() in the browser performed three sequential inserts (parent →
-- child → child_guardians). There is no transaction across PostgREST calls, so
-- a failure on the third one left an orphan parent plus a child with no guardian
-- — and the child could then never be scheduled or checked out. This moves the
-- whole registration into one SECURITY DEFINER function.

create or replace function public.create_child_with_guardian(
  p_branch uuid,
  p_child jsonb,
  p_parent_id uuid default null,
  p_new_parent jsonb default null,
  p_relation text default 'guardian'
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_parent uuid := p_parent_id;
  v_child uuid;
  v_code text;
begin
  if not public.has_permission('children.create') then raise exception 'forbidden'; end if;
  if p_branch is null then raise exception 'branch_required'; end if;
  if not public.can_access_branch(p_branch) then raise exception 'branch_forbidden'; end if;

  if p_child->>'full_name_en' is null or p_child->>'date_of_birth' is null then
    raise exception 'child_name_and_dob_required';
  end if;

  -- Create the parent first if a new one was supplied.
  if v_parent is null and p_new_parent is not null then
    if coalesce(p_new_parent->>'full_name_en', '') = ''
       or coalesce(p_new_parent->>'full_name_ar', '') = ''
       or coalesce(p_new_parent->>'phone', '') = '' then
      raise exception 'parent_name_and_phone_required';
    end if;
    insert into public.parents (full_name_en, full_name_ar, phone, email, branch_id)
    values (p_new_parent->>'full_name_en', p_new_parent->>'full_name_ar',
            p_new_parent->>'phone', nullif(p_new_parent->>'email', ''), p_branch)
    returning id into v_parent;
  end if;

  if v_parent is null then raise exception 'guardian_required'; end if;
  if not exists (select 1 from public.parents where id = v_parent) then
    raise exception 'parent_not_found';
  end if;

  insert into public.children (
    branch_id, full_name_en, full_name_ar, date_of_birth, gender,
    allergies, medical_notes, special_care,
    emergency_contact_name, emergency_contact_phone, created_by
  ) values (
    p_branch,
    p_child->>'full_name_en',
    p_child->>'full_name_ar',
    (p_child->>'date_of_birth')::date,
    nullif(p_child->>'gender', '')::gender_t,
    nullif(p_child->>'allergies', ''),
    nullif(p_child->>'medical_notes', ''),
    nullif(p_child->>'special_care', ''),
    nullif(p_child->>'emergency_contact_name', ''),
    nullif(p_child->>'emergency_contact_phone', ''),
    auth.uid()
  ) returning id, child_code into v_child, v_code;

  insert into public.child_guardians
    (child_id, parent_id, relation, is_primary, can_pickup, financial_responsible)
  values (v_child, v_parent, coalesce(p_relation, 'guardian'),
          true, true, true)
  on conflict (child_id, parent_id) do nothing;

  insert into public.audit_logs (user_id, branch_id, table_name, record_id, action, new_data)
  values (auth.uid(), p_branch, 'children', v_child::text, 'insert',
          jsonb_build_object('child_code', v_code, 'parent_id', v_parent));

  return jsonb_build_object('child_id', v_child, 'child_code', v_code, 'parent_id', v_parent);
end $$;

-- ------------------------------------------------------------ nursery extras
-- Holidays and activities/events existed as tables but had no way in.
create or replace function public.nursery_calendar(p_branch uuid, p_from date, p_to date)
returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'holidays', coalesce((select jsonb_agg(to_jsonb(h) order by h.holiday_date)
      from public.holidays h
      where h.branch_id = p_branch and h.holiday_date between p_from and p_to), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.event_date)
      from public.events e
      where e.branch_id = p_branch
        and e.event_date between p_from and p_to), '[]'::jsonb),
    'activities', coalesce((select jsonb_agg(to_jsonb(a) order by a.activity_date)
      from public.activities a
      where a.branch_id = p_branch
        and a.activity_date between p_from and p_to), '[]'::jsonb)
  ) $$;

grant execute on function
  public.create_child_with_guardian(uuid, jsonb, uuid, jsonb, text),
  public.nursery_calendar(uuid, date, date)
to authenticated;
