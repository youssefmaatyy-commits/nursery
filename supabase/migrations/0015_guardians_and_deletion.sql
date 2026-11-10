-- 0015_guardians_and_deletion.sql
-- Multiple guardians per child, plus safe archive/delete for children and parents.
--
-- Design rule, enforced in the database rather than the UI: anything that has
-- financial or attendance history can be ARCHIVED but never hard-deleted, so
-- invoices and reports can never be orphaned. Hard delete is reserved for
-- records created by mistake, and is super-admin only.

-- ============================================================ guardians
-- child_guardians already models many-to-many. What was missing is a way to add
-- a second guardian to an existing child without dropping into SQL.

create or replace function public.child_guardian_upsert(
  p_child uuid, p_parent uuid, p_relation text default 'guardian',
  p_is_primary boolean default false, p_can_pickup boolean default true,
  p_financial_responsible boolean default false, p_custody_notes text default null
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v_branch uuid; v_link uuid;
begin
  if not public.has_permission('parents.manage') then raise exception 'forbidden'; end if;
  select branch_id into v_branch from public.children where id = p_child;
  if v_branch is null then raise exception 'child_not_found'; end if;
  if not public.can_access_branch(v_branch) then raise exception 'branch_forbidden'; end if;
  if p_relation not in ('father','mother','guardian','other') then
    raise exception 'invalid_relation';
  end if;

  -- Exactly one primary guardian per child: demote the others first.
  if p_is_primary then
    update public.child_guardians set is_primary = false
     where child_id = p_child and is_primary and parent_id <> p_parent;
  end if;

  insert into public.child_guardians
    (child_id, parent_id, relation, is_primary, can_pickup, financial_responsible, custody_notes)
  values (p_child, p_parent, p_relation, p_is_primary, p_can_pickup, p_financial_responsible, p_custody_notes)
  on conflict (child_id, parent_id) do update
    set relation = excluded.relation,
        is_primary = excluded.is_primary,
        can_pickup = excluded.can_pickup,
        financial_responsible = excluded.financial_responsible,
        custody_notes = excluded.custody_notes
  returning id into v_link;

  insert into public.audit_logs (user_id, branch_id, table_name, record_id, action, new_data)
  values (auth.uid(), v_branch, 'child_guardians', v_link::text, 'insert',
          jsonb_build_object('child_id', p_child, 'parent_id', p_parent,
                             'relation', p_relation, 'is_primary', p_is_primary));
  return v_link;
end $$;

create or replace function public.child_guardian_unlink(p_link uuid)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_child uuid; v_remaining int; v_branch uuid;
begin
  if not public.has_permission('parents.manage') then raise exception 'forbidden'; end if;
  select child_id into v_child from public.child_guardians where id = p_link;
  if v_child is null then raise exception 'guardian_link_not_found'; end if;
  select branch_id into v_branch from public.children where id = v_child;
  if not public.can_access_branch(v_branch) then raise exception 'branch_forbidden'; end if;

  -- A child with no guardian has nobody to contact in an emergency.
  select count(*) into v_remaining from public.child_guardians
   where child_id = v_child and id <> p_link;
  if v_remaining = 0 then raise exception 'child_needs_at_least_one_guardian'; end if;

  delete from public.child_guardians where id = p_link;
  insert into public.audit_logs (user_id, branch_id, table_name, record_id, action, old_data)
  values (auth.uid(), v_branch, 'child_guardians', p_link::text, 'delete',
          jsonb_build_object('child_id', v_child));
end $$;

-- ============================================================ archive / delete
-- Returns the dependent-history counts so the UI can explain *why* a hard delete
-- is refused instead of just failing.
create or replace function public.child_history_counts(p_child uuid)
returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'invoices', (select count(*) from public.invoices where child_id = p_child),
    'subscriptions', (select count(*) from public.subscriptions where child_id = p_child),
    'kids_area_sessions', (select count(*) from public.kids_area_sessions where child_id = p_child),
    'nursery_attendance', (select count(*) from public.nursery_attendance where child_id = p_child),
    'nursery_enrollments', (select count(*) from public.nursery_enrollments where child_id = p_child),
    'daily_reports', (select count(*) from public.daily_child_reports where child_id = p_child)
  ) $$;

create or replace function public.admin_delete_child(p_child uuid, p_hard boolean default false)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_branch uuid; v_counts jsonb; v_total int;
begin
  select branch_id into v_branch from public.children where id = p_child;
  if v_branch is null then raise exception 'child_not_found'; end if;
  if not public.can_access_branch(v_branch) then raise exception 'branch_forbidden'; end if;

  if p_hard then
    if not (public.is_super_admin() and public.has_permission('children.archive')) then
      raise exception 'forbidden';
    end if;
    v_counts := public.child_history_counts(p_child);
    select coalesce(sum(value::int), 0) into v_total
      from jsonb_each_text(v_counts);
    if v_total > 0 then
      raise exception 'has_history_use_archive: %', v_counts::text;
    end if;
    delete from public.children where id = p_child;
    insert into public.audit_logs (user_id, branch_id, table_name, record_id, action, old_data)
    values (auth.uid(), v_branch, 'children', p_child::text, 'delete', v_counts);
    return 'deleted';
  end if;

  if not public.has_permission('children.archive') then raise exception 'forbidden'; end if;
  update public.children set status = 'archived' where id = p_child;
  insert into public.audit_logs (user_id, branch_id, table_name, record_id, action, new_data)
  values (auth.uid(), v_branch, 'children', p_child::text, 'update',
          jsonb_build_object('status', 'archived'));
  return 'archived';
end $$;

create or replace function public.admin_restore_child(p_child uuid)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_branch uuid;
begin
  if not public.has_permission('children.archive') then raise exception 'forbidden'; end if;
  select branch_id into v_branch from public.children where id = p_child;
  if v_branch is null then raise exception 'child_not_found'; end if;
  if not public.can_access_branch(v_branch) then raise exception 'branch_forbidden'; end if;
  update public.children set status = 'active' where id = p_child;
  insert into public.audit_logs (user_id, branch_id, table_name, record_id, action, new_data)
  values (auth.uid(), v_branch, 'children', p_child::text, 'update',
          jsonb_build_object('status', 'active'));
end $$;

create or replace function public.admin_delete_parent(p_parent uuid, p_hard boolean default false)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_branch uuid; v_children int; v_invoices int;
begin
  select branch_id into v_branch from public.parents where id = p_parent;
  if v_branch is null then raise exception 'parent_not_found'; end if;
  if not public.can_access_branch(v_branch) then raise exception 'branch_forbidden'; end if;

  select count(*) into v_children from public.child_guardians where parent_id = p_parent;
  select count(*) into v_invoices from public.invoices where parent_id = p_parent;

  if p_hard then
    if not (public.is_super_admin() and public.has_permission('parents.manage')) then
      raise exception 'forbidden';
    end if;
    -- Invoices reference parents with NO ACTION, and guardianships CASCADE, so a
    -- silent delete would either fail or orphan a child.
    if v_invoices > 0 then raise exception 'parent_has_invoices_use_archive'; end if;
    if v_children > 0 then raise exception 'parent_has_children_unlink_first'; end if;
    delete from public.parents where id = p_parent;
    insert into public.audit_logs (user_id, branch_id, table_name, record_id, action)
    values (auth.uid(), v_branch, 'parents', p_parent::text, 'delete');
    return 'deleted';
  end if;

  if not public.has_permission('parents.manage') then raise exception 'forbidden'; end if;
  update public.parents set status = 'inactive' where id = p_parent;
  insert into public.audit_logs (user_id, branch_id, table_name, record_id, action, new_data)
  values (auth.uid(), v_branch, 'parents', p_parent::text, 'update',
          jsonb_build_object('status', 'inactive'));
  return 'deactivated';
end $$;

create or replace function public.admin_restore_parent(p_parent uuid)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_branch uuid;
begin
  if not public.has_permission('parents.manage') then raise exception 'forbidden'; end if;
  select branch_id into v_branch from public.parents where id = p_parent;
  if v_branch is null then raise exception 'parent_not_found'; end if;
  if not public.can_access_branch(v_branch) then raise exception 'branch_forbidden'; end if;
  update public.parents set status = 'active' where id = p_parent;
  insert into public.audit_logs (user_id, branch_id, table_name, record_id, action, new_data)
  values (auth.uid(), v_branch, 'parents', p_parent::text, 'update',
          jsonb_build_object('status', 'active'));
end $$;

-- ============================================================ profile self-service
-- The `must_change_password` column itself is added by 0014, because
-- admin_create_staff_account() sets it. These are the two ways it is cleared.

create or replace function public.change_own_password(p_password text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_password is null or length(p_password) < 12 then raise exception 'password_too_short'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = auth.uid();
  update public.profiles set must_change_password = false where id = auth.uid();
  insert into public.audit_logs (user_id, table_name, record_id, action)
  values (auth.uid(), 'auth.users', auth.uid()::text, 'update');
end $$;

create or replace function public.admin_clear_must_change(p_user uuid)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not (public.is_super_admin() or p_user = auth.uid()) then raise exception 'forbidden'; end if;
  update public.profiles set must_change_password = false where id = p_user;
end $$;

grant execute on function
  public.child_guardian_upsert(uuid,uuid,text,boolean,boolean,boolean,text),
  public.child_guardian_unlink(uuid),
  public.child_history_counts(uuid),
  public.admin_delete_child(uuid,boolean),
  public.admin_restore_child(uuid),
  public.admin_delete_parent(uuid,boolean),
  public.admin_restore_parent(uuid),
  public.change_own_password(text),
  public.admin_clear_must_change(uuid)
to authenticated;
