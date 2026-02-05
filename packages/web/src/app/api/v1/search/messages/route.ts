import { db } from '@/db';
import { messages, sessions, agents } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { eq, and, ilike, or, desc, gte, lte, sql } from 'drizzle-orm';

// GET /api/v1/search/messages - Search messages across all sessions
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const userId = request.user.userId;
    const { searchParams } = new URL(request.url);

    const query = searchParams.get('q')?.trim();
    const sessionId = searchParams.get('sessionId');
    const agentId = searchParams.get('agentId');
    const role = searchParams.get('role'); // 'user' | 'assistant'
    const dateFrom = searchParams.get('from');
    const dateTo = searchParams.get('to');
    const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '20', 10) || 20), 50);
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);

    if (!query || query.length < 2) {
      return successResponse({
        results: [],
        total: 0,
        message: 'Search query must be at least 2 characters',
      });
    }

    // Build the search pattern for ILIKE
    const searchPattern = `%${query}%`;

    // Build conditions array
    const conditions: ReturnType<typeof eq>[] = [
      eq(sessions.userId, userId),
      ilike(messages.content, searchPattern),
    ];

    // Apply filters
    if (sessionId) {
      conditions.push(eq(messages.sessionId, sessionId));
    }

    if (agentId) {
      conditions.push(eq(sessions.agentId, agentId));
    }

    if (role === 'user' || role === 'assistant') {
      conditions.push(eq(messages.role, role));
    }

    if (dateFrom) {
      conditions.push(gte(messages.createdAt, new Date(dateFrom)));
    }

    if (dateTo) {
      conditions.push(lte(messages.createdAt, new Date(dateTo)));
    }

    // Execute search query
    const results = await db
      .select({
        id: messages.id,
        content: messages.content,
        role: messages.role,
        createdAt: messages.createdAt,
        sessionId: messages.sessionId,
        sessionLabel: sessions.label,
        agentId: sessions.agentId,
      })
      .from(messages)
      .innerJoin(sessions, eq(messages.sessionId, sessions.id))
      .where(and(...conditions))
      .orderBy(desc(messages.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(sessions, eq(messages.sessionId, sessions.id))
      .where(and(...conditions));

    const total = countResult[0]?.count ?? 0;

    // Format results with context preview
    const formattedResults = results.map((result) => {
      // Create a preview with context around the match
      const content = result.content || '';
      const lowerContent = content.toLowerCase();
      const lowerQuery = query.toLowerCase();
      const matchIndex = lowerContent.indexOf(lowerQuery);

      let preview = content;
      if (content.length > 200) {
        // Extract context around the match
        const start = Math.max(0, matchIndex - 50);
        const end = Math.min(content.length, matchIndex + query.length + 150);
        preview = (start > 0 ? '...' : '') + content.slice(start, end) + (end < content.length ? '...' : '');
      }

      return {
        id: result.id,
        preview,
        role: result.role,
        createdAt: result.createdAt,
        sessionId: result.sessionId,
        sessionLabel: result.sessionLabel || 'Untitled Session',
        agentId: result.agentId,
        matchIndex,
      };
    });

    return successResponse({
      results: formattedResults,
      total,
      query,
      hasMore: offset + results.length < total,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
