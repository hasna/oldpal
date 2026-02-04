'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { AlertCircle, Pencil, Check, X, Bot, Plus } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptySessionsState, EmptySearchResultsState } from '@/components/shared/EmptyState';
import {
  BulkActionsToolbar,
  SelectableItemCheckbox,
  useSelection,
  createDeleteAction,
  createExportAction,
  type BulkAction,
} from '@/components/shared/BulkActions';
import {
  SearchBar,
  SelectFilter,
  DateRangeFilter,
  useFilters,
} from '@/components/shared/ListFilters';
import {
  SortableHeader,
  PaginationControls,
  useSorting,
  usePagination,
} from '@/components/shared/DataTable';

interface Session {
  id: string;
  label: string | null;
  createdAt: string;
  updatedAt: string;
  agent?: {
    id: string;
    name: string;
    avatar: string | null;
  } | null;
}

interface Agent {
  id: string;
  name: string;
}

type SessionFilters = {
  search: string | undefined;
  agentId: string | undefined;
  startDate: string | undefined;
  endDate: string | undefined;
} & Record<string, string | undefined>;

export default function SessionsPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Sorting state
  const { sortConfig, handleSort, getSortParams } = useSorting({ column: 'updatedAt', direction: 'desc' });

  // Pagination state
  const { page, setPage, pageSize, setPageSize, totalItems, setTotalItems, totalPages, loaded: paginationLoaded } = usePagination(20);

  // Filter state
  const filters = useFilters<SessionFilters>({
    search: undefined,
    agentId: undefined,
    startDate: undefined,
    endDate: undefined,
  });

  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Editing state
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  // Selection state for bulk actions
  const selection = useSelection<Session>();

  const loadAgents = useCallback(async () => {
    try {
      const response = await fetchWithAuth('/api/v1/agents');
      const data = await response.json();
      if (data.success) {
        setAgents(data.data.items || []);
      }
    } catch {
      // Silently fail - agents filter is optional
    }
  }, [fetchWithAuth]);

  const loadSessions = useCallback(async () => {
    setError('');
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

      const url = `/api/v1/sessions${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await fetchWithAuth(url);
      const data = await response.json();
      if (data.success) {
        setSessions(data.data.items);
        setTotalItems(data.data.total || 0);
      } else {
        setError(data.error?.message || 'Failed to load sessions');
      }
    } catch {
      setError('Failed to load sessions');
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth, filters, getSortParams, page, pageSize, setTotalItems]);

  // Load agents on mount
  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  // Load sessions when filters, sorting, or pagination change
  useEffect(() => {
    if (!paginationLoaded) return;

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      loadSessions();
    }, 300);
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [loadSessions, paginationLoaded]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [filters.values, sortConfig, setPage]);

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingSessionId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingSessionId]);

  const startEditing = (session: Session) => {
    setEditingSessionId(session.id);
    setEditingLabel(session.label || '');
  };

  const cancelEditing = () => {
    setEditingSessionId(null);
    setEditingLabel('');
  };

  const saveLabel = async (sessionId: string) => {
    try {
      const response = await fetchWithAuth(`/api/v1/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: editingLabel || null }),
      });
      const data = await response.json();
      if (data.success) {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, label: editingLabel || null } : s))
        );
        toast({
          title: 'Session renamed',
          description: 'The session name has been updated.',
        });
      } else {
        toast({
          title: 'Error',
          description: data.error?.message || 'Failed to rename session',
          variant: 'destructive',
        });
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to rename session',
        variant: 'destructive',
      });
    } finally {
      setEditingSessionId(null);
      setEditingLabel('');
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent, sessionId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveLabel(sessionId);
    } else if (e.key === 'Escape') {
      cancelEditing();
    }
  };

  const clearFilters = () => {
    filters.clearAllFilters();
  };

  const hasActiveFilters = filters.hasActiveFilters;

  const deleteSession = async (id: string) => {
    try {
      const response = await fetchWithAuth(`/api/v1/sessions/${id}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
        toast({
          title: 'Session deleted',
          description: 'The session has been deleted successfully.',
        });
      }
    } catch {
      setError('Failed to delete session');
    }
  };

  // Bulk delete sessions
  const bulkDeleteSessions = useCallback(
    async (sessionsToDelete: Session[]) => {
      const ids = sessionsToDelete.map((s) => s.id);
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetchWithAuth(`/api/v1/sessions/${id}`, { method: 'DELETE' })
        )
      );

      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      const failCount = results.length - successCount;

      setSessions((prev) => prev.filter((s) => !ids.includes(s.id)));
      selection.deselectAll();

      if (failCount === 0) {
        toast({
          title: 'Sessions deleted',
          description: `Successfully deleted ${successCount} session${successCount === 1 ? '' : 's'}.`,
        });
      } else {
        toast({
          title: 'Partial success',
          description: `Deleted ${successCount} session${successCount === 1 ? '' : 's'}, ${failCount} failed.`,
          variant: 'destructive',
        });
      }
    },
    [fetchWithAuth, toast, selection]
  );

  // Bulk export sessions
  const bulkExportSessions = useCallback(
    async (sessionsToExport: Session[]) => {
      const exportData = sessionsToExport.map((s) => ({
        id: s.id,
        label: s.label,
        agent: s.agent?.name || null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }));

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sessions-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: 'Export complete',
        description: `Exported ${sessionsToExport.length} session${sessionsToExport.length === 1 ? '' : 's'}.`,
      });
    },
    [toast]
  );

  // Bulk actions configuration
  const bulkActions: BulkAction<Session>[] = [
    createDeleteAction(bulkDeleteSessions, 'session'),
    createExportAction(bulkExportSessions, 'session'),
  ];

  if (isLoading) {
    return (
      <div className="flex flex-col h-[calc(100vh-3.5rem)]">
        {/* Page Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h1 className="text-lg font-semibold">Sessions</h1>
          <Button size="sm" asChild>
            <Link href="/chat">
              <Plus className="h-4 w-4 mr-2" />
              New Session
            </Link>
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto space-y-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex-1">
                    <Skeleton className="h-5 w-48 mb-2" />
                    <Skeleton className="h-4 w-64" />
                  </div>
                  <Skeleton className="h-8 w-16" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Page Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h1 className="text-lg font-semibold">Sessions</h1>
        <Button size="sm" asChild>
          <Link href="/chat">
            <Plus className="h-4 w-4 mr-2" />
            New Session
          </Link>
        </Button>
      </div>

      {/* Page Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          {/* Search and Filters */}
      <div className="mb-6 space-y-4">
        {/* Search */}
        <SearchBar
          value={filters.values.search || ''}
          onChange={(value) => filters.updateFilter('search', value || undefined)}
          placeholder="Search sessions by name or message content..."
        />

        {/* Filters and Sort Row */}
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-3 items-center">
            {/* Agent Filter */}
            <SelectFilter
              value={filters.values.agentId || 'all'}
              onChange={(value) => filters.updateFilter('agentId', value === 'all' ? undefined : value)}
              options={agents.map((a) => ({ value: a.id, label: a.name }))}
              placeholder="All Agents"
              icon={<Bot className="h-4 w-4 text-muted-foreground" />}
            />

            {/* Date Range */}
            <DateRangeFilter
              startDate={filters.values.startDate || ''}
              endDate={filters.values.endDate || ''}
              onStartDateChange={(date) => filters.updateFilter('startDate', date || undefined)}
              onEndDateChange={(date) => filters.updateFilter('endDate', date || undefined)}
            />

            {/* Clear Filters */}
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>

          {/* Sort Controls */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Sort by:</span>
            <SortableHeader
              column="label"
              label="Name"
              sortConfig={sortConfig}
              onSort={handleSort}
            />
            <SortableHeader
              column="updatedAt"
              label="Updated"
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

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Bulk Actions Toolbar */}
      {sessions.length > 0 && (
        <BulkActionsToolbar
          selectedCount={selection.selectedCount}
          totalCount={sessions.length}
          onSelectAll={() => selection.selectAll(sessions)}
          onDeselectAll={selection.deselectAll}
          actions={bulkActions}
          selectedItems={selection.getSelectedItems(sessions)}
          onActionComplete={loadSessions}
        />
      )}

      {sessions.length === 0 ? (
        hasActiveFilters ? (
          <EmptySearchResultsState
            query={filters.values.search || ''}
            onClear={clearFilters}
          />
        ) : (
          <EmptySessionsState />
        )
      ) : (
        <>
          <div className="space-y-3">
            {sessions.map((session) => (
              <Card key={session.id}>
                <CardContent className="flex items-center gap-3 p-4">
                  <SelectableItemCheckbox
                    checked={selection.isSelected(session.id)}
                    onChange={() => selection.toggle(session.id)}
                  />
                  <div className="flex-1">
                    {editingSessionId === session.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          ref={editInputRef}
                          type="text"
                          value={editingLabel}
                          onChange={(e) => setEditingLabel(e.target.value)}
                          onKeyDown={(e) => handleEditKeyDown(e, session.id)}
                          placeholder="Session name"
                          className="w-64"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => saveLabel(session.id)}
                          className="text-green-600 hover:text-green-500"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={cancelEditing}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 group">
                        <Link
                          href={`/chat?session=${session.id}`}
                          className="text-foreground hover:text-primary transition-colors font-medium"
                        >
                          {session.label || 'Untitled Session'}
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startEditing(session)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground h-6 w-6 p-0"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                    <p className="text-sm text-muted-foreground mt-1">
                      {new Date(session.updatedAt).toLocaleDateString()} at{' '}
                      {new Date(session.updatedAt).toLocaleTimeString()}
                      {session.agent && (
                        <span className="ml-2">
                          Agent: {session.agent.name}
                        </span>
                      )}
                    </p>
                  </div>
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
                        <AlertDialogTitle>Delete session?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete this session? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteSession(session.id)}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
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
    </div>
  );
}
