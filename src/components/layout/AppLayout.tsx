import { useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, Users, Baby, DoorOpen, Blocks, School, GraduationCap, CalendarCheck,
  ClipboardList, CreditCard, Receipt, Wallet, TrendingDown, Package, Truck, UserCog, Shield,
  Bell, Settings, ScrollText, BarChart3, LogOut, Menu, X, Wifi, WifiOff, Languages,
  RefreshCw, Search, ChevronDown, Heart,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { useOnlineStatus } from '@/hooks/useOnline';
import { setLocale, type Locale } from '@/i18n';
import { Button } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';

interface NavItem { to: string; label: string; icon: React.ReactNode; permission?: string | string[] }
interface NavGroup { id: string; title: string; items: NavItem[] }

export default function AppLayout() {
  const { t, i18n } = useTranslation();
  const { context, signOut, can } = useAuth();
  const { online, pending, failed } = useOnlineStatus();
  const { push } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const isRtl = i18n.language === 'ar';

  const groups: NavGroup[] = useMemo(() => [
    {
      id: 'main', title: 'nav.sections.operations',
      items: [
        { to: '/', label: t('nav.dashboard'), icon: <LayoutDashboard className="h-4.5 w-4.5" /> },
        { to: '/operations', label: t('nav.checkin'), icon: <DoorOpen className="h-4.5 w-4.5" />, permission: ['operations.view', 'operations.checkin'] },
        { to: '/children', label: t('nav.children'), icon: <Baby className="h-4.5 w-4.5" />, permission: 'children.view' },
        { to: '/parents', label: t('nav.parents'), icon: <Users className="h-4.5 w-4.5" />, permission: 'parents.view' },
      ],
    },
    {
      id: 'services', title: 'nav.sections.insights',
      items: [
        { to: '/kids-area', label: t('nav.kidsArea'), icon: <Blocks className="h-4.5 w-4.5" />, permission: ['kids_area.operate', 'operations.view'] },
        { to: '/nursery', label: t('nav.nursery'), icon: <School className="h-4.5 w-4.5" />, permission: ['nursery.view', 'nursery.operate'] },
        { to: '/classrooms', label: t('nav.classrooms'), icon: <GraduationCap className="h-4.5 w-4.5" />, permission: ['nursery.view', 'nursery.manage_classes'] },
        { to: '/daily-reports', label: t('nav.dailyReports'), icon: <ClipboardList className="h-4.5 w-4.5" />, permission: 'nursery.reports' },
        { to: '/subscriptions', label: t('nav.subscriptions'), icon: <CalendarCheck className="h-4.5 w-4.5" />, permission: ['subscriptions.view', 'subscriptions.manage'] },
      ],
    },
    {
      id: 'finance', title: 'nav.sections.finance',
      items: [
        { to: '/pos', label: t('nav.pos'), icon: <CreditCard className="h-4.5 w-4.5" />, permission: 'pos.sell' },
        { to: '/invoices', label: t('nav.invoices'), icon: <Receipt className="h-4.5 w-4.5" />, permission: 'finance.view' },
        { to: '/cash', label: t('nav.cash'), icon: <Wallet className="h-4.5 w-4.5" />, permission: ['cash.view', 'cash.operate'] },
        { to: '/expenses', label: t('nav.expenses'), icon: <TrendingDown className="h-4.5 w-4.5" />, permission: ['expenses.manage', 'finance.view'] },
      ],
    },
    {
      id: 'admin', title: 'nav.sections.admin',
      items: [
        { to: '/inventory', label: t('nav.inventory'), icon: <Package className="h-4.5 w-4.5" />, permission: 'inventory.view' },
        { to: '/suppliers', label: t('nav.suppliers'), icon: <Truck className="h-4.5 w-4.5" />, permission: 'inventory.view' },
        { to: '/employees', label: t('nav.employees'), icon: <UserCog className="h-4.5 w-4.5" />, permission: 'employees.view' },
        { to: '/roles', label: t('nav.roles'), icon: <Shield className="h-4.5 w-4.5" />, permission: 'roles.manage' },
        { to: '/audit', label: t('nav.audit'), icon: <ScrollText className="h-4.5 w-4.5" />, permission: 'audit.view' },
        { to: '/reports', label: t('nav.reports'), icon: <BarChart3 className="h-4.5 w-4.5" />, permission: 'reports.view' },
        { to: '/settings', label: t('nav.settings'), icon: <Settings className="h-4.5 w-4.5" />, permission: 'settings.manage' },
      ],
    },
  ], [t]);

  const displayName = isRtl
    ? context?.profile?.full_name_ar || context?.profile?.full_name_en || context?.profile?.email
    : context?.profile?.full_name_en || context?.profile?.full_name_ar || context?.profile?.email;

  const toggleLocale = async () => {
    const next: Locale = i18n.language === 'ar' ? 'en' : 'ar';
    await setLocale(next);
  };

  const handleSignOut = async () => {
    await signOut();
    push('info', isRtl ? 'تم تسجيل الخروج' : 'Signed out');
    navigate('/login');
  };

  const SidebarContent = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-700 text-white">
          <Heart className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-900">{isRtl ? 'منطقة الأطفال والحضانة' : 'Kids Area & Nursery'}</p>
          <p className="truncate text-xs text-slate-400">ERP v1.0</p>
        </div>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {groups.map((group) => {
          const visible = group.items.filter((i) => !i.permission || can(i.permission));
          if (!visible.length) return null;
          return (
            <div key={group.id}>
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{t(group.title)}</p>
              <div className="space-y-0.5">
                {visible.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) => cn(
                      'flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition',
                      isActive ? 'bg-brand-50 text-brand-800 shadow-sm ring-1 ring-brand-100' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                    )}
                  >
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-slate-100 p-3">
        <div className={cn('flex items-center gap-2 rounded-xl px-3 py-2 text-xs',
          online ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')}>
          {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          <span>{online ? t('common.online') : t('common.offline')}</span>
          {pending > 0 && <span className="ms-auto rounded-full bg-white px-2 py-0.5 font-semibold">{pending}</span>}
          {failed > 0 && <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">{failed}</span>}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-slate-50">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 border-e border-slate-200 bg-white lg:block">
        {SidebarContent}
      </aside>

      {/* mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-72 bg-white shadow-xl">
            <button onClick={() => setMobileOpen(false)} className="absolute end-3 top-3 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
              <X className="h-5 w-5" />
            </button>
            {SidebarContent}
          </aside>
        </div>
      )}

      <div className="lg:ps-64">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <button onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden">
              <Menu className="h-5 w-5" />
            </button>

            <button
              onClick={() => navigate('/operations')}
              className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 transition hover:bg-white sm:flex sm:w-72"
            >
              <Search className="h-4 w-4" />
              <span className="truncate">{t('common.searchPlaceholder')}</span>
            </button>

            <div className="ms-auto flex items-center gap-1.5">
              <Button variant="ghost" size="sm" onClick={toggleLocale} title={t('common.language')}>
                <Languages className="h-4 w-4" />
                <span className="font-semibold">{i18n.language === 'ar' ? 'EN' : 'ع'}</span>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => navigate('/notifications')} title={t('common.notifications')}>
                <Bell className="h-4 w-4" />
              </Button>

              <div className="relative">
                <button
                  onClick={() => setUserMenu((v) => !v)}
                  className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-slate-100"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">
                    {(displayName ?? 'U').slice(0, 2).toUpperCase()}
                  </span>
                  <span className="hidden max-w-32 truncate text-sm font-medium sm:block">{displayName}</span>
                  <ChevronDown className="hidden h-3.5 w-3.5 text-slate-400 sm:block" />
                </button>
                {userMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setUserMenu(false)} />
                    <div className="absolute end-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                      <div className="border-b border-slate-100 px-3 py-2">
                        <p className="truncate text-sm font-medium">{displayName}</p>
                        <p className="truncate text-xs text-slate-400">{context?.profile?.email}</p>
                        <p className="mt-1 truncate text-[11px] text-brand-700">{context?.roles.join(' · ')}</p>
                      </div>
                      <button onClick={() => { setUserMenu(false); navigate('/notifications'); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                        <Bell className="h-4 w-4" /> {t('common.notifications')}
                      </button>
                      <button onClick={() => { setUserMenu(false); navigate('/sync'); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                        <RefreshCw className="h-4 w-4" /> {t('nav.sync')}
                      </button>
                      <button onClick={handleSignOut} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50">
                        <LogOut className="h-4 w-4" /> {t('common.logout')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        <main key={location.pathname} className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
