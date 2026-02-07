import { z } from 'zod';
import { ConnectorBridge, ConnectorAutoRefreshManager } from '@hasna/assistants-core';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';

const querySchema = z.object({
  name: z.string().optional(),
  verbose: z.enum(['true', 'false']).optional(),
  includeAuth: z.enum(['true', 'false']).optional(),
  refresh: z.enum(['true', 'false']).optional(),
});

export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      name: searchParams.get('name') || undefined,
      verbose: searchParams.get('verbose') || undefined,
      includeAuth: searchParams.get('includeAuth') || undefined,
      refresh: searchParams.get('refresh') || undefined,
    });

    const name = parsed.success ? parsed.data.name?.trim() : undefined;
    const verbose = parsed.success ? parsed.data.verbose === 'true' : false;
    const includeAuth = parsed.success ? parsed.data.includeAuth === 'true' : false;
    const refresh = parsed.success ? parsed.data.refresh === 'true' : false;

    const bridge = new ConnectorBridge(process.cwd());
    if (refresh) {
      await bridge.refresh(name ? [name] : undefined);
    } else {
      await bridge.discover(name ? [name] : undefined);
    }

    let connectors = bridge.getConnectors();
    if (name) {
      const lower = name.toLowerCase();
      connectors = connectors.filter((connector) => connector.name.toLowerCase() === lower);
    }

    const autoRefreshManager = ConnectorAutoRefreshManager.getInstance();
    await autoRefreshManager.start();

    const authStatuses = new Map<string, { authenticated: boolean; user?: string; email?: string; error?: string }>();
    if (includeAuth) {
      const results = await Promise.all(
        connectors.map(async (connector) => {
          try {
            const status = await bridge.checkAuthStatus(connector);
            return { name: connector.name, status };
          } catch (error) {
            return {
              name: connector.name,
              status: {
                authenticated: false,
                error: error instanceof Error ? error.message : 'Failed to check auth status',
              },
            };
          }
        })
      );
      for (const result of results) {
        authStatuses.set(result.name, result.status);
      }
    }

    const items = connectors.map((connector) => {
      const autoRefreshEntry = autoRefreshManager.get(connector.name);
      return {
        name: connector.name,
        description: connector.description,
        cli: connector.cli,
        commands: verbose
          ? connector.commands.map((cmd) => ({
              name: cmd.name,
              description: cmd.description,
              args: cmd.args.map((arg) => ({
                name: arg.name,
                description: arg.description,
                required: arg.required,
              })),
              options: cmd.options.map((opt) => ({
                name: opt.name,
                description: opt.description,
                default: opt.default,
              })),
            }))
          : undefined,
        auth: includeAuth ? (authStatuses.get(connector.name) || null) : undefined,
        autoRefresh: autoRefreshEntry
          ? {
              enabled: autoRefreshEntry.enabled,
              schedule: autoRefreshEntry.schedule,
              command: autoRefreshEntry.command,
              nextRunAt: autoRefreshEntry.nextRunAt,
              lastRunAt: autoRefreshEntry.lastRunAt,
              lastResult: autoRefreshEntry.lastResult,
            }
          : null,
      };
    });

    return successResponse({ items, total: items.length });
  } catch (error) {
    return errorResponse(error);
  }
});
