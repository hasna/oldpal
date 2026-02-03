'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Clock, Play, Pause, Trash2, Plus, Calendar, Repeat, Shuffle } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/Button';
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

export default function SchedulesPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

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

  const loadSchedules = useCallback(async () => {
    setError('');
    try {
      const response = await fetchWithAuth('/api/v1/schedules');
      const data = await response.json();
      if (data.success) {
        setSchedules(data.data.items);
      } else {
        setError(data.error?.message || 'Failed to load schedules');
      }
    } catch {
      setError('Failed to load schedules');
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

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

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-36" />
        </div>
        <div className="space-y-3">
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
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Schedules</h1>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
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
                  <p className="text-xs text-gray-500">
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

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {schedules.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Clock className="h-12 w-12 mx-auto text-gray-300 mb-4" />
            <p className="text-gray-500 mb-2">No schedules yet</p>
            <p className="text-sm text-gray-400">
              Create a schedule to automate recurring tasks.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {schedules.map((schedule) => (
            <Card key={schedule.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {getScheduleIcon(schedule.scheduleKind)}
                    <span className="font-medium text-gray-900">{schedule.command}</span>
                    <Badge variant={schedule.status === 'active' ? 'default' : 'secondary'}>
                      {schedule.status}
                    </Badge>
                    {schedule.lastResult && (
                      <Badge variant={schedule.lastResult.ok ? 'default' : 'error'}>
                        {schedule.lastResult.ok ? 'Last run: OK' : 'Last run: Error'}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-gray-500">
                    {formatSchedule(schedule)}
                    {schedule.nextRunAt && (
                      <span className="ml-2">
                        • Next: {new Date(schedule.nextRunAt).toLocaleString()}
                      </span>
                    )}
                  </p>
                  {schedule.description && (
                    <p className="text-sm text-gray-400 mt-1">{schedule.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
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
                        className="text-red-400 hover:text-red-300"
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
      )}
    </div>
  );
}
