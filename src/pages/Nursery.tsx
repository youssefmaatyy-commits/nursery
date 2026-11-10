import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { School, UserPlus, CheckCircle2, XCircle, ClipboardList, Trash2, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { Badge, Button, Card, CardHeader, EmptyState, Input, Modal, PageHeader, Select, TableSkeleton } from '@/components/ui';
import { formatCurrency, formatDate } from '@/lib/utils';
import { humanizeError } from '@/lib/errors';

interface Enrollment {
  id: string; plan_type: string; fee_amount: number; enrollment_fee: number; discount: number;
  start_date: string; end_date: string | null; status: string; billing_day: number;
  children: { id: string; child_code: string; full_name_en: string; full_name_ar: string } | null;
  classrooms: { id: string; name_en: string; name_ar: string } | null;
}

interface TeachingRow {
  id: string; classroom_id: string; employee_id: string; role: string;
  classrooms: { name_en: string; name_ar: string } | null;
  employees: { employee_code: string; profiles: { full_name_en: string; full_name_ar: string } | null } | null;
}
interface StaffOption {
  id: string; employee_code: string;
  profiles: { full_name_en: string; full_name_ar: string } | null;
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
    // Deliberately empty: the monthly fee comes from the selected classroom's
    // `monthly_fee`, never from a literal. A hardcoded 2500 was here before and
    // silently overrode the branch's real price.
    child_id: '', classroom_id: '', plan_type: 'monthly', fee_amount: '',
    enrollment_fee: '0', discount: '0', billing_day: '1',
  });

  const [showAssign, setShowAssign] = useState(false);
  const [assign, setAssign] = useState({ classroom_id: '', employee_id: '', role: 'assistant' });

  const { data: teaching } = useQuery({
    queryKey: ['classroom-teachers', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.from('classroom_teachers')
        .select('id, classroom_id, employee_id, role, classrooms(name_en, name_ar), employees(employee_code, profiles(full_name_en, full_name_ar))')
        .limit(300);
      if (error) throw error;
      return data as unknown as TeachingRow[];
    },
    enabled: Boolean(branchId),
  });

  const { data: staffOptions } = useQuery({
    queryKey: ['staff-options', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees')
        .select('id, employee_code, profiles(full_name_en, full_name_ar)')
        .eq('employment_status', 'active').order('employee_code');
      if (error) throw error;
      return data as unknown as StaffOption[];
    },
    enabled: showAssign,
  });

  const { data: classroomOptions } = useQuery({
    queryKey: ['classroom-options-all', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.from('classrooms')
        .select('id, name_en, name_ar').eq('is_active', true).order('name_en');
      if (error) throw error;
      return data as Array<{ id: string; name_en: string; name_ar: string }>;
    },
    enabled: showAssign,
  });

  const assignTeacher = useMutation({
    mutationFn: async () => {
      if (!assign.classroom_id || !assign.employee_id) throw new Error('child_required');
      // unique (classroom_id, employee_id) — let the database reject a duplicate
      // rather than silently creating a second row.
      const { error } = await supabase.from('classroom_teachers').insert({
        classroom_id: assign.classroom_id,
        employee_id: assign.employee_id,
        role: assign.role,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      push('success', t('common.savedSuccessfully'));
      setShowAssign(false);
      setAssign({ classroom_id: '', employee_id: '', role: 'assistant' });
      void qc.invalidateQueries({ queryKey: ['classroom-teachers'] });
    },
    onError: (e: Error) => push('error', humanizeError(e, isRtl ? 'ar' : 'en')),
  });

  const removeTeacher = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('classroom_teachers').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      push('success', t('common.savedSuccessfully'));
      void qc.invalidateQueries({ queryKey: ['classroom-teachers'] });
    },
    onError: (e: Error) => push('error', humanizeError(e, isRtl ? 'ar' : 'en')),
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
      if (!enroll.child_id) throw new Error('child_required');
      // `Number('')` is 0, which would persist a free enrollment. The fee is
      // required and must come from the classroom, not from an empty field.
      const fee = Number(enroll.fee_amount);
      if (!enroll.fee_amount || !Number.isFinite(fee) || fee <= 0) throw new Error('fee_required');
      const { error } = await supabase.from('nursery_enrollments').insert({
        branch_id: branchId,
        child_id: enroll.child_id,
        classroom_id: enroll.classroom_id || null,
        plan_type: enroll.plan_type,
        fee_amount: fee,
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
    onError: (e: Error) => push('error', humanizeError(e, isRtl ? 'ar' : 'en')),
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

        <Card className="lg:col-span-5">
          <CardHeader
            title={isRtl ? 'المدرسين المسندين للفصول' : 'Classroom teachers'}
            action={can(['nursery.manage_classes', 'nursery.enroll']) && (
              <Button variant="secondary" size="sm" onClick={() => setShowAssign(true)}>
                <Plus className="h-3.5 w-3.5" /> {isRtl ? 'إسناد' : 'Assign'}
              </Button>
            )}
          />
          {!teaching?.length ? (
            <EmptyState
              title={isRtl ? 'مفيش مدرسين مسندين' : 'No teachers assigned'}
              description={isRtl
                ? 'أسند كل موظف للفصل اللي بيدرّسه.'
                : 'Assign each staff member to the classroom they teach.'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr>
                  <th>{t('nursery.classroom')}</th>
                  <th>{isRtl ? 'الموظف' : 'Staff member'}</th>
                  <th>{isRtl ? 'الدور' : 'Role'}</th>
                  <th>{t('common.actions')}</th>
                </tr></thead>
                <tbody>
                  {teaching.map((r) => (
                    <tr key={r.id}>
                      <td>{r.classrooms ? (isRtl ? r.classrooms.name_ar : r.classrooms.name_en) : '—'}</td>
                      <td>
                        <p className="font-medium">
                          {r.employees?.profiles
                            ? (isRtl ? r.employees.profiles.full_name_ar : r.employees.profiles.full_name_en)
                            : r.employees?.employee_code ?? '—'}
                        </p>
                        <p className="text-xs text-slate-400">{r.employees?.employee_code}</p>
                      </td>
                      <td><Badge tone={r.role === 'lead' ? 'brand' : 'neutral'}>{r.role}</Badge></td>
                      <td>
                        {can(['nursery.manage_classes', 'nursery.enroll']) && (
                          <Button variant="ghost" size="sm" onClick={() => removeTeacher.mutate(r.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

      <Modal open={showAssign} onClose={() => setShowAssign(false)}
        title={isRtl ? 'إسناد مدرس لفصل' : 'Assign a teacher'}
        footer={<>
          <Button variant="secondary" onClick={() => setShowAssign(false)}>{t('common.cancel')}</Button>
          <Button loading={assignTeacher.isPending} onClick={() => assignTeacher.mutate()}>
            {t('common.save')}
          </Button>
        </>}>
        <div className="space-y-3">
          <Select label={t('nursery.classroom')} required value={assign.classroom_id}
            onChange={(e) => setAssign({ ...assign, classroom_id: e.target.value })}>
            <option value="">—</option>
            {classroomOptions?.map((c) => (
              <option key={c.id} value={c.id}>{isRtl ? c.name_ar : c.name_en}</option>
            ))}
          </Select>
          <Select label={isRtl ? 'الموظف' : 'Staff member'} required value={assign.employee_id}
            onChange={(e) => setAssign({ ...assign, employee_id: e.target.value })}>
            <option value="">—</option>
            {staffOptions?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.employee_code} · {s.profiles ? (isRtl ? s.profiles.full_name_ar : s.profiles.full_name_en) : ''}
              </option>
            ))}
          </Select>
          <Select label={isRtl ? 'الدور' : 'Role'} value={assign.role}
            onChange={(e) => setAssign({ ...assign, role: e.target.value })}>
            <option value="lead">{isRtl ? 'مدرس أساسي' : 'Lead'}</option>
            <option value="assistant">{isRtl ? 'مساعد' : 'Assistant'}</option>
          </Select>
          <p className="text-xs text-slate-500">
            {isRtl
              ? 'الموظف الواحد ميتسندش لنفس الفصل مرتين.'
              : 'The same staff member cannot be assigned to the same classroom twice.'}
          </p>
        </div>
      </Modal>
    </div>
  );
}
