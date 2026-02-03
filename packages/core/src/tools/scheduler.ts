import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor } from './registry';
import { generateId } from '@hasna/assistants-shared';
import type { ScheduledCommand } from '@hasna/assistants-shared';
import {
  listSchedules,
  saveSchedule,
  deleteSchedule,
  updateSchedule,
  readSchedule,
  computeNextRun,
  isValidTimeZone,
} from '../scheduler/store';

export class SchedulerTool {
  static readonly tool: Tool = {
    name: 'schedule',
    description: 'Create and manage scheduled commands (once, cron, or random interval).',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Action to perform: create, list, delete, pause, resume',
          enum: ['create', 'list', 'delete', 'pause', 'resume'],
        },
        command: {
          type: 'string',
          description: 'Command to schedule (required for create)',
        },
        at: {
          type: 'string',
          description: 'ISO 8601 timestamp for a one-time schedule',
        },
        cron: {
          type: 'string',
          description: 'Cron expression for recurring schedule (5 fields)',
        },
        minInterval: {
          type: 'number',
          description: 'Minimum interval for random scheduling (e.g., 1)',
        },
        maxInterval: {
          type: 'number',
          description: 'Maximum interval for random scheduling (e.g., 20)',
        },
        unit: {
          type: 'string',
          description: 'Time unit for interval/random scheduling: seconds, minutes, or hours',
          enum: ['seconds', 'minutes', 'hours'],
        },
        every: {
          type: 'number',
          description: 'Fixed interval for recurring schedule (e.g., every: 15 with unit: "seconds" = every 15 seconds). Minimum 1 second.',
        },
        timezone: {
          type: 'string',
          description: 'IANA timezone name (optional, best-effort)',
        },
        description: {
          type: 'string',
          description: 'Optional description for this schedule',
        },
        actionType: {
          type: 'string',
          description: 'Type of action: "command" runs the command, "message" injects custom message into agent session. Default: "command"',
          enum: ['command', 'message'],
        },
        message: {
          type: 'string',
          description: 'Custom message to inject when actionType is "message"',
        },
        sessionId: {
          type: 'string',
          description: 'Session id to scope the schedule to',
        },
        id: {
          type: 'string',
          description: 'Schedule id (for delete/pause/resume)',
        },
        cwd: {
          type: 'string',
          description: 'Project working directory (optional)',
        },
      },
      required: ['action'],
    },
  };

  static readonly executor: ToolExecutor = async (input) => {
    const action = String(input.action || '');
    const cwd = (input.cwd as string) || process.cwd();
    const now = Date.now();

    if (action === 'list') {
      const schedules = await listSchedules(cwd);
      if (schedules.length === 0) return 'No schedules found.';
      const rows = schedules
        .sort((a, b) => (a.nextRunAt || 0) - (b.nextRunAt || 0))
        .map((s) => {
          const next = s.nextRunAt ? new Date(s.nextRunAt).toISOString() : 'n/a';
          let scheduleInfo = '';
          if (s.schedule.kind === 'interval' && s.schedule.interval) {
            scheduleInfo = ` (every ${s.schedule.interval} ${s.schedule.unit || 'minutes'})`;
          } else if (s.schedule.kind === 'random' && s.schedule.minInterval && s.schedule.maxInterval) {
            scheduleInfo = ` (random: ${s.schedule.minInterval}-${s.schedule.maxInterval} ${s.schedule.unit || 'minutes'})`;
          } else if (s.schedule.kind === 'cron' && s.schedule.cron) {
            scheduleInfo = ` (cron: ${s.schedule.cron})`;
          }
          return `- ${s.id} [${s.status}] ${s.command}${scheduleInfo} (next: ${next})`;
        });
      return rows.join('\n');
    }

    if (action === 'create') {
      const command = String(input.command || '').trim();
      if (!command) return 'Error: command is required.';
      const at = input.at as string | undefined;
      const cron = input.cron as string | undefined;
      const minInterval = input.minInterval as number | undefined;
      const maxInterval = input.maxInterval as number | undefined;
      const every = input.every as number | undefined;
      const unit = input.unit as 'seconds' | 'minutes' | 'hours' | undefined;

      // Validate that at least one scheduling method is provided
      const hasRandom = minInterval !== undefined && maxInterval !== undefined;
      const hasInterval = every !== undefined;
      if (!at && !cron && !hasRandom && !hasInterval) {
        return 'Error: provide at (ISO time), cron, every (fixed interval), or minInterval+maxInterval for random scheduling.';
      }

      // Validate interval parameter
      if (hasInterval) {
        if (every <= 0) {
          return 'Error: every must be a positive number.';
        }
        // Minimum 1 second to prevent abuse
        const effectiveUnit = unit || 'minutes';
        const intervalSeconds = effectiveUnit === 'seconds' ? every : effectiveUnit === 'hours' ? every * 3600 : every * 60;
        if (intervalSeconds < 1) {
          return 'Error: minimum interval is 1 second.';
        }
      }

      // Validate random interval parameters
      if (hasRandom) {
        if (minInterval <= 0 || maxInterval <= 0) {
          return 'Error: minInterval and maxInterval must be positive numbers.';
        }
        if (minInterval > maxInterval) {
          return 'Error: minInterval cannot be greater than maxInterval.';
        }
      }

      const timezone = input.timezone as string | undefined;
      if (timezone && !isValidTimeZone(timezone)) {
        return `Error: invalid timezone "${timezone}".`;
      }

      const actionType = input.actionType as 'command' | 'message' | undefined;
      const message = input.message as string | undefined;

      // Determine schedule kind
      let scheduleKind: 'once' | 'cron' | 'random' | 'interval';
      if (hasInterval) {
        scheduleKind = 'interval';
      } else if (hasRandom) {
        scheduleKind = 'random';
      } else if (cron) {
        scheduleKind = 'cron';
      } else {
        scheduleKind = 'once';
      }

      const schedule: ScheduledCommand = {
        id: generateId(),
        createdAt: now,
        updatedAt: now,
        createdBy: 'agent',
        sessionId: typeof input.sessionId === 'string' ? input.sessionId : undefined,
        actionType: actionType || 'command',
        command,
        message: actionType === 'message' ? message : undefined,
        description: input.description as string | undefined,
        status: 'active',
        schedule: {
          kind: scheduleKind,
          at,
          cron,
          timezone,
          minInterval: hasRandom ? minInterval : undefined,
          maxInterval: hasRandom ? maxInterval : undefined,
          unit: (hasRandom || hasInterval) ? (unit || 'minutes') : undefined,
          interval: hasInterval ? every : undefined,
        },
      };
      schedule.nextRunAt = computeNextRun(schedule, now);
      if (!schedule.nextRunAt) {
        return 'Error: unable to compute next run for schedule.';
      }
      await saveSchedule(cwd, schedule);
      if (scheduleKind === 'interval') {
        return `Scheduled ${schedule.command} (${schedule.id}) every ${every} ${unit || 'minutes'}, next run: ${new Date(schedule.nextRunAt).toISOString()}`;
      }
      if (scheduleKind === 'random') {
        return `Scheduled ${schedule.command} (${schedule.id}) randomly every ${minInterval}-${maxInterval} ${unit || 'minutes'}, next run: ${new Date(schedule.nextRunAt).toISOString()}`;
      }
      return `Scheduled ${schedule.command} (${schedule.id}) for ${new Date(schedule.nextRunAt).toISOString()}`;
    }

    if (action === 'delete') {
      const id = String(input.id || '').trim();
      if (!id) return 'Error: id is required.';
      const ok = await deleteSchedule(cwd, id);
      return ok ? `Deleted schedule ${id}.` : `Schedule ${id} not found.`;
    }

    if (action === 'pause' || action === 'resume') {
      const id = String(input.id || '').trim();
      if (!id) return 'Error: id is required.';
      let nextRunAt: number | undefined;
      if (action === 'resume') {
        const schedule = await readSchedule(cwd, id);
        if (!schedule) return `Schedule ${id} not found.`;
        nextRunAt = computeNextRun(schedule, Date.now());
        if (!nextRunAt) {
          return `Error: unable to compute next run for schedule ${id}.`;
        }
      }
      const updated = await updateSchedule(cwd, id, (s) => ({
        ...s,
        status: action === 'pause' ? 'paused' : 'active',
        updatedAt: Date.now(),
        nextRunAt: action === 'resume' ? nextRunAt : s.nextRunAt,
      }));
      if (!updated) return `Schedule ${id} not found.`;
      return `${action === 'pause' ? 'Paused' : 'Resumed'} schedule ${id}.`;
    }

    return `Error: unknown action "${action}".`;
  };
}
