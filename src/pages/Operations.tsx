import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Search, DoorOpen, LogOut, Clock, ScanLine, UserCheck, Baby, AlertCircle, WifiOff,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useOnlineStatus } from '@/hooks/useOnline';
import { useToast } from '@/components/ui/Toast';
import { enqueueOperation, synchronize } from '@/lib/offline';
import {
  Alert, Badge, Button, Card, CardHeader, EmptyState, Input, Modal, PageHeader, Select, TableSkeleton,
} from '@/components/ui';
import { formatDateTime, minutesToHuman } from '@/lib/utils';

interface SearchResult {
  id: string; child_code: string; full_name_en: string; full_name_ar: string;
  date_of_birth: string; gender: string; status: string; primary_guardian: string | null;
  primary_phone: string | null; age_years: number | null;
}
interface InsideRow {
  child_id: string; child_code: string; full_name_en: string; full_name_ar: string;
  mode: string; started_at: string; session_id: string; minutes_inside: number;
}

export default function Operations() {
  const { t, i18n } = useTranslation();
  const { context, can } = useAuth();
  const { online, refreshCounts } = useOnlineStatus();
  const { push } = useToast();
  const qc = useQueryClient();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';
  const branchId = context?.branches?.[0]?.id ?? null;

  const [query, setQuery] = useState('');
  const [service, setService] = useState<'kids_area' | 'nursery'>('kids_area');
  const [checkoutTarget, setCheckoutTarget] = useState<InsideRow | null>(null);
  const [checkoutForm, setCheckoutForm] = useState({ discount: '0', pickup_name: '', pickup_relation: '', id_verified: false });
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const { data: results, isFetching } = useQuery({
    queryKey: ['op-search', query, branchId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_children', { p_query: query, p_branch: branchId, p_limit: 12 });
      if (error) throw error;
      return (data ?? []) as unknown as SearchResult[];
    },
    enabled: query.trim().length > 0,
  });

  const { data: inside } = useQuery({
    queryKey: ['inside-op', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('children_inside', { p_branch: branchId });
      if (error) throw error;
      return (data ?? []) as unknown as InsideRow[];
    },
    refetchInterval: 30_000,
  });

  const insideIds = useMemo(() => new Set((inside ?? []).map((r) => r.child_id)), [inside]);

  const checkIn = useMutation({
    mutationFn: async (child: SearchResult) => {
      if (!online) {
        await enqueueOperation('check_in', { child_id: child.id, service, branch_id: branchId });
        await refreshCounts();
        return { queued: true, child_code: child.child_code, mode: service };
      }
      const { data, error } = await supabase.rpc('check_in_child', {
        p_child: child.id, p_service: service, p_branch: branchId, p_staff: null,
      });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: (data) => {
      setResult(data as Record<string, unknown>);
      push('success', (data as { queued?: boolean }).queued ? t('common.pendingSync') : t('operations.checkedIn'));
      setQuery('');
      void qc.invalidateQueries({ queryKey: ['inside-op'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: Error) => push('error', e.message),
  });

  const checkOut = useMutation({
    mutationFn: async () => {
      if (!checkoutTarget) throw new Error('no target');
      if (checkoutTarget.mode === 'nursery') {
        const { data, error } = await supabase.rpc('check_out_nursery', {
          p_child: checkoutTarget.child_id, p_notes: checkoutForm.pickup_name || null,
        });
        if (error) throw error;
        return data as Record<string, unknown>;
      }
      if (!online) {
        await enqueueOperation('check_out', {
          session_id: checkoutTarget.session_id,
          discount: Number(checkoutForm.discount) || 0,
          pickup_name: checkoutForm.pickup_name,
          pickup_relation: checkoutForm.pickup_relation,
          id_verified: checkoutForm.id_verified,
        });
        await refreshCounts();
        return { queued: true } as Record<string, unknown>;
      }
      const { data, error } = await supabase.rpc('close_kids_session', {
        p_session: checkoutTarget.session_id,
        p_discount: Number(checkoutForm.discount) || 0,
        p_pickup_name: checkoutForm.pickup_name || null,
        p_pickup_relation: checkoutForm.pickup_relation || null,
        p_id_verified: checkoutForm.id_verified,
        p_create_invoice: true,
      });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: (data) => {
      setResult(data);
      push('success', (data as { queued?: boolean }).queued ? t('common.pendingSync') : t('operations.checkedOut'));
      setCheckoutTarget(null);
      setCheckoutForm({ discount: '0', pickup_name: '', pickup_relation: '', id_verified: false });
      void qc.invalidateQueries({ queryKey: ['inside-op'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: Error) => push('error', e.message),
  });

  const syncNow = async () => {
    const report = await synchronize();
    await refreshCounts();
    push(report.failed ? 'error' : 'success', `${t('sync.applied')}: ${report.applied} · ${t('sync.failed')}: ${report.failed}`);
    void qc.invalidateQueries();
  };

  return (
    <div>
      <PageHeader
        title={t('nav.checkin')}
        subtitle={isRtl ? 'تسجيل الدخول والخروج وتسجيل الحضور اليومي' : 'Check children in and out, record daily attendance'}
        actions={!online && (
          <>
            <Badge tone="warning"><WifiOff className="h-3.5 w-3.5" /> {t('common.offline')}</Badge>
            <Button variant="secondary" size="sm" onClick={syncNow}>{t('sync.syncNow')}</Button>
          </>
        )}
      />

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title={t('operations.searchChild')} />
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-52 flex-1">
                <Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-slate-400" />
                <Input className="ps-9" autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('common.searchPlaceholder')} />
              </div>
              <Select value={service} onChange={(e) => setService(e.target.value as 'kids_area' | 'nursery')} className="w-40">
                <option value="kids_area">{t('operations.serviceKidsArea')}</option>
                <option value="nursery">{t('operations.serviceNursery')}</option>
              </Select>
            </div>

            {isFetching && <TableSkeleton rows={2} cols={3} />}

            {query.trim() && results?.length === 0 && !isFetching && (
              <EmptyState title={t('common.noData')} icon={<ScanLine className="h-6 w-6" />}
                description={isRtl ? 'جرّب الاسم أو كود الطفل أو رقم الهاتف' : 'Try a name, child code, or phone number'} />
            )}

            <div className="space-y-2">
              {results?.map((c) => {
                const isInside = insideIds.has(c.id);
                return (
                  <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">
                      {c.child_code.slice(-3)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{isRtl ? c.full_name_ar : c.full_name_en}</p>
                      <p className="truncate text-xs text-slate-400">
                        {c.child_code} · {c.age_years ?? 0} {t('common.years')} · {c.primary_phone ?? '—'}
                      </p>
                    </div>
                    {isInside ? (
                      <Badge tone="success"><DoorOpen className="h-3 w-3" /> {t('operations.insideNow')}</Badge>
                    ) : (
                      <Button size="sm" loading={checkIn.isPending} disabled={!can(['operations.checkin', 'kids_area.operate', 'nursery.operate'])}
                        onClick={() => checkIn.mutate(c)}>
                        <UserCheck className="h-3.5 w-3.5" /> {t('operations.checkin')}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>

            {result && (
              <Alert tone="success">
                <pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(result, null, 2)}</pre>
              </Alert>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={t('operations.liveBoard')} action={<Badge tone="brand">{inside?.length ?? 0}</Badge>} />
          {!inside?.length ? (
            <EmptyState title={isRtl ? 'لا يوجد أطفال بالداخل' : 'No children inside'} icon={<Baby className="h-6 w-6" />} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {inside.map((row) => (
                <li key={`${row.mode}-${row.session_id}`} className="flex items-center gap-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{isRtl ? row.full_name_ar : row.full_name_en}</p>
                    <p className="text-xs text-slate-400">
                      {row.child_code} · {formatDateTime(row.started_at, locale)}
                    </p>
                  </div>
                  <div className="text-end">
                    <Badge tone={row.mode === 'kids_area' ? 'info' : 'brand'}>
                      {row.mode === 'kids_area' ? t('operations.serviceKidsArea') : t('operations.serviceNursery')}
                    </Badge>
                    <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500">
                      <Clock className="h-3 w-3" /> {minutesToHuman(row.minutes_inside)}
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setCheckoutTarget(row)}>
                    <LogOut className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Modal open={Boolean(checkoutTarget)} onClose={() => setCheckoutTarget(null)} title={t('operations.checkout')}
        footer={<>
          <Button variant="secondary" onClick={() => setCheckoutTarget(null)}>{t('common.cancel')}</Button>
          <Button loading={checkOut.isPending} onClick={() => checkOut.mutate()}>{t('common.confirm')}</Button>
        </>}>
        {checkoutTarget && (
          <div className="space-y-3">
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              <p className="font-semibold">{isRtl ? checkoutTarget.full_name_ar : checkoutTarget.full_name_en}</p>
              <p className="text-xs text-slate-500">
                {checkoutTarget.child_code} · {minutesToHuman(checkoutTarget.minutes_inside)} {t('operations.minutesInside')}
              </p>
            </div>
            {checkoutTarget.mode === 'kids_area' && (
              <Input label={t('common.discount')} type="number" min="0" value={checkoutForm.discount}
                onChange={(e) => setCheckoutForm({ ...checkoutForm, discount: e.target.value })} />
            )}
            <Input label={t('operations.pickupPerson')} value={checkoutForm.pickup_name}
              onChange={(e) => setCheckoutForm({ ...checkoutForm, pickup_name: e.target.value })} />
            <Input label={t('operations.relation')} value={checkoutForm.pickup_relation}
              onChange={(e) => setCheckoutForm({ ...checkoutForm, pickup_relation: e.target.value })} />
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={checkoutForm.id_verified}
                onChange={(e) => setCheckoutForm({ ...checkoutForm, id_verified: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300" />
              {t('operations.idVerified')}
            </label>
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {isRtl
                ? 'يتم حساب قيمة الجلسة على الخادم وفق قواعد التسعير النشطة، وتُنشأ فاتورة تلقائياً.'
                : 'The session charge is computed server-side from active pricing rules and an invoice is generated automatically.'}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
