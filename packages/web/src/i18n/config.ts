// Supported locales
export const locales = ['en', 'es'] as const;
export type Locale = (typeof locales)[number];

// Default locale
export const defaultLocale: Locale = 'en';

// Locale display names
export const localeNames: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
};

// Locale metadata for SEO
export const localeMetadata: Record<Locale, { dir: 'ltr' | 'rtl'; lang: string }> = {
  en: { dir: 'ltr', lang: 'en-US' },
  es: { dir: 'ltr', lang: 'es-ES' },
};

// Check if a locale is valid
export function isValidLocale(locale: string): locale is Locale {
  return locales.includes(locale as Locale);
}

// Get locale from browser/navigator
export function getBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return defaultLocale;

  const browserLocale = navigator.language.split('-')[0];
  return isValidLocale(browserLocale) ? browserLocale : defaultLocale;
}
