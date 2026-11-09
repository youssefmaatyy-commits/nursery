import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ScrollText } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Badge, Card, EmptyState, Input, PageHeader, Select, TableSkeleton } from '@/components/ui';
import { formatDateTime } from '@/lib/utils';

export default function AuditLog() {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('all');

  const { data, isLoading } = useQuery({
    queryKey: ['audit', action],
    queryFn: async () => {
      let q = supabase.from('audit_logs')
        .select('id, table_name, record_id, action, created_at, user_id, profiles(full_name_en, full_name_ar)')
        .order('created_at', { ascending: false }).limit(300);
      if (action !== 'all') q = q.eq('action', action);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as Array<{
        id: number; table_name: string; record_id: string | null; action: string;
        created_at: string; profiles: { full_name_en: string; full_name_ar: string } | null;
      }>;
    },
  });

  const rows = (data ?? []).filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return r.table_name.toLowerCase().includes(q) || String(r.record_id ?? '').toLowerCase().includes(q);
  });

  return (
    <div>
      <PageHeader title={t('admin.auditLogs')}
        subtitle={isRtl ? 'سجل غير قابل للتعديل لكل العمليات الحساسة' : 'Append-only trail of every sensitive operation'}
        actions={<>
          <Input className="w-52" placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select className="w-36" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="all">{t('common.all')}</option>
            <option value="insert">insert</option>
            <option value="update">update</option>
            <option value="delete">delete</option>
          </Select>
        </>} />

      <div className="table-wrap">
        {isLoading ? <TableSkeleton rows={8} cols={5} /> : !rows.length ? (
          <EmptyState title={t('common.noData')} icon={<ScrollText className="h-6 w-6" />} />
        ) : (
          <table className="table">
            <thead><tr>
              <th>{t('admin.timestamp')}</th><th>{t('admin.table')}</th>
              <th>{t('admin.action')}</th><th>{t('admin.user')}</th><th>ID</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-slate-500">{formatDateTime(r.created_at, locale)}</td>
                  <td className="font-mono text-xs">{r.table_name}</td>
                  <td>
                    <Badge tone={r.action === 'delete' ? 'danger' : r.action === 'insert' ? 'success' : 'info'}>{r.action}</Badge>
                  </td>
                  <td className="text-slate-600">
                    {r.profiles ? (isRtl ? r.profiles.full_name_ar : r.profiles.full_name_en) : '—'}
                  </td>
                  <td className="font-mono text-[11px] text-slate-400">{r.record_id?.slice(0, 12) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
