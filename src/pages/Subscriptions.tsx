import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarCheck, Plus, RefreshCw, Ban, PlayCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { Badge, Button, EmptyState, Input, Modal, PageHeader, Select, TableSkeleton } from '@/components/ui';
import { formatCurrency, formatDate } from '@/lib/utils';
import { humanizeError } from '@/lib/errors';

interface Sub {
  id: string; status: string; start_date: string; end_date: string; total_price: number;
  paid_amount: number; sessions_total: number; sessions_used: number; minutes_total: number; minutes_used: number;
  children: { full_name_en: string; full_name_ar: string; child_code: string } | null;
  packages: { name_en: string; name_ar: string; package_type: string } | null;
}

const tone: Record<string, 'success' | 'warning' | 'neutral' | 'danger' | 'info'> = {
  active: 'success', pending: 'warning', suspended: 'info', cancelled: 'neutral', expired: 'danger',
};

export default function Subscriptions() {
  const { t, i18n } = useTranslation();
  const { context, can } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';
  const branchId = context?.branches?.[0]?.id ?? null;

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ child_id: '', package_id: '', discount: '0' });

  const { data: subs, isLoading } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('subscriptions')
        .select('id, status, start_date, end_date, total_price, paid_amount, sessions_total, sessions_used, minutes_total, minutes_used, children(full_name_en, full_name_ar, child_code), packages(name_en, name_ar, package_type)')
        .order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return data as unknown as Sub[];
    },
  });

  const { data: packages } = useQuery({
    queryKey: ['packages'],
    queryFn: async () => {
      const { data, error } = await supabase.from('packages').select('id, code, name_en, name_ar, price, validity_days, hours_included, sessions_included').eq('is_active', true);
      if (error) throw error;
      return data as Array<{ id: string; code: string; name_en: string; name_ar: string; price: number; validity_days: number; hours_included: number; sessions_included: number }>;
    },
  });

  const { data: children } = useQuery({
    queryKey: ['sub-children', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_children', { p_query: '', p_branch: branchId, p_limit: 100 });
      if (error) throw error;
      return data as unknown as Array<{ id: string; child_code: string; full_name_en: string; full_name_ar: string }>;
    },
    enabled: showNew,
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('create_subscription', {
        p_child: form.child_id, p_package: form.package_id, p_start: new Date().toISOString().slice(0, 10),
        p_discount: Number(form.discount) || 0, p_create_invoice: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      push('success', t('common.savedSuccessfully'));
      setShowNew(false);
      void qc.invalidateQueries({ queryKey: ['subscriptions'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: Error) => push('error', humanizeError(e, isRtl ? 'ar' : 'en')),
  });

  const renew = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('renew_subscription', { p_subscription: id, p_create_invoice: true });
      if (error) throw error;
    },
    onSuccess: () => { push('success', t('common.savedSuccessfully')); void qc.invalidateQueries({ queryKey: ['subscriptions'] }); },
    onError: (e: Error) => push('error', humanizeError(e, isRtl ? 'ar' : 'en')),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.rpc('set_subscription_status', { p_subscription: id, p_status: status });
      if (error) throw error;
    },
    onSuccess: () => { push('success', t('common.savedSuccessfully')); void qc.invalidateQueries({ queryKey: ['subscriptions'] }); },
    onError: (e: Error) => push('error', humanizeError(e, isRtl ? 'ar' : 'en')),
  });

  return (
    <div>
      <PageHeader title={t('subscriptions.title')}
        subtitle={isRtl ? 'الباقات الزمنية والجلسات واستهلاكها' : 'Time and session packages and their usage'}
        actions={can('subscriptions.manage') && (
          <Button onClick={() => setShowNew(true)}><Plus className="h-4 w-4" /> {t('subscriptions.new')}</Button>
        )} />

      <div className="table-wrap">
        {isLoading ? <TableSkeleton rows={6} cols={6} /> : !subs?.length ? (
          <EmptyState title={t('common.noData')} icon={<CalendarCheck className="h-6 w-6" />} />
        ) : (
          <table className="table">
            <thead><tr>
              <th>{t('children.title')}</th><th>{t('subscriptions.package')}</th>
              <th>{t('subscriptions.validity')}</th>
              <th>{t('subscriptions.minutesRemaining')}</th>
              <th>{t('common.balance')}</th><th>{t('common.status')}</th>
              <th className="text-end">{t('common.actions')}</th>
            </tr></thead>
            <tbody>
              {subs.map((s) => {
                const minsLeft = s.minutes_total - s.minutes_used;
                const sessionsLeft = s.sessions_total - s.sessions_used;
                const bal = s.total_price - s.paid_amount;
                return (
                  <tr key={s.id}>
                    <td>
                      <p className="font-medium">{isRtl ? s.children?.full_name_ar : s.children?.full_name_en}</p>
                      <p className="text-xs text-slate-400">{s.children?.child_code}</p>
                    </td>
                    <td>{isRtl ? s.packages?.name_ar : s.packages?.name_en}</td>
                    <td className="whitespace-nowrap text-slate-500">
                      {formatDate(s.start_date, locale)} → {formatDate(s.end_date, locale)}
                    </td>
                    <td>
                      {s.minutes_total > 0 ? (
                        <span className="text-sm">{Math.max(0, minsLeft)} / {s.minutes_total}</span>
                      ) : (
                        <span className="text-sm">{Math.max(0, sessionsLeft)} / {s.sessions_total} {isRtl ? 'جلسة' : 'sessions'}</span>
                      )}
                    </td>
                    <td className={bal > 0 ? 'font-medium text-rose-600' : 'text-emerald-700'}>{formatCurrency(bal, locale)}</td>
                    <td><Badge tone={tone[s.status] ?? 'neutral'}>{t(`subscriptions.${s.status === 'active' ? 'active' : s.status}`, s.status)}</Badge></td>
                    <td className="text-end">
                      {can('subscriptions.manage') && (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => renew.mutate(s.id)} title={t('subscriptions.renew')}>
                            <RefreshCw className="h-3.5 w-3.5" />
                          </Button>
                          {s.status === 'active' ? (
                            <Button variant="ghost" size="sm" onClick={() => setStatus.mutate({ id: s.id, status: 'suspended' })}>
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => setStatus.mutate({ id: s.id, status: 'active' })}>
                              <PlayCircle className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={showNew} onClose={() => setShowNew(false)} title={t('subscriptions.new')}
        footer={<>
          <Button variant="secondary" onClick={() => setShowNew(false)}>{t('common.cancel')}</Button>
          <Button loading={create.isPending} disabled={!form.child_id || !form.package_id} onClick={() => create.mutate()}>
            {t('common.save')}
          </Button>
        </>}>
        <div className="space-y-3">
          <Select label={t('children.title')} required value={form.child_id}
            onChange={(e) => setForm({ ...form, child_id: e.target.value })}>
            <option value="">—</option>
            {children?.map((c) => <option key={c.id} value={c.id}>{isRtl ? c.full_name_ar : c.full_name_en} · {c.child_code}</option>)}
          </Select>
          <Select label={t('subscriptions.package')} required value={form.package_id}
            onChange={(e) => setForm({ ...form, package_id: e.target.value })}>
            <option value="">—</option>
            {packages?.map((p) => (
              <option key={p.id} value={p.id}>
                {isRtl ? p.name_ar : p.name_en} — {formatCurrency(p.price, locale)}
              </option>
            ))}
          </Select>
          <Input label={t('common.discount')} type="number" min="0" value={form.discount}
            onChange={(e) => setForm({ ...form, discount: e.target.value })} />
          <p className="text-xs text-slate-500">{isRtl
            ? 'يُنشئ النظام فاتورة تلقائياً للاشتراك، ويمكن تحصيلها من صفحة الفواتير.'
            : 'An invoice is created automatically and can be collected from the invoices page.'}</p>
        </div>
      </Modal>
    </div>
  );
}
