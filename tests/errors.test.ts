import { describe, expect, it } from 'vitest';
import { humanizeError } from '@/lib/errors';

describe('humanizeError', () => {
  it('translates the raw code that users actually saw in production', () => {
    // This exact string was rendered as the whole page body when a super admin
    // signed in without a branch assignment.
    expect(humanizeError('branch_forbidden', 'ar')).toContain('مش مربوط بفرع');
    expect(humanizeError('branch_forbidden', 'en')).toContain('not linked to a branch');
  });

  it('matches a code embedded in a Postgres error string', () => {
    const raw = 'P0001: forbidden\nCONTEXT: PL/pgSQL function admin_create_staff_account(...)';
    expect(humanizeError(raw, 'en')).toContain('do not have permission');
  });

  it('explains a blocked hard delete using the returned record counts', () => {
    const raw = 'has_history_use_archive: {"invoices": 2, "subscriptions": 1}';
    const en = humanizeError(raw, 'en');
    expect(en).toContain('2 invoices');
    expect(en).toContain('1 subscriptions');
    expect(en).toContain('Archive it instead');
    expect(humanizeError(raw, 'ar')).toContain('الأرشفة');
  });

  it('omits zero counts from the history explanation', () => {
    const raw = 'has_history_use_archive: {"invoices": 1, "daily_reports": 0}';
    const en = humanizeError(raw, 'en');
    expect(en).toContain('1 invoices');
    expect(en).not.toContain('0 daily reports');
  });

  it('keeps the last-super-admin guard readable', () => {
    expect(humanizeError('cannot_remove_last_super_admin', 'en')).toContain('last super admin');
  });

  it('falls back to the original message instead of swallowing it', () => {
    expect(humanizeError('some_unmapped_database_problem', 'en')).toBe('some_unmapped_database_problem');
  });

  it('handles non-Error values without throwing', () => {
    expect(humanizeError(null, 'en')).toContain('unknown error');
    expect(humanizeError(new Error('password_too_short'), 'en')).toContain('12 characters');
  });
});
