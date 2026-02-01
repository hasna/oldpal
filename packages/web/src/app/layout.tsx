import './globals.css';
import type { Metadata } from 'next';
import { Inter, Sora, JetBrains_Mono } from 'next/font/google';
import { ServiceWorker } from '@/components/shared/ServiceWorker';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const sora = Sora({ subsets: ['latin'], variable: '--font-sora' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Assistants Web',
  description: 'Assistants web interface',
  manifest: '/manifest.json',
  themeColor: '#0f172a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${sora.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen bg-slate-950 font-body text-slate-100">
        <ServiceWorker />
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.15),_transparent_55%)]" />
        <div className="relative min-h-screen">{children}</div>
      </body>
    </html>
  );
}
