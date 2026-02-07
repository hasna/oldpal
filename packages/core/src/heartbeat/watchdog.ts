/**
 * Watchdog schedule initializer.
 *
 * Creates (or verifies) a fixed-interval schedule for the `/watchdog` skill.
 * The watchdog runs independently of the main heartbeat and acts as a safety net.
 */

import { getSchedule, saveSchedule } from '../scheduler/store';
import { WATCHDOG_SCHEDULE_ID, DEFAULT_WATCHDOG_INTERVAL_MS } from './conventions';

/**
 * Ensure the watchdog schedule exists and is active.
 *
 * @param cwd       Project working directory (schedules are stored per-project)
 * @param sessionId Session that owns the watchdog
 * @param intervalMs  Polling interval in ms (default: 1 hour)
 */
export async function ensureWatchdogSchedule(
  cwd: string,
  sessionId: string,
  intervalMs: number = DEFAULT_WATCHDOG_INTERVAL_MS,
): Promise<void> {
  const existing = await getSchedule(cwd, WATCHDOG_SCHEDULE_ID);
  if (existing && existing.status === 'active') {
    return; // Already running
  }

  // Convert ms to seconds for the interval schedule
  const intervalSeconds = Math.max(60, Math.round(intervalMs / 1000));
  const nextRunAt = Date.now() + intervalMs;

  await saveSchedule(cwd, {
    id: WATCHDOG_SCHEDULE_ID,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: 'assistant',
    sessionId,
    actionType: 'message',
    command: '/watchdog',
    message: '/watchdog',
    description: 'Heartbeat watchdog — checks agent health and forces wakeup if overdue.',
    status: 'active',
    schedule: {
      kind: 'interval',
      interval: intervalSeconds,
      unit: 'seconds',
    },
    nextRunAt,
  });
}
