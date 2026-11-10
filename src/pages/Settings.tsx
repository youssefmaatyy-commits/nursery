import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Save, Settings2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { humanizeError } from '@/lib/errors';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, TableSkeleton } from '@/components/ui';

export default function Settings() {
  const { t, i18n } = useTranslation();
  const { context, can, refresh } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const isRtl = i18n.language === 'ar';
  const [draft, setDraft] = useState<Record<string, string>>({});

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('system_settings').select('key, value, description').order('key');
      if (error) throw error;
      return data as Array<{ key: string; value: unknown; description: string | null }>;
    },
  });

  const { data: branch } = useQuery({
    queryKey: ['branch-settings', context?.branches?.[0]?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('branches')
        .select('id, code, name_en, name_ar, phone, email, address, tax_rate, currency, timezone')
        .order('code').limit(1).maybeSingle();
      if (error) throw error;
      return data as Record<string, unknown> | null;
    },
  });

  const [branchDraft, setBranchDraft] = useState<Record<string, string>>({});

  const parseValue = (raw: string): unknown => {
    try { return JSON.parse(raw); } catch { return raw; }
  };

  const saveSetting = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const parsed: unknown = parseValue(value);
      const { error } = await supabase.from('system_settings')
        .update({ value: parsed, updated_by: context?.user_id ?? null, updated_at: new Date().toISOString() })
        .eq('key', key);
      if (error) throw error;
    },
    onSuccess: () => { push('success', t('common.savedSuccessfully')); void qc.invalidateQueries({ queryKey: ['settings'] }); },
    onError: (e: Error) => push('error', humanizeError(e, isRtl ? 'ar' : 'en')),
  });

  const saveBranch = useMutation({
    mutationFn: async () => {
      if (!branch) return;
      const { error } = await supabase.from('branches').update({
        name_en: branchDraft.name_en ?? branch.name_en,
        name_ar: branchDraft.name_ar ?? branch.name_ar,
        phone: branchDraft.phone ?? branch.phone,
        email: branchDraft.email ?? branch.email,
        address: branchDraft.address ?? branch.address,
        tax_rate: Number(branchDraft.tax_rate ?? branch.tax_rate),
      }).eq('id', branch.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      push('success', t('common.savedSuccessfully'));
      await refresh();
      void qc.invalidateQueries({ queryKey: ['branch-settings'] });
    },
    onError: (e: Error) => push('error', humanizeError(e, isRtl ? 'ar' : 'en')),
  });

  const asText = (v: unknown) => (typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v, null, 0));

  return (
    <div>
      <PageHeader title={t('admin.settings')}
        subtitle={isRtl ? 'إعدادات المؤسسة والفرع والفواتير' : 'Organisation, branch and billing settings'}
        actions={<Badge tone="info">{isRtl ? 'تسري على الفور' : 'Applied immediately'}</Badge>} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('admin.generalSettings')} action={<Settings2 className="h-4 w-4 text-slate-400" />} />
          {isLoading ? <TableSkeleton rows={6} cols={2} /> : !settings?.length ? <EmptyState title={t('common.noData')} /> : (
            <div className="divide-y divide-slate-100">
              {settings.map((s) => (
                <div key={s.key} className="flex flex-wrap items-end gap-2 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs font-medium text-slate-700">{s.key}</p>
                    <p className="text-[11px] text-slate-400">{s.description}</p>
                    <Input className="mt-1.5" value={draft[s.key] ?? asText(s.value)}
                      onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })}
                      disabled={!can('settings.manage')} />
                  </div>
                  {can('settings.manage') && (
                    <Button variant="secondary" size="sm" loading={saveSetting.isPending}
                      onClick={() => saveSetting.mutate({ key: s.key, value: draft[s.key] ?? asText(s.value) })}>
                      <Save className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title={t('admin.branches')} />
          {!branch ? <EmptyState title={t('common.noData')} /> : (
            <div className="space-y-3 p-4">
              <Input label={t('common.nameEn')} defaultValue={String(branch.name_en)}
                onChange={(e) => setBranchDraft({ ...branchDraft, name_en: e.target.value })} />
              <Input label={t('common.nameAr')} defaultValue={String(branch.name_ar)}
                onChange={(e) => setBranchDraft({ ...branchDraft, name_ar: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <Input label={t('common.phone')} defaultValue={String(branch.phone ?? '')}
                  onChange={(e) => setBranchDraft({ ...branchDraft, phone: e.target.value })} />
                <Input label={t('common.email')} defaultValue={String(branch.email ?? '')}
                  onChange={(e) => setBranchDraft({ ...branchDraft, email: e.target.value })} />
              </div>
              <Input label={t('common.address')} defaultValue={String(branch.address ?? '')}
                onChange={(e) => setBranchDraft({ ...branchDraft, address: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <Input label={t('admin.taxRate')} type="number" defaultValue={String(branch.tax_rate ?? 0)}
                  onChange={(e) => setBranchDraft({ ...branchDraft, tax_rate: e.target.value })} />
                <Input label={t('admin.currency')} defaultValue={String(branch.currency ?? 'EGP')} disabled />
              </div>
              <p className="text-xs text-slate-400">
                {t('admin.timezone')}: {String(branch.timezone)} · {isRtl ? 'كود الفرع' : 'Branch code'}: {String(branch.code)}
              </p>
              {can('settings.manage') && (
                <Button loading={saveBranch.isPending} onClick={() => saveBranch.mutate()} className="w-full">
                  <Save className="h-4 w-4" /> {t('common.save')}
                </Button>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
