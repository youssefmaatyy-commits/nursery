-- 0002_children_parents.sql
-- Families: parents, guardians, children, authorized pickups, documents, medical notes.

create sequence public.child_code_seq start 1001;
create sequence public.parent_code_seq start 1001;

create table public.parents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete set null,
  parent_code text not null unique default ('P-' || lpad((nextval('public.parent_code_seq'))::text, 5, '0')),
  full_name_en text not null,
  full_name_ar text not null,
  phone text not null,
  alt_phone text,
  email citext,
  national_id text,
  address text,
  branch_id uuid not null references public.branches(id),
  status record_status_t not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_parents_phone on public.parents(phone);
create index idx_parents_branch on public.parents(branch_id);
create index idx_parents_profile on public.parents(profile_id);
create trigger trg_parents_updated before update on public.parents
for each row execute function public.set_updated_at();

create table public.children (
  id uuid primary key default gen_random_uuid(),
  child_code text not null unique default ('CH-' || lpad((nextval('public.child_code_seq'))::text, 5, '0')),
  branch_id uuid not null references public.branches(id),
  full_name_en text not null,
  full_name_ar text not null,
  name_search text generated always as (
    lower(coalesce(full_name_en,'') || ' ' || public.normalize_ar(full_name_ar))
  ) stored,
  date_of_birth date not null check (date_of_birth <= current_date),
  gender gender_t not null default 'male',
  photo_url text,
  enrollment_date date not null default current_date,
  status record_status_t not null default 'active',
  allergies text,
  medical_notes text,
  special_care text,
  emergency_contact_name text,
  emergency_contact_phone text,
  blood_type text,
  internal_notes text,
  qr_token text not null default encode(gen_random_bytes(12), 'hex'),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, full_name_en, date_of_birth)
);
create index idx_children_branch on public.children(branch_id);
create index idx_children_status on public.children(status);
create index idx_children_search on public.children using gin (to_tsvector('simple', name_search));
create index idx_children_qr on public.children(qr_token);
create trigger trg_children_updated before update on public.children
for each row execute function public.set_updated_at();

create table public.child_guardians (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  parent_id uuid not null references public.parents(id) on delete cascade,
  relation text not null default 'guardian' check (relation in ('father','mother','guardian','other')),
  is_primary boolean not null default false,
  can_pickup boolean not null default true,
  financial_responsible boolean not null default false,
  custody_notes text,
  created_at timestamptz not null default now(),
  unique (child_id, parent_id)
);
create index idx_child_guardians_child on public.child_guardians(child_id);
create index idx_child_guardians_parent on public.child_guardians(parent_id);

create table public.authorized_pickups (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  full_name_en text not null,
  full_name_ar text not null,
  relation text not null,
  phone text not null,
  national_id text,
  photo_url text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_authorized_pickups_child on public.authorized_pickups(child_id);
create trigger trg_authorized_pickups_updated before update on public.authorized_pickups
for each row execute function public.set_updated_at();

create table public.child_documents (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  doc_type text not null check (doc_type in ('birth_certificate','vaccination','medical_report','photo','enrollment_form','insurance','other')),
  bucket text not null default 'child-documents',
  file_path text not null,
  original_name text,
  expires_at date,
  notes text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index idx_child_documents_child on public.child_documents(child_id);

create table public.medical_notes (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  note_type text not null check (note_type in ('allergy','chronic','medication','incident','observation','vaccination')),
  description text not null,
  severity text not null default 'low' check (severity in ('low','medium','high','critical')),
  recorded_by uuid references public.profiles(id),
  recorded_at timestamptz not null default now()
);
create index idx_medical_notes_child on public.medical_notes(child_id);

-- ------------------------------------------------------------ parent-scope helpers
create or replace function public.current_parent_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), array[]::uuid[]) from public.parents
  where profile_id = auth.uid() and status = 'active'
$$;

create or replace function public.current_parent_child_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct child_id), array[]::uuid[])
  from public.child_guardians
  where parent_id = any(public.current_parent_ids())
$$;

create or replace function public.is_parent_of(p_child uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_child = any(public.current_parent_child_ids())
$$;

-- ------------------------------------------------------------ search RPC
create or replace function public.search_children(
  p_query text,
  p_branch uuid default null,
  p_limit int default 25
) returns table (
  id uuid, child_code text, full_name_en text, full_name_ar text, date_of_birth date,
  gender gender_t, photo_url text, status record_status_t, branch_id uuid,
  primary_guardian text, primary_phone text, age_years int
) language sql stable security definer set search_path = public as $$
  with q as (
    select lower(trim(coalesce(p_query, ''))) as raw,
           public.normalize_ar(lower(trim(coalesce(p_query, '')))) as ar
  )
  select c.id, c.child_code, c.full_name_en, c.full_name_ar, c.date_of_birth, c.gender,
         c.photo_url, c.status, c.branch_id,
         coalesce(p.full_name_ar, p.full_name_en) as primary_guardian,
         p.phone as primary_phone,
         extract(year from age(c.date_of_birth))::int as age_years
  from public.children c
  left join lateral (
    select pp.* from public.child_guardians cg join public.parents pp on pp.id = cg.parent_id
    where cg.child_id = c.id order by cg.is_primary desc, cg.created_at limit 1
  ) p on true
  cross join q
  where (
      q.raw = '' or
      c.child_code ilike '%' || q.raw || '%' or
      c.full_name_en ilike '%' || q.raw || '%' or
      c.qr_token = q.raw or
      public.normalize_ar(lower(c.full_name_ar)) like '%' || q.ar || '%' or
      p.phone like '%' || q.raw || '%'
    )
    and (p_branch is null or c.branch_id = p_branch)
    and (public.is_super_admin() or public.has_permission('children.view'))
    and (p_branch is null or public.can_access_branch(p_branch))
  order by (c.status = 'active') desc, c.full_name_en
  limit greatest(1, least(p_limit, 100))
$$;

-- duplicate detection helper (same name + dob, or same qr)
create or replace function public.find_duplicate_child(p_name_en text, p_dob date, p_phone text default null)
returns table (id uuid, child_code text, full_name_en text, match_reason text)
language sql stable security definer set search_path = public as $$
  select c.id, c.child_code, c.full_name_en, 'name_and_dob'::text
  from public.children c
  where lower(c.full_name_en) = lower(p_name_en) and c.date_of_birth = p_dob
  union all
  select c.id, c.child_code, c.full_name_en, 'guardian_phone'::text
  from public.children c
  join public.child_guardians cg on cg.child_id = c.id
  join public.parents p on p.id = cg.parent_id
  where p_phone is not null and p.phone = p_phone and lower(c.full_name_en) = lower(p_name_en)
  limit 5
$$;
