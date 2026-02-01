import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor } from './registry';
import { generateId } from '@hasna/assistants-shared';
import type { ScheduledCommand } from '@hasna/assistants-shared';
import {
  listSchedules,
  saveSchedule,
  deleteSchedule,
  updateSchedule,
  computeNextRun,
  isValidTimeZone,
} from '../scheduler/store';

export class SchedulerTool {
  static readonly tool: Tool = {
    name: 'schedule',
    description: 'Create and manage scheduled commands (once or cron).',
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
        timezone: {
          type: 'string',
          description: 'IANA timezone name (optional, best-effort)',
        },
        description: {
          type: 'string',
          description: 'Optional description for this schedule',
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
          return `- ${s.id} [${s.status}] ${s.command} (next: ${next})`;
        });
      return rows.join('\n');
    }

    if (action === 'create') {
      const command = String(input.command || '').trim();
      if (!command) return 'Error: command is required.';
      const at = input.at as string | undefined;
      const cron = input.cron as string | undefined;
      if (!at && !cron) return 'Error: provide either at (ISO time) or cron.';
      const timezone = input.timezone as string | undefined;
      if (timezone && !isValidTimeZone(timezone)) {
        return `Error: invalid timezone "${timezone}".`;
      }

      const schedule: ScheduledCommand = {
        id: generateId(),
        createdAt: now,
        updatedAt: now,
        createdBy: 'agent',
        sessionId: typeof input.sessionId === 'string' ? input.sessionId : undefined,
        command,
        description: input.description as string | undefined,
        status: 'active',
        schedule: {
          kind: cron ? 'cron' : 'once',
          at,
          cron,
          timezone,
        },
      };
      schedule.nextRunAt = computeNextRun(schedule, now);
      if (!schedule.nextRunAt) {
        return 'Error: unable to compute next run for schedule.';
      }
      await saveSchedule(cwd, schedule);
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
      const updated = await updateSchedule(cwd, id, (s) => ({
        ...s,
        status: action === 'pause' ? 'paused' : 'active',
        updatedAt: Date.now(),
        nextRunAt: action === 'resume' ? computeNextRun(s, Date.now()) : s.nextRunAt,
      }));
      if (!updated) return `Schedule ${id} not found.`;
      return `${action === 'pause' ? 'Paused' : 'Resumed'} schedule ${id}.`;
    }

    return `Error: unknown action "${action}".`;
  };
}
