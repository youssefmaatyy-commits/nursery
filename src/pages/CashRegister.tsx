import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Wallet, Lock, Unlock, ArrowDownCircle, ArrowUpCircle, Landmark } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { Badge, Button, Card, CardHeader, EmptyState, Input, Modal, PageHeader, TableSkeleton } from '@/components/ui';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { humanizeError } from '@/lib/errors';

export default function CashRegister() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';

  const [openFloat, setOpenFloat] = useState('0');
  const [showOpen, setShowOpen] = useState(false);
  const [closeForm, setCloseForm] = useState({ counted: '', notes: '' });
  const [movement, setMovement] = useState({ type: 'deposit', amount: '', description: '' });

  const { data: register } = useQuery({
    queryKey: ['register'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cash_registers').select('id, code, name').eq('is_active', true).limit(1).maybeSingle();
      if (error) throw error;
      return data as { id: string; code: string; name: string } | null;
    },
  });

  const { data: shift, isLoading } = useQuery({
    queryKey: ['current-shift'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cash_shifts')
        .select('id, opened_at, opening_float, status, expected_cash, counted_cash, difference')
        .eq('status', 'open').order('opened_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data as { id: string; opened_at: string; opening_float: number; status: string } | null;
    },
  });

  const { data: movements } = useQuery({
    queryKey: ['cash-movements', shift?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('cash_movements')
        .select('id, movement_type, amount, description, created_at')
        .eq('shift_id', shift!.id).order('created_at', { ascending: false });
      if (error) throw error;
      return data as Array<{ id: string; movement_type: string; amount: number; description: string | null; created_at: string }>;
    },
    enabled: Boolean(shift?.id),
  });

  const { data: history } = useQuery({
    queryKey: ['shift-history'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cash_shifts')
        .select('id, opened_at, closed_at, opening_float, expected_cash, counted_cash, difference, status')
        .order('opened_at', { ascending: false }).limit(20);
      if (error) throw error;
      return data as Array<Record<string, unknown>>;
    },
  });

  const openShift = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('open_shift', { p_register: register!.id, p_opening_float: Number(openFloat) || 0 });
      if (error) throw error;
    },
    onSuccess: () => {
      push('success', t('common.savedSuccessfully'));
      setShowOpen(false);
      void qc.invalidateQueries({ queryKey: ['current-shift'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: Error) => push('error', humanizeError(e, isRtl ? 'ar' : 'en')),
  });

  const closeShift = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('close_shift', {
        p_shift: shift!.id, p_counted_cash: Number(closeForm.counted) || 0, p_notes: closeForm.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      push('success', t('common.savedSuccessfully'));
      setCloseForm({ counted: '', notes: '' });
      void qc.invalidateQueries({ queryKey: ['current-shift'] });
      void qc.invalidateQueries({ queryKey: ['shift-history'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: Error) => push('error', humanizeError(e, isRtl ? 'ar' : 'en')),
  });

  const addMovement = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('add_cash_movement', {
        p_shift: shift!.id, p_type: movement.type, p_amount: Number(movement.amount),
        p_description: movement.description || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      push('success', t('common.savedSuccessfully'));
      setMovement({ type: 'deposit', amount: '', description: '' });
      void qc.invalidateQueries({ queryKey: ['cash-movements'] });
    },
    onError: (e: Error) => push('error', humanizeError(e, isRtl ? 'ar' : 'en')),
  });

  const cashIn = (movements ?? []).filter((m) => ['sale', 'deposit', 'float'].includes(m.movement_type)).reduce((s, m) => s + Number(m.amount), 0);
  const cashOut = (movements ?? []).filter((m) => ['expense', 'withdrawal', 'refund'].includes(m.movement_type)).reduce((s, m) => s + Number(m.amount), 0);

  return (
    <div>
      <PageHeader title={t('finance.cashRegister')}
        subtitle={isRtl ? 'فتح وإغلاق الورديات ومطابقة النقد' : 'Open and close shifts, reconcile cash'}
        actions={shift ? <Badge tone="success"><Landmark className="h-3.5 w-3.5" /> {t('dashboard.shiftOpen')}</Badge>
          : <Badge tone="warning">{t('dashboard.shiftClosed')}</Badge>} />

      {isLoading ? <Card><TableSkeleton rows={3} cols={3} /></Card> : !shift ? (
        <Card>
          <EmptyState title={t('dashboard.shiftClosed')} icon={<Lock className="h-6 w-6" />}
            description={isRtl ? 'افتح وردية لبدء تسجيل المدفوعات النقدية' : 'Open a shift to start recording cash payments'}
            action={can('cash.operate') && <Button onClick={() => setShowOpen(true)}><Unlock className="h-4 w-4" /> {t('finance.openShift')}</Button>} />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title={isRtl ? 'الحركات النقدية' : 'Cash movements'} action={<Wallet className="h-4 w-4 text-slate-400" />} />
            {!movements?.length ? <EmptyState title={t('common.noData')} /> : (
              <ul className="divide-y divide-slate-100">
                {movements.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className={`grid h-8 w-8 place-items-center rounded-lg ${['sale', 'deposit', 'float'].includes(m.movement_type) ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                      {['sale', 'deposit', 'float'].includes(m.movement_type) ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{t(`finance.${m.movement_type === 'sale' ? 'cash' : m.movement_type}`, m.movement_type)}</p>
                      <p className="truncate text-xs text-slate-400">{m.description ?? '—'}</p>
                    </div>
                    <span className="text-xs text-slate-400">{formatDateTime(m.created_at, locale)}</span>
                    <span className="w-24 text-end font-semibold">{formatCurrency(m.amount, locale)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="space-y-4">
            <Card className="p-4">
              <p className="text-sm text-slate-500">{t('finance.openingFloat')}</p>
              <p className="text-lg font-bold">{formatCurrency(shift.opening_float, locale)}</p>
              <div className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">{t('dashboard.revenueToday')}</span><span className="text-emerald-700">{formatCurrency(cashIn, locale)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">{t('finance.expenses')}</span><span className="text-rose-600">{formatCurrency(cashOut, locale)}</span></div>
                <div className="flex justify-between border-t pt-1 font-bold"><span>{t('finance.expectedCash')}</span><span>{formatCurrency(cashIn - cashOut, locale)}</span></div>
              </div>
              <p className="mt-2 text-xs text-slate-400">{t('finance.openShift')}: {formatDateTime(shift.opened_at, locale)}</p>
            </Card>

            {can('cash.operate') && (
              <Card className="p-4">
                <p className="mb-2 text-sm font-semibold">{isRtl ? 'إيداع / سحب' : 'Deposit / withdrawal'}</p>
                <div className="space-y-2">
                  <select className="input" value={movement.type} onChange={(e) => setMovement({ ...movement, type: e.target.value })}>
                    <option value="deposit">{t('finance.deposit')}</option>
                    <option value="withdrawal">{t('finance.withdrawal')}</option>
                    <option value="expense">{t('finance.expenses')}</option>
                  </select>
                  <Input type="number" min="0" placeholder={t('finance.amount')} value={movement.amount}
                    onChange={(e) => setMovement({ ...movement, amount: e.target.value })} />
                  <Input placeholder={t('finance.description')} value={movement.description}
                    onChange={(e) => setMovement({ ...movement, description: e.target.value })} />
                  <Button className="w-full" size="sm" loading={addMovement.isPending} onClick={() => addMovement.mutate()}>
                    {t('common.save')}
                  </Button>
                </div>
              </Card>
            )}

            <Card className="p-4">
              <p className="mb-2 text-sm font-semibold">{t('finance.closeShift')}</p>
              <div className="space-y-2">
                <Input label={t('finance.countedCash')} type="number" min="0" value={closeForm.counted}
                  onChange={(e) => setCloseForm({ ...closeForm, counted: e.target.value })} />
                <Input label={t('common.notes')} value={closeForm.notes}
                  onChange={(e) => setCloseForm({ ...closeForm, notes: e.target.value })} />
                <Button variant="danger" className="w-full" size="sm" loading={closeShift.isPending}
                  onClick={() => closeShift.mutate()}>
                  <Lock className="h-3.5 w-3.5" /> {t('finance.closeShift')}
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      <Card className="mt-4">
        <CardHeader title={t('finance.shiftReport')} />
        {!history?.length ? <EmptyState title={t('common.noData')} /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr>
                <th>{t('common.date')}</th><th>{t('finance.openingFloat')}</th>
                <th>{t('finance.expectedCash')}</th><th>{t('finance.countedCash')}</th>
                <th>{t('finance.difference')}</th><th>{t('common.status')}</th>
              </tr></thead>
              <tbody>
                {history.map((s) => (
                  <tr key={String(s.id)}>
                    <td className="whitespace-nowrap">{formatDateTime(String(s.opened_at), locale)}</td>
                    <td>{formatCurrency(Number(s.opening_float), locale)}</td>
                    <td>{s.expected_cash ? formatCurrency(Number(s.expected_cash), locale) : '—'}</td>
                    <td>{s.counted_cash ? formatCurrency(Number(s.counted_cash), locale) : '—'}</td>
                    <td className={Number(s.difference) !== 0 ? 'font-semibold text-rose-600' : 'text-slate-400'}>
                      {s.difference !== null ? formatCurrency(Number(s.difference), locale) : '—'}
                    </td>
                    <td><Badge tone={s.status === 'open' ? 'success' : 'neutral'}>{String(s.status)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={showOpen} onClose={() => setShowOpen(false)} title={t('finance.openShift')}
        footer={<>
          <Button variant="secondary" onClick={() => setShowOpen(false)}>{t('common.cancel')}</Button>
          <Button loading={openShift.isPending} onClick={() => openShift.mutate()}>{t('common.confirm')}</Button>
        </>}>
        <Input label={t('finance.openingFloat')} type="number" min="0" value={openFloat} onChange={(e) => setOpenFloat(e.target.value)} />
        <p className="mt-2 text-xs text-slate-500">{register ? `${register.code} — ${register.name}` : ''}</p>
      </Modal>
    </div>
  );
}
