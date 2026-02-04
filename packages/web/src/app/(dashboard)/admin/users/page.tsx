'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, MoreHorizontal, Pencil, Eye, UserX, UserCheck } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UserEditDialog, type UserForEdit } from '@/components/admin/UserEditDialog';
import { UserDetailDialog } from '@/components/admin/UserDetailDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  SearchBar,
  SelectFilter,
  useFilters,
} from '@/components/shared/ListFilters';
import {
  SortableHeader,
  PaginationControls,
  useSorting,
  usePagination,
  TableSkeleton,
  SKELETON_COLUMNS,
} from '@/components/shared/DataTable';

interface User {
  id: string;
  email: string;
  name: string | null;
  role: 'user' | 'admin';
  emailVerified: boolean;
  avatarUrl: string | null;
  isActive?: boolean;
  suspendedReason?: string | null;
  createdAt: string;
}

type UserFilters = {
  search: string | undefined;
  role: string | undefined;
  status: string | undefined;
} & Record<string, string | undefined>;

export default function AdminUsersPage() {
  const router = useRouter();
  const { user, fetchWithAuth } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sorting state
  const { sortConfig, handleSort, getSortParams } = useSorting({ column: 'createdAt', direction: 'desc' });

  // Pagination state
  const { page, setPage, pageSize, setPageSize, totalItems, setTotalItems, totalPages, loaded: paginationLoaded } = usePagination(20);

  // Filter state
  const filters = useFilters<UserFilters>({
    search: undefined,
    role: undefined,
    status: undefined,
  });

  // Dialog states
  const [editUser, setEditUser] = useState<UserForEdit | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [suspendUser, setSuspendUser] = useState<User | null>(null);
  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false);
  const [isSuspending, setIsSuspending] = useState(false);

  useEffect(() => {
    if (user && user.role !== 'admin') {
      router.push('/chat');
    }
  }, [user, router]);

  const loadUsers = useCallback(async () => {
    try {
      setIsLoading(true);
      setError('');
      const params = new URLSearchParams();

      // Add filter params
      const filterParams = filters.getFilterParams();
      Object.entries(filterParams).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });

      // Add sort params
      const sortParams = getSortParams();
      if (sortParams.sortBy) params.set('sortBy', sortParams.sortBy);
      if (sortParams.sortDir) params.set('sortDir', sortParams.sortDir);

      // Add pagination params
      params.set('page', String(page));
      params.set('limit', String(pageSize));

      const response = await fetchWithAuth(`/api/v1/admin/users?${params}`);
      const data = await response.json();
      if (data.success) {
        setUsers(data.data.items);
        setTotalItems(data.data.total || 0);
      } else {
        setError(data.error?.message || 'Failed to load users');
      }
    } catch {
      setError('Failed to load users');
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth, filters, getSortParams, page, pageSize, setTotalItems]);

  // Load users when filters, sorting, or pagination change
  useEffect(() => {
    if (!paginationLoaded || user?.role !== 'admin') return;

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      loadUsers();
    }, 300);
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [loadUsers, paginationLoaded, user?.role]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [filters.values, sortConfig, setPage]);

  const handleEdit = (u: User) => {
    setEditUser({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      isActive: u.isActive ?? true,
      suspendedReason: u.suspendedReason ?? null,
    });
    setEditDialogOpen(true);
  };

  const handleSaveEdit = async (userId: string, data: Partial<UserForEdit>) => {
    const response = await fetchWithAuth(`/api/v1/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to update user');
    }

    await loadUsers();
  };

  const handleViewDetails = (userId: string) => {
    setDetailUserId(userId);
    setDetailDialogOpen(true);
  };

  const handleSuspendToggle = (u: User) => {
    setSuspendUser(u);
    setSuspendDialogOpen(true);
  };

  const confirmSuspendToggle = async () => {
    if (!suspendUser) return;

    setIsSuspending(true);
    try {
      const newStatus = !(suspendUser.isActive ?? true);
      const response = await fetchWithAuth(`/api/v1/admin/users/${suspendUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isActive: newStatus,
          suspendedReason: newStatus ? null : 'Suspended by admin',
        }),
      });

      const result = await response.json();

      if (!result.success) {
        setError(result.error?.message || 'Failed to update user status');
      } else {
        await loadUsers();
      }
    } catch {
      setError('Failed to update user status');
    } finally {
      setIsSuspending(false);
      setSuspendDialogOpen(false);
      setSuspendUser(null);
    }
  };

  if (user?.role !== 'admin') {
    return null;
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-[calc(100vh-3.5rem)]">
        {/* Page Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h1 className="text-lg font-semibold">Users</h1>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-6xl mx-auto">
            <TableSkeleton
              columns={SKELETON_COLUMNS.adminUsers}
              headers={['Email', 'Name', 'Role', 'Status', 'Created', 'Actions']}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Page Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h1 className="text-lg font-semibold">Users</h1>
      </div>

      {/* Page Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto">
          {/* Search and Filters */}
        <div className="mb-6 space-y-4">
          <SearchBar
            value={filters.values.search || ''}
            onChange={(value) => filters.updateFilter('search', value || undefined)}
            placeholder="Search users by name or email..."
          />

          <div className="flex flex-wrap gap-3 items-center justify-between">
            <div className="flex flex-wrap gap-3 items-center">
              <SelectFilter
                value={filters.values.role || 'all'}
                onChange={(value) => filters.updateFilter('role', value === 'all' ? undefined : value)}
                options={[
                  { value: 'admin', label: 'Admin' },
                  { value: 'user', label: 'User' },
                ]}
                placeholder="All Roles"
              />

              <SelectFilter
                value={filters.values.status || 'all'}
                onChange={(value) => filters.updateFilter('status', value === 'all' ? undefined : value)}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'suspended', label: 'Suspended' },
                ]}
                placeholder="All Status"
              />

              {filters.hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={filters.clearAllFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          </div>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <SortableHeader
                  column="email"
                  label="Email"
                  sortConfig={sortConfig}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead>
                <SortableHeader
                  column="name"
                  label="Name"
                  sortConfig={sortConfig}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead>
                <SortableHeader
                  column="role"
                  label="Role"
                  sortConfig={sortConfig}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <SortableHeader
                  column="createdAt"
                  label="Created"
                  sortConfig={sortConfig}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className="w-[70px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => {
              const isActive = u.isActive ?? true;
              const isSelf = u.id === user?.id;

              return (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.email}</TableCell>
                  <TableCell>{u.name || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={u.role === 'admin' ? 'secondary' : 'default'}>
                      {u.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={isActive ? 'success' : 'error'}>
                      {isActive ? 'Active' : 'Suspended'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleViewDetails(u.id)}>
                          <Eye className="mr-2 h-4 w-4" />
                          View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleEdit(u)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleSuspendToggle(u)}
                          disabled={isSelf}
                          className={isActive ? 'text-destructive' : 'text-green-600'}
                        >
                          {isActive ? (
                            <>
                              <UserX className="mr-2 h-4 w-4" />
                              Suspend
                            </>
                          ) : (
                            <>
                              <UserCheck className="mr-2 h-4 w-4" />
                              Activate
                            </>
                          )}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

          {totalPages > 1 && (
            <PaginationControls
              page={page}
              totalPages={totalPages}
              pageSize={pageSize}
              totalItems={totalItems}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          )}
        </div>
      </div>

      <UserEditDialog
        user={editUser}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onSave={handleSaveEdit}
        currentUserId={user?.id || ''}
      />

      <UserDetailDialog
        userId={detailUserId}
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
        fetchWithAuth={fetchWithAuth}
      />

      <AlertDialog open={suspendDialogOpen} onOpenChange={setSuspendDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {suspendUser?.isActive ?? true ? 'Suspend User' : 'Activate User'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {suspendUser?.isActive ?? true
                ? `Are you sure you want to suspend ${suspendUser?.email}? They will not be able to log in.`
                : `Are you sure you want to activate ${suspendUser?.email}? They will be able to log in again.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSuspending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmSuspendToggle}
              disabled={isSuspending}
              className={suspendUser?.isActive ?? true ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
            >
              {isSuspending ? 'Processing...' : suspendUser?.isActive ?? true ? 'Suspend' : 'Activate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
