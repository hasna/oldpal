import { z } from 'zod';
import { spawn } from 'child_process';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { db } from '@/db';
import { sessions } from '@/db/schema';
import { and, eq } from 'drizzle-orm';

const shellSchema = z.object({
  command: z.string().min(1).max(5000),
  sessionId: z.string().uuid().optional(),
});

const MAX_OUTPUT_CHARS = 64 * 1024;

type ShellResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  truncated: boolean;
};

async function runShellCommand(command: string, cwd: string): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, env: process.env });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let totalBytes = 0;
    let truncated = false;

    const collect = (chunk: Buffer, target: Buffer[]) => {
      if (totalBytes >= MAX_OUTPUT_CHARS) {
        truncated = true;
        return;
      }
      const remaining = MAX_OUTPUT_CHARS - totalBytes;
      if (chunk.length > remaining) {
        target.push(chunk.slice(0, remaining));
        totalBytes = MAX_OUTPUT_CHARS;
        truncated = true;
        return;
      }
      target.push(chunk);
      totalBytes += chunk.length;
    };

    if (child.stdout) {
      child.stdout.on('data', (chunk: Buffer) => collect(chunk, stdoutChunks));
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => collect(chunk, stderrChunks));
    }

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8').trimEnd(),
        stderr: Buffer.concat(stderrChunks).toString('utf8').trimEnd(),
        exitCode: typeof code === 'number' ? code : null,
        truncated,
      });
    });
  });
}

export const POST = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const body = await request.json();
    const data = shellSchema.parse(body);

    let cwd = process.cwd();
    if (data.sessionId) {
      const session = await db.query.sessions.findFirst({
        where: and(eq(sessions.id, data.sessionId), eq(sessions.userId, request.user.userId)),
        columns: { cwd: true },
      });
      if (session?.cwd) {
        cwd = session.cwd;
      }
    }

    try {
      const result = await runShellCommand(data.command, cwd);
      return successResponse({
        ok: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        truncated: result.truncated,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return successResponse({
        ok: false,
        stdout: '',
        stderr: message,
        exitCode: null,
        truncated: false,
      });
    }
  } catch (error) {
    return errorResponse(error);
  }
});
