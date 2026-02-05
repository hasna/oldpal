import { db } from '@/db';
import { schedules, scheduleExecutions, agents } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { ForbiddenError, NotFoundError } from '@/lib/api/errors';
import { eq } from 'drizzle-orm';
import type { StreamChunk } from '@hasna/assistants-shared';
import { EmbeddedClient } from '@hasna/assistants-core';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Maximum execution timeout (5 minutes)
const EXECUTION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Execute a schedule command and return the result
 */
async function executeScheduleCommand(
  command: string,
  agentId: string | null,
  userId: string
): Promise<{
  status: 'success' | 'failure' | 'timeout';
  output: string;
  error?: string;
}> {
  return new Promise(async (resolve) => {
    const chunks: string[] = [];
    let hasError = false;
    let errorMessage: string | undefined;
    let timedOut = false;

    // Create a temporary session ID for this execution
    const sessionId = `schedule-exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Get agent settings if specified
    let allowedTools: string[] | undefined;
    let systemPrompt: string | undefined;
    let model: string | undefined;

    if (agentId) {
      const agent = await db.query.agents.findFirst({
        where: eq(agents.id, agentId),
        columns: { settings: true, systemPrompt: true, model: true },
      });

      if (agent) {
        allowedTools = (agent.settings as any)?.tools;
        systemPrompt = agent.systemPrompt || undefined;
        model = agent.model || undefined;
      }
    }

    const client = new EmbeddedClient(process.cwd(), {
      sessionId,
      allowedTools,
      systemPrompt,
      model,
    });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      timedOut = true;
      client.stop();
      client.disconnect();
      resolve({
        status: 'timeout',
        output: chunks.join(''),
        error: `Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000} seconds`,
      });
    }, EXECUTION_TIMEOUT_MS);

    // Collect output chunks
    client.onChunk((chunk: StreamChunk) => {
      if (timedOut) return;

      if (chunk.type === 'text' && chunk.content) {
        chunks.push(chunk.content);
      } else if (chunk.type === 'error') {
        hasError = true;
        errorMessage = chunk.content || chunk.error;
      } else if (chunk.type === 'done') {
        clearTimeout(timeoutId);
        client.disconnect();
        resolve({
          status: hasError ? 'failure' : 'success',
          output: chunks.join(''),
          error: errorMessage,
        });
      }
    });

    client.onError((error: Error) => {
      if (timedOut) return;
      clearTimeout(timeoutId);
      hasError = true;
      errorMessage = error.message;
      client.disconnect();
      resolve({
        status: 'failure',
        output: chunks.join(''),
        error: error.message,
      });
    });

    try {
      await client.initialize();
      await client.send(command);
    } catch (error) {
      if (timedOut) return;
      clearTimeout(timeoutId);
      client.disconnect();
      resolve({
        status: 'failure',
        output: chunks.join(''),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

// POST /api/v1/schedules/[id]/run - Manually trigger a schedule
export const POST = withAuth(async (request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;

    if (!UUID_REGEX.test(id)) {
      return errorResponse(new NotFoundError('Schedule not found'));
    }

    // Verify ownership
    const schedule = await db.query.schedules.findFirst({
      where: eq(schedules.id, id),
    });

    if (!schedule) {
      return errorResponse(new NotFoundError('Schedule not found'));
    }

    if (schedule.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('You do not own this schedule'));
    }

    const startedAt = new Date();

    // Execute the schedule command
    const result = await executeScheduleCommand(
      schedule.command,
      schedule.agentId,
      schedule.userId
    );

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    // Truncate output for summary (keep first 500 chars)
    const summary = result.output.length > 500
      ? result.output.slice(0, 500) + '...'
      : result.output || (result.status === 'success' ? 'Completed successfully' : 'Execution failed');

    // Create execution record with real results
    const [execution] = await db
      .insert(scheduleExecutions)
      .values({
        scheduleId: id,
        status: result.status,
        trigger: 'manual',
        durationMs,
        result: {
          summary,
          output: result.output,
        },
        error: result.error,
        startedAt,
        completedAt,
      })
      .returning();

    // Update lastRunAt and set lastResult
    const [updated] = await db
      .update(schedules)
      .set({
        lastRunAt: startedAt,
        lastResult: {
          ok: result.status === 'success',
          summary,
          error: result.error,
          completedAt: completedAt.toISOString(),
        },
        updatedAt: completedAt,
      })
      .where(eq(schedules.id, id))
      .returning();

    return successResponse({
      success: result.status === 'success',
      schedule: updated,
      execution,
      message: result.status === 'success'
        ? `Schedule "${schedule.description || schedule.command}" completed successfully.`
        : `Schedule "${schedule.description || schedule.command}" ${result.status === 'timeout' ? 'timed out' : 'failed'}: ${result.error || 'Unknown error'}`,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
