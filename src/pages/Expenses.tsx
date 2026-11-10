import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import CrudPage from '@/components/CrudPage';
import { Badge } from '@/components/ui';
import { formatCurrency, formatDate } from '@/lib/utils';

export default function Expenses() {
  const { t, i18n } = useTranslation();
  const { context, can } = useAuth();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';
  const branchId = context?.branches?.[0]?.id ?? null;

  const { data: categories } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('expense_categories').select('id, name_en, name_ar').eq('is_active', true);
      if (error) throw error;
      return data as Array<{ id: string; name_en: string; name_ar: string }>;
    },
  });

  return (
    <CrudPage
      title={t('finance.expenses')}
      subtitle={isRtl ? 'المصروفات التشغيلية حسب الفئة' : 'Operating expenses by category'}
      table="expenses"
      select="id, expense_number, amount, expense_date, method, payee, description, category_id, expense_categories(name_en, name_ar)"
      orderBy={{ column: 'expense_date', ascending: false }}
      canCreate={can('expenses.manage')}
      canEdit={false}
      searchColumns={['expense_number', 'payee', 'description']}
      defaults={{ branch_id: branchId }}
      transformOnSave={(v) => ({
        ...v,
        branch_id: branchId,
        amount: Number(v.amount),
        created_by: context?.user_id ?? null,
      })}
      fields={[
        { name: 'expense_number', label: t('finance.expenseNumber') },
        {
          name: 'category_id', label: t('finance.expenseCategory'), type: 'select', required: true,
          options: (categories ?? []).map((c) => ({ value: c.id, label: isRtl ? c.name_ar : c.name_en })),
          render: (row) => {
            const cat = row.expense_categories as { name_en: string; name_ar: string } | null;
            return cat ? (isRtl ? cat.name_ar : cat.name_en) : '—';
          },
        },
        { name: 'amount', label: t('finance.amount'), type: 'number', required: true,
          render: (row) => <span className="font-semibold">{formatCurrency(Number(row.amount), locale)}</span> },
        { name: 'expense_date', label: t('common.date'), type: 'date', required: true,
          render: (row) => formatDate(String(row.expense_date), locale) },
        { name: 'method', label: t('finance.paymentMethod'), type: 'select', defaultValue: 'cash',
          options: [
            { value: 'cash', label: t('finance.cash') }, { value: 'card', label: t('finance.card') },
            { value: 'bank_transfer', label: t('finance.bankTransfer') },
          ],
          render: (row) => <Badge tone="neutral">{t(`finance.${row.method === 'bank_transfer' ? 'bankTransfer' : String(row.method)}`, String(row.method))}</Badge> },
        { name: 'payee', label: t('finance.payee') },
        { name: 'description', label: t('finance.description'), hideInTable: true },
      ]}
    />
  );
}
