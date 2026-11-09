import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bell, CheckCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Badge, Button, Card, EmptyState, PageHeader, TableSkeleton } from '@/components/ui';
import { formatDateTime } from '@/lib/utils';

export default function Notifications() {
  const { t, i18n } = useTranslation();
  const { context } = useAuth();
  const qc = useQueryClient();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const { data, error } = await supabase.from('notifications')
        .select('id, type, title_en, title_ar, body_en, body_ar, severity, is_read, created_at')
        .order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data as Array<{
        id: string; type: string; title_en: string; title_ar: string; body_en: string | null;
        body_ar: string | null; severity: string; is_read: boolean; created_at: string;
      }>;
    },
  });

  const markAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('user_id', context!.user_id).eq('is_read', false);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const toneOf = (s: string) => s === 'error' ? 'danger' : s === 'warning' ? 'warning' : s === 'success' ? 'success' : 'info';

  return (
    <div>
      <PageHeader title={t('common.notifications')}
        subtitle={isRtl ? 'تنبيهات الاشتراكات والمخزون والخزينة' : 'Subscription, inventory and cash alerts'}
        actions={<Button variant="secondary" size="sm" onClick={() => markAll.mutate()}>
          <CheckCheck className="h-4 w-4" /> {t('common.markAllRead')}
        </Button>} />

      {isLoading ? <Card><TableSkeleton rows={6} cols={3} /></Card> : !data?.length ? (
        <Card><EmptyState title={t('common.noNotifications')} icon={<Bell className="h-6 w-6" />} /></Card>
      ) : (
        <div className="space-y-2">
          {data.map((n) => (
            <Card key={n.id} className={`flex items-start gap-3 p-4 ${n.is_read ? 'opacity-70' : ''}`}>
              <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                n.severity === 'warning' ? 'bg-amber-100 text-amber-700'
                  : n.severity === 'error' ? 'bg-rose-100 text-rose-700' : 'bg-sky-100 text-sky-700'}`}>
                <Bell className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{isRtl ? n.title_ar : n.title_en}</p>
                  <Badge tone={toneOf(n.severity) as 'info'}>{n.type}</Badge>
                  {!n.is_read && <span className="h-2 w-2 rounded-full bg-brand-600" />}
                </div>
                <p className="mt-0.5 text-sm text-slate-500">{isRtl ? n.body_ar : n.body_en}</p>
                <p className="mt-1 text-[11px] text-slate-400">{formatDateTime(n.created_at, locale)}</p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
