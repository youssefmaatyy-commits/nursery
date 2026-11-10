-- 0003_operations.sql
-- Services, pricing engine, packages, kids-area sessions, classrooms, nursery,
-- attendance, daily reports, holidays, events, activities.

create type service_type_t as enum ('kids_area','nursery','product','other');
create type pricing_rule_type_t as enum ('hourly','half_hour','per_minute','fixed_ticket','day_pass','package','additional_time');
create type session_status_t as enum ('active','closed','cancelled');
create type package_type_t as enum ('time','sessions','day_pass','family');
create type subscription_status_t as enum ('pending','active','suspended','cancelled','expired');
create type enrollment_plan_t as enum ('daily','weekly','monthly','custom');
create type attendance_status_t as enum ('present','absent','late','early_leave','holiday');

create sequence public.invoice_seq start 1001;

-- ------------------------------------------------------------ services & pricing
create table public.services (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id),
  code text not null,
  name_en text not null,
  name_ar text not null,
  service_type service_type_t not null default 'kids_area',
  unit text not null default 'hour' check (unit in ('minute','half_hour','hour','session','day','month','item')),
  base_price numeric(12,2) not null default 0 check (base_price >= 0),
  tax_rate numeric(5,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (code)
);
create trigger trg_services_updated before update on public.services
for each row execute function public.set_updated_at();

create table public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id),
  service_id uuid not null references public.services(id) on delete cascade,
  name_en text not null,
  name_ar text not null,
  rule_type pricing_rule_type_t not null default 'hourly',
  price numeric(12,2) not null default 0 check (price >= 0),          -- price per billing unit
  base_price numeric(12,2) not null default 0 check (base_price >= 0), -- charge for the included block
  unit_minutes int not null default 60 check (unit_minutes > 0),
  included_minutes int not null default 0 check (included_minutes >= 0),
  min_charge numeric(12,2) not null default 0 check (min_charge >= 0),
  grace_minutes int not null default 0 check (grace_minutes >= 0),
  rounding_minutes int not null default 1 check (rounding_minutes > 0),
  additional_unit_price numeric(12,2) not null default 0 check (additional_unit_price >= 0),
  days_of_week int[] default null,     -- 0=Sunday .. 6=Saturday, null = all days
  start_time time,
  end_time time,
  valid_from date,
  valid_to date,
  priority int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_pricing_rules_service on public.pricing_rules(service_id, is_active);
create trigger trg_pricing_rules_updated before update on public.pricing_rules
for each row execute function public.set_updated_at();

create table public.packages (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  code text not null,
  name_en text not null,
  name_ar text not null,
  package_type package_type_t not null default 'time',
  hours_included numeric(8,2) not null default 0 check (hours_included >= 0),
  sessions_included int not null default 0 check (sessions_included >= 0),
  validity_days int not null default 30 check (validity_days > 0),
  price numeric(12,2) not null check (price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (branch_id, code)
);

-- ------------------------------------------------------------ kids area
create table public.kids_area_sessions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  child_id uuid not null references public.children(id),
  service_id uuid references public.services(id),
  pricing_rule_id uuid references public.pricing_rules(id),
  subscription_id uuid,
  status session_status_t not null default 'active',
  checkin_at timestamptz not null default now(),
  checkout_at timestamptz,
  billable_minutes int,
  unit_price numeric(12,2),
  amount numeric(12,2) not null default 0 check (amount >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  pricing_breakdown jsonb,
  checked_in_by uuid references public.profiles(id),
  checked_out_by uuid references public.profiles(id),
  picked_up_by_name text,
  picked_up_by_relation text,
  picked_up_by_id_verified boolean not null default false,
  notes text,
  invoice_id uuid,
  created_at timestamptz not null default now()
);
create index idx_sessions_active on public.kids_area_sessions(child_id) where status = 'active';
create index idx_sessions_branch_date on public.kids_area_sessions(branch_id, checkin_at desc);
create unique index uq_active_session_per_child on public.kids_area_sessions(child_id)
  where status = 'active';

-- ------------------------------------------------------------ subscriptions
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  child_id uuid not null references public.children(id),
  package_id uuid not null references public.packages(id),
  start_date date not null default current_date,
  end_date date not null,
  status subscription_status_t not null default 'active',
  total_price numeric(12,2) not null check (total_price >= 0),
  paid_amount numeric(12,2) not null default 0 check (paid_amount >= 0),
  sessions_total int not null default 0,
  sessions_used int not null default 0 check (sessions_used >= 0),
  minutes_total int not null default 0,
  minutes_used int not null default 0 check (minutes_used >= 0),
  auto_renew boolean not null default false,
  cancelled_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (sessions_used <= sessions_total or sessions_total = 0)
);
create index idx_subscriptions_child on public.subscriptions(child_id, status);
create index idx_subscriptions_branch on public.subscriptions(branch_id, status);
create trigger trg_subscriptions_updated before update on public.subscriptions
for each row execute function public.set_updated_at();

alter table public.kids_area_sessions
  add constraint fk_sessions_subscription foreign key (subscription_id)
  references public.subscriptions(id) on delete set null;

create table public.subscription_usage (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  child_id uuid not null references public.children(id),
  session_id uuid references public.kids_area_sessions(id) on delete set null,
  used_at timestamptz not null default now(),
  usage_type text not null default 'session' check (usage_type in ('session','time')),
  minutes int not null default 0 check (minutes >= 0),
  created_at timestamptz not null default now()
);
create index idx_subscription_usage_sub on public.subscription_usage(subscription_id);

-- ------------------------------------------------------------ nursery / classrooms
create table public.classrooms (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  name_en text not null,
  name_ar text not null,
  age_min_months int not null default 0,
  age_max_months int not null default 72,
  capacity int not null default 20 check (capacity > 0),
  monthly_fee numeric(12,2) not null default 0 check (monthly_fee >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, name_en)
);
create trigger trg_classrooms_updated before update on public.classrooms
for each row execute function public.set_updated_at();

create table public.classroom_teachers (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  role text not null default 'assistant' check (role in ('lead','assistant')),
  created_at timestamptz not null default now(),
  unique (classroom_id, employee_id)
);

create table public.classroom_children (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  assigned_at date not null default current_date,
  ended_at date,
  created_at timestamptz not null default now()
);
create unique index uq_child_active_classroom on public.classroom_children(child_id) where ended_at is null;

create table public.nursery_enrollments (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  child_id uuid not null references public.children(id),
  classroom_id uuid references public.classrooms(id),
  plan_type enrollment_plan_t not null default 'monthly',
  fee_amount numeric(12,2) not null check (fee_amount >= 0),
  enrollment_fee numeric(12,2) not null default 0 check (enrollment_fee >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  start_date date not null default current_date,
  end_date date,
  billing_day int not null default 1 check (billing_day between 1 and 28),
  status record_status_t not null default 'active',
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index idx_enrollments_child on public.nursery_enrollments(child_id, status);
create trigger trg_enrollments_updated before update on public.nursery_enrollments
for each row execute function public.set_updated_at();

create table public.nursery_attendance (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  child_id uuid not null references public.children(id),
  enrollment_id uuid references public.nursery_enrollments(id) on delete set null,
  classroom_id uuid references public.classrooms(id),
  attendance_date date not null default current_date,
  check_in_at timestamptz,
  check_out_at timestamptz,
  status attendance_status_t not null default 'present',
  late_minutes int not null default 0,
  early_leave_minutes int not null default 0,
  notes text,
  checked_in_by uuid references public.profiles(id),
  checked_out_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (child_id, attendance_date)
);
create index idx_nursery_attendance_date on public.nursery_attendance(branch_id, attendance_date desc);

create table public.daily_child_reports (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  child_id uuid not null references public.children(id),
  classroom_id uuid references public.classrooms(id),
  report_date date not null default current_date,
  meals jsonb not null default '[]'::jsonb,
  sleep jsonb not null default '[]'::jsonb,
  activities jsonb not null default '[]'::jsonb,
  mood text,
  behavior text,
  learning_progress text,
  health_observations text,
  incidents text,
  teacher_comments text,
  teacher_id uuid references public.employees(id),
  visible_to_parent boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (child_id, report_date)
);
create trigger trg_daily_reports_updated before update on public.daily_child_reports
for each row execute function public.set_updated_at();

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id),
  name_en text not null,
  name_ar text not null,
  holiday_date date not null,
  applies_to text not null default 'all' check (applies_to in ('all','nursery','kids_area')),
  is_paid boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  classroom_id uuid references public.classrooms(id),
  title_en text not null,
  title_ar text not null,
  description text,
  activity_date date not null default current_date,
  start_time time,
  end_time time,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  title_en text not null,
  title_ar text not null,
  description text,
  event_date date not null,
  start_time time,
  end_time time,
  location text,
  is_public boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
