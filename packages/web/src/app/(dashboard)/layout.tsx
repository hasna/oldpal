'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { AppSidebar } from '@/components/app-sidebar';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/Separator';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { KeyboardShortcutsHelp } from '@/components/shared/KeyboardShortcutsHelp';
import { ThemeToggle } from '@/components/shared/ThemeToggle';
import { UsageWarningBanner } from '@/components/billing';
import { NotificationBell } from '@/components/notifications';
import { GlobalSearch } from '@/components/search';
import { OnboardingProvider } from '@/components/onboarding';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

const pathToBreadcrumb: Record<string, { parent?: string; parentPath?: string; label: string }> = {
  '/chat': { label: 'Chat' },
  '/sessions': { parent: 'Chat', parentPath: '/chat', label: 'Sessions' },
  '/agents': { label: 'Agents' },
  '/messages': { label: 'Messages' },
  '/billing': { label: 'Billing' },
  '/settings': { label: 'Settings' },
  '/admin/users': { parent: 'Admin', label: 'Users' },
  '/admin/stats': { parent: 'Admin', label: 'Stats' },
};

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isLoading, fetchWithAuth } = useAuth();
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sidebar">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const currentPath = pathToBreadcrumb[pathname ?? ''] || { label: 'Dashboard' };

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center justify-between gap-2 px-4">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                {currentPath.parent && (
                  <>
                    <BreadcrumbItem className="hidden md:block">
                      {currentPath.parentPath ? (
                        <BreadcrumbLink href={currentPath.parentPath}>
                          {currentPath.parent}
                        </BreadcrumbLink>
                      ) : (
                        <span className="text-muted-foreground">{currentPath.parent}</span>
                      )}
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                  </>
                )}
                <BreadcrumbItem>
                  <BreadcrumbPage>{currentPath.label}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="hidden sm:flex items-center gap-2 text-muted-foreground"
              onClick={() => setIsSearchOpen(true)}
            >
              <Search className="h-4 w-4" />
              <span>Search</span>
              <kbd className="ml-2 hidden md:inline-flex h-5 items-center gap-0.5 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
                <span className="text-xs">⌘</span>K
              </kbd>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="sm:hidden"
              onClick={() => setIsSearchOpen(true)}
              aria-label="Search messages"
            >
              <Search className="h-5 w-5" />
            </Button>
            <NotificationBell fetchWithAuth={fetchWithAuth} />
            <ThemeToggle />
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <UsageWarningBanner fetchWithAuth={fetchWithAuth} />
          {children}
        </div>
      </SidebarInset>
      {/* Global keyboard shortcuts help modal */}
      <KeyboardShortcutsHelp />
      {/* Global search dialog */}
      <GlobalSearch
        fetchWithAuth={fetchWithAuth}
        open={isSearchOpen}
        onOpenChange={setIsSearchOpen}
      />
      {/* Onboarding flow for new users */}
      <OnboardingProvider />
    </SidebarProvider>
  );
}
