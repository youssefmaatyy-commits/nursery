import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PackagePlus, Plus, Trash2, Truck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { humanizeError } from '@/lib/errors';
import {
  Badge, Button, Card, CardHeader, EmptyState, Input, Modal, PageHeader, Select, TableSkeleton,
} from '@/components/ui';
import { formatCurrency, formatDate } from '@/lib/utils';

interface Purchase { id: string; purchase_number: string; supplier_id: string; purchase_date: string; total: number; status: string }
interface Line { key: string; product_id: string; quantity: string; unit_cost: string }
interface Product { id: string; name_en: string; name_ar: string; cost_price: number | null }
interface Supplier { id: string; name_en: string; name_ar: string }

/**
 * Purchases and stock movements.
 *
 * `purchases`, `purchase_items`, `product_categories` and `inventory_movements`
 * existed with RLS but no screen, so stock could only be corrected by SQL.
 * Receiving a purchase posts the matching `inventory_movements` rows so the
 * stock ledger stays explainable.
 */
export default function Purchases() {
  const { t, i18n } = useTranslation();
  const { context, can } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';
  const branchId = context?.branches?.[0]?.id ?? null;

  const [showNew, setShowNew] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([{ key: 'l1', product_id: '', quantity: '1', unit_cost: '0' }]);

  const { data: purchases, isLoading } = useQuery({
    queryKey: ['purchases', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.from('purchases')
        .select('id, purchase_number, supplier_id, purchase_date, total, status')
        .order('purchase_date', { ascending: false }).limit(200);
      if (error) throw error;
      return data as unknown as Purchase[];
    },
  });

  const { data: suppliers } = useQuery({
    queryKey: ['supplier-options'],
    queryFn: async () => {
      const { data, error } = await supabase.from('suppliers')
        .select('id, name_en, name_ar').eq('is_active', true).order('name_en');
      if (error) throw error;
      return data as Supplier[];
    },
    enabled: showNew,
  });

  const { data: products } = useQuery({
    queryKey: ['product-options'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products')
        .select('id, name_en, name_ar, cost_price').eq('is_active', true).order('name_en');
      if (error) throw error;
      return data as Product[];
    },
    enabled: showNew,
  });

  const { data: movements } = useQuery({
    queryKey: ['inventory-movements', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory_movements')
        .select('id, product_id, movement_type, quantity, notes, created_at, products(name_en, name_ar)')
        .order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return data as unknown as Array<{
        id: string; movement_type: string; quantity: number; notes: string | null;
        created_at: string; products: { name_en: string; name_ar: string } | null;
      }>;
    },
  });

  const total = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0),
    [lines],
  );

  const reset = () => {
    setSupplierId('');
    setPurchaseDate(new Date().toISOString().slice(0, 10));
    setLines([{ key: `l${Date.now()}`, product_id: '', quantity: '1', unit_cost: '0' }]);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error('branch_required');
      const valid = lines.filter((l) => l.product_id && Number(l.quantity) > 0);
      if (!valid.length) throw new Error('no_items');
      if (!supplierId) throw new Error('supplier_required');

      // Header first, then lines, then the stock ledger. Kept in one mutation so a
      // failure is visible instead of leaving a header with no lines.
      const { data: purchase, error: pErr } = await supabase.from('purchases').insert({
        branch_id: branchId,
        supplier_id: supplierId,
        purchase_date: purchaseDate,
        total,
        status: 'received',
        created_by: context?.user_id,
      }).select('id, purchase_number').single();
      if (pErr) throw pErr;

      const { error: iErr } = await supabase.from('purchase_items').insert(
        valid.map((l) => ({
          purchase_id: purchase.id,
          product_id: l.product_id,
          quantity: Number(l.quantity),
          unit_cost: Number(l.unit_cost),
        })),
      );
      if (iErr) throw iErr;

      const { error: mErr } = await supabase.from('inventory_movements').insert(
        valid.map((l) => ({
          branch_id: branchId,
          product_id: l.product_id,
          movement_type: 'purchase',
          quantity: Number(l.quantity),
          unit_cost: Number(l.unit_cost),
          reference_type: 'purchase',
          reference_id: purchase.id,
          notes: purchase.purchase_number,
          created_by: context?.user_id,
        })),
      );
      if (mErr) throw mErr;
      return purchase as { id: string; purchase_number: string };
    },
    onSuccess: (p) => {
      push('success', `${t('common.savedSuccessfully')} · ${p.purchase_number}`);
      setShowNew(false);
      reset();
      void qc.invalidateQueries({ queryKey: ['purchases'] });
      void qc.invalidateQueries({ queryKey: ['inventory-movements'] });
    },
    onError: (e: Error) => push('error', humanizeError(e, isRtl ? 'ar' : 'en')),
  });

  const supplierName = (id: string) => {
    const s = suppliers?.find((x) => x.id === id);
    return s ? (isRtl ? s.name_ar : s.name_en) : '—';
  };

  return (
    <div>
      <PageHeader
        title={isRtl ? 'المشتريات' : 'Purchases'}
        subtitle={isRtl ? 'فواتير الموردين وحركة المخزون' : 'Supplier invoices and stock movements'}
        actions={can('inventory.purchase') && (
          <Button onClick={() => setShowNew(true)}><Plus className="h-4 w-4" /> {t('common.add')}</Button>
        )}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={isRtl ? 'المشتريات' : 'Purchase orders'} action={<Truck className="h-4 w-4 text-slate-400" />} />
          {isLoading ? <TableSkeleton rows={5} cols={4} /> : !purchases?.length ? (
            <EmptyState title={t('common.noData')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr>
                  <th>{isRtl ? 'الرقم' : 'Number'}</th>
                  <th>{isRtl ? 'المورد' : 'Supplier'}</th>
                  <th>{isRtl ? 'التاريخ' : 'Date'}</th>
                  <th>{isRtl ? 'الإجمالي' : 'Total'}</th>
                  <th>{t('common.status')}</th>
                </tr></thead>
                <tbody>
                  {purchases.map((p) => (
                    <tr key={p.id}>
                      <td className="font-mono text-xs">{p.purchase_number}</td>
                      <td>{supplierName(p.supplier_id)}</td>
                      <td className="text-sm text-slate-500">{formatDate(p.purchase_date, locale)}</td>
                      <td>{formatCurrency(Number(p.total), locale)}</td>
                      <td><Badge tone={p.status === 'received' ? 'success' : 'neutral'}>{p.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title={isRtl ? 'حركة المخزون' : 'Stock movements'} action={<PackagePlus className="h-4 w-4 text-slate-400" />} />
          {!movements?.length ? <EmptyState title={t('common.noData')} /> : (
            <ul className="divide-y divide-slate-100">
              {movements.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {isRtl ? m.products?.name_ar : m.products?.name_en}
                    </p>
                    <p className="text-xs text-slate-400">
                      {formatDate(m.created_at, locale)}{m.notes ? ` · ${m.notes}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={m.movement_type === 'purchase' || m.movement_type === 'return' ? 'success' : 'warning'}>
                      {m.movement_type}
                    </Badge>
                    <span className="tabular-nums">{m.quantity}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Modal open={showNew} onClose={() => setShowNew(false)} wide
        title={isRtl ? 'فاتورة مشتريات' : 'New purchase'}
        footer={<>
          <Button variant="secondary" onClick={() => setShowNew(false)}>{t('common.cancel')}</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>
        </>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={isRtl ? 'المورد' : 'Supplier'} value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">—</option>
            {suppliers?.map((s) => <option key={s.id} value={s.id}>{isRtl ? s.name_ar : s.name_en}</option>)}
          </Select>
          <Input label={isRtl ? 'التاريخ' : 'Date'} type="date" value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)} />
        </div>

        <div className="mt-4 space-y-2">
          {lines.map((l, idx) => (
            <div key={l.key} className="grid grid-cols-12 items-end gap-2">
              <div className="col-span-6">
                <Select label={idx === 0 ? (isRtl ? 'الصنف' : 'Product') : undefined} value={l.product_id}
                  onChange={(e) => {
                    const prod = products?.find((p) => p.id === e.target.value);
                    setLines(lines.map((x) => x.key === l.key
                      ? { ...x, product_id: e.target.value, unit_cost: String(prod?.cost_price ?? x.unit_cost) }
                      : x));
                  }}>
                  <option value="">—</option>
                  {products?.map((p) => <option key={p.id} value={p.id}>{isRtl ? p.name_ar : p.name_en}</option>)}
                </Select>
              </div>
              <div className="col-span-2">
                <Input label={idx === 0 ? (isRtl ? 'الكمية' : 'Qty') : undefined} type="number" value={l.quantity}
                  onChange={(e) => setLines(lines.map((x) => x.key === l.key ? { ...x, quantity: e.target.value } : x))} />
              </div>
              <div className="col-span-3">
                <Input label={idx === 0 ? (isRtl ? 'سعر الوحدة' : 'Unit cost') : undefined} type="number" value={l.unit_cost}
                  onChange={(e) => setLines(lines.map((x) => x.key === l.key ? { ...x, unit_cost: e.target.value } : x))} />
              </div>
              <div className="col-span-1">
                {lines.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
          <Button variant="secondary" size="sm"
            onClick={() => setLines([...lines, { key: `l${Date.now()}`, product_id: '', quantity: '1', unit_cost: '0' }])}>
            <Plus className="h-3.5 w-3.5" /> {isRtl ? 'صنف آخر' : 'Add line'}
          </Button>
        </div>

        <p className="mt-4 text-end text-sm font-semibold">
          {isRtl ? 'الإجمالي' : 'Total'}: {formatCurrency(total, locale)}
        </p>
        <p className="mt-1 text-end text-xs text-slate-500">
          {isRtl
            ? 'الحفظ بيسجل حركة مخزون لكل صنف.'
            : 'Saving posts a stock movement for every line.'}
        </p>
      </Modal>
    </div>
  );
}
