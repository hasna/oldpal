'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Loader2,
  MessageSquare,
  User,
  Bot,
  ArrowRight,
  X,
  Calendar,
  Filter,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

interface SearchResult {
  id: string;
  preview: string;
  role: string;
  createdAt: string;
  sessionId: string;
  sessionLabel: string;
  agentId: string | null;
  matchIndex: number;
}

interface GlobalSearchProps {
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return <>{text}</>;

  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

export function GlobalSearch({ fetchWithAuth, open, onOpenChange }: GlobalSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [roleFilter, setRoleFilter] = useState<'all' | 'user' | 'assistant'>('all');
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Recent searches from localStorage
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem('recent-searches');
    if (stored) {
      setRecentSearches(JSON.parse(stored).slice(0, 5));
    }
  }, []);

  const saveRecentSearch = useCallback((searchQuery: string) => {
    const updated = [searchQuery, ...recentSearches.filter((s) => s !== searchQuery)].slice(0, 5);
    setRecentSearches(updated);
    localStorage.setItem('recent-searches', JSON.stringify(updated));
  }, [recentSearches]);

  const performSearch = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults([]);
      setTotal(0);
      return;
    }

    setIsLoading(true);
    try {
      const params = new URLSearchParams({ q: searchQuery, limit: '20' });
      if (roleFilter !== 'all') {
        params.set('role', roleFilter);
      }

      const response = await fetchWithAuth(`/api/v1/search/messages?${params}`);
      const data = await response.json();

      if (data.success) {
        setResults(data.data.results);
        setTotal(data.data.total);
      }
    } catch {
      setResults([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth, roleFilter]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      performSearch(query);
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, performSearch]);

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setResults([]);
    }
  }, [open]);

  const handleResultClick = (result: SearchResult) => {
    saveRecentSearch(query);
    onOpenChange(false);
    router.push(`/chat?session=${result.sessionId}&message=${result.id}`);
  };

  const handleRecentSearchClick = (search: string) => {
    setQuery(search);
    performSearch(search);
  };

  const clearRecentSearches = () => {
    setRecentSearches([]);
    localStorage.removeItem('recent-searches');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="sr-only">Search Messages</DialogTitle>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search messages..."
              className="pl-10 pr-10"
              aria-label="Search messages"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </DialogHeader>

        {/* Filters */}
        <div className="px-4 py-2 border-b flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">From:</span>
          <div className="flex gap-1">
            {(['all', 'user', 'assistant'] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setRoleFilter(filter)}
                className={cn(
                  'px-2 py-1 text-xs rounded-md transition-colors',
                  roleFilter === filter
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                )}
              >
                {filter === 'all' ? 'All' : filter === 'user' ? 'You' : 'Assistant'}
              </button>
            ))}
          </div>
        </div>

        <ScrollArea className="max-h-[400px]">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : query.length >= 2 && results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
              <Search className="h-10 w-10 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No messages found</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Try different keywords or remove filters
              </p>
            </div>
          ) : results.length > 0 ? (
            <div className="divide-y">
              <div className="px-4 py-2 bg-muted/50">
                <p className="text-xs text-muted-foreground">
                  {total} {total === 1 ? 'result' : 'results'} found
                </p>
              </div>
              {results.map((result) => (
                <button
                  key={result.id}
                  onClick={() => handleResultClick(result)}
                  className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors focus:bg-muted/50 focus:outline-none"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {result.role === 'user' ? (
                        <User className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Bot className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm line-clamp-2">
                        {highlightMatch(result.preview, query)}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">
                          <MessageSquare className="h-3 w-3 mr-1" />
                          {result.sessionLabel}
                        </Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(result.createdAt)}
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          ) : query.length < 2 && recentSearches.length > 0 ? (
            <div className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground font-medium">Recent searches</span>
                <button
                  onClick={clearRecentSearches}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              </div>
              <div className="space-y-1">
                {recentSearches.map((search, i) => (
                  <button
                    key={i}
                    onClick={() => handleRecentSearchClick(search)}
                    className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors flex items-center gap-2"
                  >
                    <Search className="h-3 w-3 text-muted-foreground" />
                    {search}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
              <Search className="h-10 w-10 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">Search your messages</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Type at least 2 characters to search
              </p>
            </div>
          )}
        </ScrollArea>

        <div className="border-t px-4 py-2 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">↑↓</kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Enter</kbd>
              Open
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Esc</kbd>
              Close
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
