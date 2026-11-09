-- 0008_seed_reference_data.sql
-- Permissions, system roles, initial branch, settings, services, pricing, packages,
-- classrooms, expense categories, cash register. Idempotent where practical.

-- ------------------------------------------------------------ permissions
insert into public.permissions (code, module, action, name_en, name_ar) values
 ('children.view','children','view','View children','عرض الأطفال'),
 ('children.create','children','create','Register children','تسجيل الأطفال'),
 ('children.edit','children','edit','Edit children','تعديل بيانات الأطفال'),
 ('children.archive','children','archive','Archive children','أرشفة الأطفال'),
 ('children.medical','children','medical','View medical notes','عرض الملاحظات الطبية'),
 ('parents.view','parents','view','View parents','عرض أولياء الأمور'),
 ('parents.manage','parents','manage','Manage parents & guardians','إدارة أولياء الأمور'),
 ('documents.view','documents','view','View documents','عرض المستندات'),
 ('documents.manage','documents','manage','Manage documents','إدارة المستندات'),
 ('operations.view','operations','view','View operations board','عرض لوحة العمليات'),
 ('operations.checkin','operations','checkin','Check children in','تسجيل دخول الأطفال'),
 ('operations.checkout','operations','checkout','Check children out','تسجيل خروج الأطفال'),
 ('kids_area.operate','kids_area','operate','Operate kids area','تشغيل منطقة الأطفال'),
 ('nursery.view','nursery','view','View nursery','عرض الحضانة'),
 ('nursery.operate','nursery','operate','Operate nursery attendance','تشغيل حضور الحضانة'),
 ('nursery.enroll','nursery','enroll','Enroll in nursery','تسجيل في الحضانة'),
 ('nursery.reports','nursery','reports','Write daily reports','كتابة التقارير اليومية'),
 ('nursery.manage_classes','nursery','manage_classes','Manage classrooms','إدارة الفصول'),
 ('pricing.view','pricing','view','View pricing','عرض الأسعار'),
 ('pricing.manage','pricing','manage','Manage pricing','إدارة الأسعار'),
 ('subscriptions.view','subscriptions','view','View subscriptions','عرض الاشتراكات'),
 ('subscriptions.manage','subscriptions','manage','Manage subscriptions','إدارة الاشتراكات'),
 ('finance.view','finance','view','View financial data','عرض البيانات المالية'),
 ('finance.create_invoice','finance','create_invoice','Create invoices','إنشاء الفواتير'),
 ('finance.payment','finance','payment','Record payments','تسجيل المدفوعات'),
 ('finance.refund','finance','refund','Issue refunds','إصدار المرتجعات'),
 ('cash.view','cash','view','View cash register','عرض الخزينة'),
 ('cash.operate','cash','operate','Operate cash shifts','تشغيل ورديات الخزينة'),
 ('pos.sell','pos','sell','Sell at POS','البيع من نقطة البيع'),
 ('expenses.manage','expenses','manage','Manage expenses','إدارة المصروفات'),
 ('inventory.view','inventory','view','View inventory','عرض المخزون'),
 ('inventory.manage','inventory','manage','Manage inventory','إدارة المخزون'),
 ('inventory.purchase','inventory','purchase','Record purchases','تسجيل المشتريات'),
 ('employees.view','employees','view','View employees','عرض الموظفين'),
 ('employees.manage','employees','manage','Manage employees','إدارة الموظفين'),
 ('roles.manage','roles','manage','Manage roles & permissions','إدارة الأدوار والصلاحيات'),
 ('settings.manage','settings','manage','Manage settings','إدارة الإعدادات'),
 ('audit.view','audit','view','View audit logs','عرض سجل التدقيق'),
 ('reports.view','reports','view','View reports','عرض التقارير'),
 ('reports.export','reports','export','Export reports','تصدير التقارير'),
 ('notifications.manage','notifications','manage','Manage notifications','إدارة الإشعارات')
on conflict (code) do nothing;

-- ------------------------------------------------------------ roles
insert into public.roles (code, name_en, name_ar, description, is_system) values
 ('super_admin','Super Admin','مدير النظام','Full access to everything', true),
 ('branch_manager','Branch Manager','مدير الفرع','Manages one branch end to end', true),
 ('receptionist','Receptionist','موظف الاستقبال','Front desk: children, check-in/out, invoices', true),
 ('cashier','Cashier','أمين الصندوق','POS and cash desk', true),
 ('teacher','Nursery Teacher','مدرس حضانة','Classroom operations and daily reports', true),
 ('accountant','Accountant','محاسب','Financial reporting, expenses, refunds', true),
 ('inventory_manager','Inventory Manager','مدير المخزون','Stock, suppliers and purchases', true),
 ('parent','Parent','ولي أمر','Parent portal access only', true)
on conflict (code) do nothing;

-- super admin gets every permission
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p where r.code = 'super_admin'
on conflict do nothing;

-- branch manager: everything operational + finance + HR, minus system role editing
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.code = 'branch_manager' and p.code not in ('roles.manage')
on conflict do nothing;

-- receptionist
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r join public.permissions p on p.code in (
 'children.view','children.create','children.edit','parents.view','parents.manage','documents.view','documents.manage',
 'operations.view','operations.checkin','operations.checkout','kids_area.operate','nursery.view','nursery.operate',
 'subscriptions.view','finance.create_invoice','finance.payment','cash.view','cash.operate','pos.sell',
 'pricing.view','reports.view','inventory.view','notifications.manage')
where r.code = 'receptionist'
on conflict do nothing;

-- cashier
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r join public.permissions p on p.code in (
 'children.view','operations.view','operations.checkout','pos.sell','finance.create_invoice','finance.payment',
 'cash.view','cash.operate','pricing.view','inventory.view','subscriptions.view','reports.view')
where r.code = 'cashier'
on conflict do nothing;

-- teacher
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r join public.permissions p on p.code in (
 'children.view','children.medical','operations.view','operations.checkin','operations.checkout',
 'nursery.view','nursery.operate','nursery.reports','documents.view','reports.view')
where r.code = 'teacher'
on conflict do nothing;

-- accountant
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r join public.permissions p on p.code in (
 'children.view','parents.view','finance.view','finance.create_invoice','finance.payment','finance.refund',
 'cash.view','cash.operate','expenses.manage','inventory.view','subscriptions.view','employees.view',
 'reports.view','reports.export','audit.view','operations.view')
where r.code = 'accountant'
on conflict do nothing;

-- inventory manager
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r join public.permissions p on p.code in (
 'inventory.view','inventory.manage','inventory.purchase','suppliers.manage','pos.sell','finance.view',
 'expenses.manage','reports.view','reports.export','children.view')
where r.code = 'inventory_manager'
on conflict do nothing;

-- ------------------------------------------------------------ branch
insert into public.branches (code, name_en, name_ar, address, phone, email, timezone, currency, tax_rate)
values ('MAIN','Main Branch','الفرع الرئيسي','Ismailia, Egypt','+20 100 000 0000','info@kidsnursery.example',
        'Africa/Cairo','EGP', 0)
on conflict (code) do nothing;

-- ------------------------------------------------------------ settings
insert into public.system_settings (key, value, description) values
 ('app.name', '{"en":"Kids Area & Nursery ERP","ar":"نظام إدارة منطقة الأطفال والحضانة"}', 'Application display name'),
 ('app.default_locale', '"ar"', 'Default interface language'),
 ('app.currency', '"EGP"', 'Default currency'),
 ('app.timezone', '"Africa/Cairo"', 'Business timezone'),
 ('billing.rounding_minutes', '15', 'Default rounding step for kids-area billing'),
 ('billing.grace_minutes', '10', 'Default grace period before charging'),
 ('pos.require_open_shift', 'true', 'Require an open cash shift before taking cash'),
 ('nursery.late_pickup_fee', '0', 'Fee applied for late pickup per 15 minutes'),
 ('notifications.expiry_days_before', '7', 'Days before subscription expiry to notify'),
 ('security.session_timeout_minutes', '480', 'Idle timeout for staff sessions')
on conflict (key) do nothing;

-- ------------------------------------------------------------ services & pricing
insert into public.services (branch_id, code, name_en, name_ar, service_type, unit, base_price, tax_rate)
values (null,'KIDS-HOURLY','Kids Area Hourly','منطقة الأطفال بالساعة','kids_area','hour',60,0),
       (null,'NURSERY-MONTHLY','Nursery Monthly','الحضانة شهرياً','nursery','month',2500,0),
       (null,'CAFE','Cafe Item','منتج كافيتريا','product','item',0,0)
on conflict (code) do nothing;

insert into public.pricing_rules (branch_id, service_id, name_en, name_ar, rule_type, price, base_price,
  unit_minutes, included_minutes, min_charge, grace_minutes, rounding_minutes, additional_unit_price, priority)
select null, s.id, 'Standard hourly', 'بالساعة القياسي', 'hourly', 60, 0, 60, 0, 30, 10, 15, 60, 100
from public.services s where s.code = 'KIDS-HOURLY'
  and not exists (select 1 from public.pricing_rules where service_id = s.id);

insert into public.pricing_rules (branch_id, service_id, name_en, name_ar, rule_type, price, base_price,
  unit_minutes, included_minutes, min_charge, grace_minutes, rounding_minutes, additional_unit_price, priority)
select null, s.id, 'Half-hour rate', 'نصف ساعة', 'half_hour', 35, 0, 30, 0, 30, 5, 15, 35, 200
from public.services s where s.code = 'KIDS-HOURLY'
  and date_part('dow', now()) between 1 and 4
  and not exists (select 1 from public.pricing_rules pr where pr.service_id = s.id and pr.rule_type = 'half_hour');

insert into public.pricing_rules (branch_id, service_id, name_en, name_ar, rule_type, price, base_price,
  unit_minutes, included_minutes, min_charge, grace_minutes, rounding_minutes, priority)
select null, s.id, 'Saturday day pass', 'تصريح يوم السبت', 'day_pass', 250, 250, 480, 480, 250, 0, 15, 150
from public.services s where s.code = 'KIDS-HOURLY'
  and not exists (select 1 from public.pricing_rules pr where pr.service_id = s.id and pr.rule_type = 'day_pass');

-- ------------------------------------------------------------ packages
insert into public.packages (branch_id, code, name_en, name_ar, package_type, hours_included, sessions_included, validity_days, price)
select b.id, v.code, v.en, v.ar, v.pt::package_type_t, v.h, v.s, v.d, v.price
from public.branches b
cross join (values
  ('PKG-10H','10 Hour Pass','باقة ١٠ ساعات','time',10,0,60,450),
  ('PKG-20H','20 Hour Pass','باقة ٢٠ ساعة','time',20,0,90,800),
  ('PKG-10S','10 Session Pass','باقة ١٠ جلسات','sessions',0,10,60,500),
  ('PKG-FAMILY','Family Weekend Pass','باقة العائلة','family',0,8,30,600)
) as v(code,en,ar,pt,h,s,d,price)
where not exists (select 1 from public.packages p where p.branch_id = b.id and p.code = v.code);

-- ------------------------------------------------------------ classrooms
insert into public.classrooms (branch_id, name_en, name_ar, age_min_months, age_max_months, capacity, monthly_fee)
select b.id, v.en, v.ar, v.amin, v.amax, v.cap, v.fee
from public.branches b
cross join (values
  ('Sunflowers','عباد الشمس',18,36,15,2200),
  ('Tulips','التوليب',36,48,18,2400),
  ('Stars','النجوم',48,72,20,2600)
) as v(en,ar,amin,amax,cap,fee)
where not exists (select 1 from public.classrooms c where c.branch_id = b.id and c.name_en = v.en);

-- ------------------------------------------------------------ expense categories
insert into public.expense_categories (code, name_en, name_ar) values
 ('RENT','Rent','إيجار'), ('SALARIES','Salaries','رواتب'), ('UTILITIES','Utilities','مرافق'),
 ('SUPPLIES','Supplies','مستلزمات'), ('MAINTENANCE','Maintenance','صيانة'), ('MARKETING','Marketing','تسويق'),
 ('TRANSPORT','Transportation','مواصلات'), ('OTHER','Other','أخرى')
on conflict (code) do nothing;

-- ------------------------------------------------------------ cash register
insert into public.cash_registers (branch_id, code, name)
select b.id, 'MAIN-01', 'Main Cashier' from public.branches b
where not exists (select 1 from public.cash_registers r where r.branch_id = b.id and r.code = 'MAIN-01');

-- ------------------------------------------------------------ product samples (inventory)
insert into public.product_categories (branch_id, name_en, name_ar)
select b.id, v.en, v.ar from public.branches b
cross join (values ('Snacks','سناكس'),('Beverages','مشروبات'),('Souvenirs','هدايا')) as v(en,ar)
where not exists (select 1 from public.product_categories pc where pc.branch_id = b.id and pc.name_en = v.en);

insert into public.products (branch_id, category_id, sku, barcode, name_en, name_ar, unit, cost_price, sale_price, stock_qty, min_stock)
select b.id, pc.id, v.sku, v.barcode, v.en, v.ar, 'piece', v.cost, v.sale, v.stock, v.min_stock
from public.branches b
join public.product_categories pc on pc.branch_id = b.id and pc.name_en = 'Snacks'
cross join (values
  ('SNK-CHIPS','1000000000017','Chips','شيبسي',8,15,100,20),
  ('SNK-JUICE','1000000000024','Juice Box','عصير',6,12,120,24),
  ('SNK-COOKIE','1000000000031','Cookie Pack','بسكويت',5,10,80,15)
) as v(sku,barcode,en,ar,cost,sale,stock,min_stock)
where not exists (select 1 from public.products p where p.branch_id = b.id and p.sku = v.sku);

-- ------------------------------------------------------------ audit triggers on sensitive tables
do $$
declare t text;
begin
  foreach t in array array['children','parents','child_guardians','authorized_pickups','invoices','payments',
                           'refunds','expenses','subscriptions','kids_area_sessions','nursery_attendance',
                           'employees','products','pricing_rules','user_roles','system_settings','cash_shifts']
  loop
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.audit_row()', t);
  end loop;
end $$;
