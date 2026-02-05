'use client';

import { Settings, Moon, Sun, Monitor, Check, Globe } from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Label';
import type { Locale } from '@/i18n';

type Theme = 'light' | 'dark' | 'system';

const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

// Flag emojis for visual indication
const localeFlags: Record<Locale, string> = {
  en: '🇺🇸',
  es: '🇪🇸',
};

export function PreferencesSection() {
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, localeNames, availableLocales } = useLocale();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Preferences
        </CardTitle>
        <CardDescription>
          Customize your experience
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Theme Selection */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Theme</Label>
          <div className="grid grid-cols-3 gap-3">
            {themeOptions.map(({ value, label, icon: Icon }) => (
              <Button
                key={value}
                variant={theme === value ? 'default' : 'outline'}
                className="justify-start h-auto py-3 px-4"
                onClick={() => setTheme(value)}
              >
                <Icon className="h-4 w-4 mr-2" />
                <span className="flex-1 text-left">{label}</span>
                {theme === value && <Check className="h-4 w-4 ml-2" />}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Choose how the interface appears. System follows your device settings.
          </p>
        </div>

        {/* Language Selection */}
        <div className="space-y-3">
          <Label className="text-sm font-medium flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Language
          </Label>
          <div className="grid grid-cols-2 gap-3">
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
          <p className="text-xs text-muted-foreground">
            Changing the language will reload the page.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
