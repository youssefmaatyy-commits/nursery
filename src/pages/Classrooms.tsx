import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Badge, Card, EmptyState, PageHeader, TableSkeleton } from '@/components/ui';
import { formatCurrency } from '@/lib/utils';

export default function Classrooms() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';

  const { data, isLoading } = useQuery({
    queryKey: ['classrooms'],
    queryFn: async () => {
      const { data, error } = await supabase.from('classrooms')
        .select('id, name_en, name_ar, age_min_months, age_max_months, capacity, monthly_fee, is_active, classroom_children(id, ended_at)')
        .eq('is_active', true).order('age_min_months');
      if (error) throw error;
      return data as unknown as Array<{
        id: string; name_en: string; name_ar: string; age_min_months: number; age_max_months: number;
        capacity: number; monthly_fee: number; classroom_children: Array<{ id: string; ended_at: string | null }>;
      }>;
    },
  });

  return (
    <div>
      <PageHeader title={t('nav.classrooms')}
        subtitle={isRtl ? 'السعة والفصول والعمر المستهدف' : 'Capacity, classrooms and age bands'} />

      {isLoading ? <Card><TableSkeleton rows={4} cols={4} /></Card> : !data?.length ? (
        <Card><EmptyState title={t('common.noData')} /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((c) => {
            const enrolled = c.classroom_children.filter((cc) => !cc.ended_at).length;
            const pct = Math.min(100, Math.round((enrolled / c.capacity) * 100));
            return (
              <Card key={c.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-slate-900">{isRtl ? c.name_ar : c.name_en}</p>
                    <p className="text-xs text-slate-400">
                      {Math.round(c.age_min_months / 12)}–{Math.round(c.age_max_months / 12)} {t('common.years')}
                    </p>
                  </div>
                  <Badge tone={pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'success'}>
                    {enrolled}/{c.capacity}
                  </Badge>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full ${pct >= 100 ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-slate-500">{t('nursery.fee')}</span>
                  <span className="font-semibold">{formatCurrency(c.monthly_fee, locale)}</span>
                </div>
                {!can('nursery.manage_classes') && (
                  <p className="mt-2 text-[11px] text-slate-400">{t('common.view')}</p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
