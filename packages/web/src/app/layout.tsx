import './globals.css';
import type { Metadata } from 'next';
import { Inter, Sora, JetBrains_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { ServiceWorker } from '@/components/shared/ServiceWorker';
import { AuthProvider } from '@/components/auth/auth-provider';
import { Toaster } from '@/components/ui/toaster';
import { WebVitals } from '@/components/shared/WebVitals';
import { ThemeProvider, themeScript } from '@/hooks/use-theme';
import { LocaleProvider } from '@/hooks/use-locale';
import { localeMetadata, type Locale } from '@/i18n';
import { ScreenReaderProvider, SkipLink } from '@/components/ui/screen-reader';
import { InstallPrompt, UpdatePrompt } from '@/components/pwa';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const sora = Sora({ subsets: ['latin'], variable: '--font-sora' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

const siteConfig = {
  name: 'Assistants',
  description: 'Your personal AI assistant platform. Create and manage intelligent agents that help you automate tasks, organize information, and boost productivity.',
  url: process.env.NEXT_PUBLIC_APP_URL || 'https://assistants.app',
  ogImage: '/og-image.png',
};

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  manifest: '/manifest.json',
  keywords: ['AI assistant', 'automation', 'productivity', 'agents', 'chatbot', 'AI platform'],
  authors: [{ name: 'Hasna' }],
  creator: 'Hasna',
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteConfig.url,
    title: siteConfig.name,
    description: siteConfig.description,
    siteName: siteConfig.name,
    images: [
      {
        url: siteConfig.ogImage,
        width: 1200,
        height: 630,
        alt: siteConfig.name,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: siteConfig.name,
    description: siteConfig.description,
    images: [siteConfig.ogImage],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale() as Locale;
  const messages = await getMessages();
  const { dir, lang } = localeMetadata[locale] || localeMetadata.en;

  return (
    <html lang={lang} dir={dir} className={`${inter.variable} ${sora.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-background font-body text-foreground">
        <WebVitals />
        <ServiceWorker />
        <NextIntlClientProvider messages={messages}>
          <LocaleProvider initialLocale={locale}>
            <ScreenReaderProvider>
              <ThemeProvider>
                <AuthProvider>
                  <SkipLink />
                  <main id="main-content" className="relative min-h-screen">
                    {children}
                  </main>
                  <Toaster />
                  <InstallPrompt />
                  <UpdatePrompt />
                </AuthProvider>
              </ThemeProvider>
            </ScreenReaderProvider>
          </LocaleProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
