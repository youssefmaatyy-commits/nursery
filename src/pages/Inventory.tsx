import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import CrudPage from '@/components/CrudPage';
import { Badge } from '@/components/ui';
import { formatCurrency, formatNumber } from '@/lib/utils';

export default function Inventory() {
  const { t, i18n } = useTranslation();
  const { context, can } = useAuth();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';
  const branchId = context?.branches?.[0]?.id ?? null;

  return (
    <CrudPage
      title={t('inventory.title')}
      subtitle={isRtl ? 'المنتجات والأسعار وحدود المخزون' : 'Products, prices and stock thresholds'}
      table="products"
      orderBy={{ column: 'created_at', ascending: false }}
      canCreate={can('inventory.manage')}
      canEdit={can('inventory.manage')}
      searchColumns={['sku', 'name_en', 'name_ar', 'barcode']}
      defaults={{ branch_id: branchId }}
      transformOnSave={(v) => ({
        ...v,
        branch_id: branchId,
        cost_price: Number(v.cost_price), sale_price: Number(v.sale_price),
        stock_qty: Number(v.stock_qty), min_stock: Number(v.min_stock), tax_rate: Number(v.tax_rate),
      })}
      fields={[
        { name: 'sku', label: t('inventory.sku'), required: true },
        { name: 'name_en', label: t('common.nameEn'), required: true },
        { name: 'name_ar', label: t('common.nameAr'), required: true },
        { name: 'barcode', label: t('inventory.barcode') },
        { name: 'cost_price', label: t('inventory.costPrice'), type: 'number',
          render: (r) => formatCurrency(Number(r.cost_price), locale) },
        { name: 'sale_price', label: t('inventory.salePrice'), type: 'number',
          render: (r) => formatCurrency(Number(r.sale_price), locale) },
        { name: 'stock_qty', label: t('inventory.stock'), type: 'number',
          render: (r) => {
            const low = Number(r.stock_qty) <= Number(r.min_stock);
            return <span className={low ? 'font-semibold text-rose-600' : ''}>{formatNumber(Number(r.stock_qty), locale)}</span>;
          } },
        { name: 'min_stock', label: t('inventory.minStock'), type: 'number' },
        { name: 'tax_rate', label: t('common.tax'), type: 'number', hideInTable: true },
        { name: 'unit', label: t('inventory.unit'), hideInTable: true },
      ]}
      extraActions={
        <Badge tone="info">{isRtl ? 'تسوية المخزون من خلال حركات مسجلة' : 'Stock changes are journalled'}</Badge>
      }
    />
  );
}
