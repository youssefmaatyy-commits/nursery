import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import CrudPage from '@/components/CrudPage';
import { Badge } from '@/components/ui';
import { Archive, RotateCcw, Trash2 } from 'lucide-react';

export default function Parents() {
  const { t, i18n } = useTranslation();
  const { context, can } = useAuth();
  const isRtl = i18n.language === 'ar';
  const branchId = context?.branches?.[0]?.id ?? null;

  return (
    <CrudPage
      title={t('parents.title')}
      subtitle={isRtl ? 'أولياء الأمور وأوصياء الأطفال' : 'Parents and guardians of enrolled children'}
      table="parents"
      orderBy={{ column: 'created_at', ascending: false }}
      canCreate={can('parents.manage')}
      canEdit={can('parents.manage')}
      searchColumns={['full_name_en', 'full_name_ar', 'phone', 'parent_code']}
      defaults={{ branch_id: branchId }}
      transformOnSave={(v) => ({ ...v, branch_id: branchId })}
      fields={[
        { name: 'parent_code', label: t('parents.parentCode') },
        { name: 'full_name_en', label: t('common.nameEn'), required: true },
        { name: 'full_name_ar', label: t('common.nameAr'), required: true },
        { name: 'phone', label: t('common.phone'), required: true },
        { name: 'alt_phone', label: t('parents.altPhone'), hideInTable: true },
        { name: 'email', label: t('common.email') },
        { name: 'national_id', label: t('parents.nationalId'), hideInTable: true },
        { name: 'address', label: t('common.address'), type: 'textarea', hideInTable: true },
        { name: 'status', label: t('common.status'), type: 'select', defaultValue: 'active',
          options: [{ value: 'active', label: t('children.active') }, { value: 'inactive', label: t('common.no') }],
          render: (r) => <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{String(r.status)}</Badge> },
        { name: 'portal', label: t('parents.portalAccount'), hideInTable: false,
          render: (r) => r.profile_id
            ? <Badge tone="brand">{t('common.yes')}</Badge>
            : <Badge tone="neutral">{t('common.no')}</Badge> },
      ]}
      rowActions={[
        {
          key: 'deactivate',
          label: isRtl ? 'تعطيل' : 'Deactivate',
          icon: <Archive className="h-3.5 w-3.5" />,
          visible: (r) => r.status === 'active' && can('parents.manage'),
          confirm: isRtl
            ? 'تعطيل ولي الأمر؟ لن يظهر في قوائم الإضافة لكن بياناته تبقى.'
            : 'Deactivate this parent? They stop appearing in pickers but keep their data.',
          rpc: (r) => ({ fn: 'admin_delete_parent', args: { p_parent: r.id, p_hard: false } }),
        },
        {
          key: 'restore',
          label: isRtl ? 'تفعيل' : 'Restore',
          icon: <RotateCcw className="h-3.5 w-3.5" />,
          visible: (r) => r.status !== 'active' && can('parents.manage'),
          rpc: (r) => ({ fn: 'admin_restore_parent', args: { p_parent: r.id } }),
        },
        {
          key: 'delete',
          label: isRtl ? 'حذف نهائي' : 'Delete permanently',
          icon: <Trash2 className="h-3.5 w-3.5" />,
          tone: 'danger' as const,
          visible: (r) => context?.is_super_admin === true && r.status !== 'active',
          confirm: isRtl
            ? 'حذف نهائي لا يمكن التراجع عنه. هيترفض لو عليه فواتير أو أطفال.'
            : 'Permanent delete, cannot be undone. Refused if linked to children or invoices.',
          rpc: (r) => ({ fn: 'admin_delete_parent', args: { p_parent: r.id, p_hard: true } }),
        },
      ]}
    />
  );
}
