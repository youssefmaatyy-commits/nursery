-- 0006_financial_functions.sql
-- Server-side money operations: invoices, payments, refunds, session billing,
-- cash shifts, purchasing, stock, dashboard metrics. All authorization is
-- enforced here (SECURITY DEFINER + explicit permission checks).

-- ------------------------------------------------------------ invoice builder
create or replace function public.create_invoice(
  p_branch uuid,
  p_items jsonb,
  p_child uuid default null,
  p_parent uuid default null,
  p_customer_name text default null,
  p_discount numeric default 0,
  p_source invoice_source_t default 'manual',
  p_source_id uuid default null,
  p_idempotency_key text default null,
  p_notes text default null,
  p_due_date date default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_inv public.invoices;
  v_item jsonb;
  v_sub numeric := 0;
  v_disc numeric := 0;
  v_tax numeric := 0;
  v_total numeric := 0;
  v_ls numeric;
  v_lt numeric;
  v_ltot numeric;
  v_existing public.invoices;
begin
  if not (public.has_permission('finance.create_invoice') or public.has_permission('pos.sell') or public.has_permission('operations.checkout')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not public.can_access_branch(p_branch) then raise exception 'branch_forbidden' using errcode = '42501'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_invoice';
  end if;
  if coalesce(p_discount,0) < 0 then raise exception 'invalid_discount'; end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.invoices where idempotency_key = p_idempotency_key;
    if v_existing.id is not null then
      return jsonb_build_object('id', v_existing.id, 'invoice_number', v_existing.invoice_number,
        'total', v_existing.total, 'idempotent_replay', true);
    end if;
  end if;

  insert into public.invoices (branch_id, child_id, parent_id, customer_name, status, source, source_id,
      discount_total, currency, notes, due_date, idempotency_key, created_by)
  values (p_branch, p_child, p_parent, p_customer_name, 'issued', p_source, p_source_id,
      round(coalesce(p_discount,0),2), coalesce((select currency from public.branches where id = p_branch),'EGP'),
      p_notes, p_due_date, p_idempotency_key, auth.uid())
  returning * into v_inv;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if coalesce((v_item->>'quantity')::numeric,0) <= 0 then raise exception 'invalid_quantity'; end if;
    if coalesce((v_item->>'unit_price')::numeric,0) < 0 then raise exception 'invalid_price'; end if;

    v_ls := round((v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric
                  - coalesce((v_item->>'discount')::numeric, 0), 2);
    v_ls := greatest(v_ls, 0);
    v_lt := round(v_ls * coalesce((v_item->>'tax_rate')::numeric, 0) / 100.0, 2);
    v_ltot := round(v_ls + v_lt, 2);

    insert into public.invoice_items (invoice_id, description_en, description_ar, service_id, product_id,
        quantity, unit_price, discount, tax_rate, line_subtotal, line_tax, line_total)
    values (v_inv.id,
        coalesce(v_item->>'description_en', 'Item'),
        coalesce(v_item->>'description_ar', coalesce(v_item->>'description_en', 'بند')),
        nullif(v_item->>'service_id','')::uuid,
        nullif(v_item->>'product_id','')::uuid,
        (v_item->>'quantity')::numeric,
        (v_item->>'unit_price')::numeric,
        coalesce((v_item->>'discount')::numeric,0),
        coalesce((v_item->>'tax_rate')::numeric,0),
        v_ls, v_lt, v_ltot);

    v_sub := v_sub + v_ls;
    v_tax := v_tax + v_lt;

    -- deduct stock for product lines
    if nullif(v_item->>'product_id','') is not null then
      perform public.apply_stock_movement(nullif(v_item->>'product_id','')::uuid, -1 * (v_item->>'quantity')::numeric,
        'sale', 'invoice', v_inv.id, 'POS sale ' || v_inv.invoice_number);
    end if;
  end loop;

  v_disc := round(least(coalesce(p_discount,0), v_sub), 2);
  v_total := round(greatest(v_sub - v_disc + v_tax, 0), 2);

  update public.invoices set subtotal = round(v_sub,2), discount_total = v_disc, tax_total = round(v_tax,2),
      total = v_total, status = case when v_total = 0 then 'paid'::invoice_status_t else 'issued'::invoice_status_t end
  where id = v_inv.id returning * into v_inv;

  return jsonb_build_object('id', v_inv.id, 'invoice_number', v_inv.invoice_number, 'subtotal', v_inv.subtotal,
    'discount_total', v_inv.discount_total, 'tax_total', v_inv.tax_total, 'total', v_inv.total,
    'balance', v_inv.balance, 'status', v_inv.status);
end $$;

-- ------------------------------------------------------------ payments
create or replace function public.record_payment(
  p_invoice uuid,
  p_amount numeric,
  p_method payment_method_t default 'cash',
  p_reference text default null,
  p_idempotency_key text default null,
  p_shift uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_inv public.invoices;
  v_pay public.payments;
  v_shift uuid := p_shift;
  v_new_paid numeric;
  v_existing public.payments;
begin
  if not (public.has_permission('finance.payment') or public.has_permission('pos.sell')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.payments where idempotency_key = p_idempotency_key;
    if v_existing.id is not null then
      return jsonb_build_object('id', v_existing.id, 'payment_number', v_existing.payment_number,
        'amount', v_existing.amount, 'idempotent_replay', true);
    end if;
  end if;

  select * into v_inv from public.invoices where id = p_invoice for update;
  if v_inv.id is null then raise exception 'invoice_not_found'; end if;
  if v_inv.status in ('void','refunded') then raise exception 'invoice_not_payable'; end if;
  if not public.can_access_branch(v_inv.branch_id) then raise exception 'branch_forbidden' using errcode='42501'; end if;
  if round(p_amount,2) > round(v_inv.balance, 2) then raise exception 'amount_exceeds_balance'; end if;

  if v_shift is null and p_method = 'cash' then
    select id into v_shift from public.cash_shifts
      where branch_id = v_inv.branch_id and status = 'open' order by opened_at desc limit 1;
  end if;

  insert into public.payments (branch_id, invoice_id, amount, method, status, reference, shift_id, received_by, idempotency_key)
  values (v_inv.branch_id, v_inv.id, round(p_amount,2), p_method, 'completed', p_reference, v_shift, auth.uid(), p_idempotency_key)
  returning * into v_pay;

  if v_shift is not null and p_method = 'cash' then
    insert into public.cash_movements(shift_id, branch_id, movement_type, amount, payment_id, description, created_by)
    values (v_shift, v_inv.branch_id, 'sale', round(p_amount,2), v_pay.id, 'Payment ' || v_pay.payment_number, auth.uid());
  end if;

  v_new_paid := round(v_inv.paid_amount + round(p_amount,2), 2);
  update public.invoices set paid_amount = v_new_paid,
    status = case when v_new_paid >= total then 'paid'::invoice_status_t else 'partially_paid'::invoice_status_t end
  where id = v_inv.id returning * into v_inv;

  -- propagate to subscriptions
  if v_inv.source = 'subscription' and v_inv.source_id is not null then
    update public.subscriptions set paid_amount = paid_amount + round(p_amount,2) where id = v_inv.source_id;
  end if;

  return jsonb_build_object('id', v_pay.id, 'payment_number', v_pay.payment_number, 'amount', v_pay.amount,
    'method', v_pay.method, 'invoice_balance', v_inv.balance, 'invoice_status', v_inv.status);
end $$;

create or replace function public.refund_payment(
  p_payment uuid,
  p_amount numeric,
  p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pay public.payments;
  v_inv public.invoices;
  v_ref public.refunds;
  v_already numeric;
  v_shift uuid;
begin
  if not public.has_permission('finance.refund') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'reason_required'; end if;

  select * into v_pay from public.payments where id = p_payment for update;
  if v_pay.id is null then raise exception 'payment_not_found'; end if;
  if v_pay.status <> 'completed' then raise exception 'payment_not_refundable'; end if;

  select coalesce(sum(amount),0) into v_already from public.refunds where payment_id = p_payment;
  if round(v_already + p_amount, 2) > round(v_pay.amount, 2) then raise exception 'refund_exceeds_payment'; end if;

  select * into v_inv from public.invoices where id = v_pay.invoice_id for update;

  select id into v_shift from public.cash_shifts where branch_id = v_pay.branch_id and status = 'open' order by opened_at desc limit 1;

  insert into public.refunds (branch_id, payment_id, invoice_id, amount, method, reason, approved_by, created_by, shift_id)
  values (v_pay.branch_id, v_pay.id, v_pay.invoice_id, round(p_amount,2), v_pay.method, p_reason, auth.uid(), auth.uid(), v_shift)
  returning * into v_ref;

  if v_shift is not null and v_pay.method = 'cash' then
    insert into public.cash_movements(shift_id, branch_id, movement_type, amount, description, created_by)
    values (v_shift, v_pay.branch_id, 'refund', round(p_amount,2), 'Refund ' || v_ref.refund_number, auth.uid());
  end if;

  update public.invoices set paid_amount = greatest(paid_amount - round(p_amount,2), 0),
    status = 'partially_paid' where id = v_inv.id;
  if round(v_already + p_amount,2) >= round(v_pay.amount,2) then
    update public.payments set status = 'reversed' where id = v_pay.id;
  end if;

  return jsonb_build_object('id', v_ref.id, 'refund_number', v_ref.refund_number, 'amount', v_ref.amount);
end $$;

-- ------------------------------------------------------------ kids area checkout
create or replace function public.close_kids_session(
  p_session uuid,
  p_discount numeric default 0,
  p_pickup_name text default null,
  p_pickup_relation text default null,
  p_id_verified boolean default false,
  p_create_invoice boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_s public.kids_area_sessions;
  v_rule public.pricing_rules;
  v_minutes int;
  v_res record;
  v_sub public.subscriptions;
  v_inv jsonb;
  v_total numeric;
begin
  if not (public.has_permission('operations.checkout') or public.has_permission('kids_area.operate') or public.has_permission('finance.create_invoice')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_s from public.kids_area_sessions where id = p_session for update;
  if v_s.id is null then raise exception 'session_not_found'; end if;
  if v_s.status <> 'active' then raise exception 'session_closed'; end if;
  if not public.can_access_branch(v_s.branch_id) then raise exception 'branch_forbidden' using errcode='42501'; end if;

  v_minutes := greatest(0, floor(extract(epoch from (now() - v_s.checkin_at)) / 60)::int);

  -- active subscription takes precedence, never double-charged
  select * into v_sub from public.subscriptions
    where child_id = v_s.child_id and status = 'active'
      and start_date <= current_date and end_date >= current_date
      and (sessions_total = 0 or sessions_used < sessions_total)
      and (minutes_total = 0 or minutes_used < minutes_total)
    order by end_date asc limit 1;

  if v_sub.id is not null then
    v_total := 0;
    update public.subscriptions set sessions_used = sessions_used + case when sessions_total > 0 then 1 else 0 end,
      minutes_used = minutes_used + v_minutes,
      status = case when (sessions_total > 0 and sessions_used + 1 >= sessions_total)
                     or (minutes_total > 0 and minutes_used + v_minutes >= minutes_total)
                    then 'expired'::subscription_status_t else status end
    where id = v_sub.id;
    insert into public.subscription_usage(subscription_id, child_id, session_id, usage_type, minutes)
    values (v_sub.id, v_s.child_id, v_s.id, 'time', v_minutes);
    v_res := jsonb_build_object('amount', 0, 'covered_by_subscription', true, 'subscription_id', v_sub.id,
                                'minutes', v_minutes, 'billable_minutes', v_minutes)::record;
  else
    select * into v_rule from public.pricing_rules where id = v_s.pricing_rule_id;
    if v_rule.id is null and v_s.service_id is not null then
      v_rule := public.resolve_pricing_rule(v_s.service_id, now());
    end if;

    if v_rule.id is null then
      v_res := jsonb_build_object('amount', 0, 'error', 'no_pricing_rule', 'minutes', v_minutes,
                                  'billable_minutes', v_minutes)::record;
    else
      select * into v_res from public.compute_charge(v_rule, v_minutes);
    end if;
    v_total := greatest(coalesce((v_res).amount, 0) - greatest(coalesce(p_discount,0),0), 0);
  end if;

  update public.kids_area_sessions set
    status = 'closed', checkout_at = now(), billable_minutes = v_minutes,
    unit_price = v_rule.price, amount = coalesce((v_res).amount, 0),
    discount = greatest(coalesce(p_discount,0),0), total = round(coalesce(v_total,0),2),
    pricing_breakdown = coalesce(to_jsonb(v_res), '{}'::jsonb),
    checked_out_by = auth.uid(), picked_up_by_name = p_pickup_name,
    picked_up_by_relation = p_pickup_relation, picked_up_by_id_verified = coalesce(p_id_verified,false)
  where id = v_s.id returning * into v_s;

  if p_create_invoice and coalesce(v_s.total,0) > 0 then
    v_inv := public.create_invoice(
      v_s.branch_id,
      jsonb_build_array(jsonb_build_object(
        'description_en', 'Kids Area session (' || v_minutes || ' min)',
        'description_ar', 'جلسة منطقة أطفال (' || v_minutes || ' دقيقة)',
        'quantity', 1, 'unit_price', v_s.total, 'discount', 0,
        'tax_rate', coalesce((select tax_rate from public.services where id = v_s.service_id), 0),
        'service_id', v_s.service_id)),
      v_s.child_id, null, null, 0, 'kids_area_session', v_s.id, null,
      'Auto invoice for session ' || v_s.id);
    update public.kids_area_sessions set invoice_id = (v_inv->>'id')::uuid where id = v_s.id;
    update public.kids_area_sessions set total = round(total * (1 + coalesce((select tax_rate from public.services where id = v_s.service_id),0)/100.0), 2)
      where id = v_s.id;
  end if;

  return jsonb_build_object(
    'session_id', v_s.id, 'billable_minutes', v_minutes, 'amount', v_s.amount,
    'discount', v_s.discount, 'total', v_s.total, 'invoice', v_inv,
    'pricing', v_s.pricing_breakdown, 'subscription_id', v_sub.id);
end $$;

-- ------------------------------------------------------------ cash register
create or replace function public.open_shift(p_register uuid, p_opening_float numeric default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_reg public.cash_registers; v_shift public.cash_shifts;
begin
  if not (public.has_permission('cash.operate') or public.has_permission('pos.sell')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_reg from public.cash_registers where id = p_register;
  if v_reg.id is null then raise exception 'register_not_found'; end if;
  if not public.can_access_branch(v_reg.branch_id) then raise exception 'branch_forbidden' using errcode='42501'; end if;
  if coalesce(p_opening_float,0) < 0 then raise exception 'invalid_float'; end if;

  begin
    insert into public.cash_shifts (register_id, branch_id, opened_by, opening_float)
    values (p_register, v_reg.branch_id, auth.uid(), round(coalesce(p_opening_float,0),2))
    returning * into v_shift;
  exception when unique_violation then
    raise exception 'shift_already_open';
  end;

  insert into public.cash_movements(shift_id, branch_id, movement_type, amount, description, created_by)
  values (v_shift.id, v_shift.branch_id, 'float', round(coalesce(p_opening_float,0),2), 'Opening float', auth.uid());

  return jsonb_build_object('shift_id', v_shift.id, 'opened_at', v_shift.opened_at, 'opening_float', v_shift.opening_float);
end $$;

create or replace function public.close_shift(p_shift uuid, p_counted_cash numeric, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s public.cash_shifts; v_cash_in numeric := 0; v_cash_out numeric := 0; v_expected numeric;
begin
  if not (public.has_permission('cash.operate') or public.has_permission('pos.sell')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_s from public.cash_shifts where id = p_shift for update;
  if v_s.id is null then raise exception 'shift_not_found'; end if;
  if v_s.status = 'closed' then raise exception 'shift_already_closed'; end if;
  if p_counted_cash is null or p_counted_cash < 0 then raise exception 'invalid_count'; end if;

  select coalesce(sum(amount),0) into v_cash_in from public.cash_movements
    where shift_id = p_shift and movement_type in ('sale','deposit','float');
  select coalesce(sum(amount),0) into v_cash_out from public.cash_movements
    where shift_id = p_shift and movement_type in ('expense','withdrawal','refund');
  v_expected := round(v_cash_in - v_cash_out, 2);

  update public.cash_shifts set status = 'closed', closed_at = now(), closed_by = auth.uid(),
    expected_cash = v_expected, counted_cash = round(p_counted_cash,2), notes = p_notes
  where id = p_shift returning * into v_s;

  if abs(v_s.difference) > 0.009 then
    insert into public.notifications(user_id, branch_id, type, title_en, title_ar, body_en, body_ar, severity, entity_type, entity_id)
    select ur.user_id, v_s.branch_id, 'cash_difference', 'Cash shift discrepancy', 'فرق في وردية الخزينة',
      'Expected ' || v_s.expected_cash || ' but counted ' || v_s.counted_cash,
      'المتوقع ' || v_s.expected_cash || ' والمعدود ' || v_s.counted_cash,
      'warning', 'cash_shift', v_s.id
    from public.user_roles ur join public.roles r on r.id = ur.role_id
    where r.code in ('super_admin','branch_manager','accountant');
  end if;

  return jsonb_build_object('shift_id', v_s.id, 'expected_cash', v_s.expected_cash, 'counted_cash', v_s.counted_cash,
    'difference', v_s.difference, 'closed_at', v_s.closed_at);
end $$;

create or replace function public.add_cash_movement(p_shift uuid, p_type cash_movement_type_t, p_amount numeric, p_description text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s public.cash_shifts; v_m public.cash_movements;
begin
  if not public.has_permission('cash.operate') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;
  select * into v_s from public.cash_shifts where id = p_shift;
  if v_s.id is null or v_s.status <> 'open' then raise exception 'shift_not_open'; end if;
  insert into public.cash_movements(shift_id, branch_id, movement_type, amount, description, created_by)
  values (p_shift, v_s.branch_id, p_type, round(p_amount,2), p_description, auth.uid()) returning * into v_m;
  return jsonb_build_object('id', v_m.id, 'type', v_m.movement_type, 'amount', v_m.amount);
end $$;

-- ------------------------------------------------------------ inventory
create or replace function public.apply_stock_movement(
  p_product uuid, p_qty numeric, p_type text, p_ref_type text default null,
  p_ref_id uuid default null, p_notes text default null
) returns numeric language plpgsql security definer set search_path = public as $$
declare v_p public.products; v_balance numeric;
begin
  select * into v_p from public.products where id = p_product for update;
  if v_p.id is null then raise exception 'product_not_found'; end if;
  v_balance := v_p.stock_qty + p_qty;
  if v_balance < 0 then raise exception 'insufficient_stock'; end if;
  update public.products set stock_qty = v_balance where id = p_product;
  insert into public.inventory_movements(branch_id, product_id, movement_type, quantity, unit_cost,
    reference_type, reference_id, balance_after, notes, created_by)
  values (v_p.branch_id, p_product, p_type, p_qty, v_p.cost_price, p_ref_type, p_ref_id, v_balance, p_notes, auth.uid());
  return v_balance;
end $$;

create or replace function public.receive_purchase(
  p_branch uuid, p_supplier uuid, p_items jsonb, p_paid numeric default 0, p_notes text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pub public.purchases; v_item jsonb; v_total numeric := 0; v_line numeric;
begin
  if not public.has_permission('inventory.purchase') then raise exception 'forbidden' using errcode = '42501'; end if;
  if not public.can_access_branch(p_branch) then raise exception 'branch_forbidden' using errcode = '42501'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'empty_purchase'; end if;

  insert into public.purchases(branch_id, supplier_id, status, paid_amount, created_by)
  values (p_branch, p_supplier, 'received', greatest(coalesce(p_paid,0),0), auth.uid())
  returning * into v_pub;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_line := round((v_item->>'quantity')::numeric * (v_item->>'unit_cost')::numeric, 2);
    insert into public.purchase_items(purchase_id, product_id, quantity, unit_cost)
    values (v_pub.id, (v_item->>'product_id')::uuid, (v_item->>'quantity')::numeric, (v_item->>'unit_cost')::numeric);
    perform public.apply_stock_movement((v_item->>'product_id')::uuid, (v_item->>'quantity')::numeric,
      'purchase', 'purchase', v_pub.id, 'Purchase ' || v_pub.purchase_number);
    update public.products set cost_price = (v_item->>'unit_cost')::numeric
      where id = (v_item->>'product_id')::uuid;
    v_total := v_total + v_line;
  end loop;

  update public.purchases set subtotal = v_total, total = v_total where id = v_pub.id returning * into v_pub;
  update public.suppliers set balance = balance + (v_total - v_pub.paid_amount) where id = p_supplier;

  return jsonb_build_object('id', v_pub.id, 'purchase_number', v_pub.purchase_number, 'total', v_pub.total);
end $$;

-- ------------------------------------------------------------ immutability guards
create or replace function public.prevent_financial_mutation() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'payments' and tg_op = 'UPDATE' then
    if new.amount <> old.amount or new.invoice_id <> old.invoice_id or new.method <> old.method then
      raise exception 'payments_are_immutable';
    end if;
  end if;
  if tg_table_name = 'invoices' and tg_op = 'UPDATE' then
    if new.invoice_number <> old.invoice_number then raise exception 'invoice_number_immutable'; end if;
  end if;
  if tg_op = 'DELETE' then raise exception 'hard_delete_forbidden';
  end if;
  return coalesce(new, old);
end $$;

create trigger trg_payments_guard before update or delete on public.payments
for each row execute function public.prevent_financial_mutation();
create trigger trg_invoices_guard before update or delete on public.invoices
for each row execute function public.prevent_financial_mutation();
create trigger trg_refunds_guard before update or delete on public.refunds
for each row execute function public.prevent_financial_mutation();
