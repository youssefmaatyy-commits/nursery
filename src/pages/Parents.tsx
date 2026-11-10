import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import CrudPage from '@/components/CrudPage';
import { Badge } from '@/components/ui';

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
    />
  );
}
