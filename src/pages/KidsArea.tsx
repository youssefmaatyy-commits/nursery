import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Calculator, Blocks, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, TableSkeleton } from '@/components/ui';
import { formatCurrency, formatDateTime, minutesToHuman } from '@/lib/utils';
import { humanizeError } from '@/lib/errors';

interface Rule {
  id: string; name_en: string; name_ar: string; rule_type: string; price: number;
  unit_minutes: number; min_charge: number; grace_minutes: number; rounding_minutes: number;
  included_minutes: number; base_price: number; priority: number;
  days_of_week: number[] | null; start_time: string | null; end_time: string | null;
}
interface SessionRow {
  id: string; checkin_at: string; checkout_at: string | null; status: string;
  billable_minutes: number | null; total: number; children: { full_name_en: string; full_name_ar: string; child_code: string } | null;
}

export default function KidsArea() {
  const { t, i18n } = useTranslation();
  const { push } = useToast();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';
  const [minutes, setMinutes] = useState('90');
  const [quote, setQuote] = useState<Record<string, unknown> | null>(null);

  const { data: rules } = useQuery({
    queryKey: ['pricing-rules'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pricing_rules')
        .select('id, name_en, name_ar, rule_type, price, unit_minutes, min_charge, grace_minutes, rounding_minutes, included_minutes, base_price, priority, days_of_week, start_time, end_time')
        .eq('is_active', true).order('priority');
      if (error) throw error;
      return data as Rule[];
    },
  });

  const { data: sessions, isLoading } = useQuery({
    queryKey: ['kids-sessions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('kids_area_sessions')
        .select('id, checkin_at, checkout_at, status, billable_minutes, total, children(full_name_en, full_name_ar, child_code)')
        .order('checkin_at', { ascending: false }).limit(60);
      if (error) throw error;
      return data as unknown as SessionRow[];
    },
  });

  const quoteMutation = useMutation({
    mutationFn: async () => {
      const { data: svc, error: sErr } = await supabase.from('services').select('id').eq('code', 'KIDS-HOURLY').single();
      if (sErr) throw sErr;
      const { data, error } = await supabase.rpc('quote_kids_area', { p_service: svc.id, p_minutes: Number(minutes) });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: (d) => setQuote(d),
    onError: (e: Error) => push('error', humanizeError(e, isRtl ? 'ar' : 'en')),
  });

  return (
    <div>
      <PageHeader title={t('kidsArea.title')}
        subtitle={isRtl ? 'قواعد التسعير بالساعة والجلسات المفوترة' : 'Hourly pricing rules and billed sessions'} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t('kidsArea.pricingEngine')} action={<Blocks className="h-4 w-4 text-slate-400" />} />
          {!rules ? <TableSkeleton rows={3} cols={4} /> : (
            <div className="divide-y divide-slate-100">
              {rules.map((r) => (
                <div key={r.id} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{isRtl ? r.name_ar : r.name_en}</p>
                    <Badge tone="brand">{t(`kidsArea.${r.rule_type === 'half_hour' ? 'halfHourRate' : r.rule_type === 'per_minute' ? 'perMinuteRate' : r.rule_type === 'day_pass' ? 'dayPass' : r.rule_type === 'fixed_ticket' ? 'fixedTicket' : 'hourlyRate'}`, r.rule_type)}</Badge>
                    <span className="ms-auto text-sm font-bold text-brand-800">{formatCurrency(r.price, locale)}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500 sm:grid-cols-4">
                    <span>{t('kidsArea.hourlyRate')}: {r.unit_minutes} {t('common.minutes')}</span>
                    <span>{t('kidsArea.minCharge')}: {formatCurrency(r.min_charge, locale)}</span>
                    <span>{t('kidsArea.gracePeriod')}: {r.grace_minutes} {t('common.minutes')}</span>
                    <span>{t('kidsArea.rounding')}: {r.rounding_minutes} {t('common.minutes')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title={t('kidsArea.quote')} action={<Calculator className="h-4 w-4 text-slate-400" />} />
          <div className="space-y-3 p-4">
            <Input label={`${t('operations.minutesInside')}`} type="number" min="0" value={minutes}
              onChange={(e) => setMinutes(e.target.value)} />
            <Button className="w-full" loading={quoteMutation.isPending} onClick={() => quoteMutation.mutate()}>
              {t('kidsArea.estimatedCharge')}
            </Button>
            {quote && (
              quote.error ? <p className="text-sm text-rose-600">{String(quote.error)}</p> : (
                <div className="space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
                  <div className="flex justify-between"><span className="text-slate-500">{t('common.minutes')}</span><span>{String(quote.minutes)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">{t('kidsArea.gracePeriod')}</span><span>{String(quote.grace)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">{t('operations.billableMinutes')}</span><span>{String(quote.billable)}</span></div>
                  <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-bold">
                    <span>{t('operations.sessionCharge')}</span><span>{formatCurrency(Number(quote.amount), locale)}</span>
                  </div>
                  <p className="pt-1 text-[11px] text-slate-400">
                    {isRtl ? 'يُحسب على الخادم بقواعد التسعير الفعّالة' : 'Computed server-side from active pricing rules'}
                  </p>
                </div>
              )
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title={t('kidsArea.sessions')} action={<Clock className="h-4 w-4 text-slate-400" />} />
        {isLoading ? <TableSkeleton rows={5} cols={5} /> : !sessions?.length ? <EmptyState title={t('common.noData')} /> : (
          <div className="table-wrap border-0 shadow-none">
            <table className="table">
              <thead><tr>
                <th>{t('children.title')}</th><th>{t('operations.checkin')}</th>
                <th>{t('operations.checkout')}</th><th>{t('operations.billableMinutes')}</th>
                <th>{t('common.total')}</th><th>{t('common.status')}</th>
              </tr></thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <p className="font-medium">{isRtl ? s.children?.full_name_ar : s.children?.full_name_en}</p>
                      <p className="text-xs text-slate-400">{s.children?.child_code}</p>
                    </td>
                    <td className="whitespace-nowrap text-slate-500">{formatDateTime(s.checkin_at, locale)}</td>
                    <td className="whitespace-nowrap text-slate-500">{s.checkout_at ? formatDateTime(s.checkout_at, locale) : '—'}</td>
                    <td>{s.billable_minutes ? minutesToHuman(s.billable_minutes) : '—'}</td>
                    <td className="font-semibold">{formatCurrency(s.total, locale)}</td>
                    <td><Badge tone={s.status === 'active' ? 'success' : 'neutral'}>{s.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
