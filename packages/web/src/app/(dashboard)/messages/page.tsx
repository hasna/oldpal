'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/Button';
import { ThreadDetailDialog } from '@/components/messages/ThreadDetailDialog';
import { MessageSquare, Archive, Check, Trash2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyMessagesState, EmptySearchResultsState } from '@/components/shared/EmptyState';
import {
  BulkActionsToolbar,
  SelectableItemCheckbox,
  useSelection,
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

interface AssistantMessage {
  id: string;
  threadId: string;
  subject: string | null;
  body: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'unread' | 'read' | 'archived' | 'injected';
  createdAt: string;
  readAt: string | null;
}

type MessageFilters = {
  search: string | undefined;
  status: string | undefined;
  priority: string | undefined;
} & Record<string, string | undefined>;

export default function MessagesPage() {
  const { fetchWithAuth } = useAuth();
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedThread, setSelectedThread] = useState<{
    threadId: string;
    subject: string | null;
  } | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sorting state
  const { sortConfig, handleSort, getSortParams } = useSorting({ column: 'createdAt', direction: 'desc' });

  // Pagination state
  const { page, setPage, pageSize, setPageSize, totalItems, setTotalItems, totalPages, loaded: paginationLoaded } = usePagination(20);

  // Filter state
  const filters = useFilters<MessageFilters>({
    search: undefined,
    status: undefined,
    priority: undefined,
  });

  // Selection state for bulk actions
  const selection = useSelection<AssistantMessage>();

  const loadMessages = useCallback(async () => {
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

      const response = await fetchWithAuth(`/api/v1/messages?${params}`);
      const data = await response.json();
      if (data.success) {
        setMessages(data.data.items);
        setTotalItems(data.data.total || 0);
      } else {
        setError(data.error?.message || 'Failed to load messages');
      }
    } catch {
      setError('Failed to load messages');
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth, filters, getSortParams, page, pageSize, setTotalItems]);

  // Load messages when filters, sorting, or pagination change
  useEffect(() => {
    if (!paginationLoaded) return;

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      loadMessages();
    }, 300);
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [loadMessages, paginationLoaded]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [filters.values, sortConfig, setPage]);

  const markAsRead = async (id: string) => {
    try {
      const response = await fetchWithAuth(`/api/v1/messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'read' }),
      });
      const data = await response.json();
      if (data.success) {
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, status: 'read', readAt: new Date().toISOString() } : m))
        );
      }
    } catch {
      setError('Failed to update message');
    }
  };

  const archiveMessage = async (id: string) => {
    try {
      const response = await fetchWithAuth(`/api/v1/messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      });
      const data = await response.json();
      if (data.success) {
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, status: 'archived' } : m))
        );
      }
    } catch {
      setError('Failed to archive message');
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'text-red-600';
      case 'high':
        return 'text-orange-600';
      case 'low':
        return 'text-muted-foreground/60';
      default:
        return 'text-muted-foreground';
    }
  };

  // Bulk mark as read
  const bulkMarkAsRead = useCallback(
    async (messagesToUpdate: AssistantMessage[]) => {
      const results = await Promise.allSettled(
        messagesToUpdate.map((m) =>
          fetchWithAuth(`/api/v1/messages/${m.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'read' }),
          })
        )
      );

      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      setMessages((prev) =>
        prev.map((m) =>
          messagesToUpdate.find((u) => u.id === m.id)
            ? { ...m, status: 'read', readAt: new Date().toISOString() }
            : m
        )
      );
      selection.deselectAll();

      if (successCount === messagesToUpdate.length) {
        // All succeeded
      }
    },
    [fetchWithAuth, selection]
  );

  // Bulk archive
  const bulkArchive = useCallback(
    async (messagesToArchive: AssistantMessage[]) => {
      const results = await Promise.allSettled(
        messagesToArchive.map((m) =>
          fetchWithAuth(`/api/v1/messages/${m.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'archived' }),
          })
        )
      );

      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      setMessages((prev) =>
        prev.map((m) =>
          messagesToArchive.find((u) => u.id === m.id)
            ? { ...m, status: 'archived' }
            : m
        )
      );
      selection.deselectAll();

      if (successCount === messagesToArchive.length) {
        // All succeeded
      }
    },
    [fetchWithAuth, selection]
  );

  // Bulk delete
  const bulkDelete = useCallback(
    async (messagesToDelete: AssistantMessage[]) => {
      const ids = messagesToDelete.map((m) => m.id);
      await Promise.allSettled(
        ids.map((id) =>
          fetchWithAuth(`/api/v1/messages/${id}`, { method: 'DELETE' })
        )
      );

      setMessages((prev) => prev.filter((m) => !ids.includes(m.id)));
      selection.deselectAll();
    },
    [fetchWithAuth, selection]
  );

  // Bulk actions configuration
  const bulkActions: BulkAction<AssistantMessage>[] = [
    {
      id: 'mark-read',
      label: 'Mark as read',
      icon: Check,
      variant: 'ghost',
      execute: bulkMarkAsRead,
    },
    {
      id: 'archive',
      label: 'Archive',
      icon: Archive,
      variant: 'ghost',
      execute: bulkArchive,
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: Trash2,
      variant: 'destructive',
      requiresConfirmation: true,
      confirmTitle: 'Delete selected messages?',
      confirmDescription: 'Are you sure you want to delete the selected messages? This action cannot be undone.',
      execute: bulkDelete,
    },
  ];

  const hasActiveFilters = filters.hasActiveFilters;

  if (isLoading) {
    return (
      <div className="flex flex-col h-[calc(100vh-3.5rem)]">
        {/* Page Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h1 className="text-lg font-semibold">Messages</h1>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto space-y-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <Skeleton className="h-5 w-48 mb-2" />
                  <Skeleton className="h-4 w-full mb-1" />
                  <Skeleton className="h-3 w-32" />
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
        <h1 className="text-lg font-semibold">Messages</h1>
      </div>

      {/* Page Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          {/* Search and Filters */}
      <div className="mb-6 space-y-4">
        <SearchBar
          value={filters.values.search || ''}
          onChange={(value) => filters.updateFilter('search', value || undefined)}
          placeholder="Search messages by subject or content..."
        />

        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-3 items-center">
            <SelectFilter
              value={filters.values.status || 'all'}
              onChange={(value) => filters.updateFilter('status', value === 'all' ? undefined : value)}
              options={[
                { value: 'unread', label: 'Unread' },
                { value: 'read', label: 'Read' },
                { value: 'archived', label: 'Archived' },
              ]}
              placeholder="All Status"
            />

            <SelectFilter
              value={filters.values.priority || 'all'}
              onChange={(value) => filters.updateFilter('priority', value === 'all' ? undefined : value)}
              options={[
                { value: 'urgent', label: 'Urgent' },
                { value: 'high', label: 'High' },
                { value: 'normal', label: 'Normal' },
                { value: 'low', label: 'Low' },
              ]}
              placeholder="All Priorities"
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
              column="createdAt"
              label="Date"
              sortConfig={sortConfig}
              onSort={handleSort}
            />
            <SortableHeader
              column="priority"
              label="Priority"
              sortConfig={sortConfig}
              onSort={handleSort}
            />
            <SortableHeader
              column="status"
              label="Status"
              sortConfig={sortConfig}
              onSort={handleSort}
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Bulk Actions Toolbar */}
      {messages.length > 0 && (
        <BulkActionsToolbar
          selectedCount={selection.selectedCount}
          totalCount={messages.length}
          onSelectAll={() => selection.selectAll(messages)}
          onDeselectAll={selection.deselectAll}
          actions={bulkActions}
          selectedItems={selection.getSelectedItems(messages)}
          onActionComplete={loadMessages}
        />
      )}

      {messages.length === 0 ? (
        hasActiveFilters ? (
          <EmptySearchResultsState
            query={filters.values.search || ''}
            onClear={filters.clearAllFilters}
          />
        ) : (
          <EmptyMessagesState />
        )
      ) : (
        <>
          <div className="space-y-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex items-start gap-3 p-4 rounded-lg border bg-card hover:shadow-md transition-shadow ${
                  message.status === 'unread' ? 'border-primary/30' : 'border-border'
                }`}
              >
                <SelectableItemCheckbox
                  checked={selection.isSelected(message.id)}
                  onChange={() => selection.toggle(message.id)}
                />
                <div
                  className="flex-1 cursor-pointer"
                  onClick={() =>
                    setSelectedThread({
                      threadId: message.threadId,
                      subject: message.subject,
                    })
                  }
                >
                  <div className="flex items-center gap-2">
                    {message.status === 'unread' && (
                      <span className="w-2 h-2 rounded-full bg-primary"></span>
                    )}
                    <span className="text-foreground font-medium">
                      {message.subject || 'No subject'}
                    </span>
                    <span className={`text-xs ${getPriorityColor(message.priority)}`}>
                      {message.priority}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{message.body}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <p className="text-xs text-muted-foreground">
                      {new Date(message.createdAt).toLocaleString()}
                    </p>
                    <span className="text-xs text-primary flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      View thread
                    </span>
                  </div>
                </div>
                <div
                  className="flex items-center gap-2 ml-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  {message.status === 'unread' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => markAsRead(message.id)}
                    >
                      Mark Read
                    </Button>
                  )}
                  {message.status !== 'archived' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => archiveMessage(message.id)}
                    >
                      Archive
                    </Button>
                  )}
                </div>
              </div>
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

          {/* Thread Detail Dialog */}
          <ThreadDetailDialog
            threadId={selectedThread?.threadId || null}
            initialSubject={selectedThread?.subject}
            onClose={() => setSelectedThread(null)}
            onMessageUpdate={loadMessages}
          />
        </div>
      </div>
    </div>
  );
}
