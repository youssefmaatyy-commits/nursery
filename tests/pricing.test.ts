import { describe, expect, it } from 'vitest';

/**
 * Mirror of the server-side pricing engine (`public.compute_charge`) so that
 * pricing regressions are caught in CI without a database connection. The
 * authoritative calculation always happens in PostgreSQL; this table-driven
 * test locks the expected business rules.
 */
interface Rule {
  rule_type: 'hourly' | 'half_hour' | 'per_minute' | 'fixed_ticket' | 'day_pass' | 'package';
  price: number;
  base_price?: number;
  unit_minutes: number;
  included_minutes?: number;
  min_charge?: number;
  grace_minutes?: number;
  rounding_minutes?: number;
}

function computeCharge(rule: Rule, minutes: number): { amount: number; billable: number } {
  const grace = rule.grace_minutes ?? 0;
  const minCharge = rule.min_charge ?? 0;
  const included = rule.included_minutes ?? 0;

  if (['fixed_ticket', 'day_pass', 'package'].includes(rule.rule_type)) {
    return { amount: Math.max(rule.base_price ?? 0, minCharge), billable: Math.max(0, minutes) };
  }
  const billable = Math.max(0, minutes - grace);
  const unit = Math.max(1, rule.unit_minutes);
  const { base, extra } = included > 0
    ? {
        base: rule.base_price ?? 0,
        extra: Math.ceil(Math.max(0, billable - included) / unit) * rule.price,
      }
    : { base: 0, extra: Math.ceil(billable / unit) * rule.price };
  return { amount: Math.round(Math.max(minCharge, base + extra) * 100) / 100, billable };
}

const hourly: Rule = { rule_type: 'hourly', price: 60, unit_minutes: 60, min_charge: 30, grace_minutes: 10 };
const halfHour: Rule = { rule_type: 'half_hour', price: 35, unit_minutes: 30, min_charge: 30, grace_minutes: 5 };
const dayPass: Rule = { rule_type: 'day_pass', price: 250, base_price: 250, unit_minutes: 480, min_charge: 250 };

describe('kids area pricing engine', () => {
  it('charges nothing extra within the grace period (respects minimum charge)', () => {
    expect(computeCharge(hourly, 5).amount).toBe(30);
    expect(computeCharge(hourly, 12).amount).toBe(60);
  });

  it('rounds partial hours up to the next whole unit', () => {
    expect(computeCharge(hourly, 95).amount).toBe(120); // 85 billable -> 2 units
    expect(computeCharge(hourly, 70).amount).toBe(60);  // 60 billable -> 1 unit
    expect(computeCharge(hourly, 131).amount).toBe(180); // 121 billable -> 3 units
  });

  it('applies half-hour rates', () => {
    expect(computeCharge(halfHour, 35).amount).toBe(35);  // 30 billable -> 1 unit
    expect(computeCharge(halfHour, 36).amount).toBe(70);  // 31 billable -> 2 units (rounds up)
    expect(computeCharge(halfHour, 40).amount).toBe(70);
    expect(computeCharge(halfHour, 66).amount).toBe(105); // 61 billable -> 3 units
    expect(computeCharge(halfHour, 6).amount).toBe(35);
  });

  it('charges a flat day pass regardless of duration', () => {
    expect(computeCharge(dayPass, 60).amount).toBe(250);
    expect(computeCharge(dayPass, 479).amount).toBe(250);
  });

  it('never returns a negative amount', () => {
    expect(computeCharge(hourly, 0).amount).toBeGreaterThanOrEqual(0);
    expect(computeCharge(hourly, -10).amount).toBeGreaterThanOrEqual(0);
  });

  it('never charges below the configured minimum', () => {
    const strict: Rule = { rule_type: 'hourly', price: 10, unit_minutes: 60, min_charge: 45, grace_minutes: 0 };
    expect(computeCharge(strict, 30).amount).toBe(45);
  });
});
