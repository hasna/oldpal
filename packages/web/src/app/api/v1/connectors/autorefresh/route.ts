import { z } from 'zod';
import { ConnectorAutoRefreshManager, type ConnectorAutoRefreshSchedule } from '@hasna/assistants-core';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';

const actionSchema = z.object({
  action: z.enum(['enable', 'disable', 'remove', 'status', 'list']),
  connector: z.string().optional(),
  cron: z.string().optional(),
  timezone: z.string().optional(),
  intervalMinutes: z.number().optional(),
  intervalHours: z.number().optional(),
  command: z.string().optional(),
});

function buildSchedule(input: z.infer<typeof actionSchema>): ConnectorAutoRefreshSchedule | undefined {
  if (input.cron && input.cron.trim()) {
    const schedule: ConnectorAutoRefreshSchedule = {
      kind: 'cron',
      cron: input.cron.trim(),
    };
    if (input.timezone && input.timezone.trim()) {
      schedule.timezone = input.timezone.trim();
    }
    return schedule;
  }
  if (typeof input.intervalHours === 'number' && input.intervalHours > 0) {
    return { kind: 'interval', interval: input.intervalHours, unit: 'hours' };
  }
  if (typeof input.intervalMinutes === 'number' && input.intervalMinutes > 0) {
    return { kind: 'interval', interval: input.intervalMinutes, unit: 'minutes' };
  }
  return undefined;
}

export const POST = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const body = await request.json();
    const data = actionSchema.parse(body);
    const manager = ConnectorAutoRefreshManager.getInstance();
    await manager.start();

    if (data.action === 'list') {
      return successResponse({
        count: manager.list().length,
        entries: manager.list(),
      });
    }

    if (!data.connector) {
      return errorResponse(new Error('Connector name is required for this action.'));
    }

    const connector = data.connector.trim();

    if (data.action === 'status') {
      const entry = manager.get(connector);
      return successResponse({
        connector,
        configured: Boolean(entry),
        entry,
      });
    }

    if (data.action === 'disable') {
      const entry = await manager.disable(connector);
      return successResponse({
        connector,
        disabled: Boolean(entry),
        entry,
      });
    }

    if (data.action === 'remove') {
      const removed = await manager.remove(connector);
      return successResponse({
        connector,
        removed,
      });
    }

    if (data.action === 'enable') {
      const schedule = buildSchedule(data);
      const command = data.command?.trim();
      const entry = await manager.enable(connector, schedule, command);
      return successResponse({
        connector,
        enabled: true,
        entry,
      });
    }

    return errorResponse(new Error(`Unknown action: ${data.action}`));
  } catch (error) {
    return errorResponse(error);
  }
});
