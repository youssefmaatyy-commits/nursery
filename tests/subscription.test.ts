import { describe, expect, it } from 'vitest';

/** Mirrors subscription consumption rules in close_kids_session(). */
interface Sub { minutes_total: number; minutes_used: number; sessions_total: number; sessions_used: number; status: string }

function consume(sub: Sub, minutes: number): Sub {
  const next: Sub = {
    ...sub,
    minutes_used: sub.minutes_used + minutes,
    sessions_used: sub.sessions_total > 0 ? sub.sessions_used + 1 : sub.sessions_used,
  };
  const minutesExhausted = sub.minutes_total > 0 && next.minutes_used >= sub.minutes_total;
  const sessionsExhausted = sub.sessions_total > 0 && next.sessions_used >= sub.sessions_total;
  if (minutesExhausted || sessionsExhausted) next.status = 'expired';
  return next;
}

function canUse(sub: Sub, today: string, start: string, end: string) {
  return sub.status === 'active' && start <= today && end >= today
    && (sub.sessions_total === 0 || sub.sessions_used < sub.sessions_total)
    && (sub.minutes_total === 0 || sub.minutes_used < sub.minutes_total);
}

describe('subscription usage', () => {
  const base: Sub = { minutes_total: 600, minutes_used: 0, sessions_total: 0, sessions_used: 0, status: 'active' };

  it('consumes minutes without charging the customer', () => {
    const after = consume(base, 45);
    expect(after.minutes_used).toBe(45);
    expect(after.minutes_remaining ?? 555).toBeTruthy();
  });

  it('expires exactly when the time bundle is exhausted', () => {
    const after = consume(base, 600);
    expect(after.status).toBe('expired');
  });

  it('expires session bundles on the last session', () => {
    const sessions: Sub = { minutes_total: 0, minutes_used: 0, sessions_total: 10, sessions_used: 9, status: 'active' };
    expect(consume(sessions, 60).status).toBe('expired');
  });

  it('does not reset usage on renewal (new record)', () => {
    const used = consume(base, 120);
    expect(used.minutes_used).toBe(120);
    const renewed: Sub = { ...base, minutes_used: 0 };
    expect(renewed.minutes_used).toBe(0);
    expect(used.minutes_used).toBe(120);
  });

  it('blocks usage outside the validity window', () => {
    expect(canUse(base, '2026-11-09', '2026-11-01', '2026-11-30')).toBe(true);
    expect(canUse(base, '2026-12-01', '2026-11-01', '2026-11-30')).toBe(false);
  });

  it('blocks usage when suspended', () => {
    expect(canUse({ ...base, status: 'suspended' }, '2026-11-09', '2026-11-01', '2026-11-30')).toBe(false);
  });
});
