import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { humanizeError } from '@/lib/errors';
import { Alert, Button, Card, CardHeader, Input, PageHeader } from '@/components/ui';

/**
 * Forced first-login password change.
 *
 * `profiles.must_change_password` is set for every account an administrator
 * creates. `RequireAuth` renders this screen instead of the app while the flag is
 * true, so a temporary password handed over by a manager cannot be kept in use.
 * The check is also real on the database side: `change_own_password()` is the only
 * path and it clears the flag itself.
 */
export default function ChangePassword({ forced = false }: { forced?: boolean }) {
  const { t, i18n } = useTranslation();
  const { refresh, signOut } = useAuth();
  const { push } = useToast();
  const isRtl = i18n.language === 'ar';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(isRtl ? 'كلمتا المرور غير متطابقتين.' : 'The two passwords do not match.');
      return;
    }
    if (password.length < 12) {
      setError(isRtl ? 'كلمة المرور لازم 12 حرف على الأقل.' : 'Password must be at least 12 characters.');
      return;
    }
    setBusy(true);
    // The RPC updates auth.users and clears must_change_password atomically; the
    // browser never needs the service-role key for this.
    const { error: rpcError } = await supabase.rpc('change_own_password', { p_password: password });
    setBusy(false);
    if (rpcError) {
      setError(humanizeError(rpcError, isRtl ? 'ar' : 'en'));
      return;
    }
    push('success', isRtl ? 'تم تغيير كلمة المرور.' : 'Password changed.');
    setPassword('');
    setConfirm('');
    await refresh();
  };

  return (
    <div className="mx-auto max-w-lg p-4">
      <PageHeader
        title={forced
          ? (isRtl ? 'لازم تغيّر كلمة المرور' : 'Change your password')
          : (isRtl ? 'كلمة المرور' : 'Password')}
        subtitle={isRtl
          ? 'كلمة المرور المؤقتة اللي استلمتها من المدير لازم تتغير قبل الاستخدام.'
          : 'The temporary password you were given must be replaced before you continue.'}
      />

      {forced && (
        <div className="mb-4"><Alert tone="warning">
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            {isRtl
              ? 'الحساب ده جديد، والوصول بيفضل مقفول لحد ما تغيّر كلمة المرور.'
              : 'This is a new account — access stays blocked until the password is changed.'}
          </span>
        </Alert></div>
      )}

      <Card>
        <CardHeader title={isRtl ? 'كلمة مرور جديدة' : 'New password'} />
        <form onSubmit={submit} className="space-y-3">
          <Input label={isRtl ? 'كلمة المرور' : 'Password'} type="password" required
            value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <Input label={isRtl ? 'تأكيد كلمة المرور' : 'Confirm password'} type="password" required
            value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          <p className="text-xs text-slate-500">
            {isRtl
              ? '12 حرف على الأقل. استخدم حروف وأرقام ورموز.'
              : 'At least 12 characters. Mix letters, digits and symbols.'}
          </p>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>
              <KeyRound className="h-4 w-4" /> {t('common.save')}
            </Button>
            {forced && (
              <Button type="button" variant="secondary" onClick={() => void signOut()}>
                {isRtl ? 'خروج' : 'Sign out'}
              </Button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
}
