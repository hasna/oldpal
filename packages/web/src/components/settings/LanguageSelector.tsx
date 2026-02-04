'use client';

import { Globe, Check } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useLocale } from '@/hooks/use-locale';
import type { Locale } from '@/i18n';

// Flag emojis for visual indication
const localeFlags: Record<Locale, string> = {
  en: '🇺🇸',
  es: '🇪🇸',
};

export function LanguageSelector() {
  const { locale, setLocale, localeNames, availableLocales } = useLocale();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Language
        </CardTitle>
        <CardDescription>
          Choose your preferred language for the interface
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {availableLocales.map((loc) => (
            <Button
              key={loc}
              variant={locale === loc ? 'default' : 'outline'}
              className="justify-start h-auto py-3 px-4"
              onClick={() => setLocale(loc)}
            >
              <span className="text-xl mr-3">{localeFlags[loc]}</span>
              <span className="flex-1 text-left">{localeNames[loc]}</span>
              {locale === loc && <Check className="h-4 w-4 ml-2" />}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-4">
          Changing the language will reload the page.
        </p>
      </CardContent>
    </Card>
  );
}
