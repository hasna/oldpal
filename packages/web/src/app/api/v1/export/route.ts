import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { sessions, messages, assistants, schedules } from '@/db/schema';
import { eq, and, asc, desc } from 'drizzle-orm';
import { getAuthUser } from '@/lib/auth/middleware';

export const runtime = 'nodejs';

type ExportFormat = 'json' | 'csv' | 'markdown';
type ExportType = 'all' | 'sessions' | 'assistants' | 'messages';

interface ExportData {
  exportedAt: string;
  user: {
    id: string;
    email: string;
    name: string | null;
  };
  sessions?: Array<{
    id: string;
    label: string | null;
    createdAt: string;
    updatedAt: string;
    messages: Array<{
      id: string;
      role: string;
      content: string;
      createdAt: string;
    }>;
  }>;
  assistants?: Array<{
    id: string;
    name: string;
    description: string | null;
    model: string;
    systemPrompt: string | null;
    isActive: boolean;
    createdAt: string;
  }>;
  schedules?: Array<{
    id: string;
    description: string | null;
    command: string;
    scheduleKind: string;
    scheduleCron: string | null;
    status: string;
    lastRunAt: string | null;
    nextRunAt: string | null;
    createdAt: string;
  }>;
}

function toCSV<T extends Record<string, unknown>>(data: T[], fields: (keyof T)[]): string {
  if (data.length === 0) return '';

  const header = fields.join(',');
  const rows = data.map(item =>
    fields.map(field => {
      const value = item[field];
      if (value === null || value === undefined) return '';
      const str = String(value);
      // Escape quotes and wrap in quotes if contains comma or newline
      if (str.includes(',') || str.includes('\n') || str.includes('"')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',')
  );

  return [header, ...rows].join('\n');
}

function toMarkdown(data: ExportData): string {
  const lines: string[] = [];

  lines.push(`# Data Export for ${data.user.email}`);
  lines.push(`Exported at: ${data.exportedAt}`);
  lines.push('');

  if (data.assistants && data.assistants.length > 0) {
    lines.push('## Assistants');
    lines.push('');
    for (const assistant of data.assistants) {
      lines.push(`### ${assistant.name}`);
      if (assistant.description) lines.push(`*${assistant.description}*`);
      lines.push('');
      lines.push(`- **Model:** ${assistant.model}`);
      lines.push(`- **Active:** ${assistant.isActive ? 'Yes' : 'No'}`);
      lines.push(`- **Created:** ${new Date(assistant.createdAt).toLocaleString()}`);
      if (assistant.systemPrompt) {
        lines.push('');
        lines.push('**System Prompt:**');
        lines.push('```');
        lines.push(assistant.systemPrompt);
        lines.push('```');
      }
      lines.push('');
    }
  }

  if (data.sessions && data.sessions.length > 0) {
    lines.push('## Sessions');
    lines.push('');
    for (const session of data.sessions) {
      lines.push(`### ${session.label || 'Untitled Session'}`);
      lines.push(`*Created: ${new Date(session.createdAt).toLocaleString()}*`);
      lines.push('');

      if (session.messages.length > 0) {
        for (const msg of session.messages) {
          const role = msg.role === 'user' ? '**You**' : '**Assistant**';
          lines.push(`${role}:`);
          lines.push('');
          lines.push(msg.content);
          lines.push('');
          lines.push('---');
          lines.push('');
        }
      } else {
        lines.push('*No messages*');
        lines.push('');
      }
    }
  }

  if (data.schedules && data.schedules.length > 0) {
    lines.push('## Schedules');
    lines.push('');
    for (const schedule of data.schedules) {
      lines.push(`### ${schedule.description || 'Unnamed Schedule'}`);
      lines.push('');
      lines.push(`- **Type:** ${schedule.scheduleKind}`);
      if (schedule.scheduleCron) {
        lines.push(`- **Cron:** \`${schedule.scheduleCron}\``);
      }
      lines.push(`- **Status:** ${schedule.status}`);
      lines.push(`- **Last Run:** ${schedule.lastRunAt ? new Date(schedule.lastRunAt).toLocaleString() : 'Never'}`);
      lines.push('');
      lines.push('**Command:**');
      lines.push('');
      lines.push(schedule.command);
      lines.push('');
    }
  }

  return lines.join('\n');
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const format = (searchParams.get('format') || 'json') as ExportFormat;
  const type = (searchParams.get('type') || 'all') as ExportType;
  const sessionId = searchParams.get('sessionId');

  try {
    const exportData: ExportData = {
      exportedAt: new Date().toISOString(),
      user: {
        id: user.userId,
        email: user.email,
        name: null, // Name not available in token, only email
      },
    };

    // Export specific session
    if (sessionId) {
      const sessionRows = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, user.userId)));

      if (sessionRows.length === 0) {
        return NextResponse.json(
          { success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } },
          { status: 404 }
        );
      }

      const session = sessionRows[0];
      const sessionMessages = await db
        .select()
        .from(messages)
        .where(eq(messages.sessionId, sessionId))
        .orderBy(asc(messages.createdAt));

      exportData.sessions = [{
        id: session.id,
        label: session.label,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        messages: sessionMessages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt.toISOString(),
        })),
      }];
    }
    // Export all user data
    else if (type === 'all' || type === 'sessions') {
      const userSessions = await db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, user.userId))
        .orderBy(desc(sessions.updatedAt));

      const sessionData = await Promise.all(
        userSessions.map(async (session) => {
          const sessionMessages = await db
            .select()
            .from(messages)
            .where(eq(messages.sessionId, session.id))
            .orderBy(asc(messages.createdAt));

          return {
            id: session.id,
            label: session.label,
            createdAt: session.createdAt.toISOString(),
            updatedAt: session.updatedAt.toISOString(),
            messages: sessionMessages.map(m => ({
              id: m.id,
              role: m.role,
              content: m.content,
              createdAt: m.createdAt.toISOString(),
            })),
          };
        })
      );

      exportData.sessions = sessionData;
    }

    if (type === 'all' || type === 'assistants') {
      const userAssistants = await db
        .select()
        .from(assistants)
        .where(eq(assistants.userId, user.userId))
        .orderBy(desc(assistants.createdAt));

      exportData.assistants = userAssistants.map(a => ({
        id: a.id,
        name: a.name,
        description: a.description,
        model: a.model,
        systemPrompt: a.systemPrompt,
        isActive: a.isActive,
        createdAt: a.createdAt.toISOString(),
      }));
    }

    if (type === 'all') {
      const userSchedules = await db
        .select()
        .from(schedules)
        .where(eq(schedules.userId, user.userId))
        .orderBy(desc(schedules.createdAt));

      exportData.schedules = userSchedules.map(s => ({
        id: s.id,
        description: s.description,
        command: s.command,
        scheduleKind: s.scheduleKind,
        scheduleCron: s.scheduleCron,
        status: s.status,
        lastRunAt: s.lastRunAt?.toISOString() || null,
        nextRunAt: s.nextRunAt?.toISOString() || null,
        createdAt: s.createdAt.toISOString(),
      }));
    }

    // Format the output
    let content: string;
    let contentType: string;
    let filename: string;
    const timestamp = new Date().toISOString().split('T')[0];

    if (format === 'csv') {
      // For CSV, flatten sessions with messages
      if (exportData.sessions) {
        const flatMessages = exportData.sessions.flatMap(s =>
          s.messages.map(m => ({
            sessionId: s.id,
            sessionLabel: s.label || '',
            messageId: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
          }))
        );
        content = toCSV(flatMessages, ['sessionId', 'sessionLabel', 'messageId', 'role', 'content', 'createdAt']);
      } else if (exportData.assistants) {
        content = toCSV(exportData.assistants, ['id', 'name', 'description', 'model', 'isActive', 'createdAt']);
      } else {
        content = '';
      }
      contentType = 'text/csv';
      filename = `assistants-export-${type}-${timestamp}.csv`;
    } else if (format === 'markdown') {
      content = toMarkdown(exportData);
      contentType = 'text/markdown';
      filename = `assistants-export-${type}-${timestamp}.md`;
    } else {
      content = JSON.stringify(exportData, null, 2);
      contentType = 'application/json';
      filename = `assistants-export-${type}-${timestamp}.json`;
    }

    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'EXPORT_ERROR', message: 'Failed to export data' } },
      { status: 500 }
    );
  }
}
