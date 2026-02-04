'use client';

import { useState, useEffect, useCallback } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
  column: string;
  direction: SortDirection;
}

export interface ColumnDef<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render?: (item: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
}

interface SortableHeaderProps {
  column: string;
  label: string;
  sortConfig: SortConfig | null;
  onSort: (column: string) => void;
  className?: string;
}

export function SortableHeader({
  column,
  label,
  sortConfig,
  onSort,
  className,
}: SortableHeaderProps) {
  const isActive = sortConfig?.column === column;
  const direction = isActive ? sortConfig.direction : null;

  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className={cn(
        'flex items-center gap-1 hover:text-foreground transition-colors font-medium text-muted-foreground',
        isActive && 'text-foreground',
        className
      )}
    >
      {label}
      {direction === 'asc' ? (
        <ArrowUp className="h-4 w-4" />
      ) : direction === 'desc' ? (
        <ArrowDown className="h-4 w-4" />
      ) : (
        <ArrowUpDown className="h-4 w-4 opacity-50" />
      )}
    </button>
  );
}

interface PaginationControlsProps {
  page: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
}

export function PaginationControls({
  page,
  totalPages,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
}: PaginationControlsProps) {
  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, totalItems);

  return (
    <div className="flex items-center justify-between px-2 py-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Showing</span>
        <Select
          value={String(pageSize)}
          onValueChange={(value) => onPageSizeChange(Number(value))}
        >
          <SelectTrigger className="h-8 w-[70px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span>per page</span>
        {totalItems > 0 && (
          <span className="ml-2">
            • {startItem}-{endItem} of {totalItems}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {page} of {totalPages || 1}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// Hook for managing sort state
export function useSorting(defaultSort?: SortConfig) {
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(defaultSort || null);

  const handleSort = useCallback((column: string) => {
    setSortConfig((current) => {
      if (current?.column === column) {
        // Toggle direction or clear if already desc
        if (current.direction === 'asc') {
          return { column, direction: 'desc' };
        }
        return null; // Clear sorting
      }
      // New column, start with asc
      return { column, direction: 'asc' };
    });
  }, []);

  const getSortParams = useCallback(() => {
    if (!sortConfig) return {};
    return {
      sortBy: sortConfig.column,
      sortDir: sortConfig.direction,
    };
  }, [sortConfig]);

  return {
    sortConfig,
    handleSort,
    getSortParams,
    setSortConfig,
  };
}

// Hook for managing pagination state with localStorage persistence
const PAGE_SIZE_KEY = 'data-table-page-size';

export function usePagination(defaultPageSize = 20) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [totalItems, setTotalItems] = useState(0);
  const [loaded, setLoaded] = useState(false);

  // Load page size from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(PAGE_SIZE_KEY);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed > 0) {
        setPageSize(parsed);
      }
    }
    setLoaded(true);
  }, []);

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setPage(1); // Reset to first page when changing page size
    localStorage.setItem(PAGE_SIZE_KEY, String(size));
  }, []);

  const totalPages = Math.ceil(totalItems / pageSize);

  const getPaginationParams = useCallback(() => {
    return {
      page,
      limit: pageSize,
    };
  }, [page, pageSize]);

  return {
    page,
    setPage,
    pageSize,
    setPageSize: handlePageSizeChange,
    totalItems,
    setTotalItems,
    totalPages,
    getPaginationParams,
    loaded,
  };
}

// Hook combining sort, pagination, and URL state
export function useDataTableState(options?: {
  defaultSort?: SortConfig;
  defaultPageSize?: number;
  syncToUrl?: boolean;
}) {
  const sorting = useSorting(options?.defaultSort);
  const pagination = usePagination(options?.defaultPageSize);

  // Build query params for API calls
  const getQueryParams = useCallback(() => {
    return {
      ...pagination.getPaginationParams(),
      ...sorting.getSortParams(),
    };
  }, [pagination, sorting]);

  // Build URL search params
  const getSearchParams = useCallback(() => {
    const params = new URLSearchParams();
    const queryParams = getQueryParams();

    Object.entries(queryParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    });

    return params;
  }, [getQueryParams]);

  return {
    ...sorting,
    ...pagination,
    getQueryParams,
    getSearchParams,
  };
}

// Sort data client-side (for small datasets)
export function sortData<T>(
  data: T[],
  sortConfig: SortConfig | null,
  getValueForColumn: (item: T, column: string) => string | number | Date | null
): T[] {
  if (!sortConfig) return data;

  return [...data].sort((a, b) => {
    const aVal = getValueForColumn(a, sortConfig.column);
    const bVal = getValueForColumn(b, sortConfig.column);

    // Handle null values
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return sortConfig.direction === 'asc' ? 1 : -1;
    if (bVal === null) return sortConfig.direction === 'asc' ? -1 : 1;

    // Compare values
    let comparison = 0;
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      comparison = aVal.localeCompare(bVal);
    } else if (aVal instanceof Date && bVal instanceof Date) {
      comparison = aVal.getTime() - bVal.getTime();
    } else {
      comparison = Number(aVal) - Number(bVal);
    }

    return sortConfig.direction === 'asc' ? comparison : -comparison;
  });
}

// Column skeleton configuration
export interface SkeletonColumnDef {
  width: string;  // Tailwind width class (e.g., 'w-48', 'w-32', 'w-16')
  height?: string; // Optional height class (defaults to 'h-4')
}

interface TableRowSkeletonProps {
  columns: SkeletonColumnDef[];
  className?: string;
}

export function TableRowSkeleton({ columns, className }: TableRowSkeletonProps) {
  return (
    <TableRow className={className}>
      {columns.map((col, index) => (
        <TableCell key={index}>
          <Skeleton className={cn(col.height || 'h-4', col.width)} />
        </TableCell>
      ))}
    </TableRow>
  );
}

interface TableSkeletonProps {
  columns: SkeletonColumnDef[];
  headers?: string[];
  rowCount?: number;
  className?: string;
}

export function TableSkeleton({
  columns,
  headers,
  rowCount = 5,
  className,
}: TableSkeletonProps) {
  return (
    <Table className={className}>
      {headers && headers.length > 0 && (
        <TableHeader>
          <TableRow>
            {headers.map((header, index) => (
              <TableHead key={index}>{header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
      )}
      <TableBody>
        {Array.from({ length: rowCount }).map((_, i) => (
          <TableRowSkeleton key={i} columns={columns} />
        ))}
      </TableBody>
    </Table>
  );
}

// Pre-configured skeleton layouts for common table patterns
export const SKELETON_COLUMNS = {
  // Admin users table: Email, Name, Role, Status, Created, Actions
  adminUsers: [
    { width: 'w-48' },      // Email
    { width: 'w-32' },      // Name
    { width: 'w-16', height: 'h-5' },  // Role badge
    { width: 'w-16', height: 'h-5' },  // Status badge
    { width: 'w-24' },      // Created date
    { width: 'w-8', height: 'h-8' },   // Actions button
  ] as SkeletonColumnDef[],

  // Admin audit table: Toggle, Action, Admin, Target, IP, Date
  adminAudit: [
    { width: 'w-4' },       // Expand toggle
    { width: 'w-24', height: 'h-5' },  // Action badge
    { width: 'w-32' },      // Admin info
    { width: 'w-24' },      // Target
    { width: 'w-24' },      // IP Address
    { width: 'w-32' },      // Date
  ] as SkeletonColumnDef[],

  // Sessions table: Label, Agent, Created, Updated, Actions
  sessions: [
    { width: 'w-48' },      // Label
    { width: 'w-24' },      // Agent
    { width: 'w-32' },      // Created
    { width: 'w-32' },      // Updated
    { width: 'w-8', height: 'h-8' },   // Actions
  ] as SkeletonColumnDef[],

  // Agents table: Name, Description, Model, Sessions, Actions
  agents: [
    { width: 'w-32' },      // Name
    { width: 'w-48' },      // Description
    { width: 'w-20' },      // Model
    { width: 'w-16' },      // Sessions
    { width: 'w-8', height: 'h-8' },   // Actions
  ] as SkeletonColumnDef[],

  // Billing/invoices table: Date, Amount, Status, Actions
  invoices: [
    { width: 'w-32' },      // Date
    { width: 'w-24' },      // Amount
    { width: 'w-20', height: 'h-5' },  // Status badge
    { width: 'w-24' },      // Actions/link
  ] as SkeletonColumnDef[],
} as const;

// Empty state component
interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export function DataTableEmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon && <div className="mb-4 text-muted-foreground">{icon}</div>}
      <h3 className="text-lg font-medium">{title}</h3>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// Main DataTable component that combines everything
interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  isLoading?: boolean;
  error?: string | null;
  // Sorting
  sortConfig?: SortConfig | null;
  onSort?: (column: string) => void;
  // Pagination
  page?: number;
  pageSize?: number;
  totalItems?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  // Empty state
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: React.ReactNode;
  emptyAction?: React.ReactNode;
  // Skeleton
  skeletonColumns?: SkeletonColumnDef[];
  skeletonRowCount?: number;
  // Row customization
  getRowKey: (item: T) => string;
  onRowClick?: (item: T) => void;
  rowClassName?: (item: T) => string;
  // Table customization
  className?: string;
  stickyHeader?: boolean;
}

export function DataTable<T>({
  data,
  columns,
  isLoading = false,
  error = null,
  // Sorting
  sortConfig,
  onSort,
  // Pagination
  page = 1,
  pageSize = 20,
  totalItems = 0,
  totalPages = 1,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  // Empty state
  emptyTitle = 'No results found',
  emptyDescription,
  emptyIcon,
  emptyAction,
  // Skeleton
  skeletonColumns,
  skeletonRowCount = 5,
  // Row customization
  getRowKey,
  onRowClick,
  rowClassName,
  // Table customization
  className,
  stickyHeader = false,
}: DataTableProps<T>) {
  // Generate skeleton columns from column definitions if not provided
  const effectiveSkeletonColumns = skeletonColumns || columns.map(() => ({ width: 'w-24' }));

  // Show error state
  if (error) {
    return (
      <div className="rounded-md border border-destructive/50 p-4">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  // Show loading state
  if (isLoading) {
    return (
      <div className={className}>
        <TableSkeleton
          columns={effectiveSkeletonColumns}
          headers={columns.map((col) => col.header)}
          rowCount={skeletonRowCount}
        />
        {onPageChange && onPageSizeChange && (
          <div className="flex items-center justify-between px-2 py-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Skeleton className="h-8 w-32" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-8 w-24" />
            </div>
          </div>
        )}
      </div>
    );
  }

  // Show empty state
  if (data.length === 0) {
    return (
      <div className={className}>
        <DataTableEmptyState
          title={emptyTitle}
          description={emptyDescription}
          icon={emptyIcon}
          action={emptyAction}
        />
      </div>
    );
  }

  return (
    <div className={className}>
      <div className={cn(stickyHeader && 'max-h-[600px] overflow-auto')}>
        <Table>
          <TableHeader className={cn(stickyHeader && 'sticky top-0 bg-background z-10')}>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.key} className={column.headerClassName}>
                  {column.sortable && onSort ? (
                    <SortableHeader
                      column={column.key}
                      label={column.header}
                      sortConfig={sortConfig || null}
                      onSort={onSort}
                    />
                  ) : (
                    column.header
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((item) => (
              <TableRow
                key={getRowKey(item)}
                onClick={onRowClick ? () => onRowClick(item) : undefined}
                className={cn(
                  onRowClick && 'cursor-pointer hover:bg-muted/50',
                  rowClassName?.(item)
                )}
              >
                {columns.map((column) => (
                  <TableCell key={column.key} className={column.className}>
                    {column.render ? column.render(item) : String((item as Record<string, unknown>)[column.key] ?? '')}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {onPageChange && onPageSizeChange && (
        <PaginationControls
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          totalItems={totalItems}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          pageSizeOptions={pageSizeOptions}
        />
      )}
    </div>
  );
}
