import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { Button, Card, EmptyState, Input, Modal, PageHeader, Select, TableSkeleton } from '@/components/ui';
import { humanizeError } from '@/lib/errors';

/** Optional row actions, e.g. archive/delete, implemented as database RPCs. */
export interface RowAction {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Only show this action when true. */
  visible?: (row: Record<string, unknown>) => boolean;
  /** Return the rpc name plus its arguments. */
  rpc: (row: Record<string, unknown>) => { fn: string; args: Record<string, unknown> };
  confirm?: string;
  tone?: 'default' | 'danger';
}

export interface FieldDef {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'select' | 'textarea' | 'time' | 'checkbox';
  options?: Array<{ value: string; label: string }>;
  /**
   * Load select options from another table instead of hardcoding them, so a
   * foreign key (e.g. products.category_id) can be picked in the form.
   */
  optionsFrom?: {
    table: string;
    labelColumnEn: string;
    labelColumnAr: string;
    /** Only offer rows where this column is not false. */
    activeColumn?: string;
  };
  required?: boolean;
  defaultValue?: string | number | boolean;
  hideInTable?: boolean;
  render?: (row: Record<string, unknown>) => ReactNode;
}

export interface CrudPageProps {
  title: string;
  subtitle?: string;
  table: string;
  select?: string;
  orderBy?: { column: string; ascending?: boolean };
  fields: FieldDef[];
  filters?: Array<{ column: string; label: string; options: Array<{ value: string; label: string }> }>;
  searchColumns?: string[];
  canCreate?: boolean;
  canEdit?: boolean;
  extraActions?: ReactNode;
  onRowClick?: (row: Record<string, unknown>) => void;
  defaults?: Record<string, unknown>;
  transformOnSave?: (values: Record<string, unknown>) => Record<string, unknown>;
  rowActions?: RowAction[];
}

export default function CrudPage({
  title, subtitle, table, select = '*', orderBy, fields, filters, searchColumns = [],
  canCreate, canEdit, extraActions, onRowClick, defaults, transformOnSave, rowActions = [],
}: CrudPageProps) {
  const { t, i18n } = useTranslation();
  const { push } = useToast();
  const qc = useQueryClient();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar' : 'en';
  const [search, setSearch] = useState('');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});

  const emptyForm = useMemo(
    () => fields.reduce<Record<string, unknown>>((acc, f) => {
      acc[f.name] = f.defaultValue ?? (f.type === 'checkbox' ? false : '');
      return acc;
    }, { ...(defaults ?? {}) }),
    [fields, defaults],
  );

  // Resolve any `optionsFrom` foreign keys once per table+locale.
  const dynamicSources = useMemo(() => fields.filter((f) => f.optionsFrom), [fields]);
  const { data: dynamicOptions = {} } = useQuery({
    queryKey: ['crud-options', table, isRtl, dynamicSources.map((f) => f.name)],
    queryFn: async () => {
      const result: Record<string, Array<{ value: string; label: string }>> = {};
      await Promise.all(dynamicSources.map(async (f) => {
        const src = f.optionsFrom!;
        let q = supabase.from(src.table).select(`id, ${src.labelColumnEn}, ${src.labelColumnAr}`);
        if (src.activeColumn) q = q.not(src.activeColumn, 'is', false);
        const { data: rows } = await q.limit(300);
        result[f.name] = (rows ?? []).map((r) => {
          const row = r as unknown as Record<string, string>;
          return { value: row.id, label: row[isRtl ? src.labelColumnAr : src.labelColumnEn] };
        });
      }));
      return result;
    },
    enabled: dynamicSources.length > 0,
    staleTime: 60_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: [table, filterValues],
    queryFn: async () => {
      let q = supabase.from(table).select(select).limit(500);
      Object.entries(filterValues).forEach(([k, v]) => { if (v) q = q.eq(k, v); });
      if (orderBy) q = q.order(orderBy.column, { ascending: orderBy.ascending ?? false });
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Record<string, unknown>[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      let payload = { ...form };
      if (transformOnSave) payload = transformOnSave(payload);

      // New records are opened with `editing = {}` (so the modal renders) which has
      // no id. This branch used to run for those too, sending
      // `.eq('id', undefined)` → Postgres rejects it with
      // "invalid input syntax for type uuid: undefined". Only update when a real
      // id is present; otherwise insert.
      const id = typeof editing?.id === 'string' && editing.id ? editing.id : null;
      if (id) {
        const { error } = await supabase.from(table).update(payload).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from(table).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      push('success', t('common.savedSuccessfully'));
      setEditing(null);
      void qc.invalidateQueries({ queryKey: [table] });
    },
    onError: (e: Error) => push('error', e.message),
  });

  const runAction = useMutation({
    mutationFn: async ({ fn, args }: { fn: string; args: Record<string, unknown> }) => {
      const { error } = await supabase.rpc(fn, args);
      if (error) throw error;
    },
    onSuccess: () => {
      push('success', t('common.savedSuccessfully'));
      void qc.invalidateQueries({ queryKey: [table] });
    },
    onError: (e: Error) => push('error', humanizeError(e, locale)),
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data ?? [];
    return (data ?? []).filter((r) =>
      searchColumns.some((c) => String(r[c] ?? '').toLowerCase().includes(q)));
  }, [data, search, searchColumns]);

  const visibleFields = fields.filter((f) => !f.hideInTable);

  const renderCell = (f: FieldDef, row: Record<string, unknown>) => {
    if (f.render) return f.render(row);
    const v = row[f.name];
    if (f.type === 'checkbox') return v ? '✓' : '—';
    if (f.type === 'select' && (f.options || f.optionsFrom)) {
      const opts = f.optionsFrom ? (dynamicOptions[f.name] ?? []) : (f.options ?? []);
      return opts.find((o) => o.value === String(v))?.label ?? String(v ?? '—');
    }
    return v === null || v === undefined || v === '' ? '—' : String(v);
  };

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} actions={<>
        {extraActions}
        {canCreate && (
          <Button onClick={() => { setForm(emptyForm); setEditing({}); }}>
            <Plus className="h-4 w-4" /> {t('common.add')}
          </Button>
        )}
      </>} />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          {searchColumns.length > 0 && (
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-slate-400" />
              <Input className="ps-9" placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          )}
          {filters?.map((f) => (
            <Select key={f.column} className="w-44" value={filterValues[f.column] ?? ''}
              onChange={(e) => setFilterValues({ ...filterValues, [f.column]: e.target.value })}>
              <option value="">{f.label}: {t('common.all')}</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          ))}
        </div>
      </Card>

      <div className="table-wrap">
        {isLoading ? <TableSkeleton rows={6} cols={Math.min(visibleFields.length, 6)} /> : !rows.length ? (
          <EmptyState title={t('common.noData')} />
        ) : (
          <table className="table">
            <thead>
              <tr>
                {visibleFields.map((f) => <th key={f.name}>{f.label}</th>)}
                {(canEdit || rowActions.length > 0) && <th className="text-end">{t('common.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row.id)} className={onRowClick ? 'cursor-pointer' : undefined}
                  onClick={() => onRowClick?.(row)}>
                  {visibleFields.map((f) => <td key={f.name}>{renderCell(f, row)}</td>)}
                  {(canEdit || rowActions.length > 0) && (
                    <td className="text-end">
                      {rowActions.filter((a) => !a.visible || a.visible(row)).map((a) => (
                        <Button key={a.key} variant="ghost" size="sm" title={a.label}
                          className={a.tone === 'danger' ? 'text-rose-600 hover:text-rose-700' : undefined}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (a.confirm && !window.confirm(a.confirm)) return;
                            runAction.mutate(a.rpc(row));
                          }}>
                          {a.icon ?? a.label}
                        </Button>
                      ))}
                      {canEdit && (
                      <Button variant="ghost" size="sm" onClick={(e) => {
                        e.stopPropagation();
                        setEditing(row);
                        setForm(fields.reduce<Record<string, unknown>>((acc, f) => {
                          acc[f.name] = row[f.name] ?? f.defaultValue ?? (f.type === 'checkbox' ? false : '');
                          return acc;
                        }, {}));
                      }}>{t('common.edit')}</Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} wide
        title={editing && Object.keys(editing).length ? `${t('common.edit')} — ${title}` : `${t('common.add')} — ${title}`}
        footer={<>
          <Button variant="secondary" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>
        </>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f) => {
            if (f.type === 'select') {
              return (
                <Select key={f.name} label={f.label} required={f.required} value={String(form[f.name] ?? '')}
                  onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}>
                  <option value="">—</option>
                  {(f.optionsFrom ? (dynamicOptions[f.name] ?? []) : (f.options ?? []))
                    .map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              );
            }
            if (f.type === 'checkbox') {
              return (
                <label key={f.name} className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={Boolean(form[f.name])}
                    onChange={(e) => setForm({ ...form, [f.name]: e.target.checked })} />
                  {f.label}
                </label>
              );
            }
            if (f.type === 'textarea') {
              return (
                <div key={f.name} className="sm:col-span-2">
                  <label className="label">{f.label}</label>
                  <textarea className="input min-h-20" value={String(form[f.name] ?? '')}
                    onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} />
                </div>
              );
            }
            return (
              <Input key={f.name} label={f.label} type={f.type ?? 'text'} required={f.required}
                value={String(form[f.name] ?? '')}
                onChange={(e) => setForm({ ...form, [f.name]: f.type === 'number' ? Number(e.target.value) : e.target.value })} />
            );
          })}
        </div>
      </Modal>
      {isRtl && null}
    </div>
  );
}
