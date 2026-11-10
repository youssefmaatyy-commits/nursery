import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { School, UserPlus, CheckCircle2, XCircle, ClipboardList } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { Badge, Button, Card, CardHeader, EmptyState, Input, Modal, PageHeader, Select, TableSkeleton } from '@/components/ui';
import { formatCurrency, formatDate } from '@/lib/utils';

interface Enrollment {
  id: string; plan_type: string; fee_amount: number; enrollment_fee: number; discount: number;
  start_date: string; end_date: string | null; status: string; billing_day: number;
  children: { id: string; child_code: string; full_name_en: string; full_name_ar: string } | null;
  classrooms: { id: string; name_en: string; name_ar: string } | null;
}

export default function Nursery() {
  const { t, i18n } = useTranslation();
  const { context, can } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';
  const branchId = context?.branches?.[0]?.id ?? null;

  const [showEnroll, setShowEnroll] = useState(false);
  const [enroll, setEnroll] = useState({
    child_id: '', classroom_id: '', plan_type: 'monthly', fee_amount: '2500',
    enrollment_fee: '0', discount: '0', billing_day: '1',
  });

  const { data: enrollments, isLoading } = useQuery({
    queryKey: ['enrollments', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.from('nursery_enrollments')
        .select('id, plan_type, fee_amount, enrollment_fee, discount, start_date, end_date, status, billing_day, children(id, child_code, full_name_en, full_name_ar), classrooms(id, name_en, name_ar)')
        .order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return data as unknown as Enrollment[];
    },
  });

  const { data: children } = useQuery({
    queryKey: ['nursery-children', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_children', { p_query: '', p_branch: branchId, p_limit: 100 });
      if (error) throw error;
      return data as unknown as Array<{ id: string; child_code: string; full_name_en: string; full_name_ar: string }>;
    },
    enabled: showEnroll,
  });

  const { data: classrooms } = useQuery({
    queryKey: ['classroom-options', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.from('classrooms').select('id, name_en, name_ar, capacity, monthly_fee').eq('is_active', true);
      if (error) throw error;
      return data as Array<{ id: string; name_en: string; name_ar: string; capacity: number; monthly_fee: number }>;
    },
    enabled: showEnroll,
  });

  const { data: today } = useQuery({
    queryKey: ['nursery-today', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.from('nursery_attendance')
        .select('id, attendance_date, check_in_at, check_out_at, status, children(full_name_en, full_name_ar, child_code)')
        .order('attendance_date', { ascending: false }).limit(50);
      if (error) throw error;
      return data as unknown as Array<Record<string, unknown>>;
    },
  });

  const createEnrollment = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('nursery_enrollments').insert({
        branch_id: branchId,
        child_id: enroll.child_id,
        classroom_id: enroll.classroom_id || null,
        plan_type: enroll.plan_type,
        fee_amount: Number(enroll.fee_amount),
        enrollment_fee: Number(enroll.enrollment_fee),
        discount: Number(enroll.discount),
        billing_day: Number(enroll.billing_day),
        status: 'active',
      });
      if (error) throw error;
      if (enroll.classroom_id) {
        await supabase.from('classroom_children').insert({ classroom_id: enroll.classroom_id, child_id: enroll.child_id });
      }
    },
    onSuccess: () => {
      push('success', t('common.savedSuccessfully'));
      setShowEnroll(false);
      void qc.invalidateQueries({ queryKey: ['enrollments'] });
    },
    onError: (e: Error) => push('error', e.message),
  });

  return (
    <div>
      <PageHeader title={t('nursery.title')}
        subtitle={isRtl ? 'التسجيلات والحضور اليومي للفصول' : 'Enrollments and daily classroom attendance'}
        actions={can('nursery.enroll') && (
          <Button onClick={() => setShowEnroll(true)}><UserPlus className="h-4 w-4" /> {t('nursery.enroll')}</Button>
        )} />

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title={t('nursery.enrollments')} action={<School className="h-4 w-4 text-slate-400" />} />
          {isLoading ? <TableSkeleton rows={5} cols={5} /> : !enrollments?.length ? (
            <EmptyState title={t('common.noData')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr>
                  <th>{t('children.title')}</th><th>{t('nursery.classroom')}</th>
                  <th>{t('nursery.plan')}</th><th>{t('nursery.fee')}</th>
                  <th>{t('subscriptions.startDate')}</th><th>{t('common.status')}</th>
                </tr></thead>
                <tbody>
                  {enrollments.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <p className="font-medium">{isRtl ? e.children?.full_name_ar : e.children?.full_name_en}</p>
                        <p className="text-xs text-slate-400">{e.children?.child_code}</p>
                      </td>
                      <td>{e.classrooms ? (isRtl ? e.classrooms.name_ar : e.classrooms.name_en) : '—'}</td>
                      <td><Badge tone="info">{t(`nursery.${e.plan_type}`, e.plan_type)}</Badge></td>
                      <td className="font-semibold">{formatCurrency(e.fee_amount, locale)}</td>
                      <td className="whitespace-nowrap text-slate-500">{formatDate(e.start_date, locale)}</td>
                      <td><Badge tone={e.status === 'active' ? 'success' : 'neutral'}>{e.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={t('nursery.attendance')} action={<ClipboardList className="h-4 w-4 text-slate-400" />} />
          {!today?.length ? <EmptyState title={t('common.noData')} /> : (
            <ul className="divide-y divide-slate-100">
              {today.map((a) => {
                const child = a.children as { full_name_en: string; full_name_ar: string; child_code: string } | null;
                return (
                  <li key={String(a.id)} className="flex items-center gap-2 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{isRtl ? child?.full_name_ar : child?.full_name_en}</p>
                      <p className="text-xs text-slate-400">{formatDate(String(a.attendance_date), locale)}</p>
                    </div>
                    <Badge tone={a.status === 'absent' ? 'danger' : a.status === 'late' ? 'warning' : 'success'}>
                      {a.check_out_at ? <CheckCircle2 className="h-3 w-3" /> : a.status === 'absent' ? <XCircle className="h-3 w-3" /> : null}
                      {t(`nursery.${String(a.status)}`, String(a.status))}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Modal open={showEnroll} onClose={() => setShowEnroll(false)} title={t('nursery.enroll')}
        footer={<>
          <Button variant="secondary" onClick={() => setShowEnroll(false)}>{t('common.cancel')}</Button>
          <Button loading={createEnrollment.isPending} disabled={!enroll.child_id}
            onClick={() => createEnrollment.mutate()}>{t('common.save')}</Button>
        </>}>
        <div className="space-y-3">
          <Select label={t('children.title')} required value={enroll.child_id}
            onChange={(e) => setEnroll({ ...enroll, child_id: e.target.value })}>
            <option value="">—</option>
            {children?.map((c) => (
              <option key={c.id} value={c.id}>{isRtl ? c.full_name_ar : c.full_name_en} · {c.child_code}</option>
            ))}
          </Select>
          <Select label={t('nursery.classroom')} value={enroll.classroom_id}
            onChange={(e) => {
              const cls = classrooms?.find((c) => c.id === e.target.value);
              setEnroll({ ...enroll, classroom_id: e.target.value, fee_amount: String(cls?.monthly_fee ?? enroll.fee_amount) });
            }}>
            <option value="">—</option>
            {classrooms?.map((c) => (
              <option key={c.id} value={c.id}>{isRtl ? c.name_ar : c.name_en} (max {c.capacity})</option>
            ))}
          </Select>
          <Select label={t('nursery.plan')} value={enroll.plan_type}
            onChange={(e) => setEnroll({ ...enroll, plan_type: e.target.value })}>
            <option value="daily">{t('nursery.daily')}</option>
            <option value="weekly">{t('nursery.weekly')}</option>
            <option value="monthly">{t('nursery.monthly')}</option>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input label={t('nursery.fee')} type="number" min="0" value={enroll.fee_amount}
              onChange={(e) => setEnroll({ ...enroll, fee_amount: e.target.value })} />
            <Input label={t('nursery.enrollmentFee')} type="number" min="0" value={enroll.enrollment_fee}
              onChange={(e) => setEnroll({ ...enroll, enrollment_fee: e.target.value })} />
            <Input label={t('common.discount')} type="number" min="0" value={enroll.discount}
              onChange={(e) => setEnroll({ ...enroll, discount: e.target.value })} />
            <Input label={t('nursery.billingDay')} type="number" min="1" max="28" value={enroll.billing_day}
              onChange={(e) => setEnroll({ ...enroll, billing_day: e.target.value })} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
