import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Minus, Trash2, ShoppingCart, CreditCard, Banknote, Search, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, Select } from '@/components/ui';
import { formatCurrency, newIdempotencyKey } from '@/lib/utils';
import { humanizeError } from '@/lib/errors';

interface Product {
  id: string; sku: string; name_en: string; name_ar: string; sale_price: number; stock_qty: number; tax_rate: number;
}
interface Service {
  id: string; code: string; name_en: string; name_ar: string; base_price: number; tax_rate: number; service_type: string;
}
interface CartLine {
  key: string; product_id?: string; service_id?: string;
  description_en: string; description_ar: string; quantity: number; unit_price: number; tax_rate: number;
}

type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'wallet';

export default function POS() {
  const { t, i18n } = useTranslation();
  const { context, can } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';
  const branchId = context?.branches?.[0]?.id ?? null;

  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState('');
  const [discount, setDiscount] = useState('0');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [payNow, setPayNow] = useState(true);
  const [customer, setCustomer] = useState('');
  const [lastInvoice, setLastInvoice] = useState<Record<string, unknown> | null>(null);

  const { data: products } = useQuery({
    queryKey: ['pos-products', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.from('products')
        .select('id, sku, name_en, name_ar, sale_price, stock_qty, tax_rate')
        .eq('is_active', true).order('name_en');
      if (error) throw error;
      return data as Product[];
    },
  });

  const { data: services } = useQuery({
    queryKey: ['pos-services'],
    queryFn: async () => {
      const { data, error } = await supabase.from('services').select('id, code, name_en, name_ar, base_price, tax_rate, service_type').eq('is_active', true);
      if (error) throw error;
      return data as Service[];
    },
  });

  const { data: openShift } = useQuery({
    queryKey: ['open-shift', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.from('cash_shifts').select('id, opened_at').eq('status', 'open').maybeSingle();
      if (error) throw error;
      return data as { id: string; opened_at: string } | null;
    },
  });

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products ?? [];
    return (products ?? []).filter((p) =>
      p.name_en.toLowerCase().includes(q) || p.name_ar.includes(search) || p.sku.toLowerCase().includes(q));
  }, [products, search]);

  const subtotal = cart.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const taxTotal = cart.reduce((s, l) => {
    const line = Math.max(0, l.quantity * l.unit_price);
    return s + (line * l.tax_rate) / 100;
  }, 0);
  const discountNum = Math.min(Number(discount) || 0, subtotal);
  const total = Math.max(0, subtotal - discountNum + taxTotal);

  const addLine = (patch: Partial<CartLine> & { description_en: string; description_ar: string; unit_price: number }) => {
    setCart((prev) => {
      const key = patch.product_id ?? patch.service_id ?? `${Date.now()}`;
      const existing = prev.find((l) => l.key === key);
      if (existing) return prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { key, quantity: 1, tax_rate: 0, ...patch } as CartLine];
    });
  };

  const changeQty = (key: string, delta: number) =>
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, quantity: Math.max(0, l.quantity + delta) } : l)).filter((l) => l.quantity > 0));

  const sale = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error('no_branch');
      if (!cart.length) throw new Error(t('finance.emptyCart'));
      const idempotencyKey = newIdempotencyKey('pos');

      const { data, error } = await supabase.rpc('create_invoice', {
        p_branch: branchId,
        p_items: cart.map((l) => ({
          description_en: l.description_en, description_ar: l.description_ar,
          quantity: l.quantity, unit_price: l.unit_price, discount: 0, tax_rate: l.tax_rate,
          product_id: l.product_id ?? null, service_id: l.service_id ?? null,
        })),
        p_child: null, p_parent: null, p_customer_name: customer || (isRtl ? 'عميل نقدي' : 'Walk-in'),
        p_discount: discountNum, p_source: 'pos', p_source_id: null,
        p_idempotency_key: idempotencyKey, p_notes: null, p_due_date: null,
      });
      if (error) throw error;
      const invoice = data as { id: string; invoice_number: string; total: number; balance: number };

      if (payNow && invoice.balance > 0) {
        const { error: payError } = await supabase.rpc('record_payment', {
          p_invoice: invoice.id, p_amount: invoice.balance, p_method: method,
          p_reference: null, p_idempotency_key: `${idempotencyKey}-pay`, p_shift: null,
        });
        if (payError) throw payError;
      }
      return invoice;
    },
    onSuccess: (invoice) => {
      setLastInvoice(invoice as unknown as Record<string, unknown>);
      push('success', `${t('common.savedSuccessfully')} · ${invoice.invoice_number}`);
      setCart([]); setDiscount('0'); setCustomer('');
      void qc.invalidateQueries({ queryKey: ['pos-products'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (e: Error) => push('error', humanizeError(e, isRtl ? 'ar' : 'en')),
  });

  return (
    <div>
      <PageHeader title={t('finance.pos')}
        subtitle={isRtl ? 'بيع سريع للمنتجات وخدمات منطقة الأطفال' : 'Quick sale of products and kids area services'}
        actions={openShift ? <Badge tone="success"><CheckCircle2 className="h-3.5 w-3.5" /> {t('dashboard.shiftOpen')}</Badge>
          : <Badge tone="warning">{t('dashboard.shiftClosed')}</Badge>} />

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title={t('inventory.products')} />
          <div className="p-4">
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-slate-400" />
              <Input className="ps-9" placeholder={isRtl ? 'ابحث أو امسح الباركود…' : 'Search or scan barcode…'}
                value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="grid max-h-96 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              {filteredProducts.map((p) => (
                <button key={p.id} onClick={() => addLine({
                  product_id: p.id, description_en: p.name_en, description_ar: p.name_ar,
                  unit_price: p.sale_price, tax_rate: p.tax_rate,
                })}
                  className="rounded-xl border border-slate-200 p-3 text-start transition hover:border-brand-400 hover:bg-brand-50/40">
                  <p className="truncate text-sm font-medium">{isRtl ? p.name_ar : p.name_en}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{p.sku}</p>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-sm font-semibold text-brand-800">{formatCurrency(p.sale_price, locale)}</span>
                    <span className={`text-xs ${p.stock_qty <= 0 ? 'text-rose-600' : 'text-slate-400'}`}>{p.stock_qty}</span>
                  </div>
                </button>
              ))}
            </div>

            <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('admin.services')}</p>
            <div className="flex flex-wrap gap-2">
              {services?.map((s) => (
                <button key={s.id} onClick={() => addLine({
                  service_id: s.id, description_en: s.name_en, description_ar: s.name_ar,
                  unit_price: s.base_price, tax_rate: s.tax_rate,
                })}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium hover:border-brand-400 hover:bg-brand-50">
                  {isRtl ? s.name_ar : s.name_en} · {formatCurrency(s.base_price, locale)}
                </button>
              ))}
            </div>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={t('finance.cart')} action={<ShoppingCart className="h-4 w-4 text-slate-400" />} />
          {!cart.length ? <EmptyState title={t('finance.emptyCart')} icon={<ShoppingCart className="h-6 w-6" />} /> : (
            <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
              {cart.map((l) => (
                <li key={l.key} className="flex items-center gap-2 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{isRtl ? l.description_ar : l.description_en}</p>
                    <p className="text-xs text-slate-400">{formatCurrency(l.unit_price, locale)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => changeQty(l.key, -1)} className="rounded p-1 hover:bg-slate-100"><Minus className="h-3.5 w-3.5" /></button>
                    <span className="w-6 text-center text-sm font-semibold">{l.quantity}</span>
                    <button onClick={() => changeQty(l.key, 1)} className="rounded p-1 hover:bg-slate-100"><Plus className="h-3.5 w-3.5" /></button>
                  </div>
                  <span className="w-16 text-end text-sm font-semibold">{formatCurrency(l.quantity * l.unit_price, locale)}</span>
                  <button onClick={() => setCart((p) => p.filter((x) => x.key !== l.key))} className="text-slate-300 hover:text-rose-500">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-3 border-t border-slate-100 p-4">
            <Input label={t('finance.customer')} value={customer} onChange={(e) => setCustomer(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <Input label={t('common.discount')} type="number" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              <Select label={t('finance.paymentMethod')} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                <option value="cash">{t('finance.cash')}</option>
                <option value="card">{t('finance.card')}</option>
                <option value="bank_transfer">{t('finance.bankTransfer')}</option>
                <option value="wallet">{t('finance.wallet')}</option>
              </Select>
            </div>

            <div className="space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">{t('common.subtotal')}</span><span>{formatCurrency(subtotal, locale)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">{t('common.discount')}</span><span>-{formatCurrency(discountNum, locale)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">{t('common.tax')}</span><span>{formatCurrency(taxTotal, locale)}</span></div>
              <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-bold">
                <span>{t('common.total')}</span><span>{formatCurrency(total, locale)}</span>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              {isRtl ? 'تحصيل المبلغ الآن' : 'Collect payment now'}
            </label>

            <Button className="w-full" disabled={!cart.length || !can(['pos.sell', 'finance.create_invoice'])} loading={sale.isPending}
              onClick={() => sale.mutate()}>
              {method === 'cash' ? <Banknote className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
              {t('finance.checkout')} · {formatCurrency(total, locale)}
            </Button>

            {lastInvoice && (
              <Alert tone="success">
                {isRtl ? 'تم إنشاء الفاتورة' : 'Invoice created'}: <strong>{String(lastInvoice.invoice_number)}</strong>
              </Alert>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
