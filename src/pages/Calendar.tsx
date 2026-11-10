import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, PartyPopper, Plus, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { humanizeError } from '@/lib/errors';
import {
  Badge, Button, Card, CardHeader, EmptyState, Input, Modal, PageHeader, Select, TableSkeleton,
} from '@/components/ui';
import { formatDate } from '@/lib/utils';

interface Holiday {
  id: string; name_en: string; name_ar: string; holiday_date: string;
  applies_to: string; is_paid: boolean;
}
interface EventRow {
  id: string; title_en: string; title_ar: string; event_date: string;
  start_time: string | null; end_time: string | null; location: string | null; is_public: boolean;
}
interface ActivityRow {
  id: string; title_en: string; title_ar: string; activity_date: string;
  description: string | null;
}
interface CalendarPayload {
  holidays: Holiday[]; events: EventRow[]; activities: ActivityRow[];
}

type Kind = 'holiday' | 'event' | 'activity';

/**
 * Nursery calendar: holidays, events and activities.
 *
 * These three tables existed since migration 0003 but had no screen at all — a
 * branch could not record a holiday or plan an event. Reads go through
 * `nursery_calendar()`; writes go straight to the tables, which are already
 * protected by RLS on `nursery.manage_classes` / `settings.manage`.
 */
export default function Calendar() {
  const { t, i18n } = useTranslation();
  const { context, can } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar' : 'en';
  const branchId = context?.branches?.[0]?.id ?? null;

  const today = new Date();
  const [from, setFrom] = useState(new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date(today.getFullYear(), today.getMonth() + 2, 0).toISOString().slice(0, 10));
  const [kind, setKind] = useState<Kind>('holiday');
  const [form, setForm] = useState({ nameEn: '', nameAr: '', date: today.toISOString().slice(0, 10), location: '' });
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['nursery-calendar', branchId, from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('nursery_calendar', {
        p_branch: branchId, p_from: from, p_to: to,
      });
      if (error) throw error;
      return data as unknown as CalendarPayload;
    },
    enabled: Boolean(branchId),
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error('branch_required');
      if (kind === 'holiday') {
        const { error } = await supabase.from('holidays').insert({
          branch_id: branchId, name_en: form.nameEn, name_ar: form.nameAr,
          holiday_date: form.date, applies_to: 'all',
        });
        if (error) throw error;
        return;
      }
      if (kind === 'event') {
        const { error } = await supabase.from('events').insert({
          branch_id: branchId, title_en: form.nameEn, title_ar: form.nameAr,
          event_date: form.date, location: form.location || null, created_by: context?.user_id,
        });
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from('activities').insert({
        branch_id: branchId, title_en: form.nameEn, title_ar: form.nameAr,
        activity_date: form.date,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      push('success', t('common.savedSuccessfully'));
      setOpen(false);
      setForm({ ...form, nameEn: '', nameAr: '', location: '' });
      void qc.invalidateQueries({ queryKey: ['nursery-calendar'] });
    },
    onError: (e: Error) => push('error', humanizeError(e, locale)),
  });

  const remove = useMutation({
    mutationFn: async ({ table, id }: { table: string; id: string }) => {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      push('success', t('common.savedSuccessfully'));
      void qc.invalidateQueries({ queryKey: ['nursery-calendar'] });
    },
    onError: (e: Error) => push('error', humanizeError(e, locale)),
  });

  const canManage = can(['nursery.manage_classes', 'settings.manage']);

  return (
    <div>
      <PageHeader
        title={isRtl ? 'التقويم والإجازات' : 'Calendar & holidays'}
        subtitle={isRtl ? 'الإجازات والفعاليات والأنشطة' : 'Holidays, events and activities'}
        actions={canManage && (
          <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> {t('common.add')}</Button>
        )}
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <Input type="date" label={isRtl ? 'من' : 'From'} value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          <Input type="date" label={isRtl ? 'إلى' : 'To'} value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
      </Card>

      {isLoading ? <Card><TableSkeleton rows={5} cols={3} /></Card> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title={isRtl ? 'إجازات' : 'Holidays'} action={<CalendarDays className="h-4 w-4 text-slate-400" />} />
            {!data?.holidays.length ? <EmptyState title={t('common.noData')} /> : (
              <ul className="divide-y divide-slate-100">
                {data.holidays.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{isRtl ? h.name_ar : h.name_en}</p>
                      <p className="text-xs text-slate-400">{formatDate(h.holiday_date, locale)}</p>
                    </div>
                    {canManage && (
                      <button className="text-slate-300 hover:text-rose-600"
                        onClick={() => remove.mutate({ table: 'holidays', id: h.id })}>×</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title={isRtl ? 'فعاليات' : 'Events'} action={<PartyPopper className="h-4 w-4 text-slate-400" />} />
            {!data?.events.length ? <EmptyState title={t('common.noData')} /> : (
              <ul className="divide-y divide-slate-100">
                {data.events.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{isRtl ? e.title_ar : e.title_en}</p>
                      <p className="text-xs text-slate-400">
                        {formatDate(e.event_date, locale)}{e.location ? ` · ${e.location}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {e.is_public && <Badge tone="brand">{isRtl ? 'عام' : 'public'}</Badge>}
                      {canManage && (
                        <button className="text-slate-300 hover:text-rose-600"
                          onClick={() => remove.mutate({ table: 'events', id: e.id })}>×</button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title={isRtl ? 'أنشطة' : 'Activities'} action={<Sparkles className="h-4 w-4 text-slate-400" />} />
            {!data?.activities.length ? <EmptyState title={t('common.noData')} /> : (
              <ul className="divide-y divide-slate-100">
                {data.activities.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{isRtl ? a.title_ar : a.title_en}</p>
                      <p className="text-xs text-slate-400">{formatDate(a.activity_date, locale)}</p>
                    </div>
                    {canManage && (
                      <button className="text-slate-300 hover:text-rose-600"
                        onClick={() => remove.mutate({ table: 'activities', id: a.id })}>×</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={isRtl ? 'إضافة للتقويم' : 'Add to calendar'}
        footer={<>
          <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
          <Button loading={add.isPending} onClick={() => add.mutate()}>{t('common.save')}</Button>
        </>}>
        <div className="space-y-3">
          <Select label={isRtl ? 'النوع' : 'Type'} value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="holiday">{isRtl ? 'إجازة' : 'Holiday'}</option>
            <option value="event">{isRtl ? 'فعالية' : 'Event'}</option>
            <option value="activity">{isRtl ? 'نشاط' : 'Activity'}</option>
          </Select>
          <Input label={isRtl ? 'الاسم (عربي)' : 'Name (Arabic)'} required value={form.nameAr}
            onChange={(e) => setForm({ ...form, nameAr: e.target.value })} />
          <Input label={isRtl ? 'الاسم (إنجليزي)' : 'Name (English)'} required value={form.nameEn}
            onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
          <Input label={isRtl ? 'التاريخ' : 'Date'} type="date" required value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })} />
          {kind === 'event' && (
            <Input label={isRtl ? 'المكان' : 'Location'} value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })} />
          )}
        </div>
      </Modal>
    </div>
  );
}
