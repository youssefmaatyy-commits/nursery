import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Heart, Languages, Loader2, Mail, Lock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { setLocale } from '@/i18n';
import { Alert, Button, Input } from '@/components/ui';

export default function Login() {
  const { t, i18n } = useTranslation();
  const { signIn, resetPassword } = useAuth();
  const navigate = useNavigate();
  const isRtl = i18n.language === 'ar';

  const [mode, setMode] = useState<'login' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === 'reset') {
        await resetPassword(email);
        setInfo(t('auth.resetSent'));
      } else {
        await signIn(email, password);
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.loginFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* brand panel */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-800 via-brand-700 to-teal-600 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -end-24 -top-24 h-80 w-80 rounded-full bg-white/10" />
        <div className="absolute -bottom-32 -start-16 h-96 w-96 rounded-full bg-white/5" />
        <div className="relative flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15 backdrop-blur">
            <Heart className="h-6 w-6" />
          </div>
          <div>
            <p className="text-lg font-bold">{isRtl ? 'منطقة الأطفال والحضانة' : 'Kids Area & Nursery'}</p>
            <p className="text-sm text-brand-100">Enterprise Resource Planning</p>
          </div>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-3xl font-bold leading-tight">
            {isRtl ? 'إدارة كاملة للحضانة ومنطقة الأطفال في نظام واحد' : 'Run your nursery and kids area from one system'}
          </h1>
          <p className="mt-4 text-brand-100">
            {isRtl
              ? 'تسجيل الأطفال، الحضور، التسعير بالساعة، الفواتير، الخزينة، المخزون وبوابة أولياء الأمور — كل ذلك بالعربية والإنجليزية.'
              : 'Child registration, attendance, hourly pricing, invoicing, cash register, inventory and a parent portal — fully bilingual.'}
          </p>
          <div className="mt-8 grid grid-cols-3 gap-4 text-center">
            {[
              { k: 'AR/EN', v: isRtl ? 'ثنائي اللغة' : 'Bilingual' },
              { k: 'RLS', v: isRtl ? 'أمان على مستوى الصف' : 'Row-level security' },
              { k: 'PWA', v: isRtl ? 'يعمل دون اتصال' : 'Offline ready' },
            ].map((s) => (
              <div key={s.k} className="rounded-xl bg-white/10 p-3 backdrop-blur">
                <p className="text-sm font-bold">{s.k}</p>
                <p className="mt-1 text-[11px] text-brand-100">{s.v}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-brand-200">© {new Date().getFullYear()} · {isRtl ? 'النسخة ١.٠' : 'v1.0'}</p>
      </div>

      {/* form panel */}
      <div className="flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center justify-between lg:hidden">
            <div className="flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-700 text-white"><Heart className="h-5 w-5" /></div>
              <span className="text-sm font-bold">{isRtl ? 'منطقة الأطفال والحضانة' : 'Kids & Nursery ERP'}</span>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="text-2xl font-bold text-slate-900">
              {mode === 'reset' ? t('auth.resetPassword') : t('auth.welcomeBack')}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{t('auth.loginSubtitle')}</p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {error && <Alert tone="danger">{error}</Alert>}
            {info && <Alert tone="success">{info}</Alert>}

            <div className="relative">
              <Mail className="pointer-events-none absolute start-3 top-9 h-4 w-4 text-slate-400" />
              <Input id="email" label={t('auth.email')} type="email" autoComplete="email" required
                className="ps-9" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@kidsnursery.local" />
            </div>

            {mode === 'login' && (
              <div className="relative">
                <Lock className="pointer-events-none absolute start-3 top-9 h-4 w-4 text-slate-400" />
                <Input id="password" label={t('auth.password')} type="password" autoComplete="current-password" required
                  className="ps-9" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </div>
            )}

            <Button type="submit" className="w-full" loading={busy}>
              {busy ? t('auth.signingIn') : mode === 'reset' ? t('auth.sendResetLink') : t('auth.signIn')}
            </Button>

            <div className="flex items-center justify-between text-sm">
              <button type="button" className="text-brand-700 hover:underline"
                onClick={() => { setMode(mode === 'login' ? 'reset' : 'login'); setError(null); setInfo(null); }}>
                {mode === 'login' ? t('auth.forgotPassword') : t('auth.signIn')}
              </button>
              <button type="button" onClick={() => void setLocale(i18n.language === 'ar' ? 'en' : 'ar')}
                className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800">
                <Languages className="h-4 w-4" /> {i18n.language === 'ar' ? 'English' : 'العربية'}
              </button>
            </div>
          </form>

          <p className="mt-8 rounded-xl bg-white p-3 text-center text-xs leading-relaxed text-slate-500 ring-1 ring-slate-200">
            {isRtl
              ? 'يجب تغيير كلمة المرور الأولى عند تسجيل الدخول لأول مرة.'
              : 'The bootstrap password must be changed on first sign-in.'}
          </p>
        </div>
      </div>
      {busy && <Loader2 className="hidden" />}
    </div>
  );
}
