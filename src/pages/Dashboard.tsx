import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Baby, DoorOpen, TrendingUp, Wallet, CreditCard, Receipt, AlertTriangle, Users,
  Clock, Package, ArrowRight, Landmark,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatCard, TableSkeleton } from '@/components/ui';
import { formatCurrency, formatDateTime, formatNumber, minutesToHuman } from '@/lib/utils';

interface DashboardData {
  total_children: number;
  children_inside: number;
  kids_area_active_sessions: number;
  nursery_present_today: number;
  attendance_today: number;
  revenue_today: number;
  revenue_month: number;
  outstanding_balance: number;
  active_subscriptions: number;
  expiring_subscriptions: number;
  expenses_today: number;
  net_today: number;
  cash_shift: { id: string; opened_at: string; opening_float: number } | null;
  recent_invoices: Array<{
    id: string; invoice_number: string; total: number; paid_amount: number;
    status: string; issued_at: string; customer: string;
  }>;
}

interface InsideRow {
  child_id: string; child_code: string; full_name_en: string; full_name_ar: string;
  mode: string; started_at: string; minutes_inside: number;
}

const statusTone: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  paid: 'success', issued: 'warning', partially_paid: 'info', void: 'neutral', refunded: 'danger',
};

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const { context } = useAuth();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';
  const branchId = context?.branches?.[0]?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('dashboard_metrics', { p_branch: branchId });
      if (error) throw error;
      return data as unknown as DashboardData;
    },
    refetchInterval: 60_000,
  });

  const { data: inside } = useQuery({
    queryKey: ['inside', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('children_inside', { p_branch: branchId });
      if (error) throw error;
      return (data ?? []) as unknown as InsideRow[];
    },
    refetchInterval: 30_000,
  });

  if (error) {
    return (
      <Card>
        <EmptyState title={t('common.error')} description={(error as Error).message} />
      </Card>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('nav.dashboard')}
        subtitle={`${isRtl ? 'نظرة عامة مباشرة على' : 'Live overview for'} ${context?.branches?.[0]?.[isRtl ? 'name_ar' : 'name_en'] ?? ''}`}
        actions={
          data?.cash_shift ? (
            <Badge tone="success"><Landmark className="h-3.5 w-3.5" /> {t('dashboard.shiftOpen')}</Badge>
          ) : (
            <Link to="/cash"><Badge tone="warning"><Wallet className="h-3.5 w-3.5" /> {t('dashboard.shiftClosed')}</Badge></Link>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label={t('dashboard.totalChildren')} value={formatNumber(data?.total_children, locale)}
          icon={<Baby className="h-5 w-5" />} tone="brand" />
        <StatCard label={t('dashboard.inside')} value={formatNumber(data?.children_inside, locale)}
          hint={`${t('dashboard.kidsAreaActive')}: ${data?.kids_area_active_sessions ?? 0} · ${t('dashboard.nurseryPresent')}: ${data?.nursery_present_today ?? 0}`}
          icon={<DoorOpen className="h-5 w-5" />} tone="info" />
        <StatCard label={t('dashboard.revenueToday')} value={formatCurrency(data?.revenue_today, locale)}
          hint={`${t('dashboard.expensesToday')}: ${formatCurrency(data?.expenses_today, locale)}`}
          icon={<TrendingUp className="h-5 w-5" />} tone="success" />
        <StatCard label={t('dashboard.outstanding')} value={formatCurrency(data?.outstanding_balance, locale)}
          icon={<Receipt className="h-5 w-5" />} tone="warning" />
        <StatCard label={t('dashboard.revenueMonth')} value={formatCurrency(data?.revenue_month, locale)}
          icon={<CreditCard className="h-5 w-5" />} tone="brand" />
        <StatCard label={t('dashboard.netToday')} value={formatCurrency(data?.net_today, locale)}
          icon={<Wallet className="h-5 w-5" />} tone="success" />
        <StatCard label={t('dashboard.activeSubscriptions')} value={formatNumber(data?.active_subscriptions, locale)}
          icon={<Users className="h-5 w-5" />} tone="info" />
        <StatCard label={t('dashboard.expiringSubscriptions')} value={formatNumber(data?.expiring_subscriptions, locale)}
          icon={<AlertTriangle className="h-5 w-5" />} tone={data?.expiring_subscriptions ? 'warning' : 'neutral'} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title={t('operations.liveBoard')}
            subtitle={isRtl ? 'الأطفال المتواجدون داخل المنشأة الآن' : 'Children currently inside the facility'}
            action={<Badge tone="brand">{inside?.length ?? 0}</Badge>}
          />
          {!inside ? <TableSkeleton rows={4} cols={4} /> : inside.length === 0 ? (
            <EmptyState title={isRtl ? 'لا يوجد أطفال بالداخل حالياً' : 'No children inside right now'}
              icon={<DoorOpen className="h-6 w-6" />}
              description={isRtl ? 'ابدأ بتسجيل دخول طفل من صفحة العمليات' : 'Check a child in from the operations page'} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {inside.map((row) => (
                <li key={`${row.mode}-${row.child_id}`} className="flex items-center gap-3 px-4 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">
                    {row.child_code.slice(-3)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{isRtl ? row.full_name_ar : row.full_name_en}</p>
                    <p className="text-xs text-slate-400">{row.child_code} · {formatDateTime(row.started_at, locale)}</p>
                  </div>
                  <Badge tone={row.mode === 'kids_area' ? 'info' : 'brand'}>
                    {row.mode === 'kids_area' ? t('operations.serviceKidsArea') : t('operations.serviceNursery')}
                  </Badge>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                    <Clock className="h-3.5 w-3.5" /> {minutesToHuman(row.minutes_inside)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={t('dashboard.recentInvoices')}
            action={<Link to="/invoices" className="text-xs font-medium text-brand-700 hover:underline">{t('common.view')}</Link>} />
          {isLoading ? <TableSkeleton rows={4} cols={3} /> : !data?.recent_invoices?.length ? (
            <EmptyState title={t('common.noData')} icon={<Receipt className="h-6 w-6" />} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recent_invoices.map((inv) => (
                <li key={inv.id} className="flex items-center gap-2 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{inv.invoice_number}</p>
                    <p className="truncate text-xs text-slate-400">{inv.customer}</p>
                  </div>
                  <div className="text-end">
                    <p className="text-sm font-semibold">{formatCurrency(inv.total, locale)}</p>
                    <Badge tone={statusTone[inv.status] ?? 'neutral'}>{t(`finance.${inv.status === 'paid' ? 'invoicePaid' : inv.status}`, inv.status)}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { to: '/operations', icon: <DoorOpen className="h-5 w-5" />, label: t('nav.checkin'), tone: 'bg-brand-600' },
          { to: '/pos', icon: <CreditCard className="h-5 w-5" />, label: t('dashboard.newSale'), tone: 'bg-teal-600' },
          { to: '/children', icon: <Baby className="h-5 w-5" />, label: t('children.register'), tone: 'bg-sky-600' },
          { to: '/inventory', icon: <Package className="h-5 w-5" />, label: t('nav.inventory'), tone: 'bg-slate-700' },
        ].map((a) => (
          <Link key={a.to} to={a.to}
            className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-300 hover:shadow-md">
            <span className="flex items-center gap-3">
              <span className={`grid h-10 w-10 place-items-center rounded-xl text-white ${a.tone}`}>{a.icon}</span>
              <span className="text-sm font-semibold text-slate-800">{a.label}</span>
            </span>
            <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:text-brand-600 rtl:rotate-180" />
          </Link>
        ))}
      </div>
    </div>
  );
}
