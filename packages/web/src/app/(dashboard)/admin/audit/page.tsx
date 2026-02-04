'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { EmptyAuditLogsState } from '@/components/shared/EmptyState';
import { TableSkeleton, SKELETON_COLUMNS } from '@/components/shared/DataTable';

interface AuditLog {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
  adminUser: {
    id: string;
    email: string;
    name: string | null;
  } | null;
}

const ACTION_LABELS: Record<string, string> = {
  'user.update': 'User Updated',
  'user.delete': 'User Deleted',
  'user.suspend': 'User Suspended',
  'user.activate': 'User Activated',
  'billing.override': 'Billing Override',
};

const ACTION_COLORS: Record<string, 'default' | 'secondary' | 'error' | 'success'> = {
  'user.update': 'default',
  'user.delete': 'error',
  'user.suspend': 'error',
  'user.activate': 'success',
  'billing.override': 'secondary',
};

export default function AdminAuditPage() {
  const router = useRouter();
  const { user, fetchWithAuth } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Filters
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [targetTypeFilter, setTargetTypeFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Expanded rows
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (user && user.role !== 'admin') {
      router.push('/chat');
    }
  }, [user, router]);

  const loadLogs = useCallback(async () => {
    try {
      setIsLoading(true);
      setError('');
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (actionFilter !== 'all') params.set('action', actionFilter);
      if (targetTypeFilter !== 'all') params.set('targetType', targetTypeFilter);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const response = await fetchWithAuth(`/api/v1/admin/audit?${params}`);
      const data = await response.json();
      if (data.success) {
        setLogs(data.data.items);
        setTotalPages(data.data.totalPages);
      } else {
        setError(data.error?.message || 'Failed to load audit logs');
      }
    } catch {
      setError('Failed to load audit logs');
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth, page, actionFilter, targetTypeFilter, startDate, endDate]);

  useEffect(() => {
    if (user?.role === 'admin') {
      loadLogs();
    }
  }, [loadLogs, user?.role]);

  const hasActiveFilters = actionFilter !== 'all' || targetTypeFilter !== 'all' || startDate !== '' || endDate !== '';

  const clearFilters = () => {
    setActionFilter('all');
    setTargetTypeFilter('all');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  const formatChange = (key: string, change: { old: unknown; new: unknown }) => {
    const formatValue = (v: unknown) => {
      if (v === null || v === undefined) return 'null';
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      return String(v);
    };
    return `${key}: ${formatValue(change.old)} → ${formatValue(change.new)}`;
  };

  if (user?.role !== 'admin') {
    return null;
  }

  if (isLoading && logs.length === 0) {
    return (
      <div className="flex flex-col h-[calc(100vh-3.5rem)]">
        {/* Page Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h1 className="text-lg font-semibold">Audit Log</h1>
          <Button variant="outline" size="sm" disabled>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-6xl mx-auto">
            <TableSkeleton
              columns={SKELETON_COLUMNS.adminAudit}
              headers={['', 'Action', 'Admin', 'Target', 'IP Address', 'Date']}
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
        <h1 className="text-lg font-semibold">Audit Log</h1>
        <Button variant="outline" size="sm" onClick={() => loadLogs()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Page Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-wrap gap-4 mb-6">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Action:</span>
            <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                <SelectItem value="user.update">User Updated</SelectItem>
                <SelectItem value="user.delete">User Deleted</SelectItem>
                <SelectItem value="billing.override">Billing Override</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Target:</span>
            <Select value={targetTypeFilter} onValueChange={(v) => { setTargetTypeFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="All targets" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All targets</SelectItem>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="subscription">Subscription</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">From:</span>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
              className="w-[160px]"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">To:</span>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
              className="w-[160px]"
            />
          </div>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {logs.length === 0 ? (
          <EmptyAuditLogsState
            hasFilters={hasActiveFilters}
            onClearFilters={clearFilters}
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30px]"></TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                const hasDetails = log.changes || log.metadata;
                const isExpanded = expandedRows.has(log.id);

                return (
                  <Collapsible key={log.id} open={isExpanded} onOpenChange={() => toggleRow(log.id)} asChild>
                    <>
                      <TableRow className={hasDetails ? 'cursor-pointer hover:bg-muted/50' : ''}>
                        <TableCell>
                          {hasDetails && (
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </Button>
                            </CollapsibleTrigger>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={ACTION_COLORS[log.action] || 'default'}>
                            {ACTION_LABELS[log.action] || log.action}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium">
                              {log.adminUser?.name || 'Unknown'}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {log.adminUser?.email}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-sm">
                            {log.targetType}/{log.targetId.slice(0, 8)}...
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {log.ipAddress || '-'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(log.createdAt).toLocaleString()}
                        </TableCell>
                      </TableRow>
                      {hasDetails && (
                        <CollapsibleContent asChild>
                          <TableRow className="bg-muted/30">
                            <TableCell colSpan={6} className="py-4">
                              <div className="space-y-3 px-4">
                                {log.changes && Object.keys(log.changes).length > 0 && (
                                  <div>
                                    <h4 className="text-sm font-medium mb-2">Changes</h4>
                                    <ul className="space-y-1 text-sm">
                                      {Object.entries(log.changes).map(([key, change]) => (
                                        <li key={key} className="font-mono text-xs bg-background px-2 py-1 rounded">
                                          {formatChange(key, change)}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {log.metadata && Object.keys(log.metadata).length > 0 && (
                                  <div>
                                    <h4 className="text-sm font-medium mb-2">Metadata</h4>
                                    <pre className="text-xs font-mono bg-background p-2 rounded overflow-x-auto">
                                      {JSON.stringify(log.metadata, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        </CollapsibleContent>
                      )}
                    </>
                  </Collapsible>
                );
                })}
              </TableBody>
            </Table>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-6">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1 || isLoading}
                >
                  Previous
                </Button>
                <span className="text-sm text-gray-500">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages || isLoading}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
        </div>
      </div>
    </div>
  );
}
