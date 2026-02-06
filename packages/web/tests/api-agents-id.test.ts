import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';

// Mock state
let mockAssistant: any = null;
let mockUpdatedAssistant: any = null;
let updateSetData: any = null;
let deleteWasCalled = false;

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      assistants: {
        findFirst: async () => mockAssistant,
      },
    },
    update: (table: any) => ({
      set: (data: any) => {
        updateSetData = data;
        return {
          where: (condition: any) => ({
            returning: () => [mockUpdatedAssistant || { ...mockAssistant, ...data }],
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
  assistants: 'assistants',
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

const { GET, PATCH, DELETE } = await import('../src/app/api/v1/assistants/[id]/route');

function createGetRequest(
  assistantId: string,
  options: { token?: string } = {}
): [NextRequest, { params: { id: string } }] {
  const url = new URL(`http://localhost:3001/api/v1/assistants/${assistantId}`);

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  const request = new NextRequest(url, { headers });
  const context = { params: { id: assistantId } };

  return [request, context];
}

function createPatchRequest(
  assistantId: string,
  body: Record<string, unknown>,
  options: { token?: string } = {}
): [NextRequest, { params: { id: string } }] {
  const url = new URL(`http://localhost:3001/api/v1/assistants/${assistantId}`);

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
  const context = { params: { id: assistantId } };

  return [request, context];
}

function createDeleteRequest(
  assistantId: string,
  options: { token?: string } = {}
): [NextRequest, { params: { id: string } }] {
  const url = new URL(`http://localhost:3001/api/v1/assistants/${assistantId}`);

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  const request = new NextRequest(url, { method: 'DELETE', headers });
  const context = { params: { id: assistantId } };

  return [request, context];
}

describe('GET /api/v1/assistants/:id', () => {
  beforeEach(() => {
    mockAssistant = {
      id: 'assistant-123',
      userId: 'user-123',
      name: 'Test Assistant',
      description: 'A test assistant',
      avatar: null,
      model: 'claude-3-opus',
      systemPrompt: 'You are a helpful assistant',
      settings: { temperature: 0.7 },
      isActive: true,
      createdAt: new Date(),
    };
    mockUpdatedAssistant = null;
    updateSetData = null;
    deleteWasCalled = false;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL('http://localhost:3001/api/v1/assistants/assistant-123');
      const request = new NextRequest(url);
      const context = { params: { id: 'assistant-123' } };

      const response = await GET(request, context);

      expect(response.status).toBe(401);
    });

    test('returns 401 for invalid token', async () => {
      const [request, context] = createGetRequest('assistant-123', { token: 'invalid' });

      const response = await GET(request, context);

      expect(response.status).toBe(401);
    });
  });

  describe('assistant retrieval', () => {
    test('returns assistant when user owns it', async () => {
      const [request, context] = createGetRequest('assistant-123');

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe('assistant-123');
      expect(data.data.name).toBe('Test Assistant');
    });

    test('returns 404 when assistant not found', async () => {
      mockAssistant = null;
      const [request, context] = createGetRequest('nonexistent');

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
    });

    test('returns 403 when assistant belongs to different user', async () => {
      mockAssistant = { ...mockAssistant, userId: 'different-user' };
      const [request, context] = createGetRequest('assistant-123');

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
    });
  });
});

describe('PATCH /api/v1/assistants/:id', () => {
  beforeEach(() => {
    mockAssistant = {
      id: 'assistant-123',
      userId: 'user-123',
      name: 'Test Assistant',
      description: 'A test assistant',
      avatar: null,
      model: 'claude-3-opus',
      systemPrompt: 'You are a helpful assistant',
      settings: { temperature: 0.7 },
      isActive: true,
    };
    mockUpdatedAssistant = null;
    updateSetData = null;
    deleteWasCalled = false;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL('http://localhost:3001/api/v1/assistants/assistant-123');
      const request = new NextRequest(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      });
      const context = { params: { id: 'assistant-123' } };

      const response = await PATCH(request, context);

      expect(response.status).toBe(401);
    });
  });

  describe('assistant updates', () => {
    test('updates assistant name', async () => {
      const [request, context] = createPatchRequest('assistant-123', { name: 'Updated Assistant' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(updateSetData.name).toBe('Updated Assistant');
    });

    test('updates assistant description', async () => {
      const [request, context] = createPatchRequest('assistant-123', { description: 'New description' });

      await PATCH(request, context);

      expect(updateSetData.description).toBe('New description');
    });

    test('updates avatar with valid URL', async () => {
      const [request, context] = createPatchRequest('assistant-123', {
        avatar: 'https://example.com/avatar.png',
      });

      await PATCH(request, context);

      expect(updateSetData.avatar).toBe('https://example.com/avatar.png');
    });

    test('allows null avatar', async () => {
      const [request, context] = createPatchRequest('assistant-123', { avatar: null });

      const response = await PATCH(request, context);

      expect(response.status).toBe(200);
      expect(updateSetData.avatar).toBeNull();
    });

    test('updates model', async () => {
      const [request, context] = createPatchRequest('assistant-123', { model: 'claude-3-sonnet' });

      await PATCH(request, context);

      expect(updateSetData.model).toBe('claude-3-sonnet');
    });

    test('updates systemPrompt', async () => {
      const [request, context] = createPatchRequest('assistant-123', {
        systemPrompt: 'New system prompt',
      });

      await PATCH(request, context);

      expect(updateSetData.systemPrompt).toBe('New system prompt');
    });

    test('updates settings object', async () => {
      const [request, context] = createPatchRequest('assistant-123', {
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
      const [request, context] = createPatchRequest('assistant-123', { isActive: false });

      await PATCH(request, context);

      expect(updateSetData.isActive).toBe(false);
    });

    test('sets updatedAt timestamp', async () => {
      const [request, context] = createPatchRequest('assistant-123', { name: 'New' });

      await PATCH(request, context);

      expect(updateSetData.updatedAt).toBeInstanceOf(Date);
    });

    test('accepts empty body', async () => {
      const [request, context] = createPatchRequest('assistant-123', {});

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe('authorization', () => {
    test('returns 404 when assistant not found', async () => {
      mockAssistant = null;
      const [request, context] = createPatchRequest('nonexistent', { name: 'New' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
    });

    test('returns 403 when assistant belongs to different user', async () => {
      mockAssistant = { ...mockAssistant, userId: 'different-user' };
      const [request, context] = createPatchRequest('assistant-123', { name: 'New' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
    });
  });

  describe('validation', () => {
    test('returns 422 when name is empty', async () => {
      const [request, context] = createPatchRequest('assistant-123', { name: '' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    test('returns 422 when name exceeds 255 characters', async () => {
      const [request, context] = createPatchRequest('assistant-123', { name: 'a'.repeat(256) });

      const response = await PATCH(request, context);

      expect(response.status).toBe(422);
    });

    test('returns 422 for invalid avatar URL', async () => {
      const [request, context] = createPatchRequest('assistant-123', { avatar: 'not-a-url' });

      const response = await PATCH(request, context);

      expect(response.status).toBe(422);
    });

    test('returns 422 for invalid temperature (> 2)', async () => {
      const [request, context] = createPatchRequest('assistant-123', {
        settings: { temperature: 3 },
      });

      const response = await PATCH(request, context);

      expect(response.status).toBe(422);
    });

    test('returns 422 for negative maxTokens', async () => {
      const [request, context] = createPatchRequest('assistant-123', {
        settings: { maxTokens: -100 },
      });

      const response = await PATCH(request, context);

      expect(response.status).toBe(422);
    });
  });
});

describe('DELETE /api/v1/assistants/:id', () => {
  beforeEach(() => {
    mockAssistant = {
      id: 'assistant-123',
      userId: 'user-123',
      name: 'Test Assistant',
    };
    mockUpdatedAssistant = null;
    updateSetData = null;
    deleteWasCalled = false;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL('http://localhost:3001/api/v1/assistants/assistant-123');
      const request = new NextRequest(url, { method: 'DELETE' });
      const context = { params: { id: 'assistant-123' } };

      const response = await DELETE(request, context);

      expect(response.status).toBe(401);
    });
  });

  describe('assistant deletion', () => {
    test('deletes assistant and returns success', async () => {
      const [request, context] = createDeleteRequest('assistant-123');

      const response = await DELETE(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.message).toBe('Assistant deleted');
      expect(deleteWasCalled).toBe(true);
    });
  });

  describe('authorization', () => {
    test('returns 404 when assistant not found', async () => {
      mockAssistant = null;
      const [request, context] = createDeleteRequest('nonexistent');

      const response = await DELETE(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(deleteWasCalled).toBe(false);
    });

    test('returns 403 when assistant belongs to different user', async () => {
      mockAssistant = { ...mockAssistant, userId: 'different-user' };
      const [request, context] = createDeleteRequest('assistant-123');

      const response = await DELETE(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(deleteWasCalled).toBe(false);
    });
  });
});
