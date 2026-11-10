import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import AppLayout from '@/components/layout/AppLayout';
import Login from '@/pages/Login';
import { Card, TableSkeleton } from '@/components/ui';

const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Children = lazy(() => import('@/pages/Children'));
const ChildDetail = lazy(() => import('@/pages/ChildDetail'));
const Parents = lazy(() => import('@/pages/Parents'));
const Operations = lazy(() => import('@/pages/Operations'));
const KidsArea = lazy(() => import('@/pages/KidsArea'));
const Nursery = lazy(() => import('@/pages/Nursery'));
const Classrooms = lazy(() => import('@/pages/Classrooms'));
const DailyReports = lazy(() => import('@/pages/DailyReports'));
const Subscriptions = lazy(() => import('@/pages/Subscriptions'));
const POS = lazy(() => import('@/pages/POS'));
const Invoices = lazy(() => import('@/pages/Invoices'));
const CashRegister = lazy(() => import('@/pages/CashRegister'));
const Expenses = lazy(() => import('@/pages/Expenses'));
const Inventory = lazy(() => import('@/pages/Inventory'));
const Suppliers = lazy(() => import('@/pages/Suppliers'));
const Employees = lazy(() => import('@/pages/Employees'));
const Roles = lazy(() => import('@/pages/Roles'));
const Settings = lazy(() => import('@/pages/Settings'));
const AuditLog = lazy(() => import('@/pages/AuditLog'));
const Reports = lazy(() => import('@/pages/Reports'));
const Notifications = lazy(() => import('@/pages/Notifications'));
const Sync = lazy(() => import('@/pages/Sync'));
const ParentPortal = lazy(() => import('@/pages/ParentPortal'));
const ResetPassword = lazy(() => import('@/pages/ResetPassword'));
const Setup = lazy(() => import('@/pages/Setup'));
const Staff = lazy(() => import('@/pages/Staff'));
const ChangePassword = lazy(() => import('@/pages/ChangePassword'));

function Loading() {
  return <Card><TableSkeleton rows={6} cols={4} /></Card>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading, context } = useAuth();
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-700" />
          <p className="text-sm text-slate-500">{t('common.loading')}</p>
        </div>
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;

  // A brand-new staff account must replace the temporary password before it can
  // do anything. Previously this was only a sentence on the login screen.
  if (context?.profile?.must_change_password) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <ChangePassword forced />
      </div>
    );
  }

  // An account with no branch cannot pass can_access_branch(), so every RPC would
  // fail with a bare 'branch_forbidden'. Explain it instead of showing that.
  if (context && context.branches.length === 0 && !context.is_parent) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-50 p-4">
        <div className="max-w-lg">
          <Card className="p-6 text-center">
            <p className="mb-2 text-lg font-semibold text-slate-900">
              {isRtl ? 'حسابك مش مربوط بفرع' : 'Your account has no branch'}
            </p>
            <p className="text-sm leading-relaxed text-slate-500">
              {isRtl
                ? 'الحساب اتعمل لكن لسه مفيش له فرع أو دور، فالنظام بيمنع كل العمليات. كلّم مدير النظام يربط حسابك بفرع ويديك دور.'
                : 'The account exists but has no branch or role assigned, so every operation is blocked. Ask an administrator to assign a branch and a role.'}
            </p>
          </Card>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="/children" element={<Children />} />
          <Route path="/children/:id" element={<ChildDetail />} />
          <Route path="/parents" element={<Parents />} />
          <Route path="/operations" element={<Operations />} />
          <Route path="/kids-area" element={<KidsArea />} />
          <Route path="/nursery" element={<Nursery />} />
          <Route path="/classrooms" element={<Classrooms />} />
          <Route path="/daily-reports" element={<DailyReports />} />
          <Route path="/subscriptions" element={<Subscriptions />} />
          <Route path="/pos" element={<POS />} />
          <Route path="/invoices" element={<Invoices />} />
          <Route path="/cash" element={<CashRegister />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/suppliers" element={<Suppliers />} />
          <Route path="/employees" element={<Employees />} />
          <Route path="/staff" element={<Staff />} />
          <Route path="/change-password" element={<ChangePassword />} />
          <Route path="/roles" element={<Roles />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/audit" element={<AuditLog />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/sync" element={<Sync />} />
          <Route path="/portal" element={<ParentPortal />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
