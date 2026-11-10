import { describe, expect, it } from 'vitest';
import { humanizeError } from '@/lib/errors';

/**
 * Registration moved from three browser-side inserts to one RPC
 * (`create_child_with_guardian`, migration 0016). These cover the payload
 * contract and the error codes that RPC raises, since the browser can no longer
 * observe the intermediate state.
 */
describe('child registration payload', () => {
  const toRpcArgs = (form: {
    parent_mode: 'new' | 'existing';
    parent_id: string;
    parent_name_en: string;
    parent_name_ar: string;
    parent_phone: string;
    parent_relation: string;
    full_name_en: string;
    date_of_birth: string;
  }, branchId: string) => ({
    p_branch: branchId,
    p_parent_id: form.parent_mode === 'existing' ? form.parent_id : null,
    p_new_parent: form.parent_mode === 'new'
      ? { full_name_en: form.parent_name_en, full_name_ar: form.parent_name_ar, phone: form.parent_phone }
      : null,
    p_relation: form.parent_relation,
    p_child: { full_name_en: form.full_name_en, date_of_birth: form.date_of_birth },
  });

  const base = {
    parent_mode: 'new' as const,
    parent_id: '',
    parent_name_en: 'Ahmed', parent_name_ar: 'أحمد', parent_phone: '0100',
    parent_relation: 'father',
    full_name_en: 'Omar', date_of_birth: '2021-01-01',
  };

  it('sends a new parent only when creating one', () => {
    const args = toRpcArgs(base, 'branch-1');
    expect(args.p_new_parent).not.toBeNull();
    expect(args.p_parent_id).toBeNull();
  });

  it('sends a parent id only when reusing one', () => {
    const args = toRpcArgs({ ...base, parent_mode: 'existing', parent_id: 'p-1' }, 'branch-1');
    expect(args.p_parent_id).toBe('p-1');
    expect(args.p_new_parent).toBeNull();
  });

  it('never sends both a new parent and a parent id', () => {
    for (const mode of ['new', 'existing'] as const) {
      const args = toRpcArgs({ ...base, parent_mode: mode, parent_id: 'p-1' }, 'b');
      expect(Boolean(args.p_parent_id) && Boolean(args.p_new_parent)).toBe(false);
    }
  });
});

describe('registration error codes are user-readable', () => {
  it('explains a missing name or date of birth', () => {
    expect(humanizeError('child_name_and_dob_required', 'en')).toContain('name and a date of birth');
    expect(humanizeError('child_name_and_dob_required', 'ar')).toContain('تاريخ الميلاد');
  });

  it('explains a missing guardian', () => {
    expect(humanizeError('guardian_required', 'en')).toContain('existing guardian');
  });

  it('maps the branch and permission guards', () => {
    expect(humanizeError('branch_forbidden', 'en')).toMatch(/not linked to a branch/i);
    expect(humanizeError('forbidden', 'en')).toMatch(/permission/i);
  });
});
