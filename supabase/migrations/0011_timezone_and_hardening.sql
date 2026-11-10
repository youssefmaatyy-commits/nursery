-- 0011_timezone_and_hardening.sql
-- Make the database operate on the business timezone (Africa/Cairo) so that
-- current_date / "today" metrics match the actual business day, and tighten
-- execute privileges on all SECURITY DEFINER functions.

alter database postgres set timezone to 'Africa/Cairo';

-- anon must not be able to invoke any public RPC directly.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    begin
      execute format('revoke execute on function %s from anon', f.sig);
    exception when others then null;
    end;
    begin
      execute format('grant execute on function %s to authenticated', f.sig);
    exception when others then null;
    end;
  end loop;
end $$;

revoke all on all sequences in schema public from anon;

-- table-level defaults for future tables
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- audit helper: block direct client inserts into audit_logs (only definer functions write)
drop policy if exists audit_insert on public.audit_logs;
create policy audit_insert on public.audit_logs for insert to authenticated with check (false);

-- helper used by the frontend: everything this session may do
create or replace function public.my_context() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'roles', coalesce((select jsonb_agg(distinct r.code) from public.user_roles ur join public.roles r on r.id = ur.role_id
                       where ur.user_id = auth.uid()), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(p.code order by p.code) from public.permissions p
                             where public.has_permission(p.code)), '[]'::jsonb),
    'branches', coalesce((select jsonb_agg(to_jsonb(b)) from public.branches b where b.id = any(public.branch_ids())), '[]'::jsonb),
    'is_super_admin', public.is_super_admin(),
    'is_parent', exists (select 1 from public.parents where profile_id = auth.uid()),
    'parent_children', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name_en', c.full_name_en, 'name_ar', c.full_name_ar, 'code', c.child_code))
                                 from public.children c where c.id = any(public.current_parent_child_ids())), '[]'::jsonb)
  )
$$;

grant execute on function public.my_context() to authenticated;
revoke execute on function public.my_context() from anon;
