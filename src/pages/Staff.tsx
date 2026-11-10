import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { KeyRound, Plus, Search, ShieldCheck, UserCog, UserX, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { humanizeError } from '@/lib/errors';
import {
  Alert, Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, TableSkeleton,
} from '@/components/ui';

interface RoleRef { role_id: string; code: string; name_en: string; name_ar: string; branch_id: string | null }

interface StaffAccount {
  user_id: string;
  email: string;
  full_name_en: string | null;
  full_name_ar: string | null;
  phone: string | null;
  locale: string | null;
  is_active: boolean;
  default_branch_id: string | null;
  roles: RoleRef[];
  last_sign_in_at: string | null;
  employee_id: string | null;
  employee_code: string | null;
}

interface RoleOption { id: string; code: string; name_en: string; name_ar: string }

const EMPTY_FORM = {
  email: '', password: '', full_name_en: '', full_name_ar: '', phone: '',
  role_code: 'receptionist', employee_code: '', job_title: '', salary: '',
};

export default function Staff() {
  const { t, i18n } = useTranslation();
  const { context, can } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar' : 'en';

  const branchId = context?.branches?.[0]?.id ?? null;
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [roleTarget, setRoleTarget] = useState<StaffAccount | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<StaffAccount | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['staff-accounts'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_list_staff_accounts');
      if (error) throw error;
      return (data ?? []) as unknown as StaffAccount[];
    },
  });

  const { data: roles } = useQuery({
    queryKey: ['role-options'],
    queryFn: async () => {
      const { data, error } = await supabase.from('roles').select('id, code, name_en, name_ar').order('code');
      if (error) throw error;
      return data as RoleOption[];
    },
  });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = accounts ?? [];
    if (!q) return list;
    return list.filter((a) =>
      [a.email, a.full_name_en, a.full_name_ar, a.employee_code]
        .some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [accounts, search]);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['staff-accounts'] });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('admin_create_staff_account', {
        p_email: form.email.trim(),
        p_password: form.password,
        p_full_name_en: form.full_name_en || form.email,
        p_full_name_ar: form.full_name_ar || form.full_name_en || form.email,
        p_phone: form.phone || null,
        p_role_code: form.role_code,
        p_branch_id: branchId,
        p_employee_code: form.employee_code || null,
        p_job_title: form.job_title || null,
        p_salary: form.salary ? Number(form.salary) : null,
        p_hire_date: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      push('success', isRtl
        ? 'تم إنشاء الموظف. سلّمه كلمة المرور المؤقتة.'
        : 'Staff account created. Hand over the temporary password.');
      setShowCreate(false);
      setForm(EMPTY_FORM);
      invalidate();
    },
    onError: (e: Error) => push('error', humanizeError(e, locale)),
  });

  const assignRole = useMutation({
    mutationFn: async ({ userId, roleCode }: { userId: string; roleCode: string }) => {
      const { error } = await supabase.rpc('admin_set_user_role', {
        p_user: userId, p_role_code: roleCode, p_branch_id: branchId,
      });
      if (error) throw error;
    },
    onSuccess: () => { push('success', t('common.savedSuccessfully')); setRoleTarget(null); invalidate(); },
    onError: (e: Error) => push('error', humanizeError(e, locale)),
  });

  const removeRole = useMutation({
    mutationFn: async ({ userId, roleId }: { userId: string; roleId: string }) => {
      const { error } = await supabase.rpc('admin_remove_user_role', { p_user: userId, p_role_id: roleId });
      if (error) throw error;
    },
    onSuccess: () => { push('success', t('common.savedSuccessfully')); invalidate(); },
    onError: (e: Error) => push('error', humanizeError(e, locale)),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ userId, active }: { userId: string; active: boolean }) => {
      const { error } = await supabase.rpc('admin_set_user_active', { p_user: userId, p_active: active });
      if (error) throw error;
    },
    onSuccess: () => { push('success', t('common.savedSuccessfully')); invalidate(); },
    onError: (e: Error) => push('error', humanizeError(e, locale)),
  });

  const resetPassword = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('admin_reset_user_password', {
        p_user: passwordTarget!.user_id, p_password: newPassword,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      push('success', isRtl ? 'تم تغيير كلمة المرور.' : 'Password changed.');
      setPasswordTarget(null);
      setNewPassword('');
    },
    onError: (e: Error) => push('error', humanizeError(e, locale)),
  });

  const roleName = (r: RoleRef) => (isRtl ? r.name_ar : r.name_en);

  return (
    <div>
      <PageHeader
        title={isRtl ? 'الموظفين والحسابات' : 'Staff & accounts'}
        subtitle={isRtl
          ? 'إنشاء حسابات الدخول وتحديد الأدوار والصلاحيات'
          : 'Create login accounts and control roles and permissions'}
        actions={can('employees.manage') && (
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> {isRtl ? 'موظف جديد' : 'New staff'}
          </Button>
        )}
      />

      {!branchId && (
        <div className="mb-4"><Alert tone="danger">
          {isRtl
            ? 'حسابك مش مربوط بفرع، فمش هتقدر تنشئ موظفين. كلّم مدير النظام.'
            : 'Your account has no branch, so you cannot create staff. Ask an administrator.'}
        </Alert></div>
      )}

      <Card className="mb-4 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-slate-400" />
          <Input className="ps-9" placeholder={t('common.search')} value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
      </Card>

      <div className="table-wrap">
        {isLoading ? <TableSkeleton rows={6} cols={5} /> : !visible.length ? (
          <EmptyState title={t('common.noData')} icon={<Users className="h-6 w-6" />} />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{isRtl ? 'الاسم' : 'Name'}</th>
                <th>{t('common.email')}</th>
                <th>{isRtl ? 'الأدوار' : 'Roles'}</th>
                <th>{isRtl ? 'الكود' : 'Code'}</th>
                <th>{t('common.status')}</th>
                <th className="text-end">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <tr key={a.user_id}>
                  <td>
                    <p className="font-medium">{isRtl ? a.full_name_ar || a.full_name_en : a.full_name_en || a.full_name_ar}</p>
                    <p className="text-xs text-slate-400">{a.phone ?? '—'}</p>
                  </td>
                  <td className="text-sm text-slate-600">{a.email}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {!a.roles.length
                        ? <span className="text-xs text-slate-400">{isRtl ? 'بدون دور' : 'no role'}</span>
                        : a.roles.map((r) => (
                          <Badge key={`${a.user_id}-${r.role_id}`} tone="brand">
                            <span className="inline-flex items-center gap-1">
                              {roleName(r)}
                              {can('roles.manage') && (
                                <button
                                  title={isRtl ? 'إزالة' : 'Remove'}
                                  onClick={() => removeRole.mutate({ userId: a.user_id, roleId: r.role_id })}
                                  className="ms-0.5 text-brand-800/60 hover:text-rose-600"
                                >×</button>
                              )}
                            </span>
                          </Badge>
                        ))}
                    </div>
                  </td>
                  <td className="font-mono text-xs text-slate-500">{a.employee_code ?? '—'}</td>
                  <td>
                    <Badge tone={a.is_active ? 'success' : 'neutral'}>
                      {a.is_active ? (isRtl ? 'نشط' : 'active') : (isRtl ? 'موقوف' : 'inactive')}
                    </Badge>
                  </td>
                  <td className="text-end">
                    <div className="flex justify-end gap-1">
                      {can('roles.manage') && (
                        <Button variant="ghost" size="sm" title={isRtl ? 'إضافة دور' : 'Add role'}
                          onClick={() => setRoleTarget(a)}><ShieldCheck className="h-3.5 w-3.5" /></Button>
                      )}
                      {can('employees.manage') && (
                        <Button variant="ghost" size="sm" title={isRtl ? 'كلمة مرور جديدة' : 'Reset password'}
                          onClick={() => { setPasswordTarget(a); setNewPassword(''); }}>
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {can('employees.manage') && a.user_id !== context?.user_id && (
                        <Button variant="ghost" size="sm"
                          title={a.is_active ? (isRtl ? 'إيقاف' : 'Deactivate') : (isRtl ? 'تفعيل' : 'Activate')}
                          onClick={() => toggleActive.mutate({ userId: a.user_id, active: !a.is_active })}>
                          <UserX className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ---------------------------------------------------------- create */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} wide
        title={isRtl ? 'موظف جديد' : 'New staff account'}
        footer={<>
          <Button variant="secondary" onClick={() => setShowCreate(false)}>{t('common.cancel')}</Button>
          <Button loading={create.isPending} onClick={() => create.mutate()}>{t('common.save')}</Button>
        </>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('common.email')} required type="email" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <div>
            <Input label={isRtl ? 'كلمة مرور مؤقتة' : 'Temporary password'} required type="password"
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <p className="mt-1 text-xs text-slate-400">
              {isRtl ? '12 حرف على الأقل' : 'at least 12 characters'}
            </p>
          </div>
          <Input label={isRtl ? 'الاسم (عربي)' : 'Name (Arabic)'} value={form.full_name_ar}
            onChange={(e) => setForm({ ...form, full_name_ar: e.target.value })} />
          <Input label={isRtl ? 'الاسم (إنجليزي)' : 'Name (English)'} value={form.full_name_en}
            onChange={(e) => setForm({ ...form, full_name_en: e.target.value })} />
          <Input label={t('common.phone')} value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Select label={isRtl ? 'الدور' : 'Role'} required value={form.role_code}
            onChange={(e) => setForm({ ...form, role_code: e.target.value })}>
            {roles?.map((r) => <option key={r.id} value={r.code}>{isRtl ? r.name_ar : r.name_en}</option>)}
          </Select>
          <Input label={`${isRtl ? 'كود الموظف' : 'Employee code'} (${isRtl ? 'اختياري' : 'optional'})`}
            value={form.employee_code} onChange={(e) => setForm({ ...form, employee_code: e.target.value })} />
          <Input label={isRtl ? 'الوظيفة' : 'Job title'} value={form.job_title}
            onChange={(e) => setForm({ ...form, job_title: e.target.value })} />
          <Input label={isRtl ? 'الراتب' : 'Salary'} type="number" value={form.salary}
            onChange={(e) => setForm({ ...form, salary: e.target.value })} />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {isRtl
            ? 'الحساب هيتعمل فورًا، والموظف هيُطلب منه تغيير كلمة المرور عند أول دخول.'
            : 'The account is created immediately and the employee must change the password on first sign-in.'}
        </p>
      </Modal>

      {/* ------------------------------------------------------- add role */}
      <Modal open={Boolean(roleTarget)} onClose={() => setRoleTarget(null)}
        title={isRtl ? 'إضافة دور' : 'Add role'}
        footer={<Button variant="secondary" onClick={() => setRoleTarget(null)}>{t('common.cancel')}</Button>}>
        <p className="mb-3 text-sm text-slate-600">{roleTarget?.email}</p>
        <div className="grid gap-2">
          {roles?.filter((r) => !roleTarget?.roles.some((x) => x.role_id === r.id)).map((r) => (
            <Button key={r.id} variant="secondary" loading={assignRole.isPending}
              onClick={() => assignRole.mutate({ userId: roleTarget!.user_id, roleCode: r.code })}>
              <UserCog className="h-4 w-4" /> {isRtl ? r.name_ar : r.name_en}
            </Button>
          ))}
          {roles?.every((r) => roleTarget?.roles.some((x) => x.role_id === r.id)) && (
            <p className="text-sm text-slate-500">
              {isRtl ? 'عنده كل الأدوار بالفعل.' : 'Already has every role.'}
            </p>
          )}
        </div>
      </Modal>

      {/* -------------------------------------------------- reset password */}
      <Modal open={Boolean(passwordTarget)} onClose={() => setPasswordTarget(null)}
        title={isRtl ? 'كلمة مرور جديدة' : 'New password'}
        footer={<>
          <Button variant="secondary" onClick={() => setPasswordTarget(null)}>{t('common.cancel')}</Button>
          <Button loading={resetPassword.isPending} onClick={() => resetPassword.mutate()}>{t('common.save')}</Button>
        </>}>
        <p className="mb-3 text-sm text-slate-600">{passwordTarget?.email}</p>
        <Input label={isRtl ? 'كلمة المرور' : 'Password'} type="password" value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)} />
        <p className="mt-1 text-xs text-slate-400">{isRtl ? '12 حرف على الأقل' : 'at least 12 characters'}</p>
      </Modal>
    </div>
  );
}
