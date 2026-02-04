import { db } from '@/db';
import { adminAuditLogs } from '@/db/schema';
import { NextRequest } from 'next/server';

export interface AuditLogParams {
  adminUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
  metadata?: Record<string, unknown>;
  request?: NextRequest;
}

export async function logAdminAction(params: AuditLogParams): Promise<void> {
  const ipAddress = params.request
    ? params.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      params.request.headers.get('x-real-ip') ||
      null
    : null;

  await db.insert(adminAuditLogs).values({
    adminUserId: params.adminUserId,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    changes: params.changes,
    metadata: params.metadata,
    ipAddress,
  });
}

export function computeChanges<T extends Record<string, unknown>>(
  oldValues: T,
  newValues: Partial<T>
): Record<string, { old: unknown; new: unknown }> | undefined {
  const changes: Record<string, { old: unknown; new: unknown }> = {};

  for (const key of Object.keys(newValues) as Array<keyof T>) {
    if (newValues[key] !== undefined && oldValues[key] !== newValues[key]) {
      changes[key as string] = {
        old: oldValues[key],
        new: newValues[key],
      };
    }
  }

  return Object.keys(changes).length > 0 ? changes : undefined;
}
