import { describe, expect, it } from 'vitest';
import ar from '../src/i18n/ar';
import en from '../src/i18n/en';

type Dict = Record<string, unknown>;

function flatten(obj: Dict, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === 'object' ? flatten(v as Dict, key) : [key];
  });
}

describe('bilingual dictionaries', () => {
  it('Arabic and English expose the exact same key set', () => {
    const arKeys = new Set(flatten(ar as Dict));
    const enKeys = new Set(flatten(en as Dict));
    const missingInEn = [...arKeys].filter((k) => !enKeys.has(k));
    const missingInAr = [...enKeys].filter((k) => !arKeys.has(k));
    expect(missingInEn, `missing in EN: ${missingInEn.join(', ')}`).toEqual([]);
    expect(missingInAr, `missing in AR: ${missingInAr.join(', ')}`).toEqual([]);
  });

  it('no English dictionary value is an empty string', () => {
    const walk = (obj: Dict): string[] =>
      Object.values(obj).flatMap((v) => (typeof v === 'object' && v ? walk(v as Dict) : [String(v)]));
    expect(walk(en as Dict).every((v) => v.trim().length > 0)).toBe(true);
  });

  it('Arabic UI strings actually contain Arabic characters', () => {
    const arabic = /[\u0600-\u06FF]/;
    expect(arabic.test((ar as Dict & { common: { save: string } }).common.save)).toBe(true);
    expect(arabic.test((ar as Dict & { children: { title: string } }).children.title)).toBe(true);
  });
});
