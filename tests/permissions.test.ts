import { describe, expect, it } from 'vitest';

/** Mirrors the semantics of public.has_permission() + can_access_branch(). */
interface Ctx {
  user_id: string | null;
  roles: string[];
  permissions: string[];
  is_super_admin: boolean;
  branches: Array<{ id: string }>;
}

function can(ctx: Ctx | null, permission: string | string[]): boolean {
  if (!ctx || !ctx.user_id) return false;
  if (ctx.is_super_admin) return true;
  const list = Array.isArray(permission) ? permission : [permission];
  return list.some((p) => ctx.permissions.includes(p));
}

function canAccessBranch(ctx: Ctx | null, branchId: string | null): boolean {
  if (!ctx || !branchId) return false;
  if (ctx.is_super_admin) return true;
  return ctx.branches.some((b) => b.id === branchId);
}

const receptionist: Ctx = {
  user_id: 'u1', roles: ['receptionist'], is_super_admin: false,
  permissions: ['children.view', 'children.create', 'operations.checkin', 'operations.checkout', 'finance.payment'],
  branches: [{ id: 'b1' }],
};

const parent: Ctx = { user_id: 'u2', roles: ['parent'], is_super_admin: false, permissions: [], branches: [] };
const admin: Ctx = { user_id: 'u3', roles: ['super_admin'], is_super_admin: true, permissions: [], branches: [] };

describe('authorization model', () => {
  it('denies everything when unauthenticated', () => {
    expect(can(null, 'children.view')).toBe(false);
    expect(can({ ...receptionist, user_id: null }, 'children.view')).toBe(false);
  });

  it('grants super admins every permission', () => {
    expect(can(admin, 'anything.at.all')).toBe(true);
    expect(can(admin, ['x', 'y'])).toBe(true);
  });

  it('enforces the permission list for standard roles', () => {
    expect(can(receptionist, 'children.create')).toBe(true);
    expect(can(receptionist, 'finance.refund')).toBe(false);
    expect(can(receptionist, 'roles.manage')).toBe(false);
  });

  it('accepts any-of permission arrays', () => {
    expect(can(receptionist, ['finance.refund', 'operations.checkin'])).toBe(true);
    expect(can(receptionist, ['finance.refund', 'roles.manage'])).toBe(false);
  });

  it('parents hold no staff permissions', () => {
    expect(can(parent, 'children.view')).toBe(false);
    expect(can(parent, 'finance.view')).toBe(false);
  });

  it('scopes access to assigned branches only', () => {
    expect(canAccessBranch(receptionist, 'b1')).toBe(true);
    expect(canAccessBranch(receptionist, 'b2')).toBe(false);
    expect(canAccessBranch(admin, 'b2')).toBe(true);
    expect(canAccessBranch(receptionist, null)).toBe(false);
  });
});
