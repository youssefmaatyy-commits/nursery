import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Wifi, WifiOff, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { db, isOnline, retryFailed, synchronize, type QueuedOp } from '@/lib/offline';
import { useOnlineStatus } from '@/hooks/useOnline';
import { useToast } from '@/components/ui/Toast';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { formatDateTime } from '@/lib/utils';

export default function Sync() {
  const { t, i18n } = useTranslation();
  const { online, pending, failed, refreshCounts } = useOnlineStatus();
  const { push } = useToast();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';
  const [ops, setOps] = useState<QueuedOp[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const all = await db.queue.orderBy('created_at').reverse().toArray();
    setOps(all);
  };

  useEffect(() => { void load(); }, [pending, failed]);

  const runSync = async () => {
    setBusy(true);
    try {
      const report = await synchronize();
      await refreshCounts();
      await load();
      push(report.failed ? 'error' : 'success',
        `${t('sync.applied')}: ${report.applied} · ${t('sync.failed')}: ${report.failed}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title={t('sync.title')}
        subtitle={isRtl ? 'قائمة العمليات دون اتصال ومزامنتها بأمان' : 'Offline operation queue and safe synchronisation'}
        actions={<Button onClick={runSync} loading={busy} disabled={!online}>
          <RefreshCw className="h-4 w-4" /> {t('sync.syncNow')}
        </Button>} />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-sm text-slate-500">{isRtl ? 'الاتصال' : 'Connection'}</p>
          <p className="mt-1 flex items-center gap-2 text-lg font-bold">
            {isOnline() ? <><Wifi className="h-5 w-5 text-emerald-600" /> {t('common.online')}</>
              : <><WifiOff className="h-5 w-5 text-amber-600" /> {t('common.offline')}</>}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-slate-500">{t('sync.pending')}</p>
          <p className="mt-1 text-lg font-bold">{pending}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-slate-500">{t('sync.failed')}</p>
          <p className="mt-1 flex items-center gap-2 text-lg font-bold">
            {failed > 0 ? <><AlertTriangle className="h-5 w-5 text-rose-600" /> {failed}</> : <><CheckCircle2 className="h-5 w-5 text-emerald-600" /> 0</>}
          </p>
        </Card>
      </div>

      {failed > 0 && (
        <div className="mb-4">
          <Alert tone="warning">
            {isRtl ? 'هناك عمليات فشلت ولن تُفقد. أعد المحاولة بعد حل سبب الخطأ.' : 'Some operations failed and were not lost. Retry after resolving the cause.'}
            <Button variant="secondary" size="sm" className="ms-3"
              onClick={async () => { await retryFailed(); await refreshCounts(); await load(); }}>
              {t('sync.retryFailed')}
            </Button>
          </Alert>
        </div>
      )}

      <Card>
        <CardHeader title={t('sync.offlineQueue')} action={<Badge tone="brand">{ops.length}</Badge>} />
        {!ops.length ? <EmptyState title={t('sync.upToDate')} /> : (
          <ul className="divide-y divide-slate-100">
            {ops.map((op) => (
              <li key={op.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                <Badge tone={op.status === 'applied' ? 'success' : op.status === 'failed' ? 'danger' : 'warning'}>
                  {t(`sync.${op.status === 'applied' ? 'applied' : op.status === 'failed' ? 'failed' : 'pending'}`)}
                </Badge>
                <span className="font-medium">{op.operation_type}</span>
                <span className="font-mono text-[11px] text-slate-400">{op.client_op_id}</span>
                <span className="ms-auto text-xs text-slate-400">{formatDateTime(new Date(op.created_at), locale)}</span>
                {op.last_error && <p className="w-full text-xs text-rose-600">{op.last_error}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
