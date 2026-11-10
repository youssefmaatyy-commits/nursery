-- 0007_rls_policies.sql
-- Row Level Security for every table holding protected data.
-- Principle: staff need an explicit permission AND branch access; parents only
-- ever see their own children's data; nothing is world-readable by default.

-- helper: enable RLS + revoke anon by default
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('revoke all on public.%I from anon', t.tablename);
  end loop;
end $$;

-- ============================================================ reference data
create policy branches_read on public.branches for select to authenticated
  using (public.is_staff() or public.is_super_admin());
create policy branches_write on public.branches for all to authenticated
  using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'));

create policy roles_read on public.roles for select to authenticated using (true);
create policy roles_write on public.roles for all to authenticated
  using (public.has_permission('roles.manage')) with check (public.has_permission('roles.manage'));
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy permissions_write on public.permissions for all to authenticated
  using (public.has_permission('roles.manage')) with check (public.has_permission('roles.manage'));
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);
create policy role_permissions_write on public.role_permissions for all to authenticated
  using (public.has_permission('roles.manage')) with check (public.has_permission('roles.manage'));

-- ============================================================ profiles
create policy profiles_select_self on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_permission('employees.view') or public.is_super_admin());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and is_active);
create policy profiles_admin on public.profiles for all to authenticated
  using (public.has_permission('employees.manage') or public.is_super_admin())
  with check (public.has_permission('employees.manage') or public.is_super_admin());

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_permission('roles.manage')
         or exists (select 1 from public.roles r where r.id = role_id and r.code = 'super_admin' and public.is_super_admin()));
create policy user_roles_manage on public.user_roles for all to authenticated
  using (public.has_permission('roles.manage')) with check (public.has_permission('roles.manage'));

-- ============================================================ parents
create policy parents_staff_select on public.parents for select to authenticated
  using ((public.has_permission('parents.view') or public.has_permission('children.view'))
         and public.can_access_branch(branch_id));
create policy parents_self_select on public.parents for select to authenticated
  using (profile_id = auth.uid());
create policy parents_staff_write on public.parents for all to authenticated
  using (public.has_permission('parents.manage') and public.can_access_branch(branch_id))
  with check (public.has_permission('parents.manage') and public.can_access_branch(branch_id));
create policy parents_self_update on public.parents for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ============================================================ children
create policy children_staff_select on public.children for select to authenticated
  using (public.has_permission('children.view') and public.can_access_branch(branch_id));
create policy children_parent_select on public.children for select to authenticated
  using (public.is_parent_of(id));
create policy children_staff_insert on public.children for insert to authenticated
  with check (public.has_permission('children.create') and public.can_access_branch(branch_id));
create policy children_staff_update on public.children for update to authenticated
  using (public.has_permission('children.edit') and public.can_access_branch(branch_id))
  with check (public.has_permission('children.edit') and public.can_access_branch(branch_id));
create policy children_staff_delete on public.children for delete to authenticated
  using (public.is_super_admin() and public.has_permission('children.archive'));

create policy child_guardians_staff on public.child_guardians for all to authenticated
  using (public.has_permission('children.view')
         and exists (select 1 from public.children c where c.id = child_id and public.can_access_branch(c.branch_id)))
  with check (public.has_permission('parents.manage')
         and exists (select 1 from public.children c where c.id = child_id and public.can_access_branch(c.branch_id)));
create policy child_guardians_parent on public.child_guardians for select to authenticated
  using (public.is_parent_of(child_id));

create policy authorized_pickups_staff on public.authorized_pickups for all to authenticated
  using (public.has_permission('children.view')
         and exists (select 1 from public.children c where c.id = child_id and public.can_access_branch(c.branch_id)))
  with check (public.has_permission('children.edit')
         and exists (select 1 from public.children c where c.id = child_id and public.can_access_branch(c.branch_id)));
create policy authorized_pickups_parent on public.authorized_pickups for select to authenticated
  using (public.is_parent_of(child_id));

create policy child_documents_staff on public.child_documents for all to authenticated
  using (public.has_permission('documents.view') and public.can_access_branch(branch_id))
  with check (public.has_permission('documents.manage') and public.can_access_branch(branch_id));
create policy child_documents_parent on public.child_documents for select to authenticated
  using (public.is_parent_of(child_id));

create policy medical_notes_staff on public.medical_notes for all to authenticated
  using (public.has_permission('children.medical') and public.can_access_branch(branch_id))
  with check (public.has_permission('children.medical') and public.can_access_branch(branch_id));
create policy medical_notes_parent on public.medical_notes for select to authenticated
  using (public.is_parent_of(child_id));

-- ============================================================ operations
create policy services_read on public.services for select to authenticated
  using (public.is_staff() or public.is_super_admin());
create policy services_write on public.services for all to authenticated
  using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'));

create policy pricing_rules_read on public.pricing_rules for select to authenticated
  using (public.has_permission('pricing.view') or public.has_permission('operations.checkout') or public.is_super_admin());
create policy pricing_rules_write on public.pricing_rules for all to authenticated
  using (public.has_permission('pricing.manage')) with check (public.has_permission('pricing.manage'));

create policy packages_read on public.packages for select to authenticated
  using (public.is_staff() or public.is_super_admin());
create policy packages_write on public.packages for all to authenticated
  using (public.has_permission('pricing.manage')) with check (public.has_permission('pricing.manage'));

create policy sessions_staff on public.kids_area_sessions for select to authenticated
  using (public.has_permission('operations.view') and public.can_access_branch(branch_id));
create policy sessions_parent on public.kids_area_sessions for select to authenticated
  using (public.is_parent_of(child_id));
create policy sessions_write on public.kids_area_sessions for all to authenticated
  using (public.has_permission('kids_area.operate') and public.can_access_branch(branch_id))
  with check (public.has_permission('kids_area.operate') and public.can_access_branch(branch_id));

create policy subscriptions_staff on public.subscriptions for select to authenticated
  using (public.has_permission('subscriptions.view') and public.can_access_branch(branch_id));
create policy subscriptions_parent on public.subscriptions for select to authenticated
  using (public.is_parent_of(child_id));
create policy subscriptions_write on public.subscriptions for all to authenticated
  using (public.has_permission('subscriptions.manage') and public.can_access_branch(branch_id))
  with check (public.has_permission('subscriptions.manage') and public.can_access_branch(branch_id));

create policy subscription_usage_staff on public.subscription_usage for select to authenticated
  using (public.has_permission('subscriptions.view'));
create policy subscription_usage_parent on public.subscription_usage for select to authenticated
  using (public.is_parent_of(child_id));

create policy classrooms_read on public.classrooms for select to authenticated
  using (public.has_permission('nursery.view') or public.has_permission('operations.view') or public.is_super_admin());
create policy classrooms_write on public.classrooms for all to authenticated
  using (public.has_permission('nursery.manage_classes') and public.can_access_branch(branch_id))
  with check (public.has_permission('nursery.manage_classes') and public.can_access_branch(branch_id));

create policy classroom_teachers_read on public.classroom_teachers for select to authenticated
  using (public.has_permission('nursery.view') or public.has_permission('employees.view') or public.is_super_admin());
create policy classroom_teachers_write on public.classroom_teachers for all to authenticated
  using (public.has_permission('nursery.manage_classes')) with check (public.has_permission('nursery.manage_classes'));

create policy classroom_children_read on public.classroom_children for select to authenticated
  using (public.has_permission('nursery.view') or public.has_permission('operations.view'));
create policy classroom_children_parent on public.classroom_children for select to authenticated
  using (public.is_parent_of(child_id));
create policy classroom_children_write on public.classroom_children for all to authenticated
  using (public.has_permission('nursery.manage_classes')) with check (public.has_permission('nursery.manage_classes'));

create policy enrollments_read on public.nursery_enrollments for select to authenticated
  using (public.has_permission('nursery.view') and public.can_access_branch(branch_id));
create policy enrollments_parent on public.nursery_enrollments for select to authenticated
  using (public.is_parent_of(child_id));
create policy enrollments_write on public.nursery_enrollments for all to authenticated
  using (public.has_permission('nursery.enroll') and public.can_access_branch(branch_id))
  with check (public.has_permission('nursery.enroll') and public.can_access_branch(branch_id));

create policy nursery_attendance_read on public.nursery_attendance for select to authenticated
  using (public.has_permission('operations.view') and public.can_access_branch(branch_id));
create policy nursery_attendance_parent on public.nursery_attendance for select to authenticated
  using (public.is_parent_of(child_id));
create policy nursery_attendance_write on public.nursery_attendance for all to authenticated
  using (public.has_permission('nursery.operate') and public.can_access_branch(branch_id))
  with check (public.has_permission('nursery.operate') and public.can_access_branch(branch_id));

create policy daily_reports_read on public.daily_child_reports for select to authenticated
  using (public.has_permission('nursery.reports') and public.can_access_branch(branch_id));
create policy daily_reports_parent on public.daily_child_reports for select to authenticated
  using (public.is_parent_of(child_id) and visible_to_parent);
create policy daily_reports_write on public.daily_child_reports for all to authenticated
  using (public.has_permission('nursery.reports') and public.can_access_branch(branch_id))
  with check (public.has_permission('nursery.reports') and public.can_access_branch(branch_id));

create policy holidays_read on public.holidays for select to authenticated using (public.is_staff() or public.is_super_admin());
create policy holidays_write on public.holidays for all to authenticated
  using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'));
create policy activities_read on public.activities for select to authenticated
  using (public.is_staff() or public.is_super_admin());
create policy activities_write on public.activities for all to authenticated
  using (public.has_permission('nursery.reports')) with check (public.has_permission('nursery.reports'));
create policy events_read on public.events for select to authenticated using (public.is_staff() or public.is_super_admin() or public.current_parent_ids() is not null);
create policy events_write on public.events for all to authenticated
  using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'));

-- ============================================================ finance
create policy invoices_read on public.invoices for select to authenticated
  using (public.has_permission('finance.view') and public.can_access_branch(branch_id));
create policy invoices_parent on public.invoices for select to authenticated
  using (child_id is not null and public.is_parent_of(child_id));
create policy invoices_write on public.invoices for all to authenticated
  using (public.has_permission('finance.create_invoice') and public.can_access_branch(branch_id))
  with check (public.has_permission('finance.create_invoice') and public.can_access_branch(branch_id));

create policy invoice_items_read on public.invoice_items for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id
                 and ((public.has_permission('finance.view') and public.can_access_branch(i.branch_id))
                      or (i.child_id is not null and public.is_parent_of(i.child_id)))));
create policy invoice_items_write on public.invoice_items for all to authenticated
  using (public.has_permission('finance.create_invoice')) with check (public.has_permission('finance.create_invoice'));

create policy payments_read on public.payments for select to authenticated
  using (public.has_permission('finance.view') and public.can_access_branch(branch_id));
create policy payments_parent on public.payments for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and i.child_id is not null and public.is_parent_of(i.child_id)));
create policy payments_insert on public.payments for insert to authenticated
  with check (public.has_permission('finance.payment') and public.can_access_branch(branch_id));

create policy refunds_read on public.refunds for select to authenticated
  using (public.has_permission('finance.view') and public.can_access_branch(branch_id));
create policy refunds_insert on public.refunds for insert to authenticated
  with check (public.has_permission('finance.refund') and public.can_access_branch(branch_id));

create policy cash_registers_read on public.cash_registers for select to authenticated
  using (public.has_permission('cash.view') or public.has_permission('pos.sell'));
create policy cash_registers_write on public.cash_registers for all to authenticated
  using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'));

create policy cash_shifts_read on public.cash_shifts for select to authenticated
  using ((public.has_permission('cash.view') or public.has_permission('pos.sell')) and public.can_access_branch(branch_id));
create policy cash_shifts_write on public.cash_shifts for all to authenticated
  using (public.has_permission('cash.operate') and public.can_access_branch(branch_id))
  with check (public.has_permission('cash.operate') and public.can_access_branch(branch_id));

create policy cash_movements_read on public.cash_movements for select to authenticated
  using (public.has_permission('cash.view') and public.can_access_branch(branch_id));
create policy cash_movements_write on public.cash_movements for all to authenticated
  using (public.has_permission('cash.operate') and public.can_access_branch(branch_id))
  with check (public.has_permission('cash.operate') and public.can_access_branch(branch_id));

create policy expenses_read on public.expenses for select to authenticated
  using (public.has_permission('finance.view') and public.can_access_branch(branch_id));
create policy expenses_write on public.expenses for all to authenticated
  using (public.has_permission('expenses.manage') and public.can_access_branch(branch_id))
  with check (public.has_permission('expenses.manage') and public.can_access_branch(branch_id));

create policy expense_categories_read on public.expense_categories for select to authenticated
  using (public.is_staff() or public.is_super_admin());
create policy expense_categories_write on public.expense_categories for all to authenticated
  using (public.has_permission('expenses.manage')) with check (public.has_permission('expenses.manage'));

-- ============================================================ inventory
create policy products_read on public.products for select to authenticated
  using ((public.has_permission('inventory.view') or public.has_permission('pos.sell')) and public.can_access_branch(branch_id));
create policy products_write on public.products for all to authenticated
  using (public.has_permission('inventory.manage') and public.can_access_branch(branch_id))
  with check (public.has_permission('inventory.manage') and public.can_access_branch(branch_id));

create policy product_categories_read on public.product_categories for select to authenticated
  using (public.is_staff() or public.is_super_admin());
create policy product_categories_write on public.product_categories for all to authenticated
  using (public.has_permission('inventory.manage')) with check (public.has_permission('inventory.manage'));

create policy suppliers_read on public.suppliers for select to authenticated
  using (public.has_permission('inventory.view') and public.can_access_branch(branch_id));
create policy suppliers_write on public.suppliers for all to authenticated
  using (public.has_permission('inventory.manage') and public.can_access_branch(branch_id))
  with check (public.has_permission('inventory.manage') and public.can_access_branch(branch_id));

create policy purchases_read on public.purchases for select to authenticated
  using (public.has_permission('inventory.view') and public.can_access_branch(branch_id));
create policy purchases_write on public.purchases for all to authenticated
  using (public.has_permission('inventory.purchase') and public.can_access_branch(branch_id))
  with check (public.has_permission('inventory.purchase') and public.can_access_branch(branch_id));
create policy purchase_items_read on public.purchase_items for select to authenticated
  using (exists (select 1 from public.purchases p where p.id = purchase_id and public.has_permission('inventory.view')));
create policy purchase_items_write on public.purchase_items for all to authenticated
  using (public.has_permission('inventory.purchase')) with check (public.has_permission('inventory.purchase'));

create policy inventory_movements_read on public.inventory_movements for select to authenticated
  using (public.has_permission('inventory.view') and public.can_access_branch(branch_id));
create policy inventory_movements_write on public.inventory_movements for all to authenticated
  using (public.has_permission('inventory.manage') and public.can_access_branch(branch_id))
  with check (public.has_permission('inventory.manage') and public.can_access_branch(branch_id));

-- ============================================================ HR
create policy employees_read on public.employees for select to authenticated
  using (public.has_permission('employees.view') and public.can_access_branch(branch_id));
create policy employees_self on public.employees for select to authenticated
  using (profile_id = auth.uid());
create policy employees_write on public.employees for all to authenticated
  using (public.has_permission('employees.manage') and public.can_access_branch(branch_id))
  with check (public.has_permission('employees.manage') and public.can_access_branch(branch_id));

create policy employee_attendance_read on public.employee_attendance for select to authenticated
  using (public.has_permission('employees.view') and public.can_access_branch(branch_id));
create policy employee_attendance_self on public.employee_attendance for select to authenticated
  using (exists (select 1 from public.employees e where e.id = employee_id and e.profile_id = auth.uid()));
create policy employee_attendance_write on public.employee_attendance for all to authenticated
  using (public.has_permission('employees.manage') and public.can_access_branch(branch_id))
  with check (public.has_permission('employees.manage') and public.can_access_branch(branch_id));

-- ============================================================ platform
create policy settings_read on public.system_settings for select to authenticated using (true);
create policy settings_write on public.system_settings for all to authenticated
  using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'));

create policy audit_read on public.audit_logs for select to authenticated
  using (public.has_permission('audit.view') and (branch_id is null or public.can_access_branch(branch_id)));
create policy audit_insert on public.audit_logs for insert to authenticated with check (false);

create policy files_read on public.uploaded_files for select to authenticated
  using (public.has_permission('documents.view') or uploaded_by = auth.uid());
create policy files_write on public.uploaded_files for all to authenticated
  using (uploaded_by = auth.uid() or public.has_permission('documents.manage'))
  with check (uploaded_by = auth.uid() or public.has_permission('documents.manage'));

create policy notifications_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_insert_staff on public.notifications for insert to authenticated
  with check (public.has_permission('notifications.manage') or auth.uid() is not null);

create policy sync_own_read on public.sync_operations for select to authenticated using (user_id = auth.uid());
create policy sync_own_write on public.sync_operations for insert to authenticated with check (user_id = auth.uid());

-- ============================================================ storage
insert into storage.buckets (id, name, public) values
  ('child-photos','child-photos', false),
  ('child-documents','child-documents', false),
  ('parent-documents','parent-documents', false),
  ('invoices','invoices', false),
  ('expense-receipts','expense-receipts', false)
on conflict (id) do nothing;

create policy storage_staff_read on storage.objects for select to authenticated
  using (bucket_id in ('child-photos','child-documents','parent-documents','invoices','expense-receipts')
         and (public.has_permission('documents.view') or public.has_permission('finance.view')
              or public.has_permission('expenses.manage') or public.has_permission('children.view')));
create policy storage_staff_write on storage.objects for insert to authenticated
  with check (bucket_id in ('child-photos','child-documents','parent-documents','invoices','expense-receipts')
         and (public.has_permission('documents.manage') or public.has_permission('finance.create_invoice')
              or public.has_permission('expenses.manage') or public.has_permission('children.edit')));
create policy storage_parent_read on storage.objects for select to authenticated
  using (bucket_id in ('child-photos','child-documents')
         and exists (select 1 from public.child_documents cd
                     join public.children c on c.id = cd.child_id
                     where cd.file_path = storage.objects.name and public.is_parent_of(c.id)));
