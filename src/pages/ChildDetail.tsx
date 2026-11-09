import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Phone, ShieldAlert, FileText, Plus, Users, Clock, Receipt } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Input, Modal, PageHeader, Select, TableSkeleton } from '@/components/ui';
import { ageFromDob, formatCurrency, formatDate, formatDateTime } from '@/lib/utils';

export default function ChildDetail() {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';
  const [showPickup, setShowPickup] = useState(false);
  const [pickup, setPickup] = useState({ nameEn: '', nameAr: '', relation: '', phone: '' });

  const { data: child, isLoading } = useQuery({
    queryKey: ['child', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('children').select('*').eq('id', id!).single();
      if (error) throw error;
      return data;
    },
    enabled: Boolean(id),
  });

  const { data: guardians } = useQuery({
    queryKey: ['child-guardians', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('child_guardians')
        .select('id, relation, is_primary, can_pickup, financial_responsible, parents(id, full_name_en, full_name_ar, phone, email)')
        .eq('child_id', id!);
      if (error) throw error;
      return data as unknown as Array<{
        id: string; relation: string; is_primary: boolean; can_pickup: boolean; financial_responsible: boolean;
        parents: { id: string; full_name_en: string; full_name_ar: string; phone: string; email: string | null } | null;
      }>;
    },
    enabled: Boolean(id),
  });

  const { data: pickups } = useQuery({
    queryKey: ['child-pickups', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('authorized_pickups').select('*').eq('child_id', id!).eq('is_active', true);
      if (error) throw error;
      return data as Array<{ id: string; full_name_en: string; full_name_ar: string; relation: string; phone: string }>;
    },
    enabled: Boolean(id),
  });

  const { data: sessions } = useQuery({
    queryKey: ['child-sessions', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('kids_area_sessions')
        .select('id, checkin_at, checkout_at, status, billable_minutes, total')
        .eq('child_id', id!).order('checkin_at', { ascending: false }).limit(10);
      if (error) throw error;
      return data as Array<{ id: string; checkin_at: string; checkout_at: string | null; status: string; billable_minutes: number | null; total: number }>;
    },
    enabled: Boolean(id),
  });

  const { data: invoices } = useQuery({
    queryKey: ['child-invoices', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('invoices')
        .select('id, invoice_number, total, paid_amount, balance, status, issued_at')
        .eq('child_id', id!).order('issued_at', { ascending: false }).limit(10);
      if (error) throw error;
      return data as Array<{ id: string; invoice_number: string; total: number; paid_amount: number; balance: number; status: string; issued_at: string }>;
    },
    enabled: Boolean(id),
  });

  const addPickup = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('authorized_pickups').insert({
        child_id: id, full_name_en: pickup.nameEn, full_name_ar: pickup.nameAr,
        relation: pickup.relation, phone: pickup.phone,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      push('success', t('common.savedSuccessfully'));
      setShowPickup(false);
      void qc.invalidateQueries({ queryKey: ['child-pickups', id] });
    },
    onError: (e: Error) => push('error', e.message),
  });

  if (isLoading) return <Card><TableSkeleton rows={6} cols={4} /></Card>;
  if (!child) return <Card><EmptyState title={t('common.noData')} /></Card>;

  const age = ageFromDob(child.date_of_birth);

  return (
    <div>
      <Link to="/children" className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t('children.title')}
      </Link>

      <PageHeader
        title={isRtl ? child.full_name_ar : child.full_name_en}
        subtitle={`${child.child_code} · ${age.years} ${t('common.years')} · ${t('children.enrollmentDate')}: ${formatDate(child.enrollment_date, locale)}`}
        actions={<Badge tone={child.status === 'active' ? 'success' : 'neutral'}>{String(t(`children.${child.status}`, child.status))}</Badge>}
      />

      {(child.allergies || child.medical_notes) && (
        <div className="mb-4"><Alert tone="danger">
          <span className="font-semibold">{t('children.allergies')}: </span>{child.allergies || '—'}
          {child.medical_notes && <><br /><span className="font-semibold">{t('children.medicalNotes')}: </span>{child.medical_notes}</>}
        </Alert></div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t('children.guardians')} action={can('parents.manage') && (
            <Link to="/parents"><Button variant="secondary" size="sm">{t('parents.add')}</Button></Link>
          )} />
          {!guardians?.length ? <EmptyState title={t('common.noData')} icon={<Users className="h-6 w-6" />} /> : (
            <ul className="divide-y divide-slate-100">
              {guardians.map((g) => (
                <li key={g.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                    {(g.parents?.full_name_en ?? '?').slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{isRtl ? g.parents?.full_name_ar : g.parents?.full_name_en}</p>
                    <p className="text-xs text-slate-400">{String(t(g.relation === 'father' ? 'children.father' : g.relation === 'mother' ? 'children.mother' : 'children.guardianRel'))}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {g.is_primary && <Badge tone="brand">{t('children.primary')}</Badge>}
                    {g.can_pickup && <Badge tone="success">{t('children.canPickup')}</Badge>}
                    {g.financial_responsible && <Badge tone="info">{t('children.financialResponsible')}</Badge>}
                  </div>
                  <a href={`tel:${g.parents?.phone}`} className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">
                    <Phone className="h-3.5 w-3.5" /> {g.parents?.phone}
                  </a>
                </li>
              ))}
            </ul>
          )}

          <CardHeader title={t('children.authorizedPickups')} action={can('children.edit') && (
            <Button variant="secondary" size="sm" onClick={() => setShowPickup(true)}><Plus className="h-3.5 w-3.5" /> {t('children.add')}</Button>
          )} />
          {!pickups?.length ? <EmptyState title={t('common.noData')} icon={<ShieldAlert className="h-6 w-6" />} /> : (
            <ul className="divide-y divide-slate-100">
              {pickups.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{isRtl ? p.full_name_ar : p.full_name_en}</p>
                    <p className="text-xs text-slate-400">{p.relation} · {p.phone}</p>
                  </div>
                  <Badge tone="success">{t('children.canPickup')}</Badge>
                </li>
              ))}
            </ul>
          )}

          <CardHeader title={t('children.attendanceHistory')} />
          {!sessions?.length ? <EmptyState title={t('common.noData')} icon={<Clock className="h-6 w-6" />} /> : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr>
                  <th>{t('common.date')}</th><th>{t('common.status')}</th>
                  <th>{t('operations.billableMinutes')}</th><th>{t('common.total')}</th>
                </tr></thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td className="whitespace-nowrap">{formatDateTime(s.checkin_at, locale)}</td>
                      <td><Badge tone={s.status === 'closed' ? 'neutral' : 'success'}>{s.status}</Badge></td>
                      <td>{s.billable_minutes ?? '—'}</td>
                      <td>{formatCurrency(s.total, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title={t('children.qrCode')} />
            <div className="flex flex-col items-center gap-3 p-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-3">
                <QRCodeSVG value={child.qr_token} size={168} />
              </div>
              <p className="text-center text-xs text-slate-500">{child.child_code}</p>
              <p className="text-center text-[11px] text-slate-400">
                {isRtl ? 'امسح هذا الرمز عند تسجيل الدخول والخروج' : 'Scan this code at check-in / check-out'}
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title={t('children.paymentHistory')} action={<Receipt className="h-4 w-4 text-slate-400" />} />
            {!invoices?.length ? <EmptyState title={t('common.noData')} /> : (
              <ul className="divide-y divide-slate-100">
                {invoices.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div>
                      <p className="font-medium">{inv.invoice_number}</p>
                      <p className="text-xs text-slate-400">{formatDate(inv.issued_at, locale)}</p>
                    </div>
                    <div className="text-end">
                      <p className="font-semibold">{formatCurrency(inv.total, locale)}</p>
                      <p className="text-xs text-rose-600">{t('common.balance')}: {formatCurrency(inv.balance, locale)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              <FileText className="h-4 w-4" /> {t('children.documents')}
            </p>
            <p className="text-xs text-slate-500">
              {isRtl ? 'المستندات مخزنة في مخزن خاص ولا يمكن الوصول إليها إلا للمصرح لهم.'
                : 'Documents are stored in a private bucket, accessible only to authorized staff.'}
            </p>
            <Link to="/operations"><Button variant="secondary" size="sm" className="mt-3 w-full">
              {isRtl ? 'إدارة المستندات' : 'Manage documents'}
            </Button></Link>
          </Card>
        </div>
      </div>

      <Modal open={showPickup} onClose={() => setShowPickup(false)} title={t('children.authorizedPickups')}
        footer={<>
          <Button variant="secondary" onClick={() => setShowPickup(false)}>{t('common.cancel')}</Button>
          <Button loading={addPickup.isPending} onClick={() => addPickup.mutate()}>{t('common.save')}</Button>
        </>}>
        <div className="space-y-3">
          <Input label={t('children.fullNameEn')} value={pickup.nameEn}
            onChange={(e) => setPickup({ ...pickup, nameEn: e.target.value })} />
          <Input label={t('children.fullNameAr')} value={pickup.nameAr}
            onChange={(e) => setPickup({ ...pickup, nameAr: e.target.value })} />
          <Input label={t('children.relation')} value={pickup.relation}
            onChange={(e) => setPickup({ ...pickup, relation: e.target.value })} />
          <Input label={t('common.phone')} value={pickup.phone}
            onChange={(e) => setPickup({ ...pickup, phone: e.target.value })} />
        </div>
      </Modal>
    </div>
  );
}
