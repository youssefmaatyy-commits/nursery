import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard for a hard requirement of this project: no hardcoded prices or money
 * math in the frontend. Every amount must come from the database (pricing rules,
 * classroom monthly_fee, package price, service price).
 *
 * This is a lint-style test on purpose: a regression here is silent at runtime —
 * a literal in a form default quietly overrides the branch's real price, which is
 * exactly what happened with `fee_amount: '2500'` in Nursery.tsx.
 */

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.tsx') || full.endsWith('.ts') ? [full] : [];
  });
}

/** State defaults that name a money field and assign it a numeric literal. */
const MONEY_FIELD = /\b(fee_amount|unit_price|price|amount|total|subtotal|salary|cost_price|monthly_fee)\s*:\s*['"]?\d[\d.,]*['"]?/g;

describe('no hardcoded money in the frontend', () => {
  const files = walk(SRC);

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('has no money field defaulted to a numeric literal', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const line of text.split('\n')) {
        // Ignore comments — several of them document the rule or the old bug.
        const code = line.replace(/\/\/.*$/, '');
        MONEY_FIELD.lastIndex = 0;
        if (MONEY_FIELD.test(code)) {
          offenders.push(`${file.replace(process.cwd(), '')}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('does not multiply currency client-side to compute a total from literals', () => {
    // Formatting and summing server-provided values is fine; a literal rate is not.
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const line of text.split('\n')) {
        const code = line.replace(/\/\/.*$/, '');
        if (/\b0\.\d+\s*\*\s*\w+/.test(code) || /\b\w+\s*\*\s*0\.\d+/.test(code)) {
          offenders.push(`${file.replace(process.cwd(), '')}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
