-- 0005_financial.sql
-- Invoices, payments, refunds, cash registers/shifts/movements, expenses,
-- plus product inventory & suppliers (needed for POS + purchasing).

create type invoice_status_t as enum ('draft','issued','partially_paid','paid','void','refunded');
create type payment_method_t as enum ('cash','card','bank_transfer','wallet','advance','installment');
create type payment_status_t as enum ('pending','completed','failed','reversed');
create type invoice_source_t as enum ('pos','kids_area_session','subscription','enrollment','manual','adjustment');
create type shift_status_t as enum ('open','closed');
create type cash_movement_type_t as enum ('sale','expense','deposit','withdrawal','refund','float');

-- ------------------------------------------------------------ products / suppliers / inventory
create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id),
  name_en text not null,
  name_ar text not null,
  created_at timestamptz not null default now()
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  name_en text not null,
  name_ar text not null,
  contact_person text,
  phone text,
  email citext,
  address text,
  tax_number text,
  balance numeric(12,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_suppliers_updated before update on public.suppliers
for each row execute function public.set_updated_at();

create table public.products (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  category_id uuid references public.product_categories(id),
  sku text not null,
  barcode text,
  name_en text not null,
  name_ar text not null,
  unit text not null default 'piece',
  cost_price numeric(12,2) not null default 0 check (cost_price >= 0),
  sale_price numeric(12,2) not null default 0 check (sale_price >= 0),
  tax_rate numeric(5,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  stock_qty numeric(12,2) not null default 0,
  min_stock numeric(12,2) not null default 0 check (min_stock >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, sku)
);
create index idx_products_barcode on public.products(barcode);
create trigger trg_products_updated before update on public.products
for each row execute function public.set_updated_at();

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  supplier_id uuid not null references public.suppliers(id),
  purchase_number text not null unique default ('PO-' || lpad((nextval('public.invoice_seq'))::text, 6, '0')),
  purchase_date date not null default current_date,
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  tax numeric(12,2) not null default 0 check (tax >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  paid_amount numeric(12,2) not null default 0 check (paid_amount >= 0),
  status text not null default 'received' check (status in ('draft','ordered','received','cancelled')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric(12,2) not null check (quantity > 0),
  unit_cost numeric(12,2) not null check (unit_cost >= 0),
  line_total numeric(12,2) generated always as (round(quantity * unit_cost, 2)) stored
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  product_id uuid not null references public.products(id),
  movement_type text not null check (movement_type in ('purchase','sale','return','adjustment','transfer','waste')),
  quantity numeric(12,2) not null,          -- signed: +in / -out
  unit_cost numeric(12,2),
  reference_type text,
  reference_id uuid,
  balance_after numeric(12,2),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index idx_inventory_movements_product on public.inventory_movements(product_id, created_at desc);

-- ------------------------------------------------------------ invoices
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  invoice_number text not null unique default ('INV-' || lpad((nextval('public.invoice_seq'))::text, 6, '0')),
  child_id uuid references public.children(id),
  parent_id uuid references public.parents(id),
  customer_name text,
  status invoice_status_t not null default 'issued',
  source invoice_source_t not null default 'pos',
  source_id uuid,
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  discount_total numeric(12,2) not null default 0 check (discount_total >= 0),
  tax_total numeric(12,2) not null default 0 check (tax_total >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  paid_amount numeric(12,2) not null default 0 check (paid_amount >= 0),
  balance numeric(12,2) generated always as (round(total - paid_amount, 2)) stored,
  currency char(3) not null default 'EGP',
  notes text,
  due_date date,
  idempotency_key text unique,
  issued_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index idx_invoices_branch_date on public.invoices(branch_id, issued_at desc);
create index idx_invoices_child on public.invoices(child_id);
create index idx_invoices_status on public.invoices(status);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description_en text not null,
  description_ar text not null,
  service_id uuid references public.services(id),
  product_id uuid references public.products(id),
  quantity numeric(12,4) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  tax_rate numeric(5,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  line_subtotal numeric(12,2) not null default 0,
  line_tax numeric(12,2) not null default 0,
  line_total numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index idx_invoice_items_invoice on public.invoice_items(invoice_id);

-- ------------------------------------------------------------ cash register
create table public.cash_registers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (branch_id, code)
);

create table public.cash_shifts (
  id uuid primary key default gen_random_uuid(),
  register_id uuid not null references public.cash_registers(id),
  branch_id uuid not null references public.branches(id),
  opened_by uuid references public.profiles(id),
  opened_at timestamptz not null default now(),
  opening_float numeric(12,2) not null default 0 check (opening_float >= 0),
  closed_at timestamptz,
  closed_by uuid references public.profiles(id),
  expected_cash numeric(12,2),
  counted_cash numeric(12,2),
  difference numeric(12,2) generated always as (round(coalesce(counted_cash,0) - coalesce(expected_cash,0), 2)) stored,
  status shift_status_t not null default 'open',
  notes text
);
create unique index uq_open_shift_per_register on public.cash_shifts(register_id) where status = 'open';

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.cash_shifts(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  movement_type cash_movement_type_t not null,
  amount numeric(12,2) not null check (amount >= 0),
  payment_id uuid,
  expense_id uuid,
  description text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index idx_cash_movements_shift on public.cash_movements(shift_id);

-- ------------------------------------------------------------ payments & refunds
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  invoice_id uuid not null references public.invoices(id),
  payment_number text not null unique default ('PAY-' || lpad((nextval('public.invoice_seq'))::text, 6, '0')),
  amount numeric(12,2) not null check (amount > 0),
  method payment_method_t not null default 'cash',
  status payment_status_t not null default 'completed',
  reference text,
  shift_id uuid references public.cash_shifts(id),
  received_by uuid references public.profiles(id),
  paid_at timestamptz not null default now(),
  idempotency_key text unique,
  notes text,
  created_at timestamptz not null default now()
);
create index idx_payments_invoice on public.payments(invoice_id);
create index idx_payments_branch_date on public.payments(branch_id, paid_at desc);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  payment_id uuid not null references public.payments(id),
  invoice_id uuid not null references public.invoices(id),
  refund_number text not null unique default ('RFD-' || lpad((nextval('public.invoice_seq'))::text, 6, '0')),
  amount numeric(12,2) not null check (amount > 0),
  method payment_method_t not null default 'cash',
  reason text not null,
  approved_by uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  shift_id uuid references public.cash_shifts(id),
  created_at timestamptz not null default now()
);
create index idx_refunds_invoice on public.refunds(invoice_id);

-- ------------------------------------------------------------ expenses
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_en text not null,
  name_ar text not null,
  is_active boolean not null default true
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  category_id uuid not null references public.expense_categories(id),
  expense_number text not null unique default ('EXP-' || lpad((nextval('public.invoice_seq'))::text, 6, '0')),
  amount numeric(12,2) not null check (amount > 0),
  expense_date date not null default current_date,
  method payment_method_t not null default 'cash',
  payee text,
  description text,
  receipt_path text,
  supplier_id uuid references public.suppliers(id),
  employee_id uuid references public.employees(id),
  shift_id uuid references public.cash_shifts(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index idx_expenses_branch_date on public.expenses(branch_id, expense_date desc);

-- ------------------------------------------------------------ revenue/profit view
create or replace view public.financial_summary as
select b.id as branch_id,
       coalesce(pay.total_collected, 0) as total_collected,
       coalesce(ref.total_refunded, 0) as total_refunded,
       coalesce(pay.total_collected, 0) - coalesce(ref.total_refunded, 0) as net_revenue,
       coalesce(exp.total_expenses, 0) as total_expenses,
       coalesce(pay.total_collected, 0) - coalesce(ref.total_refunded, 0) - coalesce(exp.total_expenses, 0) as profit,
       coalesce(inv.outstanding, 0) as outstanding
from public.branches b
left join lateral (
  select sum(amount) as total_collected from public.payments
  where branch_id = b.id and status = 'completed' and method <> 'advance'
) pay on true
left join lateral (
  select sum(amount) as total_refunded from public.refunds where branch_id = b.id
) ref on true
left join lateral (
  select sum(amount) as total_expenses from public.expenses where branch_id = b.id
) exp on true
left join lateral (
  select sum(balance) as outstanding from public.invoices
  where branch_id = b.id and status in ('issued','partially_paid')
) inv on true;
