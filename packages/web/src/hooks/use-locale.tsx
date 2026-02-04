'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { locales, defaultLocale, localeNames, type Locale, isValidLocale } from '@/i18n';

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  localeNames: Record<Locale, string>;
  availableLocales: readonly Locale[];
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

const LOCALE_COOKIE_NAME = 'NEXT_LOCALE';
const LOCALE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year

function getStoredLocale(): Locale {
  if (typeof document === 'undefined') return defaultLocale;

  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === LOCALE_COOKIE_NAME && isValidLocale(value)) {
      return value;
    }
  }

  // Try browser preference
  const browserLocale = navigator.language.split('-')[0];
  if (isValidLocale(browserLocale)) {
    return browserLocale;
  }

  return defaultLocale;
}

function setStoredLocale(locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${LOCALE_COOKIE_NAME}=${locale};path=/;max-age=${LOCALE_COOKIE_MAX_AGE};SameSite=Lax`;
}

interface LocaleProviderProps {
  children: ReactNode;
  initialLocale?: Locale;
}

export function LocaleProvider({ children, initialLocale }: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale || defaultLocale);

  // Initialize locale from storage on mount
  useEffect(() => {
    if (!initialLocale) {
      setLocaleState(getStoredLocale());
    }
  }, [initialLocale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    setStoredLocale(newLocale);
    // Reload the page to apply the new locale
    window.location.reload();
  }, []);

  return (
    <LocaleContext.Provider
      value={{
        locale,
        setLocale,
        localeNames,
        availableLocales: locales,
      }}
    >
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return context;
}
