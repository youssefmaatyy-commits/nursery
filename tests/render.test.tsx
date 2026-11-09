import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

// The browser has no network to Supabase in CI; stub the client surface used on mount.
vi.mock('@/lib/supabase', () => {
  const session = { data: { session: null }, error: null };
  return {
    isSupabaseConfigured: true,
    supabase: {
      auth: {
        getSession: vi.fn().mockResolvedValue(session),
        onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
        signInWithPassword: vi.fn(),
        signOut: vi.fn(),
        resetPasswordForEmail: vi.fn(),
        updateUser: vi.fn(),
      },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    },
  };
});

import i18n from '../src/i18n';
import Login from '../src/pages/Login';
import { AuthProvider } from '../src/hooks/useAuth';
import { ToastProvider } from '../src/components/ui/Toast';

function renderLogin() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <ToastProvider>
          <Login />
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('application renders', () => {
  beforeEach(async () => {
    cleanup();
    await i18n.changeLanguage('ar');
  });

  it('renders the Arabic sign-in screen right-to-left', async () => {
    renderLogin();
    expect(await screen.findByText('مرحباً بعودتك')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'دخول' })).toBeInTheDocument();
    expect(screen.getByLabelText('البريد الإلكتروني')).toBeInTheDocument();
    expect(screen.getByLabelText('كلمة المرور')).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('switches to English LTR without reloading', async () => {
    renderLogin();
    await i18n.changeLanguage('en');
    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByText('Sign in')).toBeInTheDocument();
  });

  it('never leaves untranslated raw keys on screen', async () => {
    renderLogin();
    await screen.findByText('مرحباً بعودتك');
    expect(document.body.textContent).not.toMatch(/\b(auth|common|nav)\.[a-zA-Z]/);
  });
});
