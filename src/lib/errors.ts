/**
 * Turns database error codes into sentences a receptionist can act on.
 *
 * The RPCs in migrations 0014/0015 raise stable machine codes (`forbidden`,
 * `child_needs_at_least_one_guardian`, …). Without this map those raw codes
 * surface in a toast — which is what produced the bare `branch_forbidden`
 * screen users saw. Anything unmapped falls back to the original message so no
 * information is silently swallowed.
 */

export type Locale = 'ar' | 'en';

const MESSAGES: Record<string, { ar: string; en: string }> = {
  // authorisation
  forbidden: {
    ar: 'مالكش صلاحية لعملية زي دي. كلّم مدير النظام.',
    en: 'You do not have permission for this action. Ask an administrator.',
  },
  branch_forbidden: {
    ar: 'الحساب مش مربوط بفرع، أو الفرع مش ضمن صلاحياتك. كلّم المدير يربط حسابك بفرع.',
    en: 'This account is not linked to a branch. Ask an administrator to assign one.',
  },
  only_a_super_admin_can_grant_super_admin: {
    ar: 'بس مدير النظام يقدر يمنح صلاحية مدير نظام.',
    en: 'Only a super admin can grant the super admin role.',
  },
  cannot_grant_admin_to_self: {
    ar: 'مش مسموح تمنح نفسك صلاحية مدير نظام.',
    en: 'You cannot grant yourself the super admin role.',
  },
  cannot_remove_own_role: {
    ar: 'مش مسموح تشيل دورك إنت.',
    en: 'You cannot remove your own role.',
  },
  cannot_remove_last_super_admin: {
    ar: 'ده آخر مدير نظام — مش ممكن تشيله وإلا النظام هيقفل.',
    en: 'This is the last super admin. Removing it would lock everyone out.',
  },
  cannot_deactivate_self: {
    ar: 'مش مسموح توقف حسابك إنت.',
    en: 'You cannot deactivate your own account.',
  },
  super_admin_has_all_permissions: {
    ar: 'مدير النظام عنده كل الصلاحيات، مش محتاج تعديل.',
    en: 'Super admin already holds every permission.',
  },
  use_change_password_instead: {
    ar: 'لتغيير باسوردك استخدم شاشة تغيير كلمة المرور.',
    en: 'Use the change-password screen to change your own password.',
  },

  // validation
  password_too_short: {
    ar: 'كلمة المرور لازم 12 حرف على الأقل.',
    en: 'Password must be at least 12 characters.',
  },
  invalid_email: { ar: 'البريد الإلكتروني غير صحيح.', en: 'That email address is not valid.' },
  email_already_registered: {
    ar: 'البريد ده مسجل بالفعل. عدّل الحساب الموجود بدل ما تعمل واحد جديد.',
    en: 'That email is already registered. Edit the existing account instead.',
  },
  unknown_role: { ar: 'الدور غير موجود.', en: 'That role does not exist.' },
  unknown_permission: { ar: 'الصلاحية غير موجودة.', en: 'That permission does not exist.' },
  invalid_relation: { ar: 'صلة القرابة غير صحيحة.', en: 'That relationship type is not valid.' },

  // records
  child_not_found: { ar: 'الطفل مش موجود.', en: 'Child not found.' },
  parent_not_found: { ar: 'ولي الأمر مش موجود.', en: 'Parent not found.' },
  user_not_found: { ar: 'الحساب مش موجود.', en: 'User account not found.' },
  profile_not_found: { ar: 'ملف المستخدم مش موجود.', en: 'Profile not found.' },
  guardian_link_not_found: { ar: 'الربط مش موجود.', en: 'That guardian link no longer exists.' },
  branch_required: { ar: 'لازم تحدد فرع.', en: 'A branch is required.' },

  // business rules
  child_needs_at_least_one_guardian: {
    ar: 'الطفل لازم يكون له ولي أمر واحد على الأقل.',
    en: 'A child must keep at least one guardian.',
  },
  parent_has_children_unlink_first: {
    ar: 'ولي الأمر مربوط بأطفال. افصل الربط الأول أو استخدم التعطيل بدل الحذف.',
    en: 'This parent is still linked to children. Unlink them first, or deactivate instead.',
  },
  parent_has_invoices_use_archive: {
    ar: 'عليه فواتير — للحفاظ على الحسابات الحذف ممنوع. استخدم التعطيل.',
    en: 'This parent has invoices. Deleting would break the books — deactivate instead.',
  },
  not_authenticated: { ar: 'لازم تسجل دخول تاني.', en: 'You need to sign in again.' },

  // registration (0016)
  child_name_and_dob_required: {
    ar: 'اسم الطفل وتاريخ الميلاد مطلوبين.',
    en: 'The child needs a name and a date of birth.',
  },
  parent_name_and_phone_required: {
    ar: 'اسم ولي الأمر ورقم الهاتف مطلوبين.',
    en: 'The guardian needs a name and a phone number.',
  },
  fee_required: {
    ar: 'اختار الفصل الأول — المصاريف الشهرية بتيجي منه.',
    en: 'Pick a classroom first — the monthly fee comes from it.',
  },
  child_required: {
    ar: 'اختار الطفل.',
    en: 'Select a child.',
  },
  supplier_required: {
    ar: 'اختار المورد.',
    en: 'Select a supplier.',
  },
  file_required: {
    ar: 'اختار ملف ترفعه.',
    en: 'Choose a file to upload.',
  },
  description_required: {
    ar: 'الوصف مطلوب.',
    en: 'A description is required.',
  },
  no_items: {
    ar: 'أضف صنف واحد على الأقل.',
    en: 'Add at least one line item.',
  },
  guardian_required: {
    ar: 'لازم تختار ولي أمر أو تنشئ واحد جديد.',
    en: 'Pick an existing guardian or create a new one.',
  },
};

/** Map of history counts returned by `has_history_use_archive: {...}`. */
const HISTORY_LABELS: Record<string, { ar: string; en: string }> = {
  invoices: { ar: 'فواتير', en: 'invoices' },
  subscriptions: { ar: 'اشتراكات', en: 'subscriptions' },
  kids_area_sessions: { ar: 'جلسات منطقة أطفال', en: 'kids area sessions' },
  nursery_attendance: { ar: 'حضور حضانة', en: 'nursery attendance' },
  nursery_enrollments: { ar: 'تسجيلات حضانة', en: 'nursery enrolments' },
  daily_reports: { ar: 'تقارير يومية', en: 'daily reports' },
};

function describeHistory(json: string, locale: Locale): string {
  try {
    const parsed = JSON.parse(json) as Record<string, number>;
    const parts = Object.entries(parsed)
      .filter(([, n]) => n > 0)
      .map(([key, n]) => `${n} ${HISTORY_LABELS[key]?.[locale] ?? key}`);
    return parts.join(' · ');
  } catch {
    return json;
  }
}

/** Translate an error thrown by supabase-js (or any Error) for display. */
export function humanizeError(error: unknown, locale: Locale = 'ar'): string {
  const raw =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : ((error as { message?: string } | null)?.message ?? '');

  if (!raw) return locale === 'ar' ? 'حصل خطأ غير معروف.' : 'An unknown error occurred.';

  // "has_history_use_archive: {...}" carries the blocking record counts.
  const history = raw.match(/has_history_use_archive:\s*(\{.*\})/);
  if (history) {
    const detail = describeHistory(history[1]!, locale);
    return locale === 'ar'
      ? `فيه بيانات مرتبطة (${detail}) — الحذف النهائي ممنوع. استخدم الأرشفة.`
      : `This record has history (${detail}) — deleting is blocked. Archive it instead.`;
  }

  // Longest code wins: "branch_forbidden" must not be shadowed by "forbidden",
  // which is an exact substring of it. This ordering bug is what a test caught.
  const matches = Object.keys(MESSAGES)
    .filter((code) => raw.includes(code))
    .sort((a, b) => b.length - a.length);
  if (matches.length) return MESSAGES[matches[0]!]![locale];

  return raw;
}
