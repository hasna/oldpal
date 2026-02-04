import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { getConfigDir } from '../config';
import type { Heartbeat, PersistedState } from './types';

/**
 * Information about a session that can be recovered
 */
export interface RecoverableSession {
  sessionId: string;
  heartbeat: Heartbeat;
  state: PersistedState;
  sessionPath: string;
  cwd: string;
  lastActivity: Date;
  messageCount: number;
}

/**
 * Find sessions that crashed or were terminated unexpectedly and can be recovered.
 * A session is considered recoverable if:
 * 1. It has a heartbeat file that hasn't been updated for longer than staleThresholdMs
 * 2. It has a corresponding state file with session data
 * 3. The state is not too old (within maxAgeMs)
 *
 * @param staleThresholdMs - Time in ms after which a heartbeat is considered stale (default: 2 minutes)
 * @param maxAgeMs - Maximum age of state to consider for recovery (default: 24 hours)
 * @returns Array of recoverable sessions, sorted by most recent first
 */
export function findRecoverableSessions(
  staleThresholdMs = 120000,
  maxAgeMs = 24 * 60 * 60 * 1000
): RecoverableSession[] {
  const configDir = getConfigDir();
  const heartbeatsDir = join(configDir, 'heartbeats');
  const stateDir = join(configDir, 'state');
  const sessionsDir = join(configDir, 'sessions');

  const recoverableSessions: RecoverableSession[] = [];

  // Check if heartbeats directory exists
  if (!existsSync(heartbeatsDir)) {
    return recoverableSessions;
  }

  const now = Date.now();

  // Scan heartbeat files
  const heartbeatFiles = readdirSync(heartbeatsDir).filter((f) => f.endsWith('.json'));

  for (const file of heartbeatFiles) {
    const sessionId = file.replace('.json', '');
    const heartbeatPath = join(heartbeatsDir, file);
    const statePath = join(stateDir, `${sessionId}.json`);
    const sessionPath = join(sessionsDir, `${sessionId}.json`);

    try {
      // Read heartbeat
      const heartbeatContent = readFileSync(heartbeatPath, 'utf-8');
      const heartbeat = JSON.parse(heartbeatContent) as Heartbeat;
      const heartbeatAge = now - new Date(heartbeat.timestamp).getTime();

      // Skip if heartbeat is recent (session is still active)
      if (heartbeatAge < staleThresholdMs) {
        continue;
      }

      // Read state file if it exists
      let state: PersistedState | null = null;
      if (existsSync(statePath)) {
        const stateContent = readFileSync(statePath, 'utf-8');
        state = JSON.parse(stateContent) as PersistedState;
      }

      // Skip if state is too old
      if (state) {
        const stateAge = now - new Date(state.timestamp).getTime();
        if (stateAge > maxAgeMs) {
          continue;
        }
      }

      // Try to get message count from session storage
      let messageCount = 0;
      let cwd = state?.context?.cwd || process.cwd();
      if (existsSync(sessionPath)) {
        try {
          const sessionContent = readFileSync(sessionPath, 'utf-8');
          const sessionData = JSON.parse(sessionContent) as { messages?: unknown[]; cwd?: string };
          messageCount = sessionData.messages?.length || 0;
          cwd = sessionData.cwd || cwd;
        } catch {
          // Ignore parse errors
        }
      }

      // Skip if no meaningful data to recover (no state and no messages)
      if (!state && messageCount === 0) {
        continue;
      }

      // This session is recoverable
      recoverableSessions.push({
        sessionId,
        heartbeat,
        state: state || {
          sessionId,
          heartbeat,
          context: { cwd },
          timestamp: heartbeat.timestamp,
        },
        sessionPath,
        cwd,
        lastActivity: new Date(heartbeat.lastActivity || heartbeat.timestamp),
        messageCount,
      });
    } catch {
      // Skip files that can't be parsed
      continue;
    }
  }

  // Sort by most recent activity first
  recoverableSessions.sort(
    (a, b) => b.lastActivity.getTime() - a.lastActivity.getTime()
  );

  return recoverableSessions;
}

/**
 * Clean up heartbeat and state files for a recovered or discarded session
 */
export function clearRecoveryState(sessionId: string): void {
  const configDir = getConfigDir();
  const heartbeatPath = join(configDir, 'heartbeats', `${sessionId}.json`);
  const statePath = join(configDir, 'state', `${sessionId}.json`);

  // Only delete heartbeat and state files (not session storage, which is valuable history)
  const { unlinkSync } = require('fs');
  try {
    if (existsSync(heartbeatPath)) {
      unlinkSync(heartbeatPath);
    }
  } catch {
    // Ignore
  }
  try {
    if (existsSync(statePath)) {
      unlinkSync(statePath);
    }
  } catch {
    // Ignore
  }
}
