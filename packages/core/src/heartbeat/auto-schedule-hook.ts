/**
 * Native Stop hook that ensures a heartbeat schedule exists after every agent turn
 * when autonomous mode is enabled.
 *
 * If the agent forgot to schedule its next wakeup (or it's the first turn),
 * this hook creates a default `kind: 'once'` schedule.
 */

import type { NativeHook, HookInput, NativeHookContext, HookOutput } from '@hasna/assistants-shared';
import { getSchedule, saveSchedule } from '../scheduler/store';
import {
  heartbeatScheduleId,
  DEFAULT_SLEEP_MS,
  DEFAULT_MAX_SLEEP_MS,
} from './conventions';

/**
 * Handler for the auto-schedule Stop hook.
 * Returns `null` — never blocks the assistant.
 */
async function autoScheduleHeartbeatHandler(
  _input: HookInput,
  context: NativeHookContext,
): Promise<HookOutput | null> {
  const heartbeatCfg = context.config?.heartbeat;
  if (!heartbeatCfg?.autonomous) return null;

  const scheduleId = heartbeatScheduleId(context.sessionId);

  try {
    // Check if an active heartbeat schedule already exists
    const existing = await getSchedule(context.cwd, scheduleId);
    if (existing && existing.status === 'active') {
      return null; // Agent already scheduled its next wakeup
    }

    // Create a default one-shot schedule
    const maxSleep = heartbeatCfg.maxSleepMs ?? DEFAULT_MAX_SLEEP_MS;
    const sleepMs = Math.min(DEFAULT_SLEEP_MS, maxSleep);
    const nextRunAt = Date.now() + sleepMs;

    await saveSchedule(context.cwd, {
      id: scheduleId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: 'assistant',
      sessionId: context.sessionId,
      actionType: 'message',
      command: '/main-loop',
      message: '/main-loop',
      description: 'Autonomous heartbeat (auto-created by stop hook)',
      status: 'active',
      schedule: {
        kind: 'once',
        at: new Date(nextRunAt).toISOString(),
      },
      nextRunAt,
    });
  } catch {
    // Non-blocking — if schedule creation fails, the watchdog will catch it
  }

  return null;
}

/**
 * Create the native Stop hook for auto-scheduling heartbeats.
 */
export function createAutoScheduleHeartbeatHook(): NativeHook {
  return {
    id: 'auto-schedule-heartbeat',
    name: 'Auto-schedule heartbeat',
    description: 'Ensures a heartbeat schedule exists after every agent turn when autonomous mode is enabled.',
    event: 'Stop',
    priority: 100, // Run after other Stop hooks
    handler: autoScheduleHeartbeatHandler,
  };
}
