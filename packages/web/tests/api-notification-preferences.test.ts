import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';

// Mock state
let mockPreferences: any = null;
let insertedValues: any = null;
let updatedValues: any = null;

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      notificationPreferences: {
        findFirst: async () => mockPreferences,
      },
    },
    insert: (table: any) => ({
      values: (data: any) => {
        insertedValues = data;
        return {
          returning: () => [{ id: 'pref-id', ...data, updatedAt: new Date() }],
        };
      },
    }),
    update: (table: any) => ({
      set: (data: any) => {
        updatedValues = data;
        return {
          where: () => ({
            returning: () => [{ id: 'pref-id', ...mockPreferences, ...data }],
          }),
        };
      },
    }),
  },
}));

// Mock db schema
mock.module('@/db/schema', () => ({
  notificationPreferences: 'notification_preferences',
}));

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

// Mock drizzle-orm
mock.module('drizzle-orm', () => ({
  eq: (field: any, value: any) => ({ field, value }),
}));

const { GET, PATCH } = await import('../src/app/api/v1/notifications/preferences/route');

function createGetRequest(options: { token?: string } = {}): NextRequest {
  const url = new URL('http://localhost:3001/api/v1/notifications/preferences');

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  return new NextRequest(url, { headers });
}

function createPatchRequest(
  body: Record<string, unknown>,
  options: { token?: string } = {}
): NextRequest {
  const url = new URL('http://localhost:3001/api/v1/notifications/preferences');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  return new NextRequest(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
}

describe('GET /api/v1/notifications/preferences', () => {
  beforeEach(() => {
    mockPreferences = null;
    insertedValues = null;
    updatedValues = null;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const request = new NextRequest('http://localhost:3001/api/v1/notifications/preferences');

      const response = await GET(request);

      expect(response.status).toBe(401);
    });

    test('returns 401 for invalid token', async () => {
      const request = createGetRequest({ token: 'invalid' });

      const response = await GET(request);

      expect(response.status).toBe(401);
    });
  });

  describe('returns default preferences', () => {
    test('returns defaults when no preferences exist', async () => {
      mockPreferences = null;
      const request = createGetRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.preferences.emailNotifications).toBe(true);
      expect(data.data.preferences.pushNotifications).toBe(true);
      expect(data.data.preferences.soundEnabled).toBe(true);
      expect(data.data.preferences.messageReceived).toBe(true);
      expect(data.data.preferences.scheduleCompleted).toBe(true);
      expect(data.data.preferences.scheduleFailed).toBe(true);
      expect(data.data.preferences.usageWarning).toBe(true);
      expect(data.data.preferences.usageExceeded).toBe(true);
      expect(data.data.preferences.subscriptionChanged).toBe(true);
      expect(data.data.preferences.system).toBe(true);
    });

    test('returns empty ID for default preferences', async () => {
      mockPreferences = null;
      const request = createGetRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.preferences.id).toBe('');
      expect(data.data.preferences.userId).toBe('user-123');
    });
  });

  describe('returns stored preferences', () => {
    test('returns existing preferences from database', async () => {
      mockPreferences = {
        id: 'pref-123',
        userId: 'user-123',
        emailNotifications: false,
        pushNotifications: true,
        soundEnabled: false,
        messageReceived: true,
        scheduleCompleted: false,
        scheduleFailed: true,
        usageWarning: false,
        usageExceeded: true,
        subscriptionChanged: false,
        system: true,
        updatedAt: new Date('2024-01-15'),
      };
      const request = createGetRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.preferences.id).toBe('pref-123');
      expect(data.data.preferences.emailNotifications).toBe(false);
      expect(data.data.preferences.pushNotifications).toBe(true);
      expect(data.data.preferences.soundEnabled).toBe(false);
    });
  });
});

describe('PATCH /api/v1/notifications/preferences', () => {
  beforeEach(() => {
    mockPreferences = null;
    insertedValues = null;
    updatedValues = null;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const request = new NextRequest('http://localhost:3001/api/v1/notifications/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailNotifications: false }),
      });

      const response = await PATCH(request);

      expect(response.status).toBe(401);
    });

    test('returns 401 for invalid token', async () => {
      const request = createPatchRequest(
        { emailNotifications: false },
        { token: 'invalid' }
      );

      const response = await PATCH(request);

      expect(response.status).toBe(401);
    });
  });

  describe('upsert behavior', () => {
    test('creates new preferences when none exist', async () => {
      mockPreferences = null;
      const request = createPatchRequest({ emailNotifications: false });

      const response = await PATCH(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(insertedValues).not.toBeNull();
      expect(insertedValues.userId).toBe('user-123');
      expect(insertedValues.emailNotifications).toBe(false);
    });

    test('updates existing preferences', async () => {
      mockPreferences = {
        id: 'pref-123',
        userId: 'user-123',
        emailNotifications: true,
        pushNotifications: true,
        soundEnabled: true,
      };
      const request = createPatchRequest({ emailNotifications: false, soundEnabled: false });

      const response = await PATCH(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(updatedValues).not.toBeNull();
      expect(updatedValues.emailNotifications).toBe(false);
      expect(updatedValues.soundEnabled).toBe(false);
      expect(updatedValues.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('persists updates', () => {
    test('persists single field update', async () => {
      mockPreferences = null;
      const request = createPatchRequest({ pushNotifications: false });

      await PATCH(request);

      expect(insertedValues.pushNotifications).toBe(false);
    });

    test('persists multiple field updates', async () => {
      mockPreferences = null;
      const request = createPatchRequest({
        emailNotifications: false,
        pushNotifications: false,
        soundEnabled: false,
        system: false,
      });

      await PATCH(request);

      expect(insertedValues.emailNotifications).toBe(false);
      expect(insertedValues.pushNotifications).toBe(false);
      expect(insertedValues.soundEnabled).toBe(false);
      expect(insertedValues.system).toBe(false);
    });
  });

  describe('validation', () => {
    test('accepts valid boolean fields', async () => {
      mockPreferences = null;
      const request = createPatchRequest({
        emailNotifications: true,
        pushNotifications: false,
        soundEnabled: true,
        messageReceived: false,
        scheduleCompleted: true,
        scheduleFailed: false,
        usageWarning: true,
        usageExceeded: false,
        subscriptionChanged: true,
        system: false,
      });

      const response = await PATCH(request);

      expect(response.status).toBe(200);
    });

    test('returns 422 for invalid field types', async () => {
      mockPreferences = null;
      const request = createPatchRequest({ emailNotifications: 'yes' });

      const response = await PATCH(request);

      expect(response.status).toBe(422);
    });

    test('ignores unknown fields', async () => {
      mockPreferences = null;
      const request = createPatchRequest({
        emailNotifications: false,
        unknownField: 'ignored',
      });

      const response = await PATCH(request);

      expect(response.status).toBe(200);
      expect(insertedValues.unknownField).toBeUndefined();
    });
  });

  describe('returns updated preferences', () => {
    test('returns the updated preferences object', async () => {
      mockPreferences = {
        id: 'pref-123',
        userId: 'user-123',
        emailNotifications: true,
        pushNotifications: true,
        soundEnabled: true,
        messageReceived: true,
        scheduleCompleted: true,
        scheduleFailed: true,
        usageWarning: true,
        usageExceeded: true,
        subscriptionChanged: true,
        system: true,
        updatedAt: new Date(),
      };
      const request = createPatchRequest({ emailNotifications: false });

      const response = await PATCH(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.preferences).toBeDefined();
    });
  });
});
