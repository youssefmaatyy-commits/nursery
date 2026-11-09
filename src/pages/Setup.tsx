import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Database, KeyRound, Loader2, ShieldCheck, Trash2, CheckCircle2 } from 'lucide-react';
import { Alert, Button, Input } from '@/components/ui';
import {
  assertNotServiceKey,
  clearRuntimeConfig,
  configSource,
  isSupabaseConfigured,
  saveRuntimeConfig,
  testConnection,
} from '@/lib/supabase';

/**
 * Runtime connection setup.
 *
 * Exists so a deployment built without build-time secrets can still be wired to
 * a database by an administrator, in that browser only — no rebuild, no secret in
 * the repository. It deliberately accepts only the publishable/anon key: the
 * service-role key is refused because it would bypass Row Level Security.
 */
export default function Setup() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isRtl = i18n.language === 'ar';

  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const sourceLabel =
    configSource === 'build'
      ? t('auth.sourceBuild')
      : configSource === 'runtime'
        ? t('auth.sourceRuntime')
        : '—';

  const handleTest = async () => {
    setError(null);
    setInfo(null);
    try {
      assertNotServiceKey(key.trim());
    } catch {
      setError(t('auth.serviceKeyRefused'));
      return;
    }
    setBusy(true);
    const result = await testConnection(url, key);
    setBusy(false);
    if (result.ok) setInfo(t('auth.connectionOk'));
    else setError(result.message ?? t('auth.loginFailed'));
  };

  const handleSave = () => {
    setError(null);
    setInfo(null);
    try {
      saveRuntimeConfig(url, key);
      window.location.assign('/login');
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'refused_service_role_key') setError(t('auth.serviceKeyRefused'));
      else if (msg === 'invalid_url') setError(t('auth.invalidUrl'));
      else setError(msg);
    }
  };

  const handleClear = () => {
    clearRuntimeConfig();
    setUrl('');
    setKey('');
    setInfo(null);
    setError(null);
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-start gap-4">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
            <Database className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">{t('auth.setupTitle')}</h1>
            <p className="mt-1 text-sm text-slate-600">{t('auth.setupSubtitle')}</p>
          </div>
        </div>

        {!isSupabaseConfigured && (
          <div className="mb-5">
            <Alert tone="warning">{t('auth.notConfigured')}</Alert>
          </div>
        )}

        <div className="mb-5 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span>
            {t('auth.configuredFrom')}: <strong>{sourceLabel}</strong>
          </span>
          {configSource === 'runtime' && (
            <button
              type="button"
              onClick={handleClear}
              className="inline-flex items-center gap-1 text-rose-600 hover:underline"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('auth.resetConfig')}
            </button>
          )}
        </div>

        <div className="space-y-4">
          <Input
            label={t('auth.supabaseUrl')}
            placeholder="https://<project-ref>.supabase.co"
            dir="ltr"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Input
            label={t('auth.supabaseKey')}
            placeholder="sb_publishable_…"
            dir="ltr"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>

        <div className="mt-4">
          <Alert tone="info">
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              {t('auth.setupWarning')}
            </span>
          </Alert>
        </div>

        {error && <div className="mt-4"><Alert tone="danger">{error}</Alert></div>}
        {info && (
          <div className="mt-4">
            <Alert tone="success">
              <span className="inline-flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                {info}
              </span>
            </Alert>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="secondary" onClick={handleTest} disabled={busy || !url || !key}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            {t('auth.testConnection')}
          </Button>
          <Button onClick={handleSave} disabled={!url || !key}>
            {t('auth.saveAndReload')}
          </Button>
          {isSupabaseConfigured && (
            <Button variant="ghost" onClick={() => navigate('/login')}>
              {isRtl ? 'رجوع' : 'Back'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
