import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BarChart3, Download, Printer, TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, Select, TableSkeleton } from '@/components/ui';
import { downloadCsv, formatCurrency, formatDate, formatNumber, monthStart, printElement, toISODate } from '@/lib/utils';

type ReportKind = 'revenue' | 'attendance' | 'outstanding' | 'profitLoss' | 'kidsArea' | 'inventory' | 'cash';

export default function Reports() {
  const { t, i18n } = useTranslation();
  const { context } = useAuth();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';
  const [kind, setKind] = useState<ReportKind>('revenue');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(toISODate());
  const [groupBy, setGroupBy] = useState('day');
  const branchId = context?.branches?.[0]?.id ?? null;

  const { data, isLoading } = useQuery({
    queryKey: ['report', kind, from, to, groupBy, branchId],
    queryFn: async () => {
      if (!branchId) return null;
      switch (kind) {
        case 'revenue': {
          const { data, error } = await supabase.rpc('report_revenue', { p_branch: branchId, p_from: from, p_to: to, p_group_by: groupBy });
          if (error) throw error; return data as unknown as Array<Record<string, unknown>>;
        }
        case 'attendance': {
          const { data, error } = await supabase.rpc('report_attendance', { p_branch: branchId, p_from: from, p_to: to });
          if (error) throw error; return data as unknown as Array<Record<string, unknown>>;
        }
        case 'outstanding': {
          const { data, error } = await supabase.rpc('report_outstanding', { p_branch: branchId });
          if (error) throw error; return data as unknown as Array<Record<string, unknown>>;
        }
        case 'profitLoss': {
          const { data, error } = await supabase.rpc('report_profit_loss', { p_branch: branchId, p_from: from, p_to: to });
          if (error) throw error; return data as unknown as Record<string, unknown>;
        }
        case 'kidsArea': {
          const { data, error } = await supabase.rpc('report_kids_area_sessions', { p_branch: branchId, p_from: from, p_to: to });
          if (error) throw error; return data as unknown as Array<Record<string, unknown>>;
        }
        case 'inventory': {
          const { data, error } = await supabase.rpc('report_inventory', { p_branch: branchId });
          if (error) throw error; return data as unknown as Array<Record<string, unknown>>;
        }
        case 'cash': {
          const { data, error } = await supabase.rpc('report_cash_shifts', { p_branch: branchId, p_from: from, p_to: to });
          if (error) throw error; return data as unknown as Array<Record<string, unknown>>;
        }
      }
    },
    enabled: Boolean(branchId),
  });

  const rows = Array.isArray(data) ? data : [];

  const exportCurrent = () => {
    if (Array.isArray(data)) downloadCsv(`report-${kind}-${from}-${to}`, data as Record<string, unknown>[]);
    else if (data) downloadCsv(`report-${kind}-${from}-${to}`, [data as Record<string, unknown>]);
  };

  const money = (v: unknown) => formatCurrency(Number(v ?? 0), locale);
  const num = (v: unknown) => formatNumber(Number(v ?? 0), locale);

  const renderTable = () => {
    if (kind === 'profitLoss' && data && !Array.isArray(data)) {
      const pl = data as Record<string, unknown>;
      return (
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {([
            { label: String(t('reports.grossRevenue')), value: money(pl.gross_revenue), tone: 'success' },
            { label: String(t('reports.refundsTotal')), value: money(pl.refunds), tone: 'danger' },
            { label: String(t('reports.netRevenue')), value: money(pl.net_revenue), tone: 'brand' },
            { label: String(t('reports.expensesTotal')), value: money(pl.expenses), tone: 'warning' },
            { label: String(t('reports.profit')), value: money(pl.profit), tone: Number(pl.profit) >= 0 ? 'success' : 'danger' },
          ] as Array<{ label: string; value: string; tone: string }>).map((c) => (
            <div key={c.label} className="rounded-xl border border-slate-200 p-4">
              <p className="text-sm text-slate-500">{c.label}</p>
              <p className="mt-1 text-xl font-bold">{c.value}</p>
            </div>
          ))}
          {Object.keys((pl.expenses_by_category ?? {}) as object).length > 0 && (
            <div className="rounded-xl border border-slate-200 p-4 sm:col-span-2">
              <p className="mb-2 text-sm font-semibold">{t('finance.expenses')}</p>
              <ul className="space-y-1 text-sm">
                {Object.entries(pl.expenses_by_category as Record<string, number>).map(([k, v]) => (
                  <li key={k} className="flex justify-between"><span className="text-slate-500">{k}</span><span>{money(v)}</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    }

    if (!rows.length) return <EmptyState title={t('reports.noDataInRange')} icon={<BarChart3 className="h-6 w-6" />} />;

    const cols = Object.keys(rows[0]);
    return (
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr>{cols.map((c) => <th key={c}>{c.replace(/_/g, ' ')}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => {
                  const v = r[c];
                  const isMoney = /revenue|total|amount|balance|billed|value|price|refund|paid|profit/i.test(c);
                  let display: string;
                  if (v === null || v === undefined) display = '—';
                  else if (typeof v === 'number') display = isMoney ? money(v) : num(v);
                  else if (/date|at$/.test(c) && typeof v === 'string' && v.includes('-')) display = formatDate(v, locale);
                  else display = String(v);
                  return (
                    <td key={c} className={typeof v === 'number' ? 'whitespace-nowrap' : ''}>{display}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div>
      <PageHeader title={t('reports.title')}
        subtitle={isRtl ? 'تقارير مبنية على بيانات حقيقية من قاعدة البيانات' : 'Reports built from real database records'}
        actions={<>
          <Button variant="secondary" onClick={exportCurrent}><Download className="h-4 w-4" /> {t('reports.exportExcel')}</Button>
          <Button variant="secondary" onClick={() => printElement('report-print', t('reports.title'))}>
            <Printer className="h-4 w-4" /> {t('reports.printReport')}
          </Button>
        </>} />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <Select label={t('reports.title')} className="w-52" value={kind} onChange={(e) => setKind(e.target.value as ReportKind)}>
            <option value="revenue">{t('reports.revenue')}</option>
            <option value="profitLoss">{t('reports.profitLoss')}</option>
            <option value="attendance">{t('reports.attendanceReport')}</option>
            <option value="kidsArea">{t('reports.kidsAreaReport')}</option>
            <option value="outstanding">{t('reports.outstandingReport')}</option>
            <option value="inventory">{t('reports.inventoryReport')}</option>
            <option value="cash">{t('reports.cashReport')}</option>
          </Select>
          <Input label={t('common.from')} type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label={t('common.to')} type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          {kind === 'revenue' && (
            <Select label={t('reports.groupBy')} className="w-32" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              <option value="day">{t('reports.day')}</option>
              <option value="month">{t('reports.month')}</option>
            </Select>
          )}
          <Badge tone="brand">{rows.length}</Badge>
        </div>
      </Card>

      <Card>
        <CardHeader title={t(`reports.${kind === 'profitLoss' ? 'profitLoss' : kind === 'kidsArea' ? 'kidsAreaReport' : kind === 'outstanding' ? 'outstandingReport' : kind === 'inventory' ? 'inventoryReport' : kind === 'cash' ? 'cashReport' : kind === 'attendance' ? 'attendanceReport' : 'revenue'}`)}
          subtitle={`${formatDate(from, locale)} → ${formatDate(to, locale)}`}
          action={<Badge tone={kind === 'profitLoss' ? 'brand' : 'info'}>
            {kind === 'profitLoss' ? <TrendingUp className="h-3.5 w-3.5" /> : kind === 'outstanding' ? <TrendingDown className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}
          </Badge>} />
        <div id="report-print">
          {isLoading ? <TableSkeleton rows={6} cols={5} /> : renderTable()}
        </div>
      </Card>
    </div>
  );
}
