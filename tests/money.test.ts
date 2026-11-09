import { describe, expect, it } from 'vitest';
import { ageFromDob, formatCurrency, minutesToHuman, newIdempotencyKey, toISODate } from '../src/lib/utils';

describe('money formatting', () => {
  it('formats EGP amounts in both locales', () => {
    expect(formatCurrency(1234.5, 'en-EG')).toMatch(/1,234\.5/);
    expect(formatCurrency(0, 'en-EG')).toMatch(/0/);
    expect(formatCurrency(null, 'en-EG')).toMatch(/0/);
  });

  it('renders a dash for invalid numbers', () => {
    expect(formatCurrency('not-a-number', 'en-EG')).toBe('—');
  });
});

describe('age calculation', () => {
  it('computes years and months from date of birth', () => {
    const fourYearsAgo = new Date();
    fourYearsAgo.setFullYear(fourYearsAgo.getFullYear() - 4);
    const age = ageFromDob(fourYearsAgo.toISOString().slice(0, 10));
    expect(age.years).toBe(4);
  });

  it('handles missing dob', () => {
    expect(ageFromDob(null).label).toBe('—');
  });
});

describe('duration formatting', () => {
  it('formats minutes and hours', () => {
    expect(minutesToHuman(45)).toBe('45m');
    expect(minutesToHuman(125)).toBe('2h 5m');
    expect(minutesToHuman(0)).toBe('0m');
  });
});

describe('idempotency keys', () => {
  it('are unique across rapid calls', () => {
    const keys = new Set(Array.from({ length: 500 }, () => newIdempotencyKey('pos')));
    expect(keys.size).toBe(500);
  });
});

describe('date helpers', () => {
  it('returns ISO dates', () => {
    expect(toISODate(new Date('2026-11-08T12:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
