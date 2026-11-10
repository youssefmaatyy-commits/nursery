import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Baby, Plus, Search, QrCode, Phone, UserPlus, Archive } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import {
  Alert, Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, TableSkeleton, Textarea,
} from '@/components/ui';
import { ageFromDob, formatDate } from '@/lib/utils';

interface ChildRow {
  id: string; child_code: string; full_name_en: string; full_name_ar: string;
  date_of_birth: string; gender: string; photo_url: string | null; status: string;
  branch_id: string; primary_guardian: string | null; primary_phone: string | null; age_years: number | null;
}

interface DuplicateRow { id: string; child_code: string; full_name_en: string; match_reason: string }
interface ParentOption { id: string; full_name_en: string; full_name_ar: string; phone: string }

export default function Children() {
  const { t, i18n } = useTranslation();
  const { context, can } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';
  const branchId = context?.branches?.[0]?.id ?? null;

  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateRow[] | null>(null);

  const [form, setForm] = useState({
    full_name_en: '', full_name_ar: '', date_of_birth: '', gender: 'male',
    allergies: '', medical_notes: '', special_care: '',
    emergency_contact_name: '', emergency_contact_phone: '',
    parent_mode: 'new' as 'new' | 'existing',
    parent_id: '', parent_name_en: '', parent_name_ar: '', parent_phone: '', parent_relation: 'father',
  });

  const { data: children, isLoading } = useQuery({
    queryKey: ['children', query, branchId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_children', {
        p_query: query, p_branch: branchId, p_limit: 50,
      });
      if (error) throw error;
      return (data ?? []) as unknown as ChildRow[];
    },
  });

  const { data: parents } = useQuery({
    queryKey: ['parent-options', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.from('parents').select('id, full_name_en, full_name_ar, phone')
        .eq('status', 'active').order('full_name_en').limit(500);
      if (error) throw error;
      return data as ParentOption[];
    },
    enabled: showForm,
  });

  const createChild = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error('No branch');
      const client = supabase;
      let parentId = form.parent_id;

      if (form.parent_mode === 'new') {
        const { data: newParent, error: pErr } = await client.from('parents').insert({
          full_name_en: form.parent_name_en, full_name_ar: form.parent_name_ar,
          phone: form.parent_phone, branch_id: branchId,
        }).select('id').single();
        if (pErr) throw pErr;
        parentId = newParent.id;
      }
      if (!parentId) throw new Error('guardian_required');

      const { data: child, error: cErr } = await client.from('children').insert({
        branch_id: branchId,
        full_name_en: form.full_name_en, full_name_ar: form.full_name_ar,
        date_of_birth: form.date_of_birth, gender: form.gender,
        allergies: form.allergies || null, medical_notes: form.medical_notes || null,
        special_care: form.special_care || null,
        emergency_contact_name: form.emergency_contact_name || null,
        emergency_contact_phone: form.emergency_contact_phone || null,
        created_by: context?.user_id,
      }).select('id').single();
      if (cErr) throw cErr;

      const { error: lErr } = await client.from('child_guardians').insert({
        child_id: child.id, parent_id: parentId,
        relation: form.parent_mode === 'new' ? form.parent_relation : 'guardian',
        is_primary: true, can_pickup: true, financial_responsible: true,
      });
      if (lErr) throw lErr;
      return child;
    },
    onSuccess: () => {
      push('success', t('common.savedSuccessfully'));
      setShowForm(false);
      setDuplicate(null);
      setForm({ ...form, full_name_en: '', full_name_ar: '', date_of_birth: '', parent_name_en: '', parent_name_ar: '', parent_phone: '' });
      void qc.invalidateQueries({ queryKey: ['children'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: Error) => push('error', e.message),
  });

  const archiveChild = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('children').update({ status: 'archived' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      push('success', t('common.savedSuccessfully'));
      void qc.invalidateQueries({ queryKey: ['children'] });
    },
    onError: (e: Error) => push('error', e.message),
  });

  const checkDuplicates = async () => {
    if (!form.full_name_en || !form.date_of_birth) return;
    const { data } = await supabase.rpc('find_duplicate_child', {
      p_name_en: form.full_name_en, p_dob: form.date_of_birth, p_phone: form.parent_phone || null,
    });
    if (data && (data as unknown[]).length > 0) setDuplicate(data as unknown as DuplicateRow[]);
  };

  return (
    <div>
      <PageHeader
        title={t('children.title')}
        subtitle={isRtl ? 'سجل الأطفال، أولياء الأمور والبيانات الطبية' : 'Child registry, guardians and medical data'}
        actions={can('children.create') && (
          <Button onClick={() => setShowForm(true)}><Plus className="h-4 w-4" /> {t('children.add')}</Button>
        )}
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-slate-400" />
            <Input className="ps-9" placeholder={t('common.searchPlaceholder')} value={query}
              onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Badge tone="brand">{children?.length ?? 0}</Badge>
          <div className="ms-auto flex items-center gap-1.5 text-xs text-slate-400">
            <QrCode className="h-3.5 w-3.5" />
            {isRtl ? 'ابحث بكود الطفل أو الهاتف أو امسح رمز QR' : 'Search by code, phone, or scan QR'}
          </div>
        </div>
      </Card>

      <div className="table-wrap">
        {isLoading ? <TableSkeleton rows={6} cols={6} /> : !children?.length ? (
          <EmptyState title={t('children.noChildren')} icon={<Baby className="h-6 w-6" />}
            action={can('children.create') && <Button onClick={() => setShowForm(true)}><UserPlus className="h-4 w-4" /> {t('children.register')}</Button>} />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('children.childCode')}</th>
                <th>{t('common.name')}</th>
                <th>{t('children.age')}</th>
                <th>{t('children.guardian')}</th>
                <th>{t('common.phone')}</th>
                <th>{t('common.status')}</th>
                <th className="text-end">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {children.map((c) => {
                const age = ageFromDob(c.date_of_birth);
                return (
                  <tr key={c.id}>
                    <td className="font-mono text-xs text-slate-500">{c.child_code}</td>
                    <td>
                      <Link to={`/children/${c.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                        {isRtl ? c.full_name_ar : c.full_name_en}
                      </Link>
                      <p className="text-xs text-slate-400">{isRtl ? c.full_name_en : c.full_name_ar}</p>
                    </td>
                    <td className="whitespace-nowrap text-slate-600">
                      {age.years} {t('common.years')} {age.months} {t('common.months')}
                      <p className="text-xs text-slate-400">{formatDate(c.date_of_birth, locale)}</p>
                    </td>
                    <td className="text-slate-600">{c.primary_guardian ?? '—'}</td>
                    <td className="whitespace-nowrap text-slate-600">
                      {c.primary_phone ? <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{c.primary_phone}</span> : '—'}
                    </td>
                    <td>
                      <Badge tone={c.status === 'active' ? 'success' : c.status === 'archived' ? 'neutral' : 'warning'}>
                        {t(`children.${c.status}`, c.status)}
                      </Badge>
                    </td>
                    <td className="text-end">
                      <div className="flex justify-end gap-1">
                        <Link to={`/children/${c.id}`}><Button variant="ghost" size="sm">{t('common.view')}</Button></Link>
                        {can('children.archive') && c.status === 'active' && (
                          <Button variant="ghost" size="sm" onClick={() => {
                            if (window.confirm(t('common.confirmDelete'))) archiveChild.mutate(c.id);
                          }}><Archive className="h-3.5 w-3.5" /></Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} wide title={t('children.add')}
        footer={<>
          <Button variant="secondary" onClick={() => setShowForm(false)}>{t('common.cancel')}</Button>
          <Button loading={createChild.isPending}
            onClick={async () => { await checkDuplicates(); createChild.mutate(); }}>
            {t('common.save')}
          </Button>
        </>}>
        <div className="space-y-5">
          {duplicate && duplicate.length > 0 && (
            <Alert tone="warning">
              <p className="font-medium">{t('children.duplicateFound')}</p>
              <ul className="mt-1 list-inside list-disc text-xs">
                {duplicate.map((d) => <li key={d.id}>{d.child_code} — {d.full_name_en} ({d.match_reason})</li>)}
              </ul>
            </Alert>
          )}

          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-semibold text-slate-800">{t('children.basicInfo')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={t('children.fullNameEn')} required value={form.full_name_en}
                onChange={(e) => setForm({ ...form, full_name_en: e.target.value })} />
              <Input label={t('children.fullNameAr')} required value={form.full_name_ar}
                onChange={(e) => setForm({ ...form, full_name_ar: e.target.value })} />
              <Input label={t('children.dob')} type="date" required value={form.date_of_birth}
                onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} />
              <Select label={t('children.gender')} value={form.gender}
                onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="male">{t('children.male')}</option>
                <option value="female">{t('children.female')}</option>
              </Select>
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-semibold text-slate-800">{t('children.medicalInfo')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={t('children.allergies')} value={form.allergies}
                onChange={(e) => setForm({ ...form, allergies: e.target.value })} />
              <Input label={t('children.emergencyContact')} value={form.emergency_contact_name}
                onChange={(e) => setForm({ ...form, emergency_contact_name: e.target.value })} />
              <Input label={t('children.emergencyPhone')} value={form.emergency_contact_phone}
                onChange={(e) => setForm({ ...form, emergency_contact_phone: e.target.value })} />
              <Input label={t('children.specialCare')} value={form.special_care}
                onChange={(e) => setForm({ ...form, special_care: e.target.value })} />
            </div>
            <Textarea label={t('children.medicalNotes')} value={form.medical_notes}
              onChange={(e) => setForm({ ...form, medical_notes: e.target.value })} />
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-semibold text-slate-800">{t('children.familyInfo')}</legend>
            <Select label={t('children.guardian')} value={form.parent_mode}
              onChange={(e) => setForm({ ...form, parent_mode: e.target.value as 'new' | 'existing' })}>
              <option value="new">{isRtl ? 'ولي أمر جديد' : 'New parent'}</option>
              <option value="existing">{isRtl ? 'ولي أمر مسجل' : 'Existing parent'}</option>
            </Select>

            {form.parent_mode === 'new' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label={t('children.fullNameEn')} value={form.parent_name_en}
                  onChange={(e) => setForm({ ...form, parent_name_en: e.target.value })} />
                <Input label={t('children.fullNameAr')} value={form.parent_name_ar}
                  onChange={(e) => setForm({ ...form, parent_name_ar: e.target.value })} />
                <Input label={t('common.phone')} value={form.parent_phone}
                  onChange={(e) => setForm({ ...form, parent_phone: e.target.value })} />
                <Select label={t('children.relation')} value={form.parent_relation}
                  onChange={(e) => setForm({ ...form, parent_relation: e.target.value })}>
                  <option value="father">{t('children.father')}</option>
                  <option value="mother">{t('children.mother')}</option>
                  <option value="guardian">{t('children.guardianRel')}</option>
                  <option value="other">{t('children.other')}</option>
                </Select>
              </div>
            ) : (
              <Select label={t('children.guardian')} value={form.parent_id}
                onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
                <option value="">—</option>
                {parents?.map((p) => (
                  <option key={p.id} value={p.id}>{isRtl ? p.full_name_ar : p.full_name_en} · {p.phone}</option>
                ))}
              </Select>
            )}
          </fieldset>
        </div>
      </Modal>
    </div>
  );
}
