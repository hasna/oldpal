'use client';

import { useEffect } from 'react';
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

interface DashboardLayoutProps {
  children: React.ReactNode;
}

const pathToBreadcrumb: Record<string, { parent?: string; parentPath?: string; label: string }> = {
  '/chat': { label: 'Chat' },
  '/sessions': { parent: 'Chat', parentPath: '/chat', label: 'Sessions' },
  '/agents': { label: 'Agents' },
  '/agents/new': { parent: 'Agents', parentPath: '/agents', label: 'Create Agent' },
  '/messages': { label: 'Messages' },
  '/settings': { label: 'Settings' },
  '/settings/api-keys': { parent: 'Settings', parentPath: '/settings', label: 'API Keys' },
  '/admin/users': { parent: 'Admin', label: 'Users' },
  '/admin/stats': { parent: 'Admin', label: 'Stats' },
};

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isLoading } = useAuth();

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
        <header className="flex h-16 shrink-0 items-center gap-2">
          <div className="flex items-center gap-2 px-4">
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
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
