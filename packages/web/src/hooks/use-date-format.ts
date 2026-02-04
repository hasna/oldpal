'use client';

import { useLocale } from './use-locale';
import { useCallback, useMemo } from 'react';

// Locale to Intl.Locale mapping
const localeToIntl: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
};

export function useDateFormat() {
  const { locale } = useLocale();
  const intlLocale = localeToIntl[locale] || 'en-US';

  const formatDate = useCallback(
    (date: Date | string | number, options?: Intl.DateTimeFormatOptions): string => {
      const d = new Date(date);
      return d.toLocaleDateString(intlLocale, options);
    },
    [intlLocale]
  );

  const formatTime = useCallback(
    (date: Date | string | number, options?: Intl.DateTimeFormatOptions): string => {
      const d = new Date(date);
      return d.toLocaleTimeString(intlLocale, options);
    },
    [intlLocale]
  );

  const formatDateTime = useCallback(
    (date: Date | string | number, options?: Intl.DateTimeFormatOptions): string => {
      const d = new Date(date);
      return d.toLocaleString(intlLocale, options);
    },
    [intlLocale]
  );

  const formatRelative = useCallback(
    (date: Date | string | number): string => {
      const d = new Date(date);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHour = Math.floor(diffMin / 60);
      const diffDay = Math.floor(diffHour / 24);

      const rtf = new Intl.RelativeTimeFormat(intlLocale, { numeric: 'auto' });

      if (diffSec < 60) {
        return rtf.format(-diffSec, 'second');
      } else if (diffMin < 60) {
        return rtf.format(-diffMin, 'minute');
      } else if (diffHour < 24) {
        return rtf.format(-diffHour, 'hour');
      } else if (diffDay < 7) {
        return rtf.format(-diffDay, 'day');
      } else {
        return formatDate(d, { month: 'short', day: 'numeric', year: 'numeric' });
      }
    },
    [intlLocale, formatDate]
  );

  const formatNumber = useCallback(
    (num: number, options?: Intl.NumberFormatOptions): string => {
      return num.toLocaleString(intlLocale, options);
    },
    [intlLocale]
  );

  const formatCurrency = useCallback(
    (amount: number, currency: string = 'USD'): string => {
      return new Intl.NumberFormat(intlLocale, {
        style: 'currency',
        currency,
      }).format(amount);
    },
    [intlLocale]
  );

  const formatPercent = useCallback(
    (value: number): string => {
      return new Intl.NumberFormat(intlLocale, {
        style: 'percent',
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      }).format(value);
    },
    [intlLocale]
  );

  return useMemo(
    () => ({
      locale: intlLocale,
      formatDate,
      formatTime,
      formatDateTime,
      formatRelative,
      formatNumber,
      formatCurrency,
      formatPercent,
    }),
    [intlLocale, formatDate, formatTime, formatDateTime, formatRelative, formatNumber, formatCurrency, formatPercent]
  );
}
