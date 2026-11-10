import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Shield, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { humanizeError } from '@/lib/errors';
import { Badge, Card, CardHeader, EmptyState, PageHeader, TableSkeleton } from '@/components/ui';

export default function Roles() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar' : 'en';
  const editable = can('roles.manage');

  const setPermission = useMutation({
    mutationFn: async ({ role, permission, enabled }: { role: string; permission: string; enabled: boolean }) => {
      const { error } = await supabase.rpc('admin_set_role_permission', {
        p_role_code: role, p_permission_code: permission, p_enabled: enabled,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      push('success', t('common.savedSuccessfully'));
      void qc.invalidateQueries({ queryKey: ['roles'] });
      void qc.invalidateQueries({ queryKey: ['permissions'] });
    },
    onError: (e: Error) => push('error', humanizeError(e, locale)),
  });

  const { data: roles, isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('roles')
        .select('id, code, name_en, name_ar, description, is_system, role_permissions(permission_code)')
        .order('code');
      if (error) throw error;
      return data as unknown as Array<{
        id: string; code: string; name_en: string; name_ar: string; description: string | null;
        is_system: boolean; role_permissions: Array<{ permission_code: string }>;
      }>;
    },
  });

  const { data: permissions } = useQuery({
    queryKey: ['permissions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('permissions').select('code, module, name_en, name_ar').order('module');
      if (error) throw error;
      return data as Array<{ code: string; module: string; name_en: string; name_ar: string }>;
    },
  });

  const byModule = (permissions ?? []).reduce<Record<string, typeof permissions>>((acc, p) => {
    (acc[p.module] ||= [] as never);
    acc[p.module]!.push(p);
    return acc;
  }, {});

  return (
    <div>
      <PageHeader title={t('admin.roles')}
        subtitle={isRtl ? 'الأدوار والصلاحيات — تُفرض على مستوى قاعدة البيانات' : 'Roles and permissions — enforced at the database level'} />

      {isLoading ? <Card><TableSkeleton rows={6} cols={4} /></Card> : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {roles?.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{isRtl ? r.name_ar : r.name_en}</p>
                    <p className="font-mono text-[11px] text-slate-400">{r.code}</p>
                  </div>
                  <Shield className="h-4 w-4 text-brand-600" />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <Badge tone="brand">{r.role_permissions.length}</Badge>
                  {r.is_system && <Badge tone="neutral">system</Badge>}
                </div>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader title={t('admin.permissions')}
              subtitle={isRtl ? 'مصفوفة الصلاحيات لكل دور' : 'Permission matrix per role'} />
            {!permissions?.length ? <EmptyState title={t('common.noData')} /> : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="sticky start-0 bg-slate-50">{t('admin.permissions')}</th>
                      {roles?.map((r) => <th key={r.id} className="text-center">{isRtl ? r.name_ar : r.name_en}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(byModule).map(([mod, perms]) => (
                      <>
                        <tr key={mod} className="bg-slate-50/70">
                          <td colSpan={(roles?.length ?? 0) + 1} className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            {mod}
                          </td>
                        </tr>
                        {perms?.map((p) => (
                          <tr key={p.code}>
                            <td className="whitespace-nowrap">
                              <span className="font-mono text-xs text-slate-500">{p.code}</span>
                              <p className="text-[11px] text-slate-400">{isRtl ? p.name_ar : p.name_en}</p>
                            </td>
                            {roles?.map((r) => {
                              const has = r.code === 'super_admin' || r.role_permissions.some((rp) => rp.permission_code === p.code);
                              // super_admin bypasses has_permission() entirely, so a toggle
                              // there would be cosmetic. Show it as always granted.
                              const locked = r.code === 'super_admin' || !editable;
                              return (
                                <td key={r.id} className="text-center">
                                  {locked ? (
                                    has
                                      ? <Check className="mx-auto h-4 w-4 text-emerald-600" />
                                      : <span className="text-slate-200">—</span>
                                  ) : (
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-brand-700"
                                      checked={has}
                                      disabled={setPermission.isPending}
                                      aria-label={`${r.code} ${p.code}`}
                                      onChange={(e) => setPermission.mutate({
                                        role: r.code, permission: p.code, enabled: e.target.checked,
                                      })}
                                    />
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 px-1 text-xs text-slate-500">
              {isRtl
                ? 'التغييرات تُطبّق فورًا على مستوى قاعدة البيانات، والموظف يراها بعد تحديث الصفحة.'
                : 'Changes apply immediately at the database level; staff see them on their next page load.'}
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
