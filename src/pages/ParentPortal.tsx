import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Baby, CalendarX, Receipt, ClipboardList } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { Badge, Button, Card, CardHeader, EmptyState, Input, Modal, PageHeader, TableSkeleton } from '@/components/ui';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';

export default function ParentPortal() {
  const { t, i18n } = useTranslation();
  const { context } = useAuth();
  const { push } = useToast();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';
  const children = context?.parent_children ?? [];
  const [selectedChild, setSelectedChild] = useState<string | null>(null);
  const [showAbsence, setShowAbsence] = useState(false);
  const [absence, setAbsence] = useState({ date: new Date().toISOString().slice(0, 10), reason: '' });

  const activeChild = selectedChild ?? children[0]?.id ?? null;

  const { data: invoices, isLoading: invLoading } = useQuery({
    queryKey: ['portal-invoices'],
    queryFn: async () => {
      const { data, error } = await supabase.from('invoices')
        .select('id, invoice_number, total, paid_amount, balance, status, issued_at')
        .order('issued_at', { ascending: false }).limit(50);
      if (error) throw error;
      return data as Array<{ id: string; invoice_number: string; total: number; paid_amount: number; balance: number; status: string; issued_at: string }>;
    },
  });

  const { data: reports } = useQuery({
    queryKey: ['portal-reports', activeChild],
    queryFn: async () => {
      const { data, error } = await supabase.from('daily_child_reports')
        .select('id, report_date, mood, behavior, learning_progress, health_observations, teacher_comments, meals, sleep')
        .eq('child_id', activeChild!).eq('visible_to_parent', true)
        .order('report_date', { ascending: false }).limit(20);
      if (error) throw error;
      return data as Array<Record<string, unknown>>;
    },
    enabled: Boolean(activeChild),
  });

  const { data: attendance } = useQuery({
    queryKey: ['portal-attendance', activeChild],
    queryFn: async () => {
      const { data, error } = await supabase.from('nursery_attendance')
        .select('attendance_date, status, check_in_at, check_out_at')
        .eq('child_id', activeChild!).order('attendance_date', { ascending: false }).limit(20);
      if (error) throw error;
      return data as Array<{ attendance_date: string; status: string; check_in_at: string | null; check_out_at: string | null }>;
    },
    enabled: Boolean(activeChild),
  });

  const { data: subscriptions } = useQuery({
    queryKey: ['portal-subs', activeChild],
    queryFn: async () => {
      const { data, error } = await supabase.from('subscriptions')
        .select('id, status, start_date, end_date, minutes_total, minutes_used, sessions_total, sessions_used, total_price, paid_amount, packages(name_en, name_ar)')
        .eq('child_id', activeChild!).order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as Array<Record<string, unknown>>;
    },
    enabled: Boolean(activeChild),
  });

  const notifyAbsence = useMutation({
    mutationFn: async () => {
      if (!activeChild) throw new Error('no_child');
      const { error } = await supabase.rpc('mark_absence', {
        p_child: activeChild, p_date: absence.date, p_reason: absence.reason || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      push('success', t('portal.absenceSubmitted'));
      setShowAbsence(false);
      setAbsence({ date: new Date().toISOString().slice(0, 10), reason: '' });
    },
    onError: (e: Error) => push('error', e.message),
  });

  const outstanding = (invoices ?? []).reduce((s, i) => s + Number(i.balance), 0);

  if (!children.length) {
    return (
      <div>
        <PageHeader title={t('portal.title')} />
        <Card><EmptyState title={t('portal.noChildrenLinked')} icon={<Baby className="h-6 w-6" />} /></Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t('portal.title')}
        subtitle={`${t('portal.welcome')} ${isRtl ? context?.profile?.full_name_ar : context?.profile?.full_name_en}`}
        actions={<>
          <Badge tone={outstanding > 0 ? 'warning' : 'success'}>
            {t('portal.outstandingBalance')}: {formatCurrency(outstanding, locale)}
          </Badge>
          <Button variant="secondary" onClick={() => setShowAbsence(true)}>
            <CalendarX className="h-4 w-4" /> {t('portal.notifyAbsence')}
          </Button>
        </>} />

      <div className="mb-4 flex flex-wrap gap-2">
        {children.map((c) => (
          <button key={c.id} onClick={() => setSelectedChild(c.id)}
            className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
              activeChild === c.id ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
            {isRtl ? c.name_ar : c.name_en}
            <span className="ms-2 font-mono text-[11px] text-slate-400">{c.code}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('portal.attendance')} />
          {!attendance?.length ? <EmptyState title={t('common.noData')} /> : (
            <ul className="divide-y divide-slate-100">
              {attendance.map((a) => (
                <li key={a.attendance_date} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                  <span className="text-slate-500">{formatDate(a.attendance_date, locale)}</span>
                  <span className="ms-auto text-xs text-slate-400">
                    {a.check_in_at ? formatDateTime(a.check_in_at, locale) : '—'}
                  </span>
                  <Badge tone={a.status === 'absent' ? 'danger' : a.status === 'late' ? 'warning' : 'success'}>
                    {t(`nursery.${a.status}`, a.status)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={t('portal.reports')} action={<ClipboardList className="h-4 w-4 text-slate-400" />} />
          {!reports?.length ? <EmptyState title={t('common.noData')} /> : (
            <ul className="divide-y divide-slate-100">
              {reports.map((r) => (
                <li key={String(r.id)} className="px-4 py-3">
                  <p className="text-sm font-medium">{formatDate(String(r.report_date), locale)}</p>
                  <div className="mt-1 space-y-0.5 text-xs text-slate-500">
                    {r.mood ? <p>{t('nursery.mood')}: {String(r.mood)}</p> : null}
                    {r.behavior ? <p>{t('nursery.behavior')}: {String(r.behavior)}</p> : null}
                    {r.learning_progress ? <p>{t('nursery.learningProgress')}: {String(r.learning_progress)}</p> : null}
                    {r.teacher_comments ? <p className="italic">“{String(r.teacher_comments)}”</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={t('portal.invoices')} action={<Receipt className="h-4 w-4 text-slate-400" />} />
          {invLoading ? <TableSkeleton rows={3} cols={3} /> : !invoices?.length ? <EmptyState title={t('common.noData')} /> : (
            <ul className="divide-y divide-slate-100">
              {invoices.map((i) => (
                <li key={i.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs">{i.invoice_number}</p>
                    <p className="text-[11px] text-slate-400">{formatDate(i.issued_at, locale)}</p>
                  </div>
                  <span className="font-semibold">{formatCurrency(i.total, locale)}</span>
                  <Badge tone={i.balance > 0 ? 'warning' : 'success'}>
                    {i.balance > 0 ? `${t('common.balance')} ${formatCurrency(i.balance, locale)}` : t('finance.invoicePaid')}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={t('portal.subscriptions')} />
          {!subscriptions?.length ? <EmptyState title={t('common.noData')} /> : (
            <ul className="divide-y divide-slate-100">
              {subscriptions.map((s) => {
                const pkg = s.packages as { name_en: string; name_ar: string } | null;
                const minsLeft = Number(s.minutes_total) - Number(s.minutes_used);
                return (
                  <li key={String(s.id)} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{isRtl ? pkg?.name_ar : pkg?.name_en}</p>
                      <Badge tone={s.status === 'active' ? 'success' : 'neutral'}>{String(s.status)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDate(String(s.start_date), locale)} → {formatDate(String(s.end_date), locale)}
                      {Number(s.minutes_total) > 0 && ` · ${minsLeft} ${t('subscriptions.minutesRemaining')}`}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Modal open={showAbsence} onClose={() => setShowAbsence(false)} title={t('portal.notifyAbsence')}
        footer={<>
          <Button variant="secondary" onClick={() => setShowAbsence(false)}>{t('common.cancel')}</Button>
          <Button loading={notifyAbsence.isPending} onClick={() => notifyAbsence.mutate()}>{t('common.confirm')}</Button>
        </>}>
        <div className="space-y-3">
          <Input label={t('portal.absenceDate')} type="date" value={absence.date}
            onChange={(e) => setAbsence({ ...absence, date: e.target.value })} />
          <Input label={t('portal.absenceReason')} value={absence.reason}
            onChange={(e) => setAbsence({ ...absence, reason: e.target.value })} />
        </div>
      </Modal>
    </div>
  );
}
