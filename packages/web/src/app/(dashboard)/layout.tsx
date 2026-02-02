'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const router = useRouter();
  const { isAuthenticated, isLoading, user, logout } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-400"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Top Navigation */}
      <header className="border-b border-slate-800 bg-slate-900/50">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/chat" className="text-lg font-semibold text-slate-100">
              Assistants
            </Link>
            <nav className="flex items-center gap-4">
              <Link
                href="/chat"
                className="text-sm text-slate-400 hover:text-slate-100 transition-colors"
              >
                Chat
              </Link>
              <Link
                href="/sessions"
                className="text-sm text-slate-400 hover:text-slate-100 transition-colors"
              >
                Sessions
              </Link>
              <Link
                href="/agents"
                className="text-sm text-slate-400 hover:text-slate-100 transition-colors"
              >
                Agents
              </Link>
              <Link
                href="/messages"
                className="text-sm text-slate-400 hover:text-slate-100 transition-colors"
              >
                Messages
              </Link>
              {user?.role === 'admin' && (
                <Link
                  href="/admin/users"
                  className="text-sm text-slate-400 hover:text-slate-100 transition-colors"
                >
                  Admin
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/settings"
              className="text-sm text-slate-400 hover:text-slate-100 transition-colors"
            >
              Settings
            </Link>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400">{user?.name || user?.email}</span>
              <button
                onClick={() => logout()}
                className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">{children}</main>
    </div>
  );
}
