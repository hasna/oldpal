'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AlertCircle, Clock, Play, Pause, Trash2, Plus, Calendar, Repeat, Shuffle, Pencil, History, Zap } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { EmptySchedulesState, EmptySearchResultsState } from '@/components/shared/EmptyState';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
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
import { ScheduleEditDialog, ExecutionHistoryDialog } from '@/components/schedules';

interface Schedule {
  id: string;
  command: string;
  description: string | null;
  status: string;
  scheduleKind: string;
  scheduleAt: string | null;
  scheduleCron: string | null;
  scheduleTimezone: string | null;
  scheduleMinInterval: number | null;
  scheduleMaxInterval: number | null;
  scheduleInterval: number | null;
  scheduleUnit: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastResult: { ok: boolean; summary?: string; error?: string } | null;
  createdAt: string;
  agent?: { id: string; name: string } | null;
}

const SCHEDULE_PRESETS = [
  { label: 'Every 15 seconds', kind: 'interval', interval: 15, unit: 'seconds' },
  { label: 'Every minute', kind: 'interval', interval: 1, unit: 'minutes' },
  { label: 'Every 5 minutes', kind: 'interval', interval: 5, unit: 'minutes' },
  { label: 'Every 15 minutes', kind: 'interval', interval: 15, unit: 'minutes' },
  { label: 'Every hour', kind: 'interval', interval: 1, unit: 'hours' },
  { label: 'Every day at midnight', kind: 'cron', cron: '0 0 * * *' },
  { label: 'Every Monday at 9am', kind: 'cron', cron: '0 9 * * 1' },
  { label: 'Random 5-15 minutes', kind: 'random', minInterval: 5, maxInterval: 15, unit: 'minutes' },
] as const;

function formatSchedule(schedule: Schedule): string {
  if (schedule.scheduleKind === 'once' && schedule.scheduleAt) {
    return `Once at ${new Date(schedule.scheduleAt).toLocaleString()}`;
  }
  if (schedule.scheduleKind === 'interval' && schedule.scheduleInterval) {
    return `Every ${schedule.scheduleInterval} ${schedule.scheduleUnit || 'minutes'}`;
  }
  if (schedule.scheduleKind === 'random' && schedule.scheduleMinInterval && schedule.scheduleMaxInterval) {
    return `Random ${schedule.scheduleMinInterval}-${schedule.scheduleMaxInterval} ${schedule.scheduleUnit || 'minutes'}`;
  }
  if (schedule.scheduleKind === 'cron' && schedule.scheduleCron) {
    return `Cron: ${schedule.scheduleCron}`;
  }
  return 'Unknown schedule';
}

function getScheduleIcon(kind: string) {
  switch (kind) {
    case 'once':
      return <Calendar className="h-4 w-4" />;
    case 'interval':
      return <Repeat className="h-4 w-4" />;
    case 'random':
      return <Shuffle className="h-4 w-4" />;
    default:
      return <Clock className="h-4 w-4" />;
  }
}

type ScheduleFilters = {
  search: string | undefined;
  status: string | undefined;
  scheduleKind: string | undefined;
} & Record<string, string | undefined>;

export default function SchedulesPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sorting state
  const { sortConfig, handleSort, getSortParams } = useSorting({ column: 'nextRunAt', direction: 'desc' });

  // Pagination state
  const { page, setPage, pageSize, setPageSize, totalItems, setTotalItems, totalPages, loaded: paginationLoaded } = usePagination(20);

  // Filter state
  const filters = useFilters<ScheduleFilters>({
    search: undefined,
    status: undefined,
    scheduleKind: undefined,
  });

  // Form state
  const [command, setCommand] = useState('');
  const [description, setDescription] = useState('');
  const [scheduleKind, setScheduleKind] = useState<string>('interval');
  const [scheduleAt, setScheduleAt] = useState('');
  const [scheduleCron, setScheduleCron] = useState('');
  const [scheduleInterval, setScheduleInterval] = useState('5');
  const [scheduleMinInterval, setScheduleMinInterval] = useState('5');
  const [scheduleMaxInterval, setScheduleMaxInterval] = useState('15');
  const [scheduleUnit, setScheduleUnit] = useState('minutes');
  const [selectedPreset, setSelectedPreset] = useState<string>('');

  // Edit dialog state
  const [editSchedule, setEditSchedule] = useState<Schedule | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  // History dialog state
  const [historySchedule, setHistorySchedule] = useState<{ id: string; name: string } | null>(null);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);

  // Running state
  const [runningScheduleId, setRunningScheduleId] = useState<string | null>(null);

  const loadSchedules = useCallback(async () => {
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

      const url = `/api/v1/schedules${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await fetchWithAuth(url);
      const data = await response.json();
      if (data.success) {
        setSchedules(data.data.items);
        setTotalItems(data.data.total || 0);
      } else {
        setError(data.error?.message || 'Failed to load schedules');
      }
    } catch {
      setError('Failed to load schedules');
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth, filters, getSortParams, page, pageSize, setTotalItems]);

  // Load schedules when filters, sorting, or pagination change
  useEffect(() => {
    if (!paginationLoaded) return;

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      loadSchedules();
    }, 300);
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [loadSchedules, paginationLoaded]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [filters.values, sortConfig, setPage]);

  const handlePresetChange = (value: string) => {
    setSelectedPreset(value);
    const preset = SCHEDULE_PRESETS.find((p) => p.label === value);
    if (preset) {
      setScheduleKind(preset.kind);
      if ('interval' in preset) setScheduleInterval(String(preset.interval));
      if ('minInterval' in preset) setScheduleMinInterval(String(preset.minInterval));
      if ('maxInterval' in preset) setScheduleMaxInterval(String(preset.maxInterval));
      if ('unit' in preset) setScheduleUnit(preset.unit);
      if ('cron' in preset) setScheduleCron(preset.cron);
    }
  };

  const resetForm = () => {
    setCommand('');
    setDescription('');
    setScheduleKind('interval');
    setScheduleAt('');
    setScheduleCron('');
    setScheduleInterval('5');
    setScheduleMinInterval('5');
    setScheduleMaxInterval('15');
    setScheduleUnit('minutes');
    setSelectedPreset('');
  };

  const createSchedule = async () => {
    if (!command.trim()) {
      setError('Command is required');
      return;
    }

    setIsCreating(true);
    try {
      const payload: Record<string, unknown> = {
        command: command.trim(),
        description: description.trim() || undefined,
        scheduleKind,
        scheduleUnit,
      };

      if (scheduleKind === 'once') {
        payload.scheduleAt = new Date(scheduleAt).toISOString();
      } else if (scheduleKind === 'cron') {
        payload.scheduleCron = scheduleCron;
      } else if (scheduleKind === 'interval') {
        payload.scheduleInterval = Number.parseInt(scheduleInterval, 10);
      } else if (scheduleKind === 'random') {
        payload.scheduleMinInterval = Number.parseInt(scheduleMinInterval, 10);
        payload.scheduleMaxInterval = Number.parseInt(scheduleMaxInterval, 10);
      }

      const response = await fetchWithAuth('/api/v1/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (data.success) {
        toast({
          title: 'Schedule created',
          description: 'Your schedule has been created successfully.',
        });
        setIsDialogOpen(false);
        resetForm();
        loadSchedules();
      } else {
        setError(data.error?.message || 'Failed to create schedule');
      }
    } catch {
      setError('Failed to create schedule');
    } finally {
      setIsCreating(false);
    }
  };

  const toggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'paused' : 'active';
    try {
      const response = await fetchWithAuth(`/api/v1/schedules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (response.ok) {
        setSchedules((prev) =>
          prev.map((s) => (s.id === id ? { ...s, status: newStatus } : s))
        );
        toast({
          title: newStatus === 'paused' ? 'Schedule paused' : 'Schedule resumed',
          description: `The schedule has been ${newStatus === 'paused' ? 'paused' : 'resumed'}.`,
        });
      }
    } catch {
      setError('Failed to update schedule');
    }
  };

  const deleteSchedule = async (id: string) => {
    try {
      const response = await fetchWithAuth(`/api/v1/schedules/${id}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setSchedules((prev) => prev.filter((s) => s.id !== id));
        toast({
          title: 'Schedule deleted',
          description: 'The schedule has been deleted successfully.',
        });
      }
    } catch {
      setError('Failed to delete schedule');
    }
  };

  const handleEdit = (schedule: Schedule) => {
    setEditSchedule(schedule);
    setIsEditDialogOpen(true);
  };

  const handleSaveEdit = async (scheduleId: string, data: Partial<Schedule>) => {
    const response = await fetchWithAuth(`/api/v1/schedules/${scheduleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to update schedule');
    }

    // Update local state
    setSchedules((prev) =>
      prev.map((s) => (s.id === scheduleId ? { ...s, ...result.data } : s))
    );

    toast({
      title: 'Schedule updated',
      description: 'The schedule has been updated successfully.',
    });
  };

  const handleViewHistory = (schedule: Schedule) => {
    setHistorySchedule({
      id: schedule.id,
      name: schedule.description || schedule.command,
    });
    setIsHistoryDialogOpen(true);
  };

  const handleRunNow = async (schedule: Schedule) => {
    setRunningScheduleId(schedule.id);
    try {
      const response = await fetchWithAuth(`/api/v1/schedules/${schedule.id}/run`, {
        method: 'POST',
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: 'Schedule triggered',
          description: result.message || 'The schedule has been triggered successfully.',
        });
        // Refresh to show updated lastRunAt
        loadSchedules();
      } else {
        setError(result.error?.message || 'Failed to trigger schedule');
      }
    } catch {
      setError('Failed to trigger schedule');
    } finally {
      setRunningScheduleId(null);
    }
  };

  const hasActiveFilters = filters.hasActiveFilters;

  if (isLoading) {
    return (
      <div className="flex flex-col h-[calc(100vh-3.5rem)]">
        {/* Page Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto space-y-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <Skeleton className="h-5 w-48 mb-2" />
                  <Skeleton className="h-4 w-64" />
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
        <h1 className="text-lg font-semibold">Schedules</h1>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              New Schedule
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Create Schedule</DialogTitle>
              <DialogDescription>
                Schedule a command to run automatically at specified intervals.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="command">Command</Label>
                <Textarea
                  id="command"
                  placeholder="Enter the command to execute..."
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Input
                  id="description"
                  placeholder="Brief description of what this does"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Schedule Preset</Label>
                <Select value={selectedPreset} onValueChange={handlePresetChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a preset or customize below" />
                  </SelectTrigger>
                  <SelectContent>
                    {SCHEDULE_PRESETS.map((preset) => (
                      <SelectItem key={preset.label} value={preset.label}>
                        {preset.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Schedule Type</Label>
                <Select value={scheduleKind} onValueChange={setScheduleKind}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="interval">Fixed Interval</SelectItem>
                    <SelectItem value="random">Random Interval</SelectItem>
                    <SelectItem value="cron">Cron Expression</SelectItem>
                    <SelectItem value="once">One-time</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {scheduleKind === 'interval' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="interval">Every</Label>
                    <Input
                      id="interval"
                      type="number"
                      min="1"
                      value={scheduleInterval}
                      onChange={(e) => setScheduleInterval(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="unit">Unit</Label>
                    <Select value={scheduleUnit} onValueChange={setScheduleUnit}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="seconds">Seconds</SelectItem>
                        <SelectItem value="minutes">Minutes</SelectItem>
                        <SelectItem value="hours">Hours</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {scheduleKind === 'random' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="minInterval">Min Interval</Label>
                      <Input
                        id="minInterval"
                        type="number"
                        min="1"
                        value={scheduleMinInterval}
                        onChange={(e) => setScheduleMinInterval(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="maxInterval">Max Interval</Label>
                      <Input
                        id="maxInterval"
                        type="number"
                        min="1"
                        value={scheduleMaxInterval}
                        onChange={(e) => setScheduleMaxInterval(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="randomUnit">Unit</Label>
                    <Select value={scheduleUnit} onValueChange={setScheduleUnit}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="seconds">Seconds</SelectItem>
                        <SelectItem value="minutes">Minutes</SelectItem>
                        <SelectItem value="hours">Hours</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {scheduleKind === 'cron' && (
                <div className="space-y-2">
                  <Label htmlFor="cron">Cron Expression</Label>
                  <Input
                    id="cron"
                    placeholder="0 0 * * *"
                    value={scheduleCron}
                    onChange={(e) => setScheduleCron(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Format: minute hour day month weekday (e.g., "0 9 * * 1" = every Monday at 9am)
                  </p>
                </div>
              )}

              {scheduleKind === 'once' && (
                <div className="space-y-2">
                  <Label htmlFor="datetime">Run At</Label>
                  <Input
                    id="datetime"
                    type="datetime-local"
                    value={scheduleAt}
                    onChange={(e) => setScheduleAt(e.target.value)}
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={createSchedule} disabled={isCreating}>
                {isCreating ? 'Creating...' : 'Create Schedule'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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

          {/* Search and Filters */}
          <div className="mb-6 space-y-4">
            <SearchBar
              value={filters.values.search || ''}
              onChange={(value) => filters.updateFilter('search', value || undefined)}
              placeholder="Search schedules by command..."
            />

            <div className="flex flex-wrap gap-3 items-center justify-between">
              <div className="flex flex-wrap gap-3 items-center">
                <SelectFilter
                  value={filters.values.status || 'all'}
                  onChange={(value) => filters.updateFilter('status', value === 'all' ? undefined : value)}
                  options={[
                    { value: 'active', label: 'Active' },
                    { value: 'paused', label: 'Paused' },
                  ]}
                  placeholder="All Status"
                />

                <SelectFilter
                  value={filters.values.scheduleKind || 'all'}
                  onChange={(value) => filters.updateFilter('scheduleKind', value === 'all' ? undefined : value)}
                  options={[
                    { value: 'interval', label: 'Fixed Interval' },
                    { value: 'random', label: 'Random Interval' },
                    { value: 'cron', label: 'Cron' },
                    { value: 'once', label: 'One-time' },
                  ]}
                  placeholder="All Types"
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
                  column="nextRunAt"
                  label="Next Run"
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
                  column="status"
                  label="Status"
                  sortConfig={sortConfig}
                  onSort={handleSort}
                />
              </div>
            </div>
          </div>

          {schedules.length === 0 ? (
            hasActiveFilters ? (
              <EmptySearchResultsState
                query={filters.values.search || ''}
                onClear={filters.clearAllFilters}
              />
            ) : (
              <EmptySchedulesState onNewSchedule={() => setIsDialogOpen(true)} />
            )
          ) : (
            <>
              <div className="space-y-3">
                {schedules.map((schedule) => (
                  <Card key={schedule.id}>
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {getScheduleIcon(schedule.scheduleKind)}
                          <span className="font-medium text-foreground">{schedule.command}</span>
                          <Badge variant={schedule.status === 'active' ? 'default' : 'secondary'}>
                            {schedule.status}
                          </Badge>
                          {schedule.lastResult && (
                            <Badge variant={schedule.lastResult.ok ? 'default' : 'error'}>
                              {schedule.lastResult.ok ? 'Last run: OK' : 'Last run: Error'}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {formatSchedule(schedule)}
                          {schedule.nextRunAt && (
                            <span className="ml-2">
                              • Next: {new Date(schedule.nextRunAt).toLocaleString()}
                            </span>
                          )}
                        </p>
                        {schedule.description && (
                          <p className="text-sm text-muted-foreground/80 mt-1">{schedule.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRunNow(schedule)}
                          disabled={runningScheduleId === schedule.id}
                          title="Run now"
                        >
                          <Zap className={`h-4 w-4 ${runningScheduleId === schedule.id ? 'animate-pulse' : ''}`} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewHistory(schedule)}
                          title="View history"
                        >
                          <History className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(schedule)}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleStatus(schedule.id, schedule.status)}
                          title={schedule.status === 'active' ? 'Pause' : 'Resume'}
                        >
                          {schedule.status === 'active' ? (
                            <Pause className="h-4 w-4" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive/80"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete schedule?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete this schedule? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteSchedule(schedule.id)}>
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
      <ScheduleEditDialog
        schedule={editSchedule}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        onSave={handleSaveEdit}
      />

      {/* Execution History Dialog */}
      <ExecutionHistoryDialog
        scheduleId={historySchedule?.id || null}
        scheduleName={historySchedule?.name || null}
        open={isHistoryDialogOpen}
        onOpenChange={setIsHistoryDialogOpen}
        fetchWithAuth={fetchWithAuth}
      />
    </div>
  );
}
