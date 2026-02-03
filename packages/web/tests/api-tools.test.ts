import { describe, expect, test, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';

// Mock auth middleware
mock.module('@/lib/auth/middleware', () => ({
  withAuth: (handler: any) => async (req: any) => {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
        { status: 401 }
      );
    }
    const token = authHeader.substring(7);
    if (token === 'invalid') {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }
    (req as any).user = { userId: 'user-123', email: 'test@example.com', role: 'user' };
    return handler(req);
  },
}));

const { GET } = await import('../src/app/api/v1/tools/route');

function createRequest(options: { token?: string } = {}): NextRequest {
  const url = new URL('http://localhost:3001/api/v1/tools');

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  return new NextRequest(url, { headers });
}

describe('GET /api/v1/tools', () => {
  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL('http://localhost:3001/api/v1/tools');
      const request = new NextRequest(url);

      const response = await GET(request);

      expect(response.status).toBe(401);
    });

    test('returns 401 for invalid token', async () => {
      const request = createRequest({ token: 'invalid' });

      const response = await GET(request);

      expect(response.status).toBe(401);
    });
  });

  describe('tools listing', () => {
    test('returns list of available tools', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.tools).toBeDefined();
      expect(Array.isArray(data.data.tools)).toBe(true);
    });

    test('returns count of tools', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.count).toBeDefined();
      expect(typeof data.data.count).toBe('number');
      expect(data.data.count).toBe(data.data.tools.length);
    });

    test('each tool has required fields', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      for (const tool of data.data.tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('category');
      }
    });

    test('includes system category tools', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      const systemTools = data.data.tools.filter((t: any) => t.category === 'system');
      expect(systemTools.length).toBeGreaterThan(0);
    });

    test('includes filesystem category tools', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      const fsTools = data.data.tools.filter((t: any) => t.category === 'filesystem');
      expect(fsTools.length).toBeGreaterThan(0);
    });

    test('includes web category tools', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      const webTools = data.data.tools.filter((t: any) => t.category === 'web');
      expect(webTools.length).toBeGreaterThan(0);
    });

    test('includes bash tool', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      const bashTool = data.data.tools.find((t: any) => t.name === 'bash');
      expect(bashTool).toBeDefined();
      expect(bashTool.category).toBe('system');
    });

    test('includes read-file tool', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      const readFileTool = data.data.tools.find((t: any) => t.name === 'read-file');
      expect(readFileTool).toBeDefined();
      expect(readFileTool.category).toBe('filesystem');
    });

    test('includes write-file tool', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      const writeFileTool = data.data.tools.find((t: any) => t.name === 'write-file');
      expect(writeFileTool).toBeDefined();
      expect(writeFileTool.category).toBe('filesystem');
    });

    test('includes list-files tool', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      const listFilesTool = data.data.tools.find((t: any) => t.name === 'list-files');
      expect(listFilesTool).toBeDefined();
    });

    test('includes search-files tool', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      const searchFilesTool = data.data.tools.find((t: any) => t.name === 'search-files');
      expect(searchFilesTool).toBeDefined();
    });

    test('includes web-fetch tool', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      const webFetchTool = data.data.tools.find((t: any) => t.name === 'web-fetch');
      expect(webFetchTool).toBeDefined();
      expect(webFetchTool.category).toBe('web');
    });

    test('all tools have non-empty descriptions', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      for (const tool of data.data.tools) {
        expect(tool.description).toBeTruthy();
        expect(tool.description.length).toBeGreaterThan(0);
      }
    });
  });
});
