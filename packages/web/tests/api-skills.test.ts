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

const { GET } = await import('../src/app/api/v1/skills/route');

function createRequest(options: { token?: string } = {}): NextRequest {
  const url = new URL('http://localhost:3001/api/v1/skills');

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  return new NextRequest(url, { headers });
}

describe('GET /api/v1/skills', () => {
  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL('http://localhost:3001/api/v1/skills');
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

  describe('skills listing', () => {
    test('returns list of available skills', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.skills).toBeDefined();
      expect(Array.isArray(data.data.skills)).toBe(true);
    });

    test('returns count of skills', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.count).toBeDefined();
      expect(typeof data.data.count).toBe('number');
      expect(data.data.count).toBe(data.data.skills.length);
    });

    test('each skill has required fields', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      for (const skill of data.data.skills) {
        expect(skill).toHaveProperty('name');
        expect(skill).toHaveProperty('description');
        expect(skill).toHaveProperty('category');
      }
    });

    test('includes development category skills', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      const devSkills = data.data.skills.filter((s: any) => s.category === 'development');
      expect(devSkills.length).toBeGreaterThan(0);
    });

    test('includes text category skills', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      const textSkills = data.data.skills.filter((s: any) => s.category === 'text');
      expect(textSkills.length).toBeGreaterThan(0);
    });

    test('includes code-review skill', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      const codeReviewSkill = data.data.skills.find((s: any) => s.name === 'code-review');
      expect(codeReviewSkill).toBeDefined();
      expect(codeReviewSkill.category).toBe('development');
    });

    test('includes summarize skill', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      const summarizeSkill = data.data.skills.find((s: any) => s.name === 'summarize');
      expect(summarizeSkill).toBeDefined();
      expect(summarizeSkill.category).toBe('text');
    });

    test('includes translate skill', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      const translateSkill = data.data.skills.find((s: any) => s.name === 'translate');
      expect(translateSkill).toBeDefined();
    });

    test('includes explain-code skill', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      const explainCodeSkill = data.data.skills.find((s: any) => s.name === 'explain-code');
      expect(explainCodeSkill).toBeDefined();
      expect(explainCodeSkill.category).toBe('development');
    });

    test('all skills have non-empty descriptions', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      for (const skill of data.data.skills) {
        expect(skill.description).toBeTruthy();
        expect(skill.description.length).toBeGreaterThan(0);
      }
    });
  });
});
