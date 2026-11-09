import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { Alert, Button, Input } from '@/components/ui';
import { supabase } from '@/lib/supabase';

export default function ResetPassword() {
  const { t } = useTranslation();
  const { updatePassword } = useAuth();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setReady(Boolean(data.session)));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 12) { setError(t('auth.passwordTooShort')); return; }
    if (password !== confirm) { setError(t('common.error')); return; }
    setBusy(true);
    try {
      await updatePassword(password);
      setDone(true);
      setTimeout(() => navigate('/', { replace: true }), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-6">
      <form onSubmit={submit} className="card card-pad w-full max-w-sm space-y-4">
        <h1 className="text-xl font-bold">{t('auth.resetPassword')}</h1>
        {!ready && <Alert tone="warning">{t('auth.sessionExpired')}</Alert>}
        {done && <Alert tone="success">{t('common.savedSuccessfully')}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        <Input label={t('auth.newPassword')} type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Input label={t('auth.newPassword')} type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <Button type="submit" className="w-full" loading={busy} disabled={!ready}>{t('auth.updatePassword')}</Button>
      </form>
    </div>
  );
}
