/**
 * Offline mode
 * ------------
 * Every mutating operation is written to IndexedDB first (a durable queue) and
 * then flushed to Supabase. Each queued operation carries a client-generated
 * `client_op_id` which the database treats as an idempotency key, so a retry
 * after a network blip can never double-charge.
 */
import Dexie, { type Table } from 'dexie';
import { supabase } from './supabase';

export type QueuedOpType = 'check_in' | 'check_out' | 'payment';

export interface QueuedOp {
  id?: number;
  client_op_id: string;
  operation_type: QueuedOpType;
  payload: Record<string, unknown>;
  created_at: number;
  attempts: number;
  status: 'pending' | 'applied' | 'failed';
  last_error?: string;
  result?: unknown;
}

export interface CachedRecord {
  key: string;
  data: unknown;
  updated_at: number;
}

class ErpDatabase extends Dexie {
  queue!: Table<QueuedOp, number>;
  cache!: Table<CachedRecord, string>;

  constructor() {
    super('kids-nursery-erp');
    this.version(1).stores({
      queue: '++id, client_op_id, status, operation_type, created_at',
      cache: 'key, updated_at',
    });
  }
}

export const db = new ErpDatabase();

export function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export function newClientOpId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const suffix = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${Date.now().toString(36)}-${suffix}`;
}

/** Persist an operation for later (or immediate) synchronisation. */
export async function enqueueOperation(type: QueuedOpType, payload: Record<string, unknown>) {
  const op: QueuedOp = {
    client_op_id: newClientOpId(),
    operation_type: type,
    payload,
    created_at: Date.now(),
    attempts: 0,
    status: 'pending',
  };
  const id = await db.queue.add(op);
  return { ...op, id };
}

export async function pendingCount() {
  return db.queue.where('status').equals('pending').count();
}

export async function failedCount() {
  return db.queue.where('status').equals('failed').count();
}

export interface SyncReport {
  attempted: number;
  applied: number;
  failed: number;
  errors: string[];
}

/** Flush the queue. Safe to call repeatedly; operations are idempotent. */
export async function synchronize(): Promise<SyncReport> {
  const report: SyncReport = { attempted: 0, applied: 0, failed: 0, errors: [] };
  if (!isOnline()) return report;

  const pending = await db.queue.where('status').equals('pending').sortBy('created_at');
  for (const op of pending) {
    report.attempted += 1;
    try {
      const { data, error } = await supabase.rpc('apply_sync_operation', {
        p_client_op_id: op.client_op_id,
        p_operation_type: op.operation_type,
        p_payload: op.payload,
      });
      if (error) throw new Error(error.message);

      const status = (data as { status?: string })?.status;
      if (status === 'failed') throw new Error((data as { error?: string })?.error ?? 'operation_failed');

      await db.queue.update(op.id!, { status: 'applied', result: data, last_error: undefined });
      report.applied += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = op.attempts + 1;
      const permanent = /forbidden|not_found|invalid|already|exceeds|insufficient/i.test(message);
      await db.queue.update(op.id!, {
        attempts,
        last_error: message,
        status: permanent || attempts >= 5 ? 'failed' : 'pending',
      });
      report.failed += 1;
      report.errors.push(message);
    }
  }
  return report;
}

export async function retryFailed() {
  const failed = await db.queue.where('status').equals('failed').toArray();
  await Promise.all(failed.map((op) => db.queue.update(op.id!, { status: 'pending', attempts: 0 })));
  return failed.length;
}

export async function cacheSet(key: string, data: unknown) {
  await db.cache.put({ key, data, updated_at: Date.now() });
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const row = await db.cache.get(key);
  return (row?.data as T) ?? null;
}

export async function clearSyncedQueue() {
  const applied = await db.queue.where('status').equals('applied').toArray();
  await Promise.all(applied.map((op) => db.queue.delete(op.id!)));
}
