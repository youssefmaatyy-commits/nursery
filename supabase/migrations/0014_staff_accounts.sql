-- 0014_staff_accounts.sql
-- Staff provisioning, role assignment, and permission control.
--
-- Everything here is SECURITY DEFINER behind an explicit authorisation gate, so
-- the browser never touches auth.users directly and never needs a service-role
-- key. The frontend can only call these RPCs.

-- ---------------------------------------------------------------- unique index
-- user_roles is UNIQUE (user_id, role_id, branch_id). With branch_id NULL, two
-- "global" rows for the same role could still be inserted. Cover that case too.
create unique index if not exists uq_user_roles_global
  on public.user_roles (user_id, role_id) where branch_id is null;

-- ----------------------------------------------------- forced password change
-- There was no enforced first-login password change: Login.tsx printed a static
-- sentence and nothing backed it. admin_create_staff_account() sets this flag and
-- RequireAuth blocks the app until change_own_password() clears it (0015).
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

-- ------------------------------------------------------- profile provisioning
-- handle_new_user() only creates a profile for a brand-new auth user. Any user
-- that already existed in auth.users without one (which is how a manually
-- created super admin ended up with no profile / no role → "branch_forbidden")
-- never gets one. Backfill, then keep it correct.
insert into public.profiles (id, email)
select u.id, u.email from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- ------------------------------------------------------------- staff accounts
create or replace function public.admin_list_staff_accounts()
returns table (
  user_id uuid, email text, full_name_en text, full_name_ar text, phone text,
  locale text, is_active boolean, default_branch_id uuid,
  roles jsonb, last_sign_in_at timestamptz, employee_id uuid, employee_code text
)
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not (public.has_permission('employees.manage') or public.has_permission('roles.manage')) then
    raise exception 'forbidden';
  end if;
  -- The explicit ::text casts are required: profiles.email is citext and the
  -- RETURNS TABLE types are text, so without them Postgres raises
  -- "structure of query does not match function result type".
  return query
  select p.id, p.email::text, p.full_name_en::text, p.full_name_ar::text, p.phone::text,
         p.locale::text, p.is_active, p.default_branch_id,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'role_id', r.id, 'code', r.code,
                     'name_en', r.name_en, 'name_ar', r.name_ar,
                     'branch_id', ur.branch_id)
                   order by r.code)
                   from public.user_roles ur join public.roles r on r.id = ur.role_id
                   where ur.user_id = p.id), '[]'::jsonb),
         u.last_sign_in_at, e.id, e.employee_code::text
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.employees e on e.profile_id = p.id;
end $$;

create or replace function public.admin_create_staff_account(
  p_email text, p_password text, p_full_name_en text, p_full_name_ar text,
  p_phone text, p_role_code text, p_branch_id uuid,
  p_employee_code text default null, p_job_title text default null,
  p_salary numeric default null, p_hire_date date default null
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid; v_role uuid; v_branch uuid; v_employee uuid;
begin
  if not public.has_permission('employees.manage') then
    raise exception 'forbidden';
  end if;
  if p_email is null or position('@' in p_email) = 0 then
    raise exception 'invalid_email';
  end if;
  if p_password is null or length(p_password) < 12 then
    raise exception 'password_too_short';
  end if;

  select id into v_role from public.roles where code = p_role_code;
  if v_role is null then raise exception 'unknown_role'; end if;
  if p_role_code = 'super_admin' and not public.is_super_admin() then
    raise exception 'only_a_super_admin_can_grant_super_admin';
  end if;

  v_branch := coalesce(p_branch_id, (select id from public.branches where code = 'MAIN'));
  if v_branch is null then raise exception 'branch_required'; end if;
  if not public.can_access_branch(v_branch) then raise exception 'branch_forbidden'; end if;

  select id into v_user from auth.users where lower(email) = lower(p_email) limit 1;
  if v_user = auth.uid() and p_role_code = 'super_admin' then
    raise exception 'cannot_grant_admin_to_self';
  end if;
  if v_user is not null then raise exception 'email_already_registered'; end if;

  -- crypt()/gen_salt() live in the `extensions` schema on Supabase, which is why
  -- the search_path above must include it.
  v_user := gen_random_uuid();
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
    lower(p_email), extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('full_name_en', p_full_name_en, 'full_name_ar', p_full_name_ar),
    now(), now(), '', '', '', ''
  );
  -- A user with no identity row cannot sign in.
  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_user, v_user::text, 'email',
    jsonb_build_object('sub', v_user::text, 'email', lower(p_email), 'email_verified', true),
    now(), now(), now()
  );

  insert into public.profiles
    (id, email, full_name_en, full_name_ar, phone, default_branch_id, must_change_password)
  values (v_user, lower(p_email), p_full_name_en, p_full_name_ar, p_phone, v_branch, true)
  on conflict (id) do update
    set full_name_en = excluded.full_name_en,
        full_name_ar = excluded.full_name_ar,
        phone = excluded.phone,
        default_branch_id = excluded.default_branch_id,
        is_active = true,
        must_change_password = true;

  -- super_admin is global (branch_id NULL) and bypasses has_permission().
  insert into public.user_roles (user_id, role_id, branch_id)
  values (v_user, v_role, case when p_role_code = 'super_admin' then null else v_branch end)
  on conflict do nothing;

  if p_employee_code is not null then
    insert into public.employees (profile_id, branch_id, employee_code, job_title, salary, hire_date, phone)
    values (v_user, v_branch, p_employee_code, p_job_title, coalesce(p_salary, 0),
            coalesce(p_hire_date, current_date), p_phone)
    on conflict (branch_id, employee_code) do update
      set profile_id = v_user, job_title = excluded.job_title
    returning id into v_employee;
  end if;

  insert into public.audit_logs (user_id, branch_id, table_name, record_id, action, new_data)
  values (auth.uid(), v_branch, 'profiles', v_user::text, 'insert',
          jsonb_build_object('email', p_email, 'role', p_role_code,
                             'employee_created', v_employee is not null));
  return v_user;
end $$;

create or replace function public.admin_set_user_role(p_user uuid, p_role_code text, p_branch_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_role uuid; v_branch uuid;
begin
  if not public.has_permission('roles.manage') then raise exception 'forbidden'; end if;
  select id into v_role from public.roles where code = p_role_code;
  if v_role is null then raise exception 'unknown_role'; end if;
  if p_role_code = 'super_admin' and not public.is_super_admin() then
    raise exception 'only_a_super_admin_can_grant_super_admin';
  end if;
  v_branch := case when p_role_code = 'super_admin' then null else p_branch_id end;
  if v_branch is not null and not public.can_access_branch(v_branch) then
    raise exception 'branch_forbidden';
  end if;
  insert into public.user_roles (user_id, role_id, branch_id)
  values (p_user, v_role, v_branch) on conflict do nothing;
  insert into public.audit_logs (user_id, branch_id, table_name, record_id, action, new_data)
  values (auth.uid(), v_branch, 'user_roles', p_user::text, 'insert',
          jsonb_build_object('role', p_role_code));
end $$;

create or replace function public.admin_remove_user_role(p_user uuid, p_role_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_code text;
begin
  if not public.has_permission('roles.manage') then raise exception 'forbidden'; end if;
  select code into v_code from public.roles where id = p_role_id;
  if v_code is null then raise exception 'unknown_role'; end if;
  if v_code = 'super_admin' and not public.is_super_admin() then raise exception 'forbidden'; end if;
  if p_user = auth.uid() then raise exception 'cannot_remove_own_role'; end if;
  -- Never leave the system with nobody who can administer it.
  if v_code = 'super_admin' and (
       select count(*) from public.user_roles ur
       join public.roles r on r.id = ur.role_id
       where r.code = 'super_admin' and ur.user_id <> p_user) = 0 then
    raise exception 'cannot_remove_last_super_admin';
  end if;
  delete from public.user_roles where user_id = p_user and role_id = p_role_id;
  insert into public.audit_logs (user_id, table_name, record_id, action, old_data)
  values (auth.uid(), 'user_roles', p_user::text, 'delete', jsonb_build_object('role', v_code));
end $$;

create or replace function public.admin_set_user_active(p_user uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.has_permission('employees.manage') then raise exception 'forbidden'; end if;
  if p_user = auth.uid() then raise exception 'cannot_deactivate_self'; end if;
  -- has_permission() checks profiles.is_active, so this is the real off-switch.
  update public.profiles set is_active = p_active where id = p_user;
  if not found then raise exception 'profile_not_found'; end if;
  insert into public.audit_logs (user_id, table_name, record_id, action, new_data)
  values (auth.uid(), 'profiles', p_user::text, 'update', jsonb_build_object('is_active', p_active));
end $$;

create or replace function public.admin_reset_user_password(p_user uuid, p_password text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.has_permission('employees.manage') then raise exception 'forbidden'; end if;
  if p_user = auth.uid() and not public.is_super_admin() then
    raise exception 'use_change_password_instead';
  end if;
  if p_password is null or length(p_password) < 12 then raise exception 'password_too_short'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = p_user;
  if not found then raise exception 'user_not_found'; end if;
  insert into public.audit_logs (user_id, table_name, record_id, action)
  values (auth.uid(), 'auth.users', p_user::text, 'update');
end $$;

-- ------------------------------------------------------- permission matrix
-- super_admin is deliberately not editable: it short-circuits has_permission()
-- and already holds every permission, so a toggle would be a lie in the UI.
create or replace function public.admin_set_role_permission(
  p_role_code text, p_permission_code text, p_enabled boolean
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_role uuid;
begin
  if not public.has_permission('roles.manage') then raise exception 'forbidden'; end if;
  if p_role_code = 'super_admin' then raise exception 'super_admin_has_all_permissions'; end if;
  select id into v_role from public.roles where code = p_role_code;
  if v_role is null then raise exception 'unknown_role'; end if;
  if not exists (select 1 from public.permissions where code = p_permission_code) then
    raise exception 'unknown_permission';
  end if;
  if p_enabled then
    insert into public.role_permissions (role_id, permission_code)
    values (v_role, p_permission_code) on conflict do nothing;
  else
    delete from public.role_permissions
     where role_id = v_role and permission_code = p_permission_code;
  end if;
  insert into public.audit_logs (user_id, table_name, record_id, action, new_data)
  values (auth.uid(), 'role_permissions', p_role_code, 'update',
          jsonb_build_object('permission', p_permission_code, 'enabled', p_enabled));
end $$;

grant execute on function
  public.admin_list_staff_accounts(),
  public.admin_create_staff_account(text,text,text,text,text,text,uuid,text,text,numeric,date),
  public.admin_set_user_role(uuid,text,uuid),
  public.admin_remove_user_role(uuid,uuid),
  public.admin_set_user_active(uuid,boolean),
  public.admin_reset_user_password(uuid,text),
  public.admin_set_role_permission(text,text,boolean)
to authenticated;

-- Note on application history: the live project received this as several smaller
-- migrations because the migration tool rejected one very large statement. The
-- end state matches the SQL above; re-running this file on a fresh project
-- produces the same schema.
