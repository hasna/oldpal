import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { defaultLocale, isValidLocale, type Locale } from './config';

export default getRequestConfig(async () => {
  // Try to get locale from cookie first
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get('NEXT_LOCALE')?.value;

  if (localeCookie && isValidLocale(localeCookie)) {
    const messages = (await import(`../../messages/${localeCookie}.json`)).default;
    return {
      locale: localeCookie,
      messages,
    };
  }

  // Fall back to Accept-Language header
  const headerStore = await headers();
  const acceptLanguage = headerStore.get('Accept-Language');

  if (acceptLanguage) {
    const preferredLocale = acceptLanguage.split(',')[0].split('-')[0];
    if (isValidLocale(preferredLocale)) {
      const messages = (await import(`../../messages/${preferredLocale}.json`)).default;
      return {
        locale: preferredLocale,
        messages,
      };
    }
  }

  // Default to English
  const messages = (await import(`../../messages/${defaultLocale}.json`)).default;
  return {
    locale: defaultLocale,
    messages,
  };
});
