'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Wrench, AlertCircle, RefreshCcw } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/Button';
import { EmptySearchResultsState, EmptyDataState } from '@/components/shared/EmptyState';
import {
  SearchBar,
  SelectFilter,
  useFilters,
} from '@/components/shared/ListFilters';
import {
  PaginationControls,
  usePagination,
} from '@/components/shared/DataTable';
import { ToolCard, type Tool } from '@/components/tools/ToolCard';
import { ToolDetailDrawer } from '@/components/tools/ToolDetailDrawer';

type ToolFilters = {
  search: string | undefined;
  category: string | undefined;
} & Record<string, string | undefined>;

export default function ToolsPage() {
  const { fetchWithAuth } = useAuth();
  const [tools, setTools] = useState<Tool[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Pagination state
  const { page, setPage, pageSize, setPageSize, totalItems, setTotalItems, totalPages, loaded: paginationLoaded } = usePagination(24);

  // Filter state
  const filters = useFilters<ToolFilters>({
    search: undefined,
    category: undefined,
  });

  const loadTools = useCallback(async () => {
    setError('');
    try {
      const params = new URLSearchParams();

      // Add filter params
      const filterParams = filters.getFilterParams();
      Object.entries(filterParams).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });

      // Add pagination params
      params.set('page', String(page));
      params.set('limit', String(pageSize));

      const url = `/api/v1/tools${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await fetchWithAuth(url);
      const data = await response.json();
      if (data.success) {
        setTools(data.data.items);
        setTotalItems(data.data.total || 0);
        if (data.data.categories) {
          setCategories(data.data.categories);
        }
      } else {
        setError(data.error?.message || 'Failed to load tools');
      }
    } catch {
      setError('Failed to load tools');
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth, filters, page, pageSize, setTotalItems]);

  // Load tools when filters or pagination change
  useEffect(() => {
    if (!paginationLoaded) return;

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      loadTools();
    }, 300);
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [loadTools, paginationLoaded]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [filters.values, setPage]);

  const handleToolClick = (tool: Tool) => {
    setSelectedTool(tool);
    setIsDrawerOpen(true);
  };

  const hasActiveFilters = filters.hasActiveFilters;

  if (isLoading) {
    return (
      <div className="flex flex-col h-[calc(100vh-3.5rem)]">
        {/* Page Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">Tools</h1>
          </div>
          <Button variant="outline" size="sm" disabled>
            <RefreshCcw className="h-4 w-4 mr-2 animate-spin" />
            Refresh
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-6xl mx-auto">
            {/* Search skeleton */}
            <Skeleton className="h-10 w-full mb-6" />
            {/* Grid skeleton */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton key={i} className="h-32" />
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
        <div className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Tools</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => loadTools()}
          disabled={isLoading}
        >
          <RefreshCcw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Page Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto">
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Search and Filters */}
          <div className="mb-6 space-y-4">
            {/* Search */}
            <SearchBar
              value={filters.values.search || ''}
              onChange={(value) => filters.updateFilter('search', value || undefined)}
              placeholder="Search tools by name or description..."
            />

            {/* Filters Row */}
            <div className="flex flex-wrap gap-3 items-center">
              {/* Category Filter */}
              <SelectFilter
                value={filters.values.category || 'all'}
                onChange={(value) => filters.updateFilter('category', value === 'all' ? undefined : value)}
                options={categories.map((cat) => ({ value: cat, label: cat.charAt(0).toUpperCase() + cat.slice(1) }))}
                placeholder="All Categories"
              />

              {/* Clear Filters */}
              {hasActiveFilters && (
                <button
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  onClick={filters.clearAllFilters}
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {/* Tools Grid */}
          {tools.length === 0 ? (
            hasActiveFilters ? (
              <EmptySearchResultsState
                query={filters.values.search || ''}
                onClear={filters.clearAllFilters}
              />
            ) : (
              <EmptyDataState
                title="No tools available"
                description="Tools will appear here when they are configured in the system."
              />
            )
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {tools.map((tool) => (
                  <ToolCard
                    key={tool.name}
                    tool={tool}
                    onClick={() => handleToolClick(tool)}
                  />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-6">
                  <PaginationControls
                    page={page}
                    totalPages={totalPages}
                    pageSize={pageSize}
                    totalItems={totalItems}
                    onPageChange={setPage}
                    onPageSizeChange={setPageSize}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Tool Detail Drawer */}
      <ToolDetailDrawer
        tool={selectedTool}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      />
    </div>
  );
}
