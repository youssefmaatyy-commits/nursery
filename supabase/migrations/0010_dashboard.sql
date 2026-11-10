-- ------------------------------------------------------------ dashboard
create or replace function public.dashboard_metrics(
  p_branch uuid default null,
  p_from date default current_date,
  p_to date default current_date
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_branch uuid := p_branch;
  v_total_children int; v_inside int; v_attendance_today int; v_sessions_active int;
  v_nursery_present int; v_revenue_today numeric; v_revenue_month numeric; v_outstanding numeric;
  v_active_subs int; v_expiring_subs int; v_expenses_today numeric; v_shift jsonb; v_recent jsonb;
begin
  if v_branch is null then select id into v_branch from public.branches where is_active order by code limit 1; end if;
  if not public.can_access_branch(v_branch) then raise exception 'branch_forbidden' using errcode='42501'; end if;

  select count(*) into v_total_children from public.children where branch_id = v_branch and status = 'active';
  select count(*) into v_sessions_active from public.kids_area_sessions
    where branch_id = v_branch and status = 'active';
  select count(*) into v_nursery_present from public.nursery_attendance
    where branch_id = v_branch and attendance_date = current_date and check_in_at is not null;
  v_inside := v_sessions_active + v_nursery_present;
  select count(*) into v_attendance_today from public.nursery_attendance
    where branch_id = v_branch and attendance_date = current_date and status in ('present','late');

  select coalesce(sum(amount),0) into v_revenue_today from public.payments
    where branch_id = v_branch and status = 'completed'
      and (paid_at at time zone 'Africa/Cairo')::date = current_date;
  select coalesce(sum(amount),0) into v_revenue_month from public.payments
    where branch_id = v_branch and status = 'completed'
      and date_trunc('month', (paid_at at time zone 'Africa/Cairo')) = date_trunc('month', now() at time zone 'Africa/Cairo');
  select coalesce(sum(balance),0) into v_outstanding from public.invoices
    where branch_id = v_branch and status in ('issued','partially_paid');
  select count(*) into v_active_subs from public.subscriptions
    where branch_id = v_branch and status = 'active' and end_date >= current_date;
  select count(*) into v_expiring_subs from public.subscriptions
    where branch_id = v_branch and status = 'active' and end_date between current_date and current_date + 7;
  select coalesce(sum(amount),0) into v_expenses_today from public.expenses
    where branch_id = v_branch and expense_date = current_date;

  select to_jsonb(s.*) into v_shift from public.cash_shifts s
    where s.branch_id = v_branch and s.status = 'open' order by s.opened_at desc limit 1;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_recent from (
    select i.id, i.invoice_number, i.total, i.paid_amount, i.status, i.issued_at,
           coalesce(c.full_name_en, i.customer_name, 'Walk-in') as customer
    from public.invoices i left join public.children c on c.id = i.child_id
    where i.branch_id = v_branch order by i.issued_at desc limit 8
  ) t;

  return jsonb_build_object(
    'branch_id', v_branch,
    'total_children', v_total_children,
    'children_inside', v_inside,
    'kids_area_active_sessions', v_sessions_active,
    'nursery_present_today', v_nursery_present,
    'attendance_today', v_attendance_today,
    'revenue_today', round(v_revenue_today, 2),
    'revenue_month', round(v_revenue_month, 2),
    'outstanding_balance', round(v_outstanding, 2),
    'active_subscriptions', v_active_subs,
    'expiring_subscriptions', v_expiring_subs,
    'expenses_today', round(v_expenses_today, 2),
    'net_today', round(v_revenue_today - v_expenses_today, 2),
    'cash_shift', v_shift,
    'recent_invoices', v_recent,
    'generated_at', now());
end $$;

-- ------------------------------------------------------------ reports
create or replace function public.report_revenue(
  p_branch uuid, p_from date, p_to date, p_group_by text default 'day'
) returns table (period text, payments_count bigint, gross numeric, refunds numeric, net numeric)
language sql stable security definer set search_path = public as $$
  with pay as (
    select case when p_group_by = 'month' then to_char(paid_at at time zone 'Africa/Cairo','YYYY-MM')
                else to_char(paid_at at time zone 'Africa/Cairo','YYYY-MM-DD') end as period,
           count(*) as cnt, sum(amount) as amt
    from public.payments
    where branch_id = p_branch and status = 'completed'
      and (paid_at at time zone 'Africa/Cairo')::date between p_from and p_to
      and (public.has_permission('finance.view') or public.is_super_admin())
    group by 1
  ), ref as (
    select case when p_group_by = 'month' then to_char(created_at at time zone 'Africa/Cairo','YYYY-MM')
                else to_char(created_at at time zone 'Africa/Cairo','YYYY-MM-DD') end as period,
           sum(amount) as amt
    from public.refunds
    where branch_id = p_branch and (created_at at time zone 'Africa/Cairo')::date between p_from and p_to
    group by 1
  )
  select coalesce(pay.period, ref.period), coalesce(pay.cnt,0), coalesce(pay.amt,0),
         coalesce(ref.amt,0), coalesce(pay.amt,0) - coalesce(ref.amt,0)
  from pay full outer join ref on pay.period = ref.period
  order by 1
$$;

create or replace function public.report_attendance(
  p_branch uuid, p_from date, p_to date
) returns table (attendance_date date, present bigint, absent bigint, checked_out bigint)
language sql stable security definer set search_path = public as $$
  select a.attendance_date,
         count(*) filter (where a.status in ('present','late')) as present,
         count(*) filter (where a.status = 'absent') as absent,
         count(*) filter (where a.check_out_at is not null) as checked_out
  from public.nursery_attendance a
  where a.branch_id = p_branch and a.attendance_date between p_from and p_to
    and (public.has_permission('operations.view') or public.is_super_admin())
  group by 1 order by 1
$$;

create or replace function public.report_outstanding(p_branch uuid)
returns table (invoice_id uuid, invoice_number text, child_name text, total numeric, paid_amount numeric,
               balance numeric, issued_at timestamptz, days_overdue int)
language sql stable security definer set search_path = public as $$
  select i.id, i.invoice_number, coalesce(c.full_name_en, i.customer_name, 'Walk-in'),
         i.total, i.paid_amount, i.balance, i.issued_at,
         greatest(0, (current_date - (i.issued_at at time zone 'Africa/Cairo')::date))::int
  from public.invoices i left join public.children c on c.id = i.child_id
  where i.branch_id = p_branch and i.status in ('issued','partially_paid')
    and (public.has_permission('finance.view') or public.is_super_admin())
  order by i.issued_at
$$;

create or replace function public.report_profit_loss(p_branch uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  with rev as (
    select coalesce(sum(amount),0) as gross from public.payments
    where branch_id = p_branch and status = 'completed' and (paid_at at time zone 'Africa/Cairo')::date between p_from and p_to
  ), ref as (
    select coalesce(sum(amount),0) as amount from public.refunds
    where branch_id = p_branch and (created_at at time zone 'Africa/Cairo')::date between p_from and p_to
  ), exp as (
    select coalesce(sum(amount),0) as amount from public.expenses
    where branch_id = p_branch and expense_date between p_from and p_to
  ), by_cat as (
    select jsonb_object_agg(t.name_en, t.total) as cats from (
      select ec.name_en, sum(e.amount) as total from public.expenses e
      join public.expense_categories ec on ec.id = e.category_id
      where e.branch_id = p_branch and e.expense_date between p_from and p_to
      group by 1) t
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'gross_revenue', round((select gross from rev),2),
    'refunds', round((select amount from ref),2),
    'net_revenue', round((select gross from rev) - (select amount from ref),2),
    'expenses', round((select amount from exp),2),
    'profit', round((select gross from rev) - (select amount from ref) - (select amount from exp),2),
    'expenses_by_category', coalesce((select cats from by_cat), '{}'::jsonb))
  where (public.has_permission('finance.view') or public.is_super_admin())
$$;

create or replace function public.report_kids_area_sessions(p_branch uuid, p_from date, p_to date)
returns table (child_name text, sessions bigint, total_minutes bigint, billed numeric, avg_minutes numeric)
language sql stable security definer set search_path = public as $$
  select c.full_name_en, count(*), coalesce(sum(s.billable_minutes),0)::bigint,
         coalesce(sum(s.total),0), round(coalesce(avg(s.billable_minutes),0),1)
  from public.kids_area_sessions s join public.children c on c.id = s.child_id
  where s.branch_id = p_branch and s.status = 'closed'
    and (s.checkin_at at time zone 'Africa/Cairo')::date between p_from and p_to
    and (public.has_permission('operations.view') or public.is_super_admin())
  group by c.full_name_en order by 3 desc
$$;

create or replace function public.report_inventory(p_branch uuid)
returns table (sku text, name_en text, name_ar text, stock_qty numeric, min_stock numeric,
               stock_value numeric, is_low boolean)
language sql stable security definer set search_path = public as $$
  select p.sku, p.name_en, p.name_ar, p.stock_qty, p.min_stock,
         round(p.stock_qty * p.cost_price, 2), p.stock_qty <= p.min_stock
  from public.products p
  where p.branch_id = p_branch and p.is_active
    and (public.has_permission('inventory.view') or public.is_super_admin())
  order by p.name_en
$$;

create or replace function public.report_cash_shifts(p_branch uuid, p_from date, p_to date)
returns table (shift_id uuid, opened_at timestamptz, closed_at timestamptz, opening_float numeric,
               expected_cash numeric, counted_cash numeric, difference numeric, status shift_status_t)
language sql stable security definer set search_path = public as $$
  select s.id, s.opened_at, s.closed_at, s.opening_float, s.expected_cash, s.counted_cash, s.difference, s.status
  from public.cash_shifts s
  where s.branch_id = p_branch and (s.opened_at at time zone 'Africa/Cairo')::date between p_from and p_to
    and (public.has_permission('cash.view') or public.is_super_admin())
  order by s.opened_at desc
$$;

-- ------------------------------------------------------------ sync endpoint
create or replace function public.apply_sync_operation(p_client_op_id text, p_operation_type text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_existing public.sync_operations; v_new public.sync_operations; v_result jsonb;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_existing from public.sync_operations where client_op_id = p_client_op_id;
  if v_existing.id is not null then
    return jsonb_build_object('status', v_existing.status, 'result', v_existing.result, 'replay', true);
  end if;

  insert into public.sync_operations (client_op_id, user_id, operation_type, payload, status)
  values (p_client_op_id, auth.uid(), p_operation_type, p_payload, 'pending') returning * into v_new;

  begin
    if p_operation_type = 'check_in' then
      v_result := public.check_in_child((p_payload->>'child_id')::uuid, coalesce(p_payload->>'service','kids_area'),
        nullif(p_payload->>'branch_id','')::uuid, null);
    elsif p_operation_type = 'check_out' then
      v_result := public.close_kids_session((p_payload->>'session_id')::uuid,
        coalesce((p_payload->>'discount')::numeric,0), p_payload->>'pickup_name', p_payload->>'pickup_relation',
        coalesce((p_payload->>'id_verified')::boolean,false), true);
    elsif p_operation_type = 'payment' then
      v_result := public.record_payment((p_payload->>'invoice_id')::uuid, (p_payload->>'amount')::numeric,
        coalesce((p_payload->>'method')::payment_method_t,'cash'), p_payload->>'reference',
        p_client_op_id, null);
    else
      raise exception 'unsupported_operation';
    end if;
    update public.sync_operations set status = 'applied', result = v_result, applied_at = now() where id = v_new.id;
    return jsonb_build_object('status','applied','result',v_result);
  exception when others then
    update public.sync_operations set status = 'failed', error = sqlerrm where id = v_new.id;
    return jsonb_build_object('status','failed','error',sqlerrm);
  end;
end $$;
