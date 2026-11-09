import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatCurrency(value: number | string | null | undefined, locale = 'ar-EG', currency = 'EGP') {
  const n = typeof value === 'string' ? Number(value) : value ?? 0;
  if (Number.isNaN(n)) return '—';
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
}

export function formatNumber(value: number | null | undefined, locale = 'ar-EG') {
  return new Intl.NumberFormat(locale).format(value ?? 0);
}

export function formatDate(value: string | Date | null | undefined, locale = 'ar-EG') {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: '2-digit' }).format(d);
}

export function formatDateTime(value: string | Date | null | undefined, locale = 'ar-EG') {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(d);
}

export function formatTime(value: string | Date | null | undefined, locale = 'ar-EG') {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d);
}

export function ageFromDob(dob: string | null | undefined) {
  if (!dob) return { years: 0, months: 0, label: '—' };
  const birth = new Date(dob);
  const now = new Date();
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  if (now.getDate() < birth.getDate()) months -= 1;
  months = Math.max(0, months);
  return { years: Math.floor(months / 12), months: months % 12, label: `${Math.floor(months / 12)}y ${months % 12}m` };
}

export function minutesToHuman(minutes: number | null | undefined) {
  const m = Math.max(0, Math.round(minutes ?? 0));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest}m`;
  return `${h}h ${rest}m`;
}

export function toISODate(d: Date = new Date()) {
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
}

export function monthStart(d: Date = new Date()) {
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
}

/** Stable idempotency key for financial operations. */
export function newIdempotencyKey(prefix = 'op') {
  const rand = crypto.getRandomValues(new Uint32Array(4)).join('-');
  return `${prefix}-${Date.now()}-${rand}`;
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function printElement(elementId: string, title: string) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return;
  win.document.write(`<!doctype html><html><head><title>${title}</title>
    <style>body{font-family:system-ui,sans-serif;padding:24px;color:#111}
    table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #ddd;padding:8px;text-align:start}
    th{background:#f3f4f6}h1{font-size:20px}</style></head><body>${el.innerHTML}</body></html>`);
  win.document.close();
  win.focus();
  win.print();
}
