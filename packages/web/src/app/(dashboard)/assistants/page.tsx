'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AlertCircle, Power, PowerOff, Plus, Pencil } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/Label';
import { Badge } from '@/components/ui/Badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AvatarUpload } from '@/components/ui/avatar-upload';
import { EmptyAssistantsState, EmptySearchResultsState } from '@/components/shared/EmptyState';
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
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AssistantEditDialog } from '@/components/assistants/AssistantEditDialog';
import {
  ANTHROPIC_MODELS,
  DEFAULT_MODEL,
  DEFAULT_TEMPERATURE,
  MIN_TEMPERATURE,
  MAX_TEMPERATURE,
  TEMPERATURE_STEP,
  getModelDisplayName,
} from '@hasna/assistants-shared';

interface Assistant {
  id: string;
  name: string;
  description: string | null;
  avatar: string | null;
  model: string;
  systemPrompt?: string | null;
  settings?: {
    temperature?: number;
    maxTokens?: number;
    tools?: string[];
    skills?: string[];
  } | null;
  isActive: boolean;
  createdAt: string;
}

type AssistantFilters = {
  search: string | undefined;
  status: string | undefined;
} & Record<string, string | undefined>;

export default function AssistantsPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newAssistantName, setNewAssistantName] = useState('');
  const [newAssistantDescription, setNewAssistantDescription] = useState('');
  const [newAssistantAvatar, setNewAssistantAvatar] = useState<string | null>(null);
  const [newAssistantModel, setNewAssistantModel] = useState(DEFAULT_MODEL);
  const [newAssistantTemperature, setNewAssistantTemperature] = useState(DEFAULT_TEMPERATURE);
  const createFormRef = useRef<HTMLDivElement>(null);

  // Edit dialog state
  const [editingAssistant, setEditingAssistant] = useState<Assistant | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Selection state for bulk actions
  const selection = useSelection<Assistant>();

  // Sorting state
  const { sortConfig, handleSort, getSortParams } = useSorting({ column: 'createdAt', direction: 'desc' });

  // Pagination state
  const { page, setPage, pageSize, setPageSize, totalItems, setTotalItems, totalPages, loaded: paginationLoaded } = usePagination(20);

  // Filter state
  const filters = useFilters<AssistantFilters>({
    search: undefined,
    status: undefined,
  });

  const scrollToCreateForm = () => {
    createFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Focus the name input after scrolling
    setTimeout(() => {
      const nameInput = createFormRef.current?.querySelector('input[id="name"]') as HTMLInputElement;
      nameInput?.focus();
    }, 500);
  };

  const loadAssistants = useCallback(async () => {
    setError(''); // Clear any previous errors
    try {
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

      const url = `/api/v1/assistants${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await fetchWithAuth(url);
      const data = await response.json();
      if (data.success) {
        setAssistants(data.data.items);
        setTotalItems(data.data.total || 0);
      } else {
        setError(data.error?.message || 'Failed to load assistants');
      }
    } catch {
      setError('Failed to load assistants');
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth, filters, getSortParams, page, pageSize, setTotalItems]);

  // Load assistants when filters, sorting, or pagination change
  useEffect(() => {
    if (!paginationLoaded) return;

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      loadAssistants();
    }, 300);
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [loadAssistants, paginationLoaded]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [filters.values, sortConfig, setPage]);

  const createAssistant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAssistantName.trim()) return;

    setIsCreating(true);
    try {
      const response = await fetchWithAuth('/api/v1/assistants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newAssistantName,
          description: newAssistantDescription || undefined,
          avatar: newAssistantAvatar || undefined,
          model: newAssistantModel,
          settings: {
            temperature: newAssistantTemperature,
          },
        }),
      });
      const data = await response.json();
      if (data.success) {
        setAssistants((prev) => [data.data, ...prev]);
        setNewAssistantName('');
        setNewAssistantDescription('');
        setNewAssistantAvatar(null);
        setNewAssistantModel(DEFAULT_MODEL);
        setNewAssistantTemperature(DEFAULT_TEMPERATURE);
        toast({
          title: 'Assistant created',
          description: `${data.data.name} has been created successfully.`,
        });
      } else {
        setError(data.error?.message || 'Failed to create assistant');
      }
    } catch {
      setError('Failed to create assistant');
    } finally {
      setIsCreating(false);
    }
  };

  // Update assistant through edit dialog
  const updateAssistant = async (assistantId: string, data: Partial<Assistant>) => {
    const response = await fetchWithAuth(`/api/v1/assistants/${assistantId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (result.success) {
      setAssistants((prev) =>
        prev.map((a) => (a.id === assistantId ? { ...a, ...result.data } : a))
      );
      toast({
        title: 'Assistant updated',
        description: `${result.data.name} has been updated successfully.`,
      });
    } else {
      throw new Error(result.error?.message || 'Failed to update assistant');
    }
  };

  // Open edit dialog
  const openEditDialog = (assistant: Assistant) => {
    setEditingAssistant(assistant);
    setIsEditDialogOpen(true);
  };

  const deleteAssistant = async (id: string) => {
    try {
      const response = await fetchWithAuth(`/api/v1/assistants/${id}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setAssistants((prev) => prev.filter((a) => a.id !== id));
        toast({
          title: 'Assistant deleted',
          description: 'The assistant has been deleted successfully.',
        });
      }
    } catch {
      setError('Failed to delete assistant');
    }
  };

  const toggleAssistant = async (id: string, isActive: boolean) => {
    try {
      const response = await fetchWithAuth(`/api/v1/assistants/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive }),
      });
      const data = await response.json();
      if (data.success) {
        setAssistants((prev) =>
          prev.map((a) => (a.id === id ? { ...a, isActive: !isActive } : a))
        );
      }
    } catch {
      setError('Failed to update assistant');
    }
  };

  // Bulk activate assistants
  const bulkActivate = useCallback(
    async (assistantsToUpdate: Assistant[]) => {
      await Promise.allSettled(
        assistantsToUpdate.map((a) =>
          fetchWithAuth(`/api/v1/assistants/${a.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive: true }),
          })
        )
      );

      setAssistants((prev) =>
        prev.map((a) =>
          assistantsToUpdate.find((u) => u.id === a.id) ? { ...a, isActive: true } : a
        )
      );
      selection.deselectAll();
      toast({
        title: 'Assistants activated',
        description: `${assistantsToUpdate.length} assistant${assistantsToUpdate.length === 1 ? '' : 's'} activated.`,
      });
    },
    [fetchWithAuth, selection, toast]
  );

  // Bulk deactivate assistants
  const bulkDeactivate = useCallback(
    async (assistantsToUpdate: Assistant[]) => {
      await Promise.allSettled(
        assistantsToUpdate.map((a) =>
          fetchWithAuth(`/api/v1/assistants/${a.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive: false }),
          })
        )
      );

      setAssistants((prev) =>
        prev.map((a) =>
          assistantsToUpdate.find((u) => u.id === a.id) ? { ...a, isActive: false } : a
        )
      );
      selection.deselectAll();
      toast({
        title: 'Assistants deactivated',
        description: `${assistantsToUpdate.length} assistant${assistantsToUpdate.length === 1 ? '' : 's'} deactivated.`,
      });
    },
    [fetchWithAuth, selection, toast]
  );

  // Bulk delete assistants
  const bulkDeleteAssistants = useCallback(
    async (assistantsToDelete: Assistant[]) => {
      const ids = assistantsToDelete.map((a) => a.id);
      await Promise.allSettled(
        ids.map((id) =>
          fetchWithAuth(`/api/v1/assistants/${id}`, { method: 'DELETE' })
        )
      );

      setAssistants((prev) => prev.filter((a) => !ids.includes(a.id)));
      selection.deselectAll();
      toast({
        title: 'Assistants deleted',
        description: `${assistantsToDelete.length} assistant${assistantsToDelete.length === 1 ? '' : 's'} deleted.`,
      });
    },
    [fetchWithAuth, selection, toast]
  );

  // Bulk actions configuration
  const bulkActions: BulkAction<Assistant>[] = [
    {
      id: 'activate',
      label: 'Activate',
      icon: Power,
      variant: 'ghost',
      execute: bulkActivate,
    },
    {
      id: 'deactivate',
      label: 'Deactivate',
      icon: PowerOff,
      variant: 'ghost',
      execute: bulkDeactivate,
    },
    createDeleteAction(bulkDeleteAssistants, 'assistant'),
  ];

  const hasActiveFilters = filters.hasActiveFilters;

  if (isLoading) {
    return (
      <div className="flex flex-col h-[calc(100vh-3.5rem)]">
        {/* Page Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h1 className="text-lg font-semibold">Assistants</h1>
          <Button size="sm" disabled>
            <Plus className="h-4 w-4 mr-2" />
            New Assistant
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
        <h1 className="text-lg font-semibold">Assistants</h1>
        <Button size="sm" onClick={scrollToCreateForm}>
          <Plus className="h-4 w-4 mr-2" />
          New Assistant
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

      {/* Create Assistant Form */}
      <Card className="mb-8" ref={createFormRef}>
        <CardHeader>
          <CardTitle>Create New Assistant</CardTitle>
          <CardDescription>Configure a new AI assistant for your workspace</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={createAssistant} className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-6">
              {/* Avatar Upload */}
              <div className="flex-shrink-0">
                <Label className="block mb-2">Avatar (optional)</Label>
                <AvatarUpload
                  currentAvatarUrl={newAssistantAvatar}
                  fallback={newAssistantName?.charAt(0)?.toUpperCase() || '?'}
                  onUpload={async (url) => setNewAssistantAvatar(url)}
                  onRemove={async () => setNewAssistantAvatar(null)}
                  size="md"
                />
              </div>

              {/* Form Fields */}
              <div className="flex-1 space-y-4">
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={newAssistantName}
                    onChange={(e) => setNewAssistantName(e.target.value)}
                    placeholder="My Assistant"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="description">Description (optional)</Label>
                  <Textarea
                    id="description"
                    value={newAssistantDescription}
                    onChange={(e) => setNewAssistantDescription(e.target.value)}
                    placeholder="A helpful assistant for..."
                    className="resize-none"
                    rows={2}
                  />
                </div>
              </div>
            </div>

            {/* Model and Temperature */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="model">Model</Label>
                <Select value={newAssistantModel} onValueChange={setNewAssistantModel}>
                  <SelectTrigger id="model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ANTHROPIC_MODELS.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label htmlFor="temperature">Temperature</Label>
                  <span className="text-sm text-muted-foreground">{newAssistantTemperature.toFixed(1)}</span>
                </div>
                <Slider
                  id="temperature"
                  value={[newAssistantTemperature]}
                  min={MIN_TEMPERATURE}
                  max={MAX_TEMPERATURE}
                  step={TEMPERATURE_STEP}
                  onValueChange={([value]) => setNewAssistantTemperature(value)}
                  className="w-full"
                />
              </div>
            </div>

            <Button type="submit" disabled={isCreating || !newAssistantName.trim()}>
              {isCreating ? 'Creating...' : 'Create Assistant'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Search and Filters */}
      <div className="mb-6 space-y-4">
        {/* Search */}
        <SearchBar
          value={filters.values.search || ''}
          onChange={(value) => filters.updateFilter('search', value || undefined)}
          placeholder="Search assistants by name..."
        />

        {/* Filters and Sort Row */}
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-3 items-center">
            {/* Status Filter */}
            <SelectFilter
              value={filters.values.status || 'all'}
              onChange={(value) => filters.updateFilter('status', value === 'all' ? undefined : value)}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
              placeholder="All Status"
            />

            {/* Clear Filters */}
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={filters.clearAllFilters}>
                Clear filters
              </Button>
            )}
          </div>

          {/* Sort Controls */}
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
            <SortableHeader
              column="updatedAt"
              label="Updated"
              sortConfig={sortConfig}
              onSort={handleSort}
            />
          </div>
        </div>
      </div>

      {/* Bulk Actions Toolbar */}
      {assistants.length > 0 && (
        <BulkActionsToolbar
          selectedCount={selection.selectedCount}
          totalCount={assistants.length}
          onSelectAll={() => selection.selectAll(assistants)}
          onDeselectAll={selection.deselectAll}
          actions={bulkActions}
          selectedItems={selection.getSelectedItems(assistants)}
          onActionComplete={loadAssistants}
        />
      )}

      {/* Assistants List */}
      {assistants.length === 0 ? (
        hasActiveFilters ? (
          <EmptySearchResultsState
            query={filters.values.search || ''}
            onClear={filters.clearAllFilters}
          />
        ) : (
          <EmptyAssistantsState onCreate={scrollToCreateForm} />
        )
      ) : (
        <>
          <div className="space-y-3">
            {assistants.map((assistant) => (
              <Card key={assistant.id}>
                <CardContent className="flex items-center gap-3 p-4">
                  <SelectableItemCheckbox
                    checked={selection.isSelected(assistant.id)}
                    onChange={() => selection.toggle(assistant.id)}
                  />
                  <div className="flex items-center gap-4 flex-1">
                    {/* Assistant Avatar */}
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={assistant.avatar || undefined} alt={assistant.name} />
                      <AvatarFallback className="bg-muted">
                        {assistant.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground font-medium truncate">{assistant.name}</span>
                        {!assistant.isActive && (
                          <Badge variant="default">Inactive</Badge>
                        )}
                      </div>
                      {assistant.description && (
                        <p className="text-sm text-muted-foreground mt-1 truncate">{assistant.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        {getModelDisplayName(assistant.model)}
                        {assistant.settings?.temperature !== undefined && ` | T: ${assistant.settings.temperature.toFixed(1)}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditDialog(assistant)}
                    >
                      <Pencil className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleAssistant(assistant.id, assistant.isActive)}
                    >
                      {assistant.isActive ? 'Deactivate' : 'Activate'}
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
                          <AlertDialogTitle>Delete assistant?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete this assistant? This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteAssistant(assistant.id)}>
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

          {/* Pagination */}
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
      <AssistantEditDialog
        assistant={editingAssistant}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        onSave={updateAssistant}
      />
    </div>
  );
}
