import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';

// Mock state
let mockAgent: any = null;
let mockUpdatedAgent: any = null;
let updateSetData: any = null;
let deleteWasCalled = false;

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      agents: {
        findFirst: async () => mockAgent,
      },
    },
    update: (table: any) => ({
      set: (data: any) => {
        updateSetData = data;
        return {
          where: (condition: any) => ({
            returning: () => [mockUpdatedAgent || { ...mockAgent, ...data }],
          }),
        };
      },
    }),
    delete: (table: any) => ({
      where: (condition: any) => {
        deleteWasCalled = true;
        return Promise.resolve();
      },
    }),
  },
}));

// Mock db schema
mock.module('@/db/schema', () => ({
  agents: 'agents',
}));

// Mock auth middleware
mock.module('@/lib/auth/middleware', () => ({
  withAuth: (handler: any) => async (req: any, context: any) => {
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
    return handler(req, context);
  },
}));

// Mock drizzle-orm
mock.module('drizzle-orm', () => ({
  eq: (field: any, value: any) => ({ field, value }),
}));

const { GET, PATCH, DELETE } = await import('../src/app/api/v1/agents/[id]/route');

function createGetRequest(
  agentId: string,
  options: { token?: string } = {}
): [NextRequest, { params: { id: string } }] {
  const url = new URL(`http://localhost:3001/api/v1/agents/${agentId}`);

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  const request = new NextRequest(url, { headers });
  const context = { params: { id: agentId } };

  return [request, context];
}

function createPatchRequest(
  agentId: string,
  body: Record<string, unknown>,
  options: { token?: string } = {}
): [NextRequest, { params: { id: string } }] {
  const url = new URL(`http://localhost:3001/api/v1/agents/${agentId}`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  const request = new NextRequest(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  const context = { params: { id: agentId } };

  return [request, context];
}

function createDeleteRequest(
  agentId: string,
  options: { token?: string } = {}
): [NextRequest, { params: { id: string } }] {
  const url = new URL(`http://localhost:3001/api/v1/agents/${agentId}`);

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  const request = new NextRequest(url, { method: 'DELETE', headers });
  const context = { params: { id: agentId } };

  return [request, context];
}

describe('GET /api/v1/agents/:id', () => {
  beforeEach(() => {
    mockAgent = {
      id: 'agent-123',
      userId: 'user-123',
      name: 'Test Agent',
      description: 'A test agent',
      avatar: null,
      model: 'claude-3-opus',
      systemPrompt: 'You are a helpful assistant',
      settings: { temperature: 0.7 },
      isActive: true,
      createdAt: new Date(),
    };
    mockUpdatedAgent = null;
    updateSetData = null;
    deleteWasCalled = false;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL('http://localhost:3001/api/v1/agents/agent-123');
      const request = new NextRequest(url);
      const context = { params: { id: 'agent-123' } };

      const response = await GET(request, context);

      expect(response.status).toBe(401);
    });

    test('returns 401 for invalid token', async () => {
      const [request, context] = createGetRequest('agent-123', { token: 'invalid' });

      const response = await GET(request, context);

      expect(response.status).toBe(401);
    });
  });

  describe('agent retrieval', () => {
    test('returns agent when user owns it', async () => {
      const [request, context] = createGetRequest('agent-123');

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe('agent-123');
      expect(data.data.name).toBe('Test Agent');
    });

    test('returns 404 when agent not found', async () => {
      mockAgent = null;
      const [request, context] = createGetRequest('nonexistent');

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
    });

    test('returns 403 when agent belongs to different user', async () => {
      mockAgent = { ...mockAgent, userId: 'different-user' };
      const [request, context] = createGetRequest('agent-123');

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
    });
  });
});

describe('PATCH /api/v1/agents/:id', () => {
  beforeEach(() => {
    mockAgent = {
      id: 'agent-123',
      userId: 'user-123',
      name: 'Test Agent',
      description: 'A test agent',
      avatar: null,
      model: 'claude-3-opus',
      systemPrompt: 'You are a helpful assistant',
      settings: { temperature: 0.7 },
      isActive: true,
    };
    mockUpdatedAgent = null;
    updateSetData = null;
    deleteWasCalled = false;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL('http://localhost:3001/api/v1/agents/agent-123');
      const request = new NextRequest(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      });
      const context = { params: { id: 'agent-123' } };

      const response = await PATCH(request, context);

      expect(response.status).toBe(401);
    });
  });

  describe('agent updates', () => {
    test('updates agent name', async () => {
      const [request, context] = createPatchRequest('agent-123', { name: 'Updated Agent' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(updateSetData.name).toBe('Updated Agent');
    });

    test('updates agent description', async () => {
      const [request, context] = createPatchRequest('agent-123', { description: 'New description' });

      await PATCH(request, context);

      expect(updateSetData.description).toBe('New description');
    });

    test('updates avatar with valid URL', async () => {
      const [request, context] = createPatchRequest('agent-123', {
        avatar: 'https://example.com/avatar.png',
      });

      await PATCH(request, context);

      expect(updateSetData.avatar).toBe('https://example.com/avatar.png');
    });

    test('allows null avatar', async () => {
      const [request, context] = createPatchRequest('agent-123', { avatar: null });

      const response = await PATCH(request, context);

      expect(response.status).toBe(200);
      expect(updateSetData.avatar).toBeNull();
    });

    test('updates model', async () => {
      const [request, context] = createPatchRequest('agent-123', { model: 'claude-3-sonnet' });

      await PATCH(request, context);

      expect(updateSetData.model).toBe('claude-3-sonnet');
    });

    test('updates systemPrompt', async () => {
      const [request, context] = createPatchRequest('agent-123', {
        systemPrompt: 'New system prompt',
      });

      await PATCH(request, context);

      expect(updateSetData.systemPrompt).toBe('New system prompt');
    });

    test('updates settings object', async () => {
      const [request, context] = createPatchRequest('agent-123', {
        settings: {
          temperature: 0.5,
          maxTokens: 2000,
          tools: ['bash', 'read'],
          skills: ['skill1'],
        },
      });

      await PATCH(request, context);

      expect(updateSetData.settings.temperature).toBe(0.5);
      expect(updateSetData.settings.maxTokens).toBe(2000);
      expect(updateSetData.settings.tools).toEqual(['bash', 'read']);
    });

    test('updates isActive flag', async () => {
      const [request, context] = createPatchRequest('agent-123', { isActive: false });

      await PATCH(request, context);

      expect(updateSetData.isActive).toBe(false);
    });

    test('sets updatedAt timestamp', async () => {
      const [request, context] = createPatchRequest('agent-123', { name: 'New' });

      await PATCH(request, context);

      expect(updateSetData.updatedAt).toBeInstanceOf(Date);
    });

    test('accepts empty body', async () => {
      const [request, context] = createPatchRequest('agent-123', {});

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe('authorization', () => {
    test('returns 404 when agent not found', async () => {
      mockAgent = null;
      const [request, context] = createPatchRequest('nonexistent', { name: 'New' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
    });

    test('returns 403 when agent belongs to different user', async () => {
      mockAgent = { ...mockAgent, userId: 'different-user' };
      const [request, context] = createPatchRequest('agent-123', { name: 'New' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
    });
  });

  describe('validation', () => {
    test('returns 422 when name is empty', async () => {
      const [request, context] = createPatchRequest('agent-123', { name: '' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    test('returns 422 when name exceeds 255 characters', async () => {
      const [request, context] = createPatchRequest('agent-123', { name: 'a'.repeat(256) });

      const response = await PATCH(request, context);

      expect(response.status).toBe(422);
    });

    test('returns 422 for invalid avatar URL', async () => {
      const [request, context] = createPatchRequest('agent-123', { avatar: 'not-a-url' });

      const response = await PATCH(request, context);

      expect(response.status).toBe(422);
    });

    test('returns 422 for invalid temperature (> 2)', async () => {
      const [request, context] = createPatchRequest('agent-123', {
        settings: { temperature: 3 },
      });

      const response = await PATCH(request, context);

      expect(response.status).toBe(422);
    });

    test('returns 422 for negative maxTokens', async () => {
      const [request, context] = createPatchRequest('agent-123', {
        settings: { maxTokens: -100 },
      });

      const response = await PATCH(request, context);

      expect(response.status).toBe(422);
    });
  });
});

describe('DELETE /api/v1/agents/:id', () => {
  beforeEach(() => {
    mockAgent = {
      id: 'agent-123',
      userId: 'user-123',
      name: 'Test Agent',
    };
    mockUpdatedAgent = null;
    updateSetData = null;
    deleteWasCalled = false;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL('http://localhost:3001/api/v1/agents/agent-123');
      const request = new NextRequest(url, { method: 'DELETE' });
      const context = { params: { id: 'agent-123' } };

      const response = await DELETE(request, context);

      expect(response.status).toBe(401);
    });
  });

  describe('agent deletion', () => {
    test('deletes agent and returns success', async () => {
      const [request, context] = createDeleteRequest('agent-123');

      const response = await DELETE(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.message).toBe('Agent deleted');
      expect(deleteWasCalled).toBe(true);
    });
  });

  describe('authorization', () => {
    test('returns 404 when agent not found', async () => {
      mockAgent = null;
      const [request, context] = createDeleteRequest('nonexistent');

      const response = await DELETE(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(deleteWasCalled).toBe(false);
    });

    test('returns 403 when agent belongs to different user', async () => {
      mockAgent = { ...mockAgent, userId: 'different-user' };
      const [request, context] = createDeleteRequest('agent-123');

      const response = await DELETE(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(deleteWasCalled).toBe(false);
    });
  });
});
