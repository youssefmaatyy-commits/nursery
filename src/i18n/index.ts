import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './ar';
import en from './en';

export const SUPPORTED_LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const stored = (typeof localStorage !== 'undefined' && localStorage.getItem('erp.locale')) as Locale | null;
const initial: Locale = stored && SUPPORTED_LOCALES.includes(stored) ? stored : 'ar';

void i18n.use(initReactI18next).init({
  resources: { ar: { translation: ar }, en: { translation: en } },
  lng: initial,
  fallbackLng: 'ar',
  supportedLngs: SUPPORTED_LOCALES as unknown as string[],
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function isRtl(locale: string) {
  return locale.startsWith('ar');
}

export function applyDocumentLocale(locale: string) {
  const dir = isRtl(locale) ? 'rtl' : 'ltr';
  document.documentElement.lang = locale;
  document.documentElement.dir = dir;
  document.documentElement.classList.toggle('font-ar', locale === 'ar');
}

export async function setLocale(locale: Locale) {
  await i18n.changeLanguage(locale);
  localStorage.setItem('erp.locale', locale);
  applyDocumentLocale(locale);
}

applyDocumentLocale(i18n.language);

export default i18n;
