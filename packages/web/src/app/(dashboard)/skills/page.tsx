'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Sparkles, AlertCircle, RefreshCcw } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
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
import { SkillCard, type Skill } from '@/components/skills/SkillCard';
import { SkillDetailDrawer } from '@/components/skills/SkillDetailDrawer';

type SkillFilters = {
  search: string | undefined;
  category: string | undefined;
  userInvocableOnly: string | undefined;
} & Record<string, string | undefined>;

export default function SkillsPage() {
  const { fetchWithAuth } = useAuth();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Pagination state
  const { page, setPage, pageSize, setPageSize, totalItems, setTotalItems, totalPages, loaded: paginationLoaded } = usePagination(24);

  // Filter state
  const filters = useFilters<SkillFilters>({
    search: undefined,
    category: undefined,
    userInvocableOnly: undefined,
  });

  const loadSkills = useCallback(async () => {
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

      const url = `/api/v1/skills${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await fetchWithAuth(url);
      const data = await response.json();
      if (data.success) {
        setSkills(data.data.items);
        setTotalItems(data.data.total || 0);
        if (data.data.categories) {
          setCategories(data.data.categories);
        }
      } else {
        setError(data.error?.message || 'Failed to load skills');
      }
    } catch {
      setError('Failed to load skills');
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth, filters, page, pageSize, setTotalItems]);

  // Load skills when filters or pagination change
  useEffect(() => {
    if (!paginationLoaded) return;

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      loadSkills();
    }, 300);
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [loadSkills, paginationLoaded]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [filters.values, setPage]);

  const handleSkillClick = (skill: Skill) => {
    setSelectedSkill(skill);
    setIsDrawerOpen(true);
  };

  const hasActiveFilters = filters.hasActiveFilters;

  if (isLoading) {
    return (
      <div className="flex flex-col h-[calc(100vh-3.5rem)]">
        {/* Page Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">Skills</h1>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-6xl mx-auto">
            {/* Search skeleton */}
            <Skeleton className="h-10 w-full mb-6" />
            {/* Grid skeleton */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton key={i} className="h-36" />
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
          <Sparkles className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Skills</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => loadSkills()} disabled={isLoading}>
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
              placeholder="Search skills by name or description..."
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

              {/* User Invocable Filter */}
              <SelectFilter
                value={filters.values.userInvocableOnly || 'all'}
                onChange={(value) => filters.updateFilter('userInvocableOnly', value === 'all' ? undefined : value)}
                options={[
                  { value: 'true', label: 'User Invocable Only' },
                ]}
                placeholder="All Skills"
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

          {/* Skills Grid */}
          {skills.length === 0 ? (
            hasActiveFilters ? (
              <EmptySearchResultsState
                query={filters.values.search || ''}
                onClear={filters.clearAllFilters}
              />
            ) : (
              <EmptyDataState
                title="No skills available"
                description="Skills will appear here when they are configured. Create SKILL.md files in ~/.assistants/shared/skills/ or .assistants/skills/ to add skills."
              />
            )
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {skills.map((skill) => (
                  <SkillCard
                    key={skill.name}
                    skill={skill}
                    onClick={() => handleSkillClick(skill)}
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

      {/* Skill Detail Drawer */}
      <SkillDetailDrawer
        skill={selectedSkill}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      />
    </div>
  );
}
