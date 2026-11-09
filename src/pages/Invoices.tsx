import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Receipt, Printer, CreditCard, Undo2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import {
  Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, TableSkeleton,
} from '@/components/ui';
import { downloadCsv, formatCurrency, formatDateTime, newIdempotencyKey, printElement } from '@/lib/utils';

interface InvoiceRow {
  id: string; invoice_number: string; total: number; paid_amount: number; balance: number;
  status: string; issued_at: string; currency: string;
  children: { full_name_en: string; full_name_ar: string; child_code: string } | null;
  customer_name: string | null;
}
interface PaymentRow { id: string; amount: number; method: string; payment_number: string; paid_at: string; status: string }

const tone: Record<string, 'success' | 'warning' | 'info' | 'neutral' | 'danger'> = {
  paid: 'success', issued: 'warning', partially_paid: 'info', void: 'neutral', refunded: 'danger',
};

export default function Invoices() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';

  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<InvoiceRow | null>(null);
  const [payment, setPayment] = useState({ amount: '', method: 'cash', reference: '' });
  const [refund, setRefund] = useState<{ payment: PaymentRow | null; amount: string; reason: string }>({ payment: null, amount: '', reason: '' });

  const { data: invoices, isLoading } = useQuery({
    queryKey: ['invoices', status],
    queryFn: async () => {
      let q = supabase.from('invoices')
        .select('id, invoice_number, total, paid_amount, balance, status, issued_at, currency, customer_name, children(full_name_en, full_name_ar, child_code)')
        .order('issued_at', { ascending: false }).limit(200);
      if (status !== 'all') q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as InvoiceRow[];
    },
  });

  const { data: detail } = useQuery({
    queryKey: ['invoice-detail', selected?.id],
    queryFn: async () => {
      const [{ data: items }, { data: payments }] = await Promise.all([
        supabase.from('invoice_items').select('*').eq('invoice_id', selected!.id),
        supabase.from('payments').select('id, amount, method, payment_number, paid_at, status').eq('invoice_id', selected!.id).order('paid_at'),
      ]);
      return { items: items ?? [], payments: (payments ?? []) as PaymentRow[] };
    },
    enabled: Boolean(selected),
  });

  const pay = useMutation({
    mutationFn: async () => {
      const amount = Number(payment.amount);
      if (!amount || amount <= 0) throw new Error(t('common.required'));
      const { error } = await supabase.rpc('record_payment', {
        p_invoice: selected!.id, p_amount: amount, p_method: payment.method,
        p_reference: payment.reference || null, p_idempotency_key: newIdempotencyKey('pay'), p_shift: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      push('success', t('finance.paymentRecorded'));
      setPayment({ amount: '', method: 'cash', reference: '' });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['invoice-detail'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      setSelected(null);
    },
    onError: (e: Error) => push('error', e.message),
  });

  const doRefund = useMutation({
    mutationFn: async () => {
      const amount = Number(refund.amount);
      if (!amount || amount <= 0) throw new Error(t('common.required'));
      const { error } = await supabase.rpc('refund_payment', {
        p_payment: refund.payment!.id, p_amount: amount, p_reason: refund.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      push('success', t('common.savedSuccessfully'));
      setRefund({ payment: null, amount: '', reason: '' });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['invoice-detail'] });
    },
    onError: (e: Error) => push('error', e.message),
  });

  const filtered = (invoices ?? []).filter((inv) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const name = isRtl ? inv.children?.full_name_ar : inv.children?.full_name_en;
    return inv.invoice_number.toLowerCase().includes(q) || (name ?? inv.customer_name ?? '').toLowerCase().includes(q);
  });

  const exportRows = () => downloadCsv('invoices', filtered.map((i) => ({
    invoice: i.invoice_number, date: i.issued_at,
    customer: (isRtl ? i.children?.full_name_ar : i.children?.full_name_en) ?? i.customer_name ?? '',
    total: i.total, paid: i.paid_amount, balance: i.balance, status: i.status,
  })));

  return (
    <div>
      <PageHeader title={t('finance.invoices')}
        subtitle={isRtl ? 'جميع الفواتير والمدفوعات — السجلات المالية غير قابلة للحذف' : 'All invoices and payments — financial records are immutable'}
        actions={<>
          <Input className="w-56" placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            <option value="all">{t('common.all')}</option>
            <option value="issued">{t('finance.issued')}</option>
            <option value="partially_paid">{t('finance.partiallyPaid')}</option>
            <option value="paid">{t('finance.invoicePaid')}</option>
          </Select>
          {can('reports.export') && <Button variant="secondary" onClick={exportRows}>{t('common.export')}</Button>}
        </>} />

      <div className="table-wrap">
        {isLoading ? <TableSkeleton rows={6} cols={6} /> : !filtered.length ? (
          <EmptyState title={t('common.noData')} icon={<Receipt className="h-6 w-6" />} />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('finance.invoiceNumber')}</th>
                <th>{t('finance.customer')}</th>
                <th>{t('common.date')}</th>
                <th>{t('common.total')}</th>
                <th>{t('common.paid')}</th>
                <th>{t('common.balance')}</th>
                <th>{t('common.status')}</th>
                <th className="text-end">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr key={inv.id} className="cursor-pointer" onClick={() => setSelected(inv)}>
                  <td className="font-mono text-xs">{inv.invoice_number}</td>
                  <td>
                    <p className="font-medium">{(isRtl ? inv.children?.full_name_ar : inv.children?.full_name_en) ?? inv.customer_name ?? '—'}</p>
                    {inv.children && <p className="text-xs text-slate-400">{inv.children.child_code}</p>}
                  </td>
                  <td className="whitespace-nowrap text-slate-500">{formatDateTime(inv.issued_at, locale)}</td>
                  <td className="font-semibold">{formatCurrency(inv.total, locale)}</td>
                  <td className="text-emerald-700">{formatCurrency(inv.paid_amount, locale)}</td>
                  <td className={inv.balance > 0 ? 'font-medium text-rose-600' : 'text-slate-400'}>{formatCurrency(inv.balance, locale)}</td>
                  <td><Badge tone={tone[inv.status] ?? 'neutral'}>{t(`finance.${inv.status === 'paid' ? 'invoicePaid' : inv.status}`, inv.status)}</Badge></td>
                  <td className="text-end">
                    <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelected(inv); }}>{t('common.view')}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} wide title={`${t('finance.invoiceNumber')} ${selected?.invoice_number ?? ''}`}
        footer={<>
          <Button variant="secondary" onClick={() => printElement('invoice-print', selected?.invoice_number ?? 'invoice')}>
            <Printer className="h-4 w-4" /> {t('common.print')}
          </Button>
          {selected && selected.balance > 0 && can('finance.payment') && (
            <Button onClick={() => pay.mutate()} loading={pay.isPending}>
              <CreditCard className="h-4 w-4" /> {t('finance.recordPayment')}
            </Button>
          )}
        </>}>
        {selected && (
          <div className="space-y-4">
            <div id="invoice-print" className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold">{isRtl ? 'فاتورة' : 'INVOICE'}</h3>
                  <p className="font-mono text-sm text-slate-500">{selected.invoice_number}</p>
                </div>
                <div className="text-end text-sm">
                  <p className="font-medium">{(isRtl ? selected.children?.full_name_ar : selected.children?.full_name_en) ?? selected.customer_name}</p>
                  <p className="text-xs text-slate-400">{formatDateTime(selected.issued_at, locale)}</p>
                </div>
              </div>
              <table className="table">
                <thead><tr>
                  <th>{t('finance.description')}</th><th>{t('finance.quantity')}</th>
                  <th>{t('finance.unitPrice')}</th><th>{t('finance.lineTotal')}</th>
                </tr></thead>
                <tbody>
                  {detail?.items.map((it) => (
                    <tr key={it.id}>
                      <td>{isRtl ? it.description_ar : it.description_en}</td>
                      <td>{Number(it.quantity)}</td>
                      <td>{formatCurrency(it.unit_price, locale)}</td>
                      <td>{formatCurrency(it.line_total, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 ms-auto max-w-xs space-y-1 text-sm">
                <div className="flex justify-between"><span>{t('common.subtotal')}</span><span>{formatCurrency(selected.total, locale)}</span></div>
                <div className="flex justify-between"><span>{t('common.paid')}</span><span>{formatCurrency(selected.paid_amount, locale)}</span></div>
                <div className="flex justify-between border-t pt-1 font-bold"><span>{t('common.balance')}</span><span>{formatCurrency(selected.balance, locale)}</span></div>
              </div>
            </div>

            {can('finance.payment') && selected.balance > 0 && (
              <div className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-3">
                <Input label={t('finance.amount')} type="number" min="0" max={selected.balance} value={payment.amount}
                  onChange={(e) => setPayment({ ...payment, amount: e.target.value })} />
                <Select label={t('finance.paymentMethod')} value={payment.method}
                  onChange={(e) => setPayment({ ...payment, method: e.target.value })}>
                  <option value="cash">{t('finance.cash')}</option>
                  <option value="card">{t('finance.card')}</option>
                  <option value="bank_transfer">{t('finance.bankTransfer')}</option>
                  <option value="wallet">{t('finance.wallet')}</option>
                </Select>
                <Input label={t('common.notes')} value={payment.reference}
                  onChange={(e) => setPayment({ ...payment, reference: e.target.value })} />
              </div>
            )}

            <div>
              <p className="mb-2 text-sm font-semibold">{t('finance.payments')}</p>
              {!detail?.payments.length ? <p className="text-sm text-slate-400">{t('common.noData')}</p> : (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {detail.payments.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="font-mono text-xs text-slate-400">{p.payment_number}</span>
                      <span>{formatCurrency(p.amount, locale)}</span>
                      <Badge tone="neutral">{t(`finance.${p.method === 'bank_transfer' ? 'bankTransfer' : p.method}`, p.method)}</Badge>
                      {p.status === 'reversed' && <Badge tone="danger">{t('finance.refunded')}</Badge>}
                      <span className="ms-auto text-xs text-slate-400">{formatDateTime(p.paid_at, locale)}</span>
                      {can('finance.refund') && p.status === 'completed' && (
                        <Button variant="ghost" size="sm" onClick={() => setRefund({ payment: p, amount: String(p.amount), reason: '' })}>
                          <Undo2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(refund.payment)} onClose={() => setRefund({ payment: null, amount: '', reason: '' })}
        title={t('finance.refund')}
        footer={<>
          <Button variant="secondary" onClick={() => setRefund({ payment: null, amount: '', reason: '' })}>{t('common.cancel')}</Button>
          <Button variant="danger" loading={doRefund.isPending} onClick={() => doRefund.mutate()}>{t('common.confirm')}</Button>
        </>}>
        <div className="space-y-3">
          <Input label={t('finance.amount')} type="number" min="0" value={refund.amount}
            onChange={(e) => setRefund({ ...refund, amount: e.target.value })} />
          <Input label={t('finance.refundReason')} required value={refund.reason}
            onChange={(e) => setRefund({ ...refund, reason: e.target.value })} />
          <p className="text-xs text-slate-500">{t('finance.refund')}: {isRtl
            ? 'يتم تسجيل الاسترداد كقيد عكسي ولا يُحذف الدفع الأصلي.'
            : 'Refunds are recorded as reversal entries; the original payment is never deleted.'}</p>
        </div>
      </Modal>
          </div>
  );
}
