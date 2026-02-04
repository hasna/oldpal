'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
}

interface ScheduleEditDialogProps {
  schedule: Schedule | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (scheduleId: string, data: Partial<Schedule>) => Promise<void>;
}

export function ScheduleEditDialog({
  schedule,
  open,
  onOpenChange,
  onSave,
}: ScheduleEditDialogProps) {
  const [command, setCommand] = useState('');
  const [description, setDescription] = useState('');
  const [scheduleKind, setScheduleKind] = useState<string>('interval');
  const [scheduleAt, setScheduleAt] = useState('');
  const [scheduleCron, setScheduleCron] = useState('');
  const [scheduleInterval, setScheduleInterval] = useState('5');
  const [scheduleMinInterval, setScheduleMinInterval] = useState('5');
  const [scheduleMaxInterval, setScheduleMaxInterval] = useState('15');
  const [scheduleUnit, setScheduleUnit] = useState('minutes');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  // Reset form when schedule changes
  useEffect(() => {
    if (schedule) {
      setCommand(schedule.command);
      setDescription(schedule.description || '');
      setScheduleKind(schedule.scheduleKind);
      setScheduleAt(schedule.scheduleAt ? new Date(schedule.scheduleAt).toISOString().slice(0, 16) : '');
      setScheduleCron(schedule.scheduleCron || '');
      setScheduleInterval(String(schedule.scheduleInterval || 5));
      setScheduleMinInterval(String(schedule.scheduleMinInterval || 5));
      setScheduleMaxInterval(String(schedule.scheduleMaxInterval || 15));
      setScheduleUnit(schedule.scheduleUnit || 'minutes');
      setError('');
    }
  }, [schedule]);

  const handleSave = async () => {
    if (!schedule) return;
    if (!command.trim()) {
      setError('Command is required');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      const data: Record<string, unknown> = {
        command: command.trim(),
        description: description.trim() || null,
        scheduleKind,
        scheduleUnit,
      };

      if (scheduleKind === 'once') {
        data.scheduleAt = new Date(scheduleAt).toISOString();
        data.scheduleCron = null;
        data.scheduleInterval = null;
        data.scheduleMinInterval = null;
        data.scheduleMaxInterval = null;
      } else if (scheduleKind === 'cron') {
        data.scheduleCron = scheduleCron;
        data.scheduleAt = null;
        data.scheduleInterval = null;
        data.scheduleMinInterval = null;
        data.scheduleMaxInterval = null;
      } else if (scheduleKind === 'interval') {
        data.scheduleInterval = Number.parseInt(scheduleInterval, 10);
        data.scheduleAt = null;
        data.scheduleCron = null;
        data.scheduleMinInterval = null;
        data.scheduleMaxInterval = null;
      } else if (scheduleKind === 'random') {
        data.scheduleMinInterval = Number.parseInt(scheduleMinInterval, 10);
        data.scheduleMaxInterval = Number.parseInt(scheduleMaxInterval, 10);
        data.scheduleAt = null;
        data.scheduleCron = null;
        data.scheduleInterval = null;
      }

      await onSave(schedule.id, data as Partial<Schedule>);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save schedule');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Schedule</DialogTitle>
          <DialogDescription>
            Modify the schedule settings below.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="edit-command">Command</Label>
            <Textarea
              id="edit-command"
              placeholder="Enter the command to execute..."
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-description">Description (optional)</Label>
            <Input
              id="edit-description"
              placeholder="Brief description of what this does"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
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
                <Label htmlFor="edit-interval">Every</Label>
                <Input
                  id="edit-interval"
                  type="number"
                  min="1"
                  value={scheduleInterval}
                  onChange={(e) => setScheduleInterval(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-unit">Unit</Label>
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
                  <Label htmlFor="edit-minInterval">Min Interval</Label>
                  <Input
                    id="edit-minInterval"
                    type="number"
                    min="1"
                    value={scheduleMinInterval}
                    onChange={(e) => setScheduleMinInterval(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-maxInterval">Max Interval</Label>
                  <Input
                    id="edit-maxInterval"
                    type="number"
                    min="1"
                    value={scheduleMaxInterval}
                    onChange={(e) => setScheduleMaxInterval(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-randomUnit">Unit</Label>
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
              <Label htmlFor="edit-cron">Cron Expression</Label>
              <Input
                id="edit-cron"
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
              <Label htmlFor="edit-datetime">Run At</Label>
              <Input
                id="edit-datetime"
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
