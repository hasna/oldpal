'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Calendar, Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Label } from '@/components/ui/Label';
import { cn } from '@/lib/utils';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterConfig {
  id: string;
  label: string;
  type: 'select' | 'date' | 'dateRange' | 'text';
  options?: FilterOption[];
  placeholder?: string;
}

export interface FilterValues {
  [key: string]: string | undefined;
}

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  debounceMs?: number;
}

export function SearchBar({
  value,
  onChange,
  placeholder = 'Search...',
  className,
  debounceMs = 300,
}: SearchBarProps) {
  const [localValue, setLocalValue] = useState(value);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (newValue: string) => {
    setLocalValue(newValue);

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      onChange(newValue);
    }, debounceMs);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div className={cn('relative', className)}>
      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        type="text"
        placeholder={placeholder}
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        className="pl-10"
      />
      {localValue && (
        <button
          type="button"
          onClick={() => handleChange('')}
          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

interface DateRangeFilterProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  className?: string;
}

export function DateRangeFilter({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  className,
}: DateRangeFilterProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Calendar className="h-4 w-4 text-muted-foreground" />
      <Input
        type="date"
        value={startDate}
        onChange={(e) => onStartDateChange(e.target.value)}
        className="w-[140px]"
        placeholder="Start date"
      />
      <span className="text-muted-foreground">to</span>
      <Input
        type="date"
        value={endDate}
        onChange={(e) => onEndDateChange(e.target.value)}
        className="w-[140px]"
        placeholder="End date"
      />
    </div>
  );
}

interface SelectFilterProps {
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  placeholder?: string;
  icon?: React.ReactNode;
  className?: string;
}

export function SelectFilter({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  icon,
  className,
}: SelectFilterProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {icon}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{placeholder}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface AdvancedFiltersProps {
  filters: FilterConfig[];
  values: FilterValues;
  onChange: (values: FilterValues) => void;
  className?: string;
}

export function AdvancedFilters({
  filters,
  values,
  onChange,
  className,
}: AdvancedFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);

  const activeFilterCount = Object.entries(values).filter(
    ([, v]) => v && v !== 'all'
  ).length;

  const handleFilterChange = (filterId: string, value: string) => {
    onChange({
      ...values,
      [filterId]: value || undefined,
    });
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={className}>
          <Filter className="h-4 w-4 mr-2" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-2">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-4">
          <h4 className="font-medium text-sm">Filters</h4>
          {filters.map((filter) => (
            <div key={filter.id} className="space-y-2">
              <Label htmlFor={filter.id}>{filter.label}</Label>
              {filter.type === 'select' && filter.options && (
                <Select
                  value={values[filter.id] || 'all'}
                  onValueChange={(v) =>
                    handleFilterChange(filter.id, v === 'all' ? '' : v)
                  }
                >
                  <SelectTrigger id={filter.id}>
                    <SelectValue placeholder={filter.placeholder} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {filter.options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {filter.type === 'date' && (
                <Input
                  id={filter.id}
                  type="date"
                  value={values[filter.id] || ''}
                  onChange={(e) => handleFilterChange(filter.id, e.target.value)}
                />
              )}
              {filter.type === 'text' && (
                <Input
                  id={filter.id}
                  type="text"
                  value={values[filter.id] || ''}
                  onChange={(e) => handleFilterChange(filter.id, e.target.value)}
                  placeholder={filter.placeholder}
                />
              )}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface ActiveFiltersProps {
  filters: FilterConfig[];
  values: FilterValues;
  onRemove: (filterId: string) => void;
  onClearAll: () => void;
  className?: string;
}

export function ActiveFilters({
  filters,
  values,
  onRemove,
  onClearAll,
  className,
}: ActiveFiltersProps) {
  const activeFilters = Object.entries(values)
    .filter(([, v]) => v && v !== 'all')
    .map(([key, value]) => {
      const filter = filters.find((f) => f.id === key);
      if (!filter) return null;

      let displayValue = value;
      if (filter.type === 'select' && filter.options) {
        const option = filter.options.find((o) => o.value === value);
        displayValue = option?.label || value;
      }

      return { id: key, label: filter.label, value: displayValue };
    })
    .filter(Boolean);

  if (activeFilters.length === 0) return null;

  return (
    <div className={cn('flex items-center gap-2 flex-wrap', className)}>
      {activeFilters.map((filter) => (
        <Badge
          key={filter!.id}
          variant="secondary"
          className="flex items-center gap-1"
        >
          <span className="text-muted-foreground">{filter!.label}:</span>
          <span>{filter!.value}</span>
          <button
            type="button"
            onClick={() => onRemove(filter!.id)}
            className="ml-1 hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <Button
        variant="ghost"
        size="sm"
        onClick={onClearAll}
        className="text-muted-foreground"
      >
        Clear all
      </Button>
    </div>
  );
}

// Combined FilterBar component for unified search and filter UI
interface FilterBarProps<T extends Record<string, string | undefined>> {
  // Search
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  // Quick filters (inline select dropdowns)
  quickFilters?: Array<{
    id: keyof T;
    options: FilterOption[];
    placeholder: string;
    icon?: React.ReactNode;
  }>;
  // Advanced filters (in popover)
  advancedFilters?: FilterConfig[];
  // Filter values and handlers
  filterValues: T;
  onFilterChange: (key: keyof T, value: string | undefined) => void;
  onFiltersChange?: (values: Partial<T>) => void;
  onClearAll?: () => void;
  // Active filter display
  showActiveFilters?: boolean;
  // Actions slot
  actions?: React.ReactNode;
  // Styling
  className?: string;
}

export function FilterBar<T extends Record<string, string | undefined>>({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  quickFilters,
  advancedFilters,
  filterValues,
  onFilterChange,
  onFiltersChange,
  onClearAll,
  showActiveFilters = true,
  actions,
  className,
}: FilterBarProps<T>) {
  const handleQuickFilterChange = (id: keyof T, value: string) => {
    onFilterChange(id, value === 'all' ? undefined : value);
  };

  const handleAdvancedFilterChange = (values: FilterValues) => {
    if (onFiltersChange) {
      onFiltersChange(values as Partial<T>);
    } else {
      // Update each filter individually
      Object.entries(values).forEach(([key, value]) => {
        onFilterChange(key as keyof T, value);
      });
    }
  };

  const handleRemoveFilter = (filterId: string) => {
    onFilterChange(filterId as keyof T, undefined);
  };

  const allFilters: FilterConfig[] = [
    ...(quickFilters?.map((f) => ({
      id: String(f.id),
      label: f.placeholder,
      type: 'select' as const,
      options: f.options,
    })) || []),
    ...(advancedFilters || []),
  ];

  const hasActiveFilters = Object.entries(filterValues).some(
    ([, v]) => v && v !== 'all'
  );

  return (
    <div className={cn('space-y-4', className)}>
      {/* Main filter row */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Search bar */}
        {onSearchChange && (
          <SearchBar
            value={searchValue || ''}
            onChange={onSearchChange}
            placeholder={searchPlaceholder}
            className="w-full sm:w-64"
          />
        )}

        {/* Quick filters */}
        {quickFilters?.map((filter) => (
          <SelectFilter
            key={String(filter.id)}
            value={(filterValues[filter.id] as string) || 'all'}
            onChange={(v) => handleQuickFilterChange(filter.id, v)}
            options={filter.options}
            placeholder={filter.placeholder}
            icon={filter.icon}
          />
        ))}

        {/* Advanced filters popover */}
        {advancedFilters && advancedFilters.length > 0 && (
          <AdvancedFilters
            filters={advancedFilters}
            values={filterValues as FilterValues}
            onChange={handleAdvancedFilterChange}
          />
        )}

        {/* Actions slot (e.g., add button, export) */}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>

      {/* Active filters display */}
      {showActiveFilters && hasActiveFilters && onClearAll && (
        <ActiveFilters
          filters={allFilters}
          values={filterValues as FilterValues}
          onRemove={handleRemoveFilter}
          onClearAll={onClearAll}
        />
      )}
    </div>
  );
}

// Hook for managing filter state with URL sync support
interface UseFiltersWithUrlOptions {
  syncToUrl?: boolean;
  paramPrefix?: string;
}

export function useFiltersWithUrl<T extends Record<string, string | undefined>>(
  defaultValues: T,
  options: UseFiltersWithUrlOptions = {}
) {
  const base = useFilters(defaultValues);
  const { syncToUrl = false, paramPrefix = '' } = options;

  // URL sync effect
  useEffect(() => {
    if (!syncToUrl || typeof window === 'undefined') return;

    // Read initial values from URL
    const params = new URLSearchParams(window.location.search);
    const urlValues: Partial<T> = {};
    Object.keys(defaultValues).forEach((key) => {
      const paramName = paramPrefix ? `${paramPrefix}_${key}` : key;
      const value = params.get(paramName);
      if (value) {
        urlValues[key as keyof T] = value as T[keyof T];
      }
    });

    if (Object.keys(urlValues).length > 0) {
      base.updateFilters(urlValues);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncToUrl]);

  // Update URL when filters change
  useEffect(() => {
    if (!syncToUrl || typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);

    // Remove existing filter params
    Object.keys(defaultValues).forEach((key) => {
      const paramName = paramPrefix ? `${paramPrefix}_${key}` : key;
      params.delete(paramName);
    });

    // Add current filter values
    Object.entries(base.values).forEach(([key, value]) => {
      if (value && value !== 'all') {
        const paramName = paramPrefix ? `${paramPrefix}_${key}` : key;
        params.set(paramName, value);
      }
    });

    const newUrl = params.toString()
      ? `${window.location.pathname}?${params}`
      : window.location.pathname;

    window.history.replaceState({}, '', newUrl);
  }, [base.values, defaultValues, paramPrefix, syncToUrl]);

  return base;
}

// Hook for managing filter state
export function useFilters<T extends Record<string, string | undefined>>(defaultValues: T) {
  const [values, setValues] = useState<T>(defaultValues);

  const updateFilter = useCallback((key: keyof T, value: string | undefined) => {
    setValues((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  const updateFilters = useCallback((newValues: Partial<T>) => {
    setValues((prev) => ({
      ...prev,
      ...newValues,
    }));
  }, []);

  const clearFilter = useCallback((key: keyof T) => {
    setValues((prev) => ({
      ...prev,
      [key]: undefined,
    }));
  }, []);

  const clearAllFilters = useCallback(() => {
    setValues(defaultValues);
  }, [defaultValues]);

  const hasActiveFilters = Object.entries(values).some(
    ([, v]) => v && v !== 'all'
  );

  const getFilterParams = useCallback(() => {
    const params: Record<string, string> = {};
    Object.entries(values).forEach(([key, value]) => {
      if (value && value !== 'all') {
        params[key] = value;
      }
    });
    return params;
  }, [values]);

  return {
    values,
    setValues,
    updateFilter,
    updateFilters,
    clearFilter,
    clearAllFilters,
    hasActiveFilters,
    getFilterParams,
  };
}
