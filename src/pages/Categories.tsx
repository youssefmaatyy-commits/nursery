import { useTranslation } from 'react-i18next';
import CrudPage from '@/components/CrudPage';
import { useAuth } from '@/hooks/useAuth';

/**
 * Product categories.
 *
 * `product_categories` existed since migration 0005 and `products.category_id`
 * pointed at it, but there was no way to create a category — so every product
 * was uncategorised.
 */
export default function Categories() {
  const { t, i18n } = useTranslation();
  const { context, can } = useAuth();
  const isRtl = i18n.language === 'ar';
  const branchId = context?.branches?.[0]?.id ?? null;

  return (
    <CrudPage
      title={isRtl ? 'تصنيفات المنتجات' : 'Product categories'}
      subtitle={isRtl ? 'تجميع المنتجات لتقارير المخزون' : 'Group products for stock reporting'}
      table="product_categories"
      orderBy={{ column: 'name_en', ascending: true }}
      select="id, name_en, name_ar, branch_id"
      canCreate={can('inventory.manage')}
      canEdit={can('inventory.manage')}
      searchColumns={['name_en', 'name_ar']}
      defaults={{ branch_id: branchId }}
      transformOnSave={(v) => ({ ...v, branch_id: branchId })}
      fields={[
        { name: 'name_en', label: t('common.nameEn'), required: true },
        { name: 'name_ar', label: t('common.nameAr'), required: true },
      ]}
    />
  );
}
