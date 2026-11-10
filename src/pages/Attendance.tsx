import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarCheck, LogIn, LogOut, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { humanizeError } from '@/lib/errors';
import {
  Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, Select, TableSkeleton,
} from '@/components/ui';
import { formatDate, formatTime } from '@/lib/utils';

interface Employee {
  id: string; employee_code: string; job_title: string | null; branch_id: string;
  profiles: { full_name_en: string; full_name_ar: string } | null;
}
interface AttendanceRow {
  id: string; employee_id: string; work_date: string; check_in_at: string | null;
  check_out_at: string | null; status: string; notes: string | null;
  employees: { employee_code: string; profiles: { full_name_en: string; full_name_ar: string } | null } | null;
}

const STATUSES = ['present', 'absent', 'late', 'leave', 'holiday'] as const;

/**
 * Staff attendance.
 *
 * `employee_attendance` has existed since migration 0001 with a unique
 * (employee_id, work_date) constraint, but nothing in the app ever wrote to it.
 * Marking is an upsert on that constraint so a double tap cannot create two rows
 * for the same day.
 */
export default function Attendance() {
  const { t, i18n } = useTranslation();
  const { context, can } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';
  const branchId = context?.branches?.[0]?.id ?? null;
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const { data: employees, isLoading: empLoading } = useQuery({
    queryKey: ['employee-options', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees')
        .select('id, employee_code, job_title, branch_id, profiles(full_name_en, full_name_ar)')
        .eq('employment_status', 'active').order('employee_code');
      if (error) throw error;
      return data as unknown as Employee[];
    },
    enabled: Boolean(branchId),
  });

  const { data: rows, isLoading: rowsLoading } = useQuery({
    queryKey: ['employee-attendance', branchId, date],
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_attendance')
        .select('id, employee_id, work_date, check_in_at, check_out_at, status, notes, employees(employee_code, profiles(full_name_en, full_name_ar))')
        .eq('work_date', date);
      if (error) throw error;
      return data as unknown as AttendanceRow[];
    },
    enabled: Boolean(branchId),
  });

  const mark = useMutation({
    mutationFn: async ({
      employeeId, status, stamp,
    }: { employeeId: string; status: string; stamp?: 'in' | 'out' }) => {
      if (!branchId) throw new Error('branch_required');
      const existing = rows?.find((r) => r.employee_id === employeeId);
      const now = new Date().toISOString();

      if (existing) {
        const patch: Record<string, unknown> = { status };
        if (stamp === 'in') patch.check_in_at = now;
        if (stamp === 'out') patch.check_out_at = now;
        const { error } = await supabase.from('employee_attendance')
          .update(patch).eq('id', existing.id);
        if (error) throw error;
        return;
      }

      const { error } = await supabase.from('employee_attendance').insert({
        employee_id: employeeId,
        branch_id: branchId,
        work_date: date,
        status,
        check_in_at: stamp === 'in' ? now : null,
        check_out_at: stamp === 'out' ? now : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      push('success', t('common.savedSuccessfully'));
      void qc.invalidateQueries({ queryKey: ['employee-attendance'] });
    },
    onError: (e: Error) => push('error', humanizeError(e, isRtl ? 'ar' : 'en')),
  });

  const nameOf = (e: Employee['profiles']) => (e ? (isRtl ? e.full_name_ar : e.full_name_en) : '—');
  const rowFor = (employeeId: string) => rows?.find((r) => r.employee_id === employeeId);
  const canManage = can(['hr.manage', 'hr.view', 'employees.edit']);
  const isLoading = empLoading || rowsLoading;

  const statusTone = (s: string) =>
    s === 'present' ? 'success' : s === 'late' ? 'warning' : s === 'absent' ? 'danger' : 'neutral';

  return (
    <div>
      <PageHeader
        title={isRtl ? 'حضور الموظفين' : 'Staff attendance'}
        subtitle={isRtl ? 'تسجيل الحضور والانصراف اليومي' : 'Daily check-in and check-out'}
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <Input type="date" label={isRtl ? 'التاريخ' : 'Date'} value={date}
            onChange={(e) => setDate(e.target.value)} className="w-44" />
          <div className="flex items-center gap-2 pb-1 text-sm text-slate-500">
            <Users className="h-4 w-4" />
            {rows?.length ?? 0} / {employees?.length ?? 0}
            <span className="text-xs">{isRtl ? 'تم تسجيلهم' : 'recorded'}</span>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={isRtl ? 'الموظفين' : 'Employees'}
          action={<CalendarCheck className="h-4 w-4 text-slate-400" />}
        />
        {isLoading ? <TableSkeleton rows={6} cols={4} /> : !employees?.length ? (
          <EmptyState
            title={isRtl ? 'مفيش موظفين مسجلين' : 'No employees yet'}
            description={isRtl
              ? 'أضف الموظفين من صفحة الموظفين أو من صفحة الحسابات.'
              : 'Add employees from the Employees page or the Staff & accounts page.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr>
                <th>{isRtl ? 'الكود' : 'Code'}</th>
                <th>{isRtl ? 'الاسم' : 'Name'}</th>
                <th>{t('common.status')}</th>
                <th>{isRtl ? 'حضور' : 'In'}</th>
                <th>{isRtl ? 'انصراف' : 'Out'}</th>
                {canManage && <th>{t('common.actions')}</th>}
              </tr></thead>
              <tbody>
                {employees.map((e) => {
                  const row = rowFor(e.id);
                  return (
                    <tr key={e.id}>
                      <td className="font-mono text-xs">{e.employee_code}</td>
                      <td>
                        <p className="font-medium">{nameOf(e.profiles)}</p>
                        <p className="text-xs text-slate-400">{e.job_title ?? '—'}</p>
                      </td>
                      <td>
                        {row ? <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                          : <span className="text-xs text-slate-400">—</span>}
                      </td>
                      <td className="text-xs text-slate-500">
                        {row?.check_in_at ? formatTime(row.check_in_at, locale) : '—'}
                      </td>
                      <td className="text-xs text-slate-500">
                        {row?.check_out_at ? formatTime(row.check_out_at, locale) : '—'}
                      </td>
                      {canManage && (
                        <td>
                          <div className="flex flex-wrap items-center gap-1">
                            <Button variant="ghost" size="sm"
                              onClick={() => mark.mutate({ employeeId: e.id, status: 'present', stamp: 'in' })}>
                              <LogIn className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm"
                              onClick={() => mark.mutate({ employeeId: e.id, status: row?.status ?? 'present', stamp: 'out' })}>
                              <LogOut className="h-3.5 w-3.5" />
                            </Button>
                            <Select value={row?.status ?? ''} className="w-28 text-xs"
                              onChange={(ev) => mark.mutate({ employeeId: e.id, status: ev.target.value })}>
                              <option value="">—</option>
                              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </Select>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-3 text-xs text-slate-400">
        {isRtl
          ? `سجل يوم ${formatDate(date, locale)} — صف واحد لكل موظف في اليوم.`
          : `Log for ${formatDate(date, locale)} — one row per employee per day.`}
      </p>
    </div>
  );
}
