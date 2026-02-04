'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AlertCircle, Plus, Pencil, Star, StarOff, User } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/Label';
import { Badge } from '@/components/ui/Badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { EmptySearchResultsState, EmptyState } from '@/components/shared/EmptyState';
import {
  BulkActionsToolbar,
  SelectableItemCheckbox,
  useSelection,
  createDeleteAction,
  type BulkAction,
} from '@/components/shared/BulkActions';
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
} from '@/components/shared/DataTable';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { IdentityEditDialog } from '@/components/identities/IdentityEditDialog';

interface IdentityContacts {
  emails: { value: string; label: string; isPrimary?: boolean }[];
  phones: { value: string; label: string }[];
  addresses: { street: string; city: string; state?: string; postalCode: string; country: string; label: string }[];
  social?: { platform: string; value: string; label?: string }[];
}

interface IdentityPreferences {
  language: string;
  dateFormat: string;
  communicationStyle: 'formal' | 'casual' | 'professional';
  responseLength: 'concise' | 'detailed' | 'balanced';
  custom: Record<string, unknown>;
}

interface Identity {
  id: string;
  name: string;
  isDefault: boolean;
  displayName: string | null;
  title: string | null;
  company: string | null;
  bio: string | null;
  timezone: string;
  locale: string;
  contacts: IdentityContacts | null;
  preferences: IdentityPreferences | null;
  context: string | null;
  isActive: boolean;
  createdAt: string;
}

type IdentityFilters = {
  search: string | undefined;
  status: string | undefined;
} & Record<string, string | undefined>;

export default function IdentitiesPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newIdentityName, setNewIdentityName] = useState('');
  const [newIdentityDisplayName, setNewIdentityDisplayName] = useState('');
  const [newIdentityTitle, setNewIdentityTitle] = useState('');
  const [newIdentityCompany, setNewIdentityCompany] = useState('');
  const [newIdentityTimezone, setNewIdentityTimezone] = useState('UTC');
  const [newIdentityCommunicationStyle, setNewIdentityCommunicationStyle] = useState<'formal' | 'casual' | 'professional'>('professional');
  const createFormRef = useRef<HTMLDivElement>(null);

  // Edit dialog state
  const [editingIdentity, setEditingIdentity] = useState<Identity | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Selection state for bulk actions
  const selection = useSelection<Identity>();

  // Sorting state
  const { sortConfig, handleSort, getSortParams } = useSorting({ column: 'createdAt', direction: 'desc' });

  // Pagination state
  const { page, setPage, pageSize, setPageSize, totalItems, setTotalItems, totalPages, loaded: paginationLoaded } = usePagination(20);

  // Filter state
  const filters = useFilters<IdentityFilters>({
    search: undefined,
    status: undefined,
  });

  const scrollToCreateForm = () => {
    createFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      const nameInput = createFormRef.current?.querySelector('input[id="name"]') as HTMLInputElement;
      nameInput?.focus();
    }, 500);
  };

  const loadIdentities = useCallback(async () => {
    setError('');
    try {
      const params = new URLSearchParams();

      const filterParams = filters.getFilterParams();
      Object.entries(filterParams).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });

      const sortParams = getSortParams();
      if (sortParams.sortBy) params.set('sortBy', sortParams.sortBy);
      if (sortParams.sortDir) params.set('sortDir', sortParams.sortDir);

      params.set('page', String(page));
      params.set('limit', String(pageSize));

      const url = `/api/v1/identities${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await fetchWithAuth(url);
      const data = await response.json();
      if (data.success) {
        setIdentities(data.data.items);
        setTotalItems(data.data.total || 0);
      } else {
        setError(data.error?.message || 'Failed to load identities');
      }
    } catch {
      setError('Failed to load identities');
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth, filters, getSortParams, page, pageSize, setTotalItems]);

  useEffect(() => {
    if (!paginationLoaded) return;

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      loadIdentities();
    }, 300);
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [loadIdentities, paginationLoaded]);

  useEffect(() => {
    setPage(1);
  }, [filters.values, sortConfig, setPage]);

  const createIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIdentityName.trim()) return;

    setIsCreating(true);
    try {
      const response = await fetchWithAuth('/api/v1/identities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newIdentityName,
          displayName: newIdentityDisplayName || newIdentityName,
          title: newIdentityTitle || undefined,
          company: newIdentityCompany || undefined,
          timezone: newIdentityTimezone,
          preferences: {
            communicationStyle: newIdentityCommunicationStyle,
          },
        }),
      });
      const data = await response.json();
      if (data.success) {
        setIdentities((prev) => [data.data, ...prev]);
        setNewIdentityName('');
        setNewIdentityDisplayName('');
        setNewIdentityTitle('');
        setNewIdentityCompany('');
        setNewIdentityTimezone('UTC');
        setNewIdentityCommunicationStyle('professional');
        toast({
          title: 'Identity created',
          description: `${data.data.name} has been created successfully.`,
        });
      } else {
        setError(data.error?.message || 'Failed to create identity');
      }
    } catch {
      setError('Failed to create identity');
    } finally {
      setIsCreating(false);
    }
  };

  const updateIdentity = async (identityId: string, data: Partial<Identity>) => {
    const response = await fetchWithAuth(`/api/v1/identities/${identityId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (result.success) {
      setIdentities((prev) =>
        prev.map((i) => (i.id === identityId ? { ...i, ...result.data } : i))
      );
      toast({
        title: 'Identity updated',
        description: `${result.data.name} has been updated successfully.`,
      });
    } else {
      throw new Error(result.error?.message || 'Failed to update identity');
    }
  };

  const openEditDialog = (identity: Identity) => {
    setEditingIdentity(identity);
    setIsEditDialogOpen(true);
  };

  const deleteIdentity = async (id: string) => {
    try {
      const response = await fetchWithAuth(`/api/v1/identities/${id}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setIdentities((prev) => prev.filter((i) => i.id !== id));
        toast({
          title: 'Identity deleted',
          description: 'The identity has been deleted successfully.',
        });
      }
    } catch {
      setError('Failed to delete identity');
    }
  };

  const setAsDefault = async (id: string) => {
    try {
      const response = await fetchWithAuth(`/api/v1/identities/${id}/default`, {
        method: 'POST',
      });
      const data = await response.json();
      if (data.success) {
        setIdentities((prev) =>
          prev.map((i) => ({
            ...i,
            isDefault: i.id === id,
          }))
        );
        toast({
          title: 'Default identity updated',
          description: 'This identity is now your default.',
        });
      }
    } catch {
      setError('Failed to set default identity');
    }
  };

  // Bulk delete identities
  const bulkDeleteIdentities = useCallback(
    async (identitiesToDelete: Identity[]) => {
      const ids = identitiesToDelete.map((i) => i.id);
      await Promise.allSettled(
        ids.map((id) =>
          fetchWithAuth(`/api/v1/identities/${id}`, { method: 'DELETE' })
        )
      );

      setIdentities((prev) => prev.filter((i) => !ids.includes(i.id)));
      selection.deselectAll();
      toast({
        title: 'Identities deleted',
        description: `${identitiesToDelete.length} ${identitiesToDelete.length === 1 ? 'identity' : 'identities'} deleted.`,
      });
    },
    [fetchWithAuth, selection, toast]
  );

  const bulkActions: BulkAction<Identity>[] = [
    createDeleteAction(bulkDeleteIdentities, 'identity'),
  ];

  const hasActiveFilters = filters.hasActiveFilters;

  if (isLoading) {
    return (
      <div className="flex flex-col h-[calc(100vh-3.5rem)]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h1 className="text-lg font-semibold">Identities</h1>
          <Button size="sm" disabled>
            <Plus className="h-4 w-4 mr-2" />
            New Identity
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto">
            <Card className="mb-8">
              <CardHeader>
                <Skeleton className="h-6 w-40" />
              </CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-32" />
              </CardContent>
            </Card>
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Card key={i}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex-1">
                      <Skeleton className="h-5 w-40 mb-2" />
                      <Skeleton className="h-4 w-64 mb-1" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-8 w-20" />
                      <Skeleton className="h-8 w-16" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Page Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h1 className="text-lg font-semibold">Identities</h1>
        <Button size="sm" onClick={scrollToCreateForm}>
          <Plus className="h-4 w-4 mr-2" />
          New Identity
        </Button>
      </div>

      {/* Page Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Create Identity Form */}
          <Card className="mb-8" ref={createFormRef}>
            <CardHeader>
              <CardTitle>Create New Identity</CardTitle>
              <CardDescription>Define a persona for your AI assistant to adopt</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={createIdentity} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="name">Identity Name</Label>
                    <Input
                      id="name"
                      value={newIdentityName}
                      onChange={(e) => setNewIdentityName(e.target.value)}
                      placeholder="Work, Personal, Support..."
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="displayName">Display Name</Label>
                    <Input
                      id="displayName"
                      value={newIdentityDisplayName}
                      onChange={(e) => setNewIdentityDisplayName(e.target.value)}
                      placeholder="How you want to be addressed"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="title">Title (optional)</Label>
                    <Input
                      id="title"
                      value={newIdentityTitle}
                      onChange={(e) => setNewIdentityTitle(e.target.value)}
                      placeholder="Software Engineer, Manager..."
                    />
                  </div>
                  <div>
                    <Label htmlFor="company">Company (optional)</Label>
                    <Input
                      id="company"
                      value={newIdentityCompany}
                      onChange={(e) => setNewIdentityCompany(e.target.value)}
                      placeholder="Acme Corp"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="timezone">Timezone</Label>
                    <Select value={newIdentityTimezone} onValueChange={setNewIdentityTimezone}>
                      <SelectTrigger id="timezone">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="UTC">UTC</SelectItem>
                        <SelectItem value="America/New_York">Eastern Time</SelectItem>
                        <SelectItem value="America/Chicago">Central Time</SelectItem>
                        <SelectItem value="America/Denver">Mountain Time</SelectItem>
                        <SelectItem value="America/Los_Angeles">Pacific Time</SelectItem>
                        <SelectItem value="Europe/London">London</SelectItem>
                        <SelectItem value="Europe/Paris">Paris</SelectItem>
                        <SelectItem value="Asia/Tokyo">Tokyo</SelectItem>
                        <SelectItem value="Asia/Shanghai">Shanghai</SelectItem>
                        <SelectItem value="Australia/Sydney">Sydney</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="communicationStyle">Communication Style</Label>
                    <Select value={newIdentityCommunicationStyle} onValueChange={(v) => setNewIdentityCommunicationStyle(v as 'formal' | 'casual' | 'professional')}>
                      <SelectTrigger id="communicationStyle">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="professional">Professional</SelectItem>
                        <SelectItem value="formal">Formal</SelectItem>
                        <SelectItem value="casual">Casual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button type="submit" disabled={isCreating || !newIdentityName.trim()}>
                  {isCreating ? 'Creating...' : 'Create Identity'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Search and Filters */}
          <div className="mb-6 space-y-4">
            <SearchBar
              value={filters.values.search || ''}
              onChange={(value) => filters.updateFilter('search', value || undefined)}
              placeholder="Search identities by name..."
            />

            <div className="flex flex-wrap gap-3 items-center justify-between">
              <div className="flex flex-wrap gap-3 items-center">
                <SelectFilter
                  value={filters.values.status || 'all'}
                  onChange={(value) => filters.updateFilter('status', value === 'all' ? undefined : value)}
                  options={[
                    { value: 'active', label: 'Active' },
                    { value: 'inactive', label: 'Inactive' },
                  ]}
                  placeholder="All Status"
                />

                {hasActiveFilters && (
                  <Button variant="ghost" size="sm" onClick={filters.clearAllFilters}>
                    Clear filters
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Sort by:</span>
                <SortableHeader
                  column="name"
                  label="Name"
                  sortConfig={sortConfig}
                  onSort={handleSort}
                />
                <SortableHeader
                  column="createdAt"
                  label="Created"
                  sortConfig={sortConfig}
                  onSort={handleSort}
                />
              </div>
            </div>
          </div>

          {/* Bulk Actions Toolbar */}
          {identities.length > 0 && (
            <BulkActionsToolbar
              selectedCount={selection.selectedCount}
              totalCount={identities.length}
              onSelectAll={() => selection.selectAll(identities)}
              onDeselectAll={selection.deselectAll}
              actions={bulkActions}
              selectedItems={selection.getSelectedItems(identities)}
              onActionComplete={loadIdentities}
            />
          )}

          {/* Identities List */}
          {identities.length === 0 ? (
            hasActiveFilters ? (
              <EmptySearchResultsState
                query={filters.values.search || ''}
                onClear={filters.clearAllFilters}
              />
            ) : (
              <EmptyState
                illustration="agents"
                title="No identities created"
                description="Create your first identity to personalize how your AI assistant interacts with you."
                tip="Identities can have different communication styles, timezones, and contact info."
                action={{
                  label: 'Create your first identity',
                  onClick: scrollToCreateForm,
                }}
              />
            )
          ) : (
            <>
              <div className="space-y-3">
                {identities.map((identity) => (
                  <Card key={identity.id}>
                    <CardContent className="flex items-center gap-3 p-4">
                      <SelectableItemCheckbox
                        checked={selection.isSelected(identity.id)}
                        onChange={() => selection.toggle(identity.id)}
                      />
                      <div className="flex items-center gap-4 flex-1">
                        <Avatar className="h-12 w-12">
                          <AvatarFallback className="bg-muted">
                            <User className="h-6 w-6 text-muted-foreground" />
                          </AvatarFallback>
                        </Avatar>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-foreground font-medium truncate">{identity.name}</span>
                            {identity.isDefault && (
                              <Badge variant="secondary">
                                <Star className="h-3 w-3 mr-1 fill-current" />
                                Default
                              </Badge>
                            )}
                            {!identity.isActive && (
                              <Badge variant="default">Inactive</Badge>
                            )}
                          </div>
                          {(identity.displayName || identity.title || identity.company) && (
                            <p className="text-sm text-muted-foreground mt-1 truncate">
                              {identity.displayName || identity.name}
                              {identity.title && ` · ${identity.title}`}
                              {identity.company && ` at ${identity.company}`}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            {identity.timezone}
                            {identity.preferences?.communicationStyle && ` · ${identity.preferences.communicationStyle}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {!identity.isDefault && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setAsDefault(identity.id)}
                          >
                            <StarOff className="h-4 w-4 mr-1" />
                            Set Default
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditDialog(identity)}
                        >
                          <Pencil className="h-4 w-4 mr-1" />
                          Edit
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive/80"
                            >
                              Delete
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete identity?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete this identity? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteIdentity(identity.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

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
            </>
          )}
        </div>
      </div>

      {/* Edit Dialog */}
      <IdentityEditDialog
        identity={editingIdentity}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        onSave={updateIdentity}
      />
    </div>
  );
}
