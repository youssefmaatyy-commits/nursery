import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import CrudPage from '@/components/CrudPage';
import { Badge } from '@/components/ui';
import { formatCurrency, formatDate } from '@/lib/utils';

export default function Employees() {
  const { t, i18n } = useTranslation();
  const { context, can } = useAuth();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';
  const branchId = context?.branches?.[0]?.id ?? null;

  return (
    <CrudPage
      title={t('hr.employees')}
      subtitle={isRtl ? 'ملفات الموظفين والرواتب' : 'Employee profiles and salaries'}
      table="employees"
      orderBy={{ column: 'created_at', ascending: false }}
      canCreate={can('employees.manage')}
      canEdit={can('employees.manage')}
      searchColumns={['employee_code', 'job_title', 'department']}
      defaults={{ branch_id: branchId }}
      transformOnSave={(v) => ({ ...v, branch_id: branchId, salary: Number(v.salary) })}
      fields={[
        { name: 'employee_code', label: t('hr.employeeCode'), required: true },
        { name: 'job_title', label: t('hr.jobTitle') },
        { name: 'department', label: t('hr.department') },
        { name: 'hire_date', label: t('hr.hireDate'), type: 'date', render: (r) => formatDate(String(r.hire_date), locale) },
        { name: 'salary', label: t('hr.salary'), type: 'number', render: (r) => formatCurrency(Number(r.salary), locale) },
        { name: 'employment_status', label: t('hr.employmentStatus'), type: 'select', defaultValue: 'active',
          options: [
            { value: 'active', label: t('hr.activeEmp') }, { value: 'on_leave', label: t('hr.onLeave') },
            { value: 'suspended', label: t('hr.suspendedEmp') }, { value: 'terminated', label: t('hr.terminated') },
          ],
          render: (r) => <Badge tone={r.employment_status === 'active' ? 'success' : 'neutral'}>{String(r.employment_status)}</Badge> },
        { name: 'phone', label: t('common.phone') },
        { name: 'notes', label: t('common.notes'), type: 'textarea', hideInTable: true },
      ]}
    />
  );
}
