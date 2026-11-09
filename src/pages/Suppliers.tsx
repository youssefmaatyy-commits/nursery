import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import CrudPage from '@/components/CrudPage';
import { formatCurrency } from '@/lib/utils';

export default function Suppliers() {
  const { t, i18n } = useTranslation();
  const { context, can } = useAuth();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';
  const branchId = context?.branches?.[0]?.id ?? null;

  return (
    <CrudPage
      title={t('inventory.suppliers')}
      subtitle={isRtl ? 'الموردون وأرصدة الحسابات' : 'Suppliers and account balances'}
      table="suppliers"
      orderBy={{ column: 'created_at', ascending: false }}
      canCreate={can('inventory.manage')}
      canEdit={can('inventory.manage')}
      searchColumns={['name_en', 'name_ar', 'phone']}
      defaults={{ branch_id: branchId }}
      transformOnSave={(v) => ({ ...v, branch_id: branchId })}
      fields={[
        { name: 'name_en', label: t('common.nameEn'), required: true },
        { name: 'name_ar', label: t('common.nameAr'), required: true },
        { name: 'contact_person', label: t('inventory.contactPerson') },
        { name: 'phone', label: t('common.phone') },
        { name: 'email', label: t('common.email'), hideInTable: true },
        { name: 'tax_number', label: t('inventory.taxNumber'), hideInTable: true },
        { name: 'address', label: t('common.address'), type: 'textarea', hideInTable: true },
        { name: 'balance', label: t('common.balance'), render: (r) => formatCurrency(Number(r.balance), locale) },
      ]}
    />
  );
}
