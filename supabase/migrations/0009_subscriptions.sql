-- 0009_dashboard_reports_subscriptions.sql
-- Dashboard aggregates, reporting RPCs, subscription lifecycle.

-- ------------------------------------------------------------ subscriptions
create or replace function public.create_subscription(
  p_child uuid,
  p_package uuid,
  p_start date default current_date,
  p_discount numeric default 0,
  p_create_invoice boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pkg public.packages; v_child public.children; v_sub public.subscriptions;
        v_total numeric; v_inv jsonb;
begin
  if not public.has_permission('subscriptions.manage') then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_child from public.children where id = p_child;
  if v_child.id is null then raise exception 'child_not_found'; end if;
  if not public.can_access_branch(v_child.branch_id) then raise exception 'branch_forbidden' using errcode='42501'; end if;
  select * into v_pkg from public.packages where id = p_package and is_active;
  if v_pkg.id is null then raise exception 'package_not_found'; end if;
  if coalesce(p_discount,0) < 0 or coalesce(p_discount,0) > v_pkg.price then raise exception 'invalid_discount'; end if;

  v_total := round(v_pkg.price - coalesce(p_discount,0), 2);

  insert into public.subscriptions (branch_id, child_id, package_id, start_date, end_date, status,
      total_price, sessions_total, minutes_total, created_by)
  values (v_child.branch_id, p_child, p_package, coalesce(p_start, current_date),
      coalesce(p_start, current_date) + v_pkg.validity_days - 1, 'active', v_total,
      v_pkg.sessions_included, (v_pkg.hours_included * 60)::int, auth.uid())
  returning * into v_sub;

  if p_create_invoice and v_total > 0 then
    v_inv := public.create_invoice(
      v_child.branch_id,
      jsonb_build_array(jsonb_build_object(
        'description_en', v_pkg.name_en, 'description_ar', v_pkg.name_ar,
        'quantity', 1, 'unit_price', v_pkg.price, 'discount', coalesce(p_discount,0),
        'tax_rate', 0)),
      p_child, null, null, 0, 'subscription', v_sub.id, null, 'Subscription ' || v_sub.id);
  end if;

  return jsonb_build_object('subscription_id', v_sub.id, 'end_date', v_sub.end_date,
    'total_price', v_sub.total_price, 'invoice', v_inv);
end $$;

create or replace function public.renew_subscription(p_subscription uuid, p_create_invoice boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s public.subscriptions; v_pkg public.packages; v_new public.subscriptions; v_inv jsonb; v_start date;
begin
  if not public.has_permission('subscriptions.manage') then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_s from public.subscriptions where id = p_subscription;
  if v_s.id is null then raise exception 'subscription_not_found'; end if;
  if not public.can_access_branch(v_s.branch_id) then raise exception 'branch_forbidden' using errcode='42501'; end if;
  select * into v_pkg from public.packages where id = v_s.package_id;

  v_start := greatest(v_s.end_date + 1, current_date);

  insert into public.subscriptions (branch_id, child_id, package_id, start_date, end_date, status,
      total_price, sessions_total, minutes_total, created_by)
  values (v_s.branch_id, v_s.child_id, v_s.package_id, v_start, v_start + v_pkg.validity_days - 1, 'active',
      v_pkg.price, v_pkg.sessions_included, (v_pkg.hours_included * 60)::int, auth.uid())
  returning * into v_new;

  update public.subscriptions set auto_renew = true where id = v_s.id;

  if p_create_invoice and v_new.total_price > 0 then
    v_inv := public.create_invoice(v_new.branch_id,
      jsonb_build_array(jsonb_build_object('description_en', v_pkg.name_en || ' (renewal)',
        'description_ar', v_pkg.name_ar || ' (تجديد)', 'quantity', 1, 'unit_price', v_pkg.price, 'tax_rate', 0)),
      v_new.child_id, null, null, 0, 'subscription', v_new.id, null, 'Renewal ' || v_new.id);
  end if;

  return jsonb_build_object('subscription_id', v_new.id, 'start_date', v_new.start_date,
    'end_date', v_new.end_date, 'invoice', v_inv);
end $$;

create or replace function public.set_subscription_status(p_subscription uuid, p_status subscription_status_t, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s public.subscriptions;
begin
  if not public.has_permission('subscriptions.manage') then raise exception 'forbidden' using errcode='42501'; end if;
  update public.subscriptions set status = p_status, cancelled_reason = coalesce(p_reason, cancelled_reason)
    where id = p_subscription returning * into v_s;
  if v_s.id is null then raise exception 'subscription_not_found'; end if;
  return jsonb_build_object('id', v_s.id, 'status', v_s.status);
end $$;

-- expire + notify (callable by cron / admin)
create or replace function public.run_expiry_jobs() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_expired int := 0; v_notified int := 0;
begin
  update public.subscriptions set status = 'expired' where status = 'active' and end_date < current_date;
  get diagnostics v_expired = row_count;

  insert into public.notifications (user_id, branch_id, type, title_en, title_ar, body_en, body_ar, severity, entity_type, entity_id)
  select p.id, s.branch_id, 'subscription_expiring', 'Subscription expiring soon', 'اشتراك ينتهي قريباً',
         'Subscription for child ' || c.full_name_en || ' expires on ' || s.end_date,
         'اشتراك الطفل ' || c.full_name_ar || ' ينتهي في ' || s.end_date,
         'warning', 'subscription', s.id
  from public.subscriptions s
  join public.children c on c.id = s.child_id
  join public.user_roles ur on ur.branch_id = s.branch_id
  join public.roles r on r.id = ur.role_id and r.code in ('super_admin','branch_manager','receptionist')
  join public.profiles p on p.id = ur.user_id
  where s.status = 'active' and s.end_date between current_date and current_date + 7
    and not exists (select 1 from public.notifications n
                    where n.entity_id = s.id and n.type = 'subscription_expiring'
                      and n.created_at > now() - interval '3 days');
  get diagnostics v_notified = row_count;

  insert into public.notifications (user_id, branch_id, type, title_en, title_ar, body_en, body_ar, severity, entity_type, entity_id)
  select ur.user_id, pr.branch_id, 'low_stock', 'Low stock', 'مخزون منخفض',
         pr.name_en || ' is at ' || pr.stock_qty || ' (min ' || pr.min_stock || ')',
         pr.name_ar || ' الكمية ' || pr.stock_qty || ' (الحد الأدنى ' || pr.min_stock || ')',
         'warning', 'product', pr.id
  from public.products pr
  join public.user_roles ur on ur.branch_id = pr.branch_id
  join public.roles r on r.id = ur.role_id and r.code in ('super_admin','inventory_manager','branch_manager')
  where pr.is_active and pr.stock_qty <= pr.min_stock
    and not exists (select 1 from public.notifications n
                    where n.entity_id = pr.id and n.type = 'low_stock' and n.created_at > now() - interval '1 day');

  return jsonb_build_object('expired', v_expired, 'notified', v_notified, 'ran_at', now());
end $$;

