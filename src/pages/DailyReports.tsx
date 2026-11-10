import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, TableSkeleton } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import { humanizeError } from '@/lib/errors';

interface ReportRow {
  id: string; report_date: string; mood: string | null; behavior: string | null;
  learning_progress: string | null; health_observations: string | null; incidents: string | null;
  teacher_comments: string | null; visible_to_parent: boolean;
  children: { full_name_en: string; full_name_ar: string; child_code: string } | null;
}

export default function DailyReports() {
  const { t, i18n } = useTranslation();
  const { context, can } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';
  const branchId = context?.branches?.[0]?.id ?? null;

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    child_id: '', report_date: new Date().toISOString().slice(0, 10),
    mood: '', behavior: '', learning_progress: '', health_observations: '',
    incidents: '', teacher_comments: '', visible_to_parent: true,
    meal: '', sleep_minutes: '',
  });

  const { data: reports, isLoading } = useQuery({
    queryKey: ['daily-reports'],
    queryFn: async () => {
      const { data, error } = await supabase.from('daily_child_reports')
        .select('id, report_date, mood, behavior, learning_progress, health_observations, incidents, teacher_comments, visible_to_parent, children(full_name_en, full_name_ar, child_code)')
        .order('report_date', { ascending: false }).limit(100);
      if (error) throw error;
      return data as unknown as ReportRow[];
    },
  });

  const { data: children } = useQuery({
    queryKey: ['report-children', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_children', { p_query: '', p_branch: branchId, p_limit: 100 });
      if (error) throw error;
      return data as unknown as Array<{ id: string; child_code: string; full_name_en: string; full_name_ar: string }>;
    },
    enabled: showForm,
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('daily_child_reports').insert({
        branch_id: branchId,
        child_id: form.child_id,
        report_date: form.report_date,
        mood: form.mood || null, behavior: form.behavior || null,
        learning_progress: form.learning_progress || null,
        health_observations: form.health_observations || null,
        incidents: form.incidents || null, teacher_comments: form.teacher_comments || null,
        visible_to_parent: form.visible_to_parent,
        meals: form.meal ? [{ name: form.meal, time: '12:30' }] : [],
        sleep: form.sleep_minutes ? [{ minutes: Number(form.sleep_minutes) }] : [],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      push('success', t('common.savedSuccessfully'));
      setShowForm(false);
      void qc.invalidateQueries({ queryKey: ['daily-reports'] });
    },
    onError: (e: Error) => push('error', humanizeError(e, isRtl ? 'ar' : 'en')),
  });

  return (
    <div>
      <PageHeader title={t('nav.dailyReports')}
        subtitle={isRtl ? 'تقارير الأطفال اليومية — الوجبات والنوم والأنشطة' : 'Daily child reports — meals, sleep and activities'}
        actions={can('nursery.reports') && (
          <Button onClick={() => setShowForm(true)}><Plus className="h-4 w-4" /> {t('nursery.dailyReport')}</Button>
        )} />

      {isLoading ? <Card><TableSkeleton rows={5} cols={4} /></Card> : !reports?.length ? (
        <Card><EmptyState title={t('common.noData')} icon={<ClipboardList className="h-6 w-6" />} /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {reports.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{isRtl ? r.children?.full_name_ar : r.children?.full_name_en}</p>
                  <p className="text-xs text-slate-400">{r.children?.child_code} · {formatDate(r.report_date, locale)}</p>
                </div>
                {r.visible_to_parent
                  ? <Badge tone="success">{t('nursery.visibleToParent')}</Badge>
                  : <Badge tone="neutral">{t('common.no')}</Badge>}
              </div>
              <dl className="mt-3 space-y-1.5 text-xs">
                {r.mood && <div><dt className="inline font-medium text-slate-500">{t('nursery.mood')}: </dt><dd className="inline">{r.mood}</dd></div>}
                {r.behavior && <div><dt className="inline font-medium text-slate-500">{t('nursery.behavior')}: </dt><dd className="inline">{r.behavior}</dd></div>}
                {r.learning_progress && <div><dt className="inline font-medium text-slate-500">{t('nursery.learningProgress')}: </dt><dd className="inline">{r.learning_progress}</dd></div>}
                {r.health_observations && <div><dt className="inline font-medium text-slate-500">{t('nursery.healthObservations')}: </dt><dd className="inline">{r.health_observations}</dd></div>}
                {r.incidents && <div className="text-rose-600"><dt className="inline font-medium">{t('nursery.incidents')}: </dt><dd className="inline">{r.incidents}</dd></div>}
                {r.teacher_comments && <div className="italic text-slate-600">“{r.teacher_comments}”</div>}
              </dl>
            </Card>
          ))}
        </div>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} wide title={t('nursery.dailyReport')}
        footer={<>
          <Button variant="secondary" onClick={() => setShowForm(false)}>{t('common.cancel')}</Button>
          <Button loading={create.isPending} disabled={!form.child_id} onClick={() => create.mutate()}>{t('common.save')}</Button>
        </>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('children.title')} required value={form.child_id}
            onChange={(e) => setForm({ ...form, child_id: e.target.value })}>
            <option value="">—</option>
            {children?.map((c) => <option key={c.id} value={c.id}>{isRtl ? c.full_name_ar : c.full_name_en} · {c.child_code}</option>)}
          </Select>
          <Input label={t('common.date')} type="date" value={form.report_date}
            onChange={(e) => setForm({ ...form, report_date: e.target.value })} />
          <Input label={t('nursery.mood')} value={form.mood} onChange={(e) => setForm({ ...form, mood: e.target.value })} />
          <Input label={t('nursery.behavior')} value={form.behavior} onChange={(e) => setForm({ ...form, behavior: e.target.value })} />
          <Input label={t('nursery.meals')} value={form.meal} onChange={(e) => setForm({ ...form, meal: e.target.value })} />
          <Input label={`${t('nursery.sleep')} (${t('common.minutes')})`} type="number" value={form.sleep_minutes}
            onChange={(e) => setForm({ ...form, sleep_minutes: e.target.value })} />
          <Input label={t('nursery.learningProgress')} value={form.learning_progress}
            onChange={(e) => setForm({ ...form, learning_progress: e.target.value })} />
          <Input label={t('nursery.healthObservations')} value={form.health_observations}
            onChange={(e) => setForm({ ...form, health_observations: e.target.value })} />
          <Input label={t('nursery.incidents')} value={form.incidents}
            onChange={(e) => setForm({ ...form, incidents: e.target.value })} />
          <Input label={t('nursery.teacherComments')} value={form.teacher_comments}
            onChange={(e) => setForm({ ...form, teacher_comments: e.target.value })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.visible_to_parent}
              onChange={(e) => setForm({ ...form, visible_to_parent: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300" />
            {t('nursery.visibleToParent')}
          </label>
        </div>
      </Modal>
    </div>
  );
}
