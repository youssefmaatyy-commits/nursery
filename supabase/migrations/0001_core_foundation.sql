-- 0001_core_foundation.sql
-- Extensions, enums, tenancy (branches), identity, RBAC, settings, audit, files.
create extension if not exists pgcrypto;
create extension if not exists citext;

create type record_status_t as enum ('active','inactive','archived');
create type gender_t as enum ('male','female');
create type employment_status_t as enum ('active','on_leave','suspended','terminated');
create type locale_t as enum ('ar','en');

-- ---------------------------------------------------------------- helpers
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create or replace function public.normalize_ar(t text) returns text
language sql immutable as $$
  select regexp_replace(translate(coalesce(t,''), 'أإآٱىة', 'اااايه'), '\s+', ' ', 'g')
$$;

-- ---------------------------------------------------------------- branches
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Za-z0-9_-]{2,20}$'),
  name_en text not null,
  name_ar text not null,
  address text,
  phone text,
  email citext,
  timezone text not null default 'Africa/Cairo',
  currency char(3) not null default 'EGP',
  tax_rate numeric(5,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_branches_updated before update on public.branches
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- roles / permissions
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_en text not null,
  name_ar text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.permissions (
  code text primary key,
  module text not null,
  action text not null,
  name_en text not null,
  name_ar text not null
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_id, permission_code)
);

-- ---------------------------------------------------------------- profiles (1-1 with auth.users)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name_en text,
  full_name_ar text,
  email citext,
  phone text,
  avatar_url text,
  locale locale_t not null default 'ar',
  default_branch_id uuid references public.branches(id),
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles
for each row execute function public.set_updated_at();

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, role_id, branch_id)
);
create index idx_user_roles_user on public.user_roles(user_id);

-- auto-create a profile for every new auth user
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name_en, full_name_ar, phone, locale)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data->>'full_name_en',''),
    nullif(new.raw_user_meta_data->>'full_name_ar',''),
    nullif(new.raw_user_meta_data->>'phone',''),
    coalesce((new.raw_user_meta_data->>'locale')::locale_t, 'ar')
  ) on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- authorization helpers
create or replace function public.current_profile() returns public.profiles
language sql stable security definer set search_path = public as $$
  select * from public.profiles where id = auth.uid()
$$;

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and r.code = 'super_admin'
  )
$$;

create or replace function public.has_permission(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then false
    when public.is_super_admin() then true
    else exists (
      select 1 from public.user_roles ur
      join public.role_permissions rp on rp.role_id = ur.role_id
      join public.profiles pr on pr.id = ur.user_id
      where ur.user_id = auth.uid() and rp.permission_code = p_code and pr.is_active
    )
  end
$$;

create or replace function public.has_any_permission(p_codes text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from unnest(p_codes) c where public.has_permission(c))
$$;

-- branch scope of the current user (super admin sees all)
create or replace function public.branch_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select case
    when public.is_super_admin() then coalesce(array(select id from public.branches), array[]::uuid[])
    else coalesce(
      (select array_agg(distinct b) from (
         select ur.branch_id as b from public.user_roles ur where ur.user_id = auth.uid() and ur.branch_id is not null
         union
         select p.default_branch_id from public.profiles p where p.id = auth.uid() and p.default_branch_id is not null
       ) s), array[]::uuid[])
  end
$$;

create or replace function public.can_access_branch(p_branch uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or (p_branch is not null and p_branch = any(public.branch_ids()))
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and p.is_active
  )
$$;

-- ---------------------------------------------------------------- employees / HR
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete set null,
  branch_id uuid not null references public.branches(id),
  employee_code text not null,
  job_title text,
  department text,
  hire_date date not null default current_date,
  salary numeric(12,2) not null default 0 check (salary >= 0),
  employment_status employment_status_t not null default 'active',
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, employee_code)
);
create index idx_employees_branch on public.employees(branch_id);
create trigger trg_employees_updated before update on public.employees
for each row execute function public.set_updated_at();

create table public.employee_attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  work_date date not null default current_date,
  check_in_at timestamptz,
  check_out_at timestamptz,
  status text not null default 'present' check (status in ('present','absent','late','leave','holiday')),
  notes text,
  created_at timestamptz not null default now(),
  unique (employee_id, work_date)
);

-- ---------------------------------------------------------------- settings / audit / files
create table public.system_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id),
  branch_id uuid,
  table_name text not null,
  record_id text,
  action text not null check (action in ('insert','update','delete','login','logout','export','sync')),
  old_data jsonb,
  new_data jsonb,
  ip inet,
  created_at timestamptz not null default now()
);
create index idx_audit_created on public.audit_logs(created_at desc);
create index idx_audit_table on public.audit_logs(table_name, record_id);

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_branch uuid;
begin
  begin
    v_branch := coalesce((to_jsonb(coalesce(new, old))->>'branch_id')::uuid, null);
  exception when others then v_branch := null;
  end;
  insert into public.audit_logs(user_id, branch_id, table_name, record_id, action, old_data, new_data)
  values (
    auth.uid(), v_branch, tg_table_name,
    coalesce((to_jsonb(coalesce(new, old))->>'id'), (to_jsonb(coalesce(new, old))->>'key')),
    lower(tg_op),
    case when tg_op in ('update','delete') then to_jsonb(old) end,
    case when tg_op in ('insert','update') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create table public.uploaded_files (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  path text not null,
  original_name text,
  mime_type text,
  size_bytes bigint,
  entity_type text,
  entity_id uuid,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (bucket, path)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  branch_id uuid references public.branches(id),
  type text not null,
  title_en text not null,
  title_ar text not null,
  body_en text,
  body_ar text,
  severity text not null default 'info' check (severity in ('info','success','warning','error')),
  is_read boolean not null default false,
  read_at timestamptz,
  entity_type text,
  entity_id uuid,
  created_at timestamptz not null default now()
);
create index idx_notifications_user on public.notifications(user_id, is_read, created_at desc);

create table public.sync_operations (
  id uuid primary key default gen_random_uuid(),
  client_op_id text not null unique,
  user_id uuid references public.profiles(id),
  branch_id uuid references public.branches(id),
  operation_type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','applied','failed','conflict')),
  error text,
  result jsonb,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_sync_status on public.sync_operations(status, created_at);
