import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Download, FileUp, HeartPulse, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { humanizeError } from '@/lib/errors';
import {
  Alert, Badge, Button, Card, CardHeader, EmptyState, Input, Modal, PageHeader, Select, TableSkeleton,
} from '@/components/ui';
import { formatDate } from '@/lib/utils';

interface ChildOption { id: string; child_code: string; full_name_en: string; full_name_ar: string; branch_id: string }
interface DocRow {
  id: string; child_id: string; doc_type: string; bucket: string; file_path: string;
  original_name: string | null; expires_at: string | null; created_at: string;
  children: { child_code: string; full_name_en: string; full_name_ar: string } | null;
}
interface MedicalRow {
  id: string; child_id: string; note_type: string; description: string;
  severity: string; recorded_at: string;
  children: { child_code: string; full_name_en: string; full_name_ar: string } | null;
}

const DOC_TYPES = ['birth_certificate', 'vaccination', 'medical_report', 'photo', 'enrollment_form', 'insurance', 'other'] as const;
const NOTE_TYPES = ['allergy', 'chronic', 'medication', 'incident', 'observation', 'vaccination'] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

/**
 * Child documents and medical notes.
 *
 * `child_documents` and `medical_notes` have existed since migration 0002 with
 * RLS and a private storage bucket, but there was no screen — and ChildDetail
 * linked "Manage documents" to a page that had no documents on it at all.
 *
 * Files never go through a signed URL that leaves this component: the storage
 * bucket is private, so a link is only minted on demand and expires.
 */
export default function Documents() {
  const { t, i18n } = useTranslation();
  const { context, can } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-US';
  const branchId = context?.branches?.[0]?.id ?? null;
  const fileRef = useRef<HTMLInputElement>(null);
  // ChildDetail links here with ?child=<id> so the picker opens pre-filled.
  const [params] = useSearchParams();

  const [showDoc, setShowDoc] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [docForm, setDocForm] = useState({ child_id: '', doc_type: 'birth_certificate', file: null as File | null });
  const [noteForm, setNoteForm] = useState({ child_id: '', note_type: 'allergy', description: '', severity: 'low' });
  const presetChild = params.get('child') ?? '';

  useEffect(() => {
    if (!presetChild) return;
    setDocForm((f) => ({ ...f, child_id: presetChild }));
    setNoteForm((f) => ({ ...f, child_id: presetChild }));
  }, [presetChild]);

  const { data: children } = useQuery({
    queryKey: ['children-options', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.from('children')
        .select('id, child_code, full_name_en, full_name_ar, branch_id')
        .is('archived_at', null).order('child_code').limit(500);
      if (error) throw error;
      return data as ChildOption[];
    },
    enabled: Boolean(branchId),
  });

  const { data: docs, isLoading: docsLoading } = useQuery({
    queryKey: ['child-documents', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.from('child_documents')
        .select('id, child_id, doc_type, bucket, file_path, original_name, expires_at, created_at, children(child_code, full_name_en, full_name_ar)')
        .order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return data as unknown as DocRow[];
    },
    enabled: Boolean(branchId),
  });

  const { data: notes, isLoading: notesLoading } = useQuery({
    queryKey: ['medical-notes', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.from('medical_notes')
        .select('id, child_id, note_type, description, severity, recorded_at, children(child_code, full_name_en, full_name_ar)')
        .order('recorded_at', { ascending: false }).limit(200);
      if (error) throw error;
      return data as unknown as MedicalRow[];
    },
    enabled: Boolean(branchId),
  });

  const childName = (c: { child_code: string; full_name_en: string; full_name_ar: string } | null) =>
    c ? `${c.child_code} · ${isRtl ? c.full_name_ar : c.full_name_en}` : '—';

  const upload = useMutation({
    mutationFn: async () => {
      if (!docForm.file) throw new Error('file_required');
      if (!docForm.child_id) throw new Error('child_required');
      const child = children?.find((c) => c.id === docForm.child_id);
      if (!child) throw new Error('child_required');

      const safeName = docForm.file.name.replace(/[^\w.\-\u0600-\u06FF]/g, '_');
      const path = `${child.branch_id}/${docForm.child_id}/${Date.now()}-${safeName}`;

      const { error: upErr } = await supabase.storage
        .from('child-documents')
        .upload(path, docForm.file, { upsert: false, contentType: docForm.file.type || undefined });
      if (upErr) throw upErr;

      const { error } = await supabase.from('child_documents').insert({
        child_id: docForm.child_id,
        branch_id: child.branch_id,
        doc_type: docForm.doc_type,
        bucket: 'child-documents',
        file_path: path,
        original_name: docForm.file.name,
        notes: null,
        uploaded_by: context?.user_id,
      });
      // If the row fails the file is orphaned in storage — remove it so the
      // bucket does not silently fill with untracked objects.
      if (error) {
        await supabase.storage.from('child-documents').remove([path]);
        throw error;
      }

      await supabase.from('uploaded_files').insert({
        bucket: 'child-documents', path, original_name: docForm.file.name,
        mime_type: docForm.file.type || null, size_bytes: docForm.file.size,
        entity_type: 'child_documents', entity_id: docForm.child_id,
        uploaded_by: context?.user_id,
      });
    },
    onSuccess: () => {
      push('success', t('common.savedSuccessfully'));
      setShowDoc(false);
      setDocForm({ child_id: '', doc_type: 'birth_certificate', file: null });
      if (fileRef.current) fileRef.current.value = '';
      void qc.invalidateQueries({ queryKey: ['child-documents'] });
    },
    onError: (e: Error) => push('error', humanizeError(e, isRtl ? 'ar' : 'en')),
  });

  const openDoc = useMutation({
    mutationFn: async (d: DocRow) => {
      const { data, error } = await supabase.storage.from(d.bucket).createSignedUrl(d.file_path, 60);
      if (error) throw error;
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    },
    onError: (e: Error) => push('error', humanizeError(e, isRtl ? 'ar' : 'en')),
  });

  const removeDoc = useMutation({
    mutationFn: async (d: DocRow) => {
      await supabase.storage.from(d.bucket).remove([d.file_path]);
      const { error } = await supabase.from('child_documents').delete().eq('id', d.id);
      if (error) throw error;
    },
    onSuccess: () => {
      push('success', t('common.savedSuccessfully'));
      void qc.invalidateQueries({ queryKey: ['child-documents'] });
    },
    onError: (e: Error) => push('error', humanizeError(e, isRtl ? 'ar' : 'en')),
  });

  const addNote = useMutation({
    mutationFn: async () => {
      if (!noteForm.child_id) throw new Error('child_required');
      if (!noteForm.description.trim()) throw new Error('description_required');
      const child = children?.find((c) => c.id === noteForm.child_id);
      if (!child) throw new Error('child_required');
      const { error } = await supabase.from('medical_notes').insert({
        child_id: noteForm.child_id,
        branch_id: child.branch_id,
        note_type: noteForm.note_type,
        description: noteForm.description,
        severity: noteForm.severity,
        recorded_by: context?.user_id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      push('success', t('common.savedSuccessfully'));
      setShowNote(false);
      setNoteForm({ child_id: '', note_type: 'allergy', description: '', severity: 'low' });
      void qc.invalidateQueries({ queryKey: ['medical-notes'] });
    },
    onError: (e: Error) => push('error', humanizeError(e, isRtl ? 'ar' : 'en')),
  });

  const removeNote = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('medical_notes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      push('success', t('common.savedSuccessfully'));
      void qc.invalidateQueries({ queryKey: ['medical-notes'] });
    },
    onError: (e: Error) => push('error', humanizeError(e, isRtl ? 'ar' : 'en')),
  });

  const canDocs = can('documents.view');
  const canManage = can(['documents.manage', 'children.edit']);
  const severityTone = (s: string) =>
    s === 'critical' || s === 'high' ? 'danger' : s === 'medium' ? 'warning' : 'neutral';

  return (
    <div>
      <PageHeader
        title={isRtl ? 'المستندات والملاحظات الطبية' : 'Documents & medical notes'}
        subtitle={isRtl ? 'ملفات الأطفال في مخزن خاص' : 'Child files in a private bucket'}
        actions={canManage && (
          <>
            <Button variant="secondary" onClick={() => setShowNote(true)}>
              <HeartPulse className="h-4 w-4" /> {isRtl ? 'ملاحظة طبية' : 'Medical note'}
            </Button>
            <Button onClick={() => setShowDoc(true)}>
              <Plus className="h-4 w-4" /> {isRtl ? 'رفع مستند' : 'Upload'}
            </Button>
          </>
        )}
      />

      {!canDocs && (
        <div className="mb-4">
          <Alert tone="warning">
            {isRtl ? 'مالكش صلاحية عرض المستندات.' : 'You do not have permission to view documents.'}
          </Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={isRtl ? 'المستندات' : 'Documents'} action={<FileUp className="h-4 w-4 text-slate-400" />} />
          {docsLoading ? <TableSkeleton rows={4} cols={3} /> : !docs?.length ? (
            <EmptyState title={t('common.noData')} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{d.original_name ?? d.file_path}</p>
                    <p className="truncate text-xs text-slate-400">
                      {childName(d.children)} · {d.doc_type}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openDoc.mutate(d)}>
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    {canManage && (
                      <Button variant="ghost" size="sm" onClick={() => removeDoc.mutate(d)}>
                        <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={isRtl ? 'ملاحظات طبية' : 'Medical notes'} action={<HeartPulse className="h-4 w-4 text-slate-400" />} />
          {notesLoading ? <TableSkeleton rows={4} cols={3} /> : !notes?.length ? (
            <EmptyState title={t('common.noData')} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {notes.map((n) => (
                <li key={n.id} className="flex items-start justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge tone={severityTone(n.severity)}>{n.note_type}</Badge>
                      <span className="text-xs text-slate-400">{formatDate(n.recorded_at, locale)}</span>
                    </div>
                    <p className="mt-1 text-sm">{n.description}</p>
                    <p className="truncate text-xs text-slate-400">{childName(n.children)}</p>
                  </div>
                  {canManage && (
                    <Button variant="ghost" size="sm" onClick={() => removeNote.mutate(n.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Modal open={showDoc} onClose={() => setShowDoc(false)} title={isRtl ? 'رفع مستند' : 'Upload a document'}
        footer={<>
          <Button variant="secondary" onClick={() => setShowDoc(false)}>{t('common.cancel')}</Button>
          <Button loading={upload.isPending} onClick={() => upload.mutate()}>{t('common.save')}</Button>
        </>}>
        <div className="space-y-3">
          <Select label={isRtl ? 'الطفل' : 'Child'} required value={docForm.child_id}
            onChange={(e) => setDocForm({ ...docForm, child_id: e.target.value })}>
            <option value="">—</option>
            {children?.map((c) => (
              <option key={c.id} value={c.id}>{c.child_code} · {isRtl ? c.full_name_ar : c.full_name_en}</option>
            ))}
          </Select>
          <Select label={isRtl ? 'نوع المستند' : 'Document type'} value={docForm.doc_type}
            onChange={(e) => setDocForm({ ...docForm, doc_type: e.target.value })}>
            {DOC_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
          <div>
            <label className="label">{isRtl ? 'الملف' : 'File'}</label>
            <input ref={fileRef} type="file" className="input"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={(e) => setDocForm({ ...docForm, file: e.target.files?.[0] ?? null })} />
          </div>
          <p className="text-xs text-slate-500">
            {isRtl
              ? 'المخزن خاص، والرابط بيتولد عند الطلب وبينتهي بعد دقيقة.'
              : 'The bucket is private; links are minted on demand and expire after a minute.'}
          </p>
        </div>
      </Modal>

      <Modal open={showNote} onClose={() => setShowNote(false)} title={isRtl ? 'ملاحظة طبية' : 'Medical note'}
        footer={<>
          <Button variant="secondary" onClick={() => setShowNote(false)}>{t('common.cancel')}</Button>
          <Button loading={addNote.isPending} onClick={() => addNote.mutate()}>{t('common.save')}</Button>
        </>}>
        <div className="space-y-3">
          <Select label={isRtl ? 'الطفل' : 'Child'} required value={noteForm.child_id}
            onChange={(e) => setNoteForm({ ...noteForm, child_id: e.target.value })}>
            <option value="">—</option>
            {children?.map((c) => (
              <option key={c.id} value={c.id}>{c.child_code} · {isRtl ? c.full_name_ar : c.full_name_en}</option>
            ))}
          </Select>
          <Select label={isRtl ? 'النوع' : 'Type'} value={noteForm.note_type}
            onChange={(e) => setNoteForm({ ...noteForm, note_type: e.target.value })}>
            {NOTE_TYPES.map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
          <Select label={isRtl ? 'درجة الخطورة' : 'Severity'} value={noteForm.severity}
            onChange={(e) => setNoteForm({ ...noteForm, severity: e.target.value })}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Input label={isRtl ? 'الوصف' : 'Description'} required value={noteForm.description}
            onChange={(e) => setNoteForm({ ...noteForm, description: e.target.value })} />
        </div>
      </Modal>
    </div>
  );
}
