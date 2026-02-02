import type { ReactNode } from 'react';

interface AuthLayoutProps {
  children: ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-100">Assistants</h1>
          <p className="mt-2 text-slate-400">Your personal AI assistant</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
