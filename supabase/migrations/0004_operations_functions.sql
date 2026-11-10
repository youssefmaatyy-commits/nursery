-- ------------------------------------------------------------ pricing engine
create or replace function public.ceil_to(p_value numeric, p_step numeric) returns numeric
language sql immutable as $$
  select case when p_step is null or p_step <= 0 then p_value
              else ceil(p_value / p_step) * p_step end
$$;

-- Resolve the applicable pricing rule for a service at a point in time.
create or replace function public.resolve_pricing_rule(p_service uuid, p_at timestamptz default now())
returns public.pricing_rules language sql stable security definer set search_path = public as $$
  select pr from public.pricing_rules pr
  where pr.service_id = p_service and pr.is_active
    and (pr.valid_from is null or pr.valid_from <= (p_at at time zone 'Africa/Cairo')::date)
    and (pr.valid_to is null or pr.valid_to >= (p_at at time zone 'Africa/Cairo')::date)
    and (pr.days_of_week is null or extract(dow from (p_at at time zone 'Africa/Cairo'))::int = any(pr.days_of_week))
    and (pr.start_time is null or (p_at at time zone 'Africa/Cairo')::time >= pr.start_time)
    and (pr.end_time is null or (p_at at time zone 'Africa/Cairo')::time < pr.end_time)
  order by pr.priority asc, pr.created_at asc
  limit 1
$$;

-- Core billing calculation. All money math is server-side and deterministic.
create or replace function public.compute_charge(p_rule public.pricing_rules, p_minutes int)
returns table (billable_minutes int, units int, unit_minutes int, unit_price numeric,
               base_amount numeric, extra_amount numeric, amount numeric, breakdown jsonb)
language plpgsql immutable as $$
declare
  v_billable int;
  v_units int;
  v_extra_minutes int;
  v_base numeric;
  v_extra numeric;
  v_amount numeric;
  v_included numeric;
begin
  v_included := coalesce(p_rule.included_minutes, 0);
  if p_rule.rule_type in ('fixed_ticket','day_pass','package') then
    return query select greatest(0,p_minutes), 1, coalesce(p_rule.unit_minutes,60),
      p_rule.price, p_rule.base_price, 0::numeric,
      greatest(coalesce(p_rule.base_price,0), coalesce(p_rule.min_charge,0)),
      jsonb_build_object('type', p_rule.rule_type, 'flat', true);
    return;
  end if;

  v_billable := greatest(0, coalesce(p_minutes,0) - coalesce(p_rule.grace_minutes,0));

  if v_included > 0 then
    v_extra_minutes := greatest(0, v_billable - v_included::int);
    v_base := coalesce(p_rule.base_price,0);
    v_units := ceil(v_extra_minutes::numeric / greatest(1, coalesce(p_rule.rounding_minutes,1)) );
    v_extra := ceil(v_extra_minutes::numeric / greatest(1, coalesce(p_rule.unit_minutes,60)))
               * coalesce(p_rule.price,0);
  else
    v_base := 0;
    v_units := ceil(v_billable::numeric / greatest(1, coalesce(p_rule.unit_minutes,60)));
    v_extra := v_units * coalesce(p_rule.price,0);
  end if;

  v_amount := greatest(coalesce(p_rule.min_charge,0), v_base + v_extra);

  return query select v_billable, v_units, coalesce(p_rule.unit_minutes,60), coalesce(p_rule.price,0),
    v_base, v_extra, round(v_amount, 2),
    jsonb_build_object(
      'rule_id', p_rule.id, 'rule_name_en', p_rule.name_en, 'rule_name_ar', p_rule.name_ar,
      'minutes', coalesce(p_minutes,0), 'grace', p_rule.grace_minutes, 'billable', v_billable,
      'included_minutes', v_included, 'unit_minutes', p_rule.unit_minutes,
      'units', v_units, 'unit_price', p_rule.price, 'base', v_base, 'extra', v_extra,
      'min_charge', p_rule.min_charge, 'rounding_minutes', p_rule.rounding_minutes);
end $$;

create or replace function public.quote_kids_area(p_service uuid, p_minutes int, p_at timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.pricing_rules; res record;
begin
  r := public.resolve_pricing_rule(p_service, p_at);
  if r.id is null then
    return jsonb_build_object('error','no_pricing_rule','service_id',p_service);
  end if;
  select * into res from public.compute_charge(r, p_minutes);
  return res.breakdown || jsonb_build_object('amount', res.amount, 'billable_minutes', res.billable_minutes);
end $$;

-- ------------------------------------------------------------ check-in / check-out core
create or replace function public.check_in_child(
  p_child uuid,
  p_service text default 'kids_area',
  p_branch uuid default null,
  p_staff uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_child public.children;
  v_branch uuid;
  v_service public.services;
  v_rule public.pricing_rules;
  v_session public.kids_area_sessions;
  v_enrollment public.nursery_enrollments;
  v_att record;
  v_staff uuid := coalesce(p_staff, auth.uid());
  v_has_open boolean;
begin
  if not (public.has_permission('operations.checkin') or public.has_permission('kids_area.operate') or public.has_permission('nursery.operate')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_child from public.children where id = p_child;
  if v_child.id is null then raise exception 'child_not_found'; end if;
  if v_child.status <> 'active' then raise exception 'child_inactive'; end if;
  v_branch := coalesce(p_branch, v_child.branch_id);
  if not public.can_access_branch(v_branch) then raise exception 'branch_forbidden' using errcode='42501'; end if;

  if p_service = 'kids_area' then
    select exists(select 1 from public.kids_area_sessions where child_id = p_child and status = 'active') into v_has_open;
    if v_has_open then raise exception 'already_checked_in'; end if;

    select * into v_service from public.services
      where service_type = 'kids_area' and is_active and (branch_id is null or branch_id = v_branch)
      order by (branch_id is not null) desc limit 1;
    if v_service.id is not null then
      v_rule := public.resolve_pricing_rule(v_service.id, now());
    end if;

    insert into public.kids_area_sessions (branch_id, child_id, service_id, pricing_rule_id, status, checkin_at, checked_in_by)
    values (v_branch, p_child, v_service.id, v_rule.id, 'active', now(), v_staff)
    returning * into v_session;

    insert into public.notifications(user_id, branch_id, type, title_en, title_ar, body_en, body_ar, severity, entity_type, entity_id)
    select pp.profile_id, v_branch, 'child_checkin', 'Child checked in', 'تم تسجيل دخول الطفل',
           v_child.full_name_en || ' checked in at ' || to_char(now() at time zone 'Africa/Cairo','HH24:MI'),
           v_child.full_name_ar || ' تم تسجيل الدخول ' || to_char(now() at time zone 'Africa/Cairo','HH24:MI'),
           'info', 'kids_area_session', v_session.id
    from public.child_guardians cg join public.parents pp on pp.id = cg.parent_id
    where cg.child_id = p_child and pp.profile_id is not null;

    return jsonb_build_object('mode','kids_area','session_id',v_session.id,'checkin_at',v_session.checkin_at,
      'child_code', v_child.child_code, 'service_id', v_service.id, 'rule_id', v_rule.id);
  else
    select * into v_enrollment from public.nursery_enrollments
      where child_id = p_child and status = 'active' and branch_id = v_branch
        and (end_date is null or end_date >= current_date)
      order by start_date desc limit 1;

    insert into public.nursery_attendance (branch_id, child_id, enrollment_id, classroom_id, attendance_date,
        check_in_at, status, checked_in_by)
    values (v_branch, p_child, v_enrollment.id,
        (select cc.classroom_id from public.classroom_children cc where cc.child_id = p_child and cc.ended_at is null limit 1),
        current_date, now(), 'present', v_staff)
    on conflict (child_id, attendance_date) do update
      set check_in_at = coalesce(public.nursery_attendance.check_in_at, now()), checked_in_by = v_staff
    returning * into v_att;

    return jsonb_build_object('mode','nursery','attendance_id',v_att.id,'attendance_date',v_att.attendance_date,
      'child_code', v_child.child_code, 'enrollment_id', v_enrollment.id);
  end if;
end $$;

create or replace function public.mark_absence(p_child uuid, p_date date, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_branch uuid; v_row record;
begin
  if not (public.has_permission('nursery.operate') or public.is_parent_of(p_child)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select branch_id into v_branch from public.children where id = p_child;
  insert into public.nursery_attendance (branch_id, child_id, attendance_date, status, notes)
  values (v_branch, p_child, p_date, 'absent', p_reason)
  on conflict (child_id, attendance_date) do update
    set status = 'absent', notes = coalesce(p_reason, public.nursery_attendance.notes)
  returning * into v_row;
  return jsonb_build_object('attendance_id', v_row.id, 'status', v_row.status);
end $$;

create or replace function public.check_out_nursery(p_child uuid, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row record;
begin
  if not (public.has_permission('operations.checkout') or public.has_permission('nursery.operate') or public.has_permission('operations.checkin')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.nursery_attendance
    set check_out_at = now(), checked_out_by = auth.uid(), notes = coalesce(p_notes, notes)
    where child_id = p_child and attendance_date = current_date and check_out_at is null
    returning * into v_row;
  if v_row.id is null then raise exception 'no_open_attendance'; end if;
  return jsonb_build_object('attendance_id', v_row.id, 'check_out_at', v_row.check_out_at);
end $$;

-- live board: who is inside right now
create or replace function public.children_inside(p_branch uuid default null)
returns table (child_id uuid, child_code text, full_name_en text, full_name_ar text, photo_url text,
               mode text, started_at timestamptz, session_id uuid, minutes_inside int)
language sql stable security definer set search_path = public as $$
  select s.child_id, c.child_code, c.full_name_en, c.full_name_ar, c.photo_url,
         'kids_area'::text, s.checkin_at, s.id,
         extract(epoch from (now() - s.checkin_at))/60::int
  from public.kids_area_sessions s join public.children c on c.id = s.child_id
  where s.status = 'active' and (p_branch is null or s.branch_id = p_branch)
    and (public.has_permission('operations.view') or public.has_permission('kids_area.operate'))
  union all
  select a.child_id, c.child_code, c.full_name_en, c.full_name_ar, c.photo_url,
         'nursery'::text, a.check_in_at, a.id,
         extract(epoch from (now() - a.check_in_at))/60::int
  from public.nursery_attendance a join public.children c on c.id = a.child_id
  where a.attendance_date = current_date and a.check_in_at is not null and a.check_out_at is null
    and (p_branch is null or a.branch_id = p_branch)
    and (public.has_permission('operations.view') or public.has_permission('nursery.operate'))
  order by 7
$$;
