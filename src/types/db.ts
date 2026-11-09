/**
 * Hand-maintained database types.
 *
 * These mirror the deployed schema (49 tables). They are intentionally kept
 * narrow: only the columns the UI reads or writes, with the nullability that the
 * migrations enforce. If a migration changes a column, update the type in the
 * same commit.
 *
 * A future `supabase gen types typescript` run can replace this file wholesale;
 * nothing here is generated at build time.
 */

export type UUID = string;
/** ISO-8601 timestamp string as returned by PostgREST. */
export type Timestamp = string;
/** `YYYY-MM-DD` — business date, computed in Africa/Cairo. */
export type BusinessDate = string;

export type Language = 'ar' | 'en';
export type Currency = 'EGP';

/* ------------------------------------------------------------------ core --- */

export type BranchCode = string;

export interface Branch {
  id: UUID;
  code: BranchCode;
  name_en: string;
  name_ar: string;
  phone: string | null;
  email: string | null;
  address_en: string | null;
  address_ar: string | null;
  currency: Currency;
  timezone: string;
  tax_rate: number;
  is_active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Profile {
  id: UUID;
  full_name_en: string | null;
  full_name_ar: string | null;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  default_branch_id: UUID | null;
  preferred_language: Language;
  is_active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type RoleCode =
  | 'super_admin'
  | 'branch_manager'
  | 'receptionist'
  | 'cashier'
  | 'nursery_teacher'
  | 'accountant'
  | 'inventory_manager'
  | 'parent'
  | (string & {});

export interface Role {
  id: UUID;
  code: RoleCode;
  name_en: string;
  name_ar: string;
  description_en: string | null;
  description_ar: string | null;
  is_system: boolean;
}

export interface Permission {
  id: UUID;
  code: string;
  module: string;
  name_en: string;
  name_ar: string;
}

export interface UserRole {
  user_id: UUID;
  role_id: UUID;
  branch_id: UUID | null;
}

/** Shape returned by `public.my_context()`. */
export interface AppContext {
  user_id: UUID | null;
  profile: Profile | null;
  roles: RoleCode[];
  permissions: string[];
  branches: Branch[];
  is_super_admin: boolean;
  is_parent: boolean;
  parent_children: Array<{ id: UUID; name_en: string; name_ar: string; code: string }>;
}

export interface SystemSetting {
  key: string;
  value: unknown;
  description: string | null;
  updated_by: UUID | null;
  updated_at: Timestamp;
}

export interface AuditLog {
  id: UUID;
  branch_id: UUID | null;
  actor_id: UUID | null;
  action: string;
  table_name: string;
  record_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: Timestamp;
}

export interface Notification {
  id: UUID;
  branch_id: UUID | null;
  recipient_id: UUID | null;
  title_en: string;
  title_ar: string;
  body_en: string | null;
  body_ar: string | null;
  kind: string;
  is_read: boolean;
  link: string | null;
  created_at: Timestamp;
}

export interface UploadedFile {
  id: UUID;
  branch_id: UUID;
  bucket: string;
  path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: UUID | null;
  created_at: Timestamp;
}

/* ------------------------------------------------------------- children --- */

export type ChildStatus = 'active' | 'inactive' | 'graduated' | 'withdrawn';
export type Gender = 'male' | 'female';

export interface Child {
  id: UUID;
  branch_id: UUID;
  child_code: string;
  full_name_en: string;
  full_name_ar: string;
  date_of_birth: BusinessDate;
  gender: Gender;
  nationality: string | null;
  photo_url: string | null;
  blood_type: string | null;
  allergies: string | null;
  has_medical_condition: boolean;
  medical_notes: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  qr_token: string | null;
  status: ChildStatus;
  notes: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Parent {
  id: UUID;
  branch_id: UUID;
  parent_code: string;
  profile_id: UUID | null;
  full_name_en: string;
  full_name_ar: string;
  relation: string;
  phone: string;
  phone_secondary: string | null;
  email: string | null;
  national_id: string | null;
  address: string | null;
  occupation: string | null;
  is_active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ChildGuardian {
  child_id: UUID;
  parent_id: UUID;
  relationship: string;
  is_primary: boolean;
  has_custody: boolean;
}

export interface AuthorizedPickup {
  id: UUID;
  branch_id: UUID;
  child_id: UUID;
  full_name: string;
  relationship: string;
  phone: string | null;
  national_id: string | null;
  photo_url: string | null;
  is_active: boolean;
}

export interface ChildDocument {
  id: UUID;
  branch_id: UUID;
  child_id: UUID;
  file_id: UUID | null;
  document_type: string;
  title: string;
  expires_at: BusinessDate | null;
  deleted_at: Timestamp | null;
}

export interface MedicalNote {
  id: UUID;
  branch_id: UUID;
  child_id: UUID;
  note: string;
  severity: 'low' | 'medium' | 'high' | null;
  created_by: UUID | null;
  created_at: Timestamp;
}

/** Row shape of `search_children()` / duplicate warnings. */
export interface DuplicateRow {
  id: UUID;
  child_code: string;
  full_name_en: string;
  match_reason?: string;
}

/* ----------------------------------------------------------- operations --- */

export interface Classroom {
  id: UUID;
  branch_id: UUID;
  name_en: string;
  name_ar: string;
  capacity: number;
  age_min_months: number | null;
  age_max_months: number | null;
  is_active: boolean;
}

export interface NurseryEnrollment {
  id: UUID;
  branch_id: UUID;
  child_id: UUID;
  classroom_id: UUID | null;
  plan_name: string | null;
  monthly_fee: number;
  registration_fee: number;
  start_date: BusinessDate;
  end_date: BusinessDate | null;
  status: 'active' | 'paused' | 'ended';
}

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'early_leave' | 'holiday';

export interface NurseryAttendance {
  id: UUID;
  branch_id: UUID;
  child_id: UUID;
  enrollment_id: UUID | null;
  attendance_date: BusinessDate;
  status: AttendanceStatus;
  check_in_at: Timestamp | null;
  check_out_at: Timestamp | null;
  absence_reason: string | null;
  late_minutes: number | null;
}

export type KidsSessionStatus = 'open' | 'closed' | 'cancelled';

export interface KidsAreaSession {
  id: UUID;
  branch_id: UUID;
  child_id: UUID;
  service_id: UUID | null;
  rule_id: UUID | null;
  subscription_id: UUID | null;
  started_at: Timestamp;
  ended_at: Timestamp | null;
  billable_minutes: number | null;
  amount_due: number;
  status: KidsSessionStatus;
  notes: string | null;
}

export type PricingRuleType =
  | 'hourly'
  | 'half_hour'
  | 'per_minute'
  | 'fixed_ticket'
  | 'day_pass'
  | 'package'
  | 'family';

export interface PricingRule {
  id: UUID;
  branch_id: UUID;
  service_id: UUID | null;
  name_en: string;
  name_ar: string;
  rule_type: PricingRuleType;
  price: number;
  unit_minutes: number;
  min_charge: number;
  grace_minutes: number;
  base_price: number | null;
  included_minutes: number | null;
  family_discount_pct: number | null;
  day_of_week: number | null;
  valid_from: BusinessDate | null;
  valid_to: BusinessDate | null;
  is_active: boolean;
}

/** Result of `quote_kids_area()`. */
export interface PricingQuote {
  amount: number;
  billable_minutes: number;
  rule_id?: UUID | null;
  rule_type?: PricingRuleType;
}

export interface DailyChildReport {
  id: UUID;
  branch_id: UUID;
  child_id: UUID;
  report_date: BusinessDate;
  meals: string | null;
  nap_minutes: number | null;
  mood: string | null;
  toilet: string | null;
  activities: string | null;
  notes: string | null;
  created_by: UUID | null;
}

/* ------------------------------------------------------------ financial --- */

export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'void';
export type InvoiceType = 'kids_area' | 'nursery' | 'pos' | 'subscription' | 'other';
export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'wallet';

export interface Invoice {
  id: UUID;
  branch_id: UUID;
  invoice_number: string;
  type: InvoiceType;
  child_id: UUID | null;
  parent_id: UUID | null;
  subtotal: number;
  discount_amount: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  paid_amount: number;
  balance_due: number;
  status: InvoiceStatus;
  idempotency_key: string | null;
  issued_at: Timestamp;
  notes: string | null;
  created_at: Timestamp;
}

export interface InvoiceItem {
  id: UUID;
  invoice_id: UUID;
  item_type: string;
  description_en: string | null;
  description_ar: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface Payment {
  id: UUID;
  branch_id: UUID;
  invoice_id: UUID;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  received_by: UUID | null;
  idempotency_key: string | null;
  paid_at: Timestamp;
}

export interface Refund {
  id: UUID;
  branch_id: UUID;
  payment_id: UUID;
  invoice_id: UUID | null;
  amount: number;
  reason: string;
  refunded_by: UUID | null;
  refunded_at: Timestamp;
}

export interface CashRegister {
  id: UUID;
  branch_id: UUID;
  code: string;
  name_en: string;
  name_ar: string;
  is_active: boolean;
}

export interface CashShift {
  id: UUID;
  branch_id: UUID;
  register_id: UUID;
  opened_by: UUID | null;
  closed_by: UUID | null;
  opening_float: number;
  expected_cash: number | null;
  counted_cash: number | null;
  variance: number | null;
  status: 'open' | 'closed';
  opened_at: Timestamp;
  closed_at: Timestamp | null;
}

export interface CashMovement {
  id: UUID;
  branch_id: UUID;
  shift_id: UUID;
  direction: 'in' | 'out';
  amount: number;
  reason: string;
  created_by: UUID | null;
  created_at: Timestamp;
}

export interface ExpenseCategory {
  id: UUID;
  code: string;
  name_en: string;
  name_ar: string;
}

export interface Expense {
  id: UUID;
  branch_id: UUID;
  expense_number: string;
  category_id: UUID | null;
  supplier_id: UUID | null;
  amount: number;
  expense_date: BusinessDate;
  payment_method: PaymentMethod;
  description: string | null;
  receipt_url: string | null;
  created_by: UUID | null;
  created_at: Timestamp;
}

/* ------------------------------------------------------------ inventory --- */

export interface Product {
  id: UUID;
  branch_id: UUID;
  sku: string;
  name_en: string;
  name_ar: string;
  category_id: UUID | null;
  unit_price: number;
  cost_price: number;
  stock_quantity: number;
  reorder_level: number;
  is_active: boolean;
}

export interface Supplier {
  id: UUID;
  branch_id: UUID;
  name_en: string;
  name_ar: string;
  phone: string | null;
  email: string | null;
  contact_name: string | null;
  is_active: boolean;
}

/* -------------------------------------------------------- subscriptions --- */

export interface PackagePlan {
  id: UUID;
  branch_id: UUID;
  code: string;
  name_en: string;
  name_ar: string;
  included_minutes: number | null;
  included_sessions: number | null;
  price: number;
  validity_days: number;
  is_active: boolean;
}

export type SubscriptionStatus = 'active' | 'suspended' | 'cancelled' | 'expired' | 'completed';

export interface Subscription {
  id: UUID;
  branch_id: UUID;
  child_id: UUID;
  package_id: UUID;
  subscription_code: string;
  total_minutes: number | null;
  minutes_used: number;
  total_sessions: number | null;
  sessions_used: number;
  price_paid: number;
  starts_on: BusinessDate;
  expires_on: BusinessDate;
  status: SubscriptionStatus;
}

export interface SubscriptionUsage {
  id: UUID;
  subscription_id: UUID;
  session_id: UUID | null;
  minutes_used: number;
  used_at: Timestamp;
}

/* -------------------------------------------------------------------- hr --- */

export interface Employee {
  id: UUID;
  branch_id: UUID;
  employee_code: string;
  full_name_en: string;
  full_name_ar: string;
  job_title: string | null;
  phone: string | null;
  email: string | null;
  hire_date: BusinessDate | null;
  salary: number | null;
  is_active: boolean;
}

/* ------------------------------------------------------------------ sync --- */

export interface SyncOperation {
  id: UUID;
  branch_id: UUID;
  user_id: UUID | null;
  operation: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  status: 'pending' | 'applied' | 'failed';
  error_message: string | null;
  created_at: Timestamp;
  applied_at: Timestamp | null;
}

/* -------------------------------------------------------------- reports --- */

export interface DashboardMetrics {
  revenue_today: number;
  revenue_month: number;
  children_inside: number;
  open_sessions: number;
  outstanding_total: number;
  absences_today: number;
  active_subscriptions: number;
  low_stock_count: number;
  revenue_trend: Array<{ day: string; amount: number }>;
}

export interface ProfitAndLoss {
  gross_revenue: number;
  refunds: number;
  net_revenue: number;
  expenses: number;
  expenses_by_category: Record<string, number>;
  profit: number;
}

export interface ReportFilters {
  branch_id?: UUID;
  from?: BusinessDate;
  to?: BusinessDate;
  group_by?: 'day' | 'week' | 'month' | 'method' | 'service';
}
