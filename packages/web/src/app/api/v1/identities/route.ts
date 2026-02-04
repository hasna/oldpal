import { z } from 'zod';
import { db } from '@/db';
import { identities } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse, paginatedResponse } from '@/lib/api/response';
import { eq, desc, asc, count, and, ilike } from 'drizzle-orm';

// Contact entry schema
const contactEntrySchema = z.object({
  value: z.string(),
  label: z.string(),
  isPrimary: z.boolean().optional(),
});

// Address entry schema
const addressEntrySchema = z.object({
  street: z.string(),
  city: z.string(),
  state: z.string().optional(),
  postalCode: z.string(),
  country: z.string(),
  label: z.string(),
});

// Social entry schema
const socialEntrySchema = z.object({
  platform: z.string(),
  value: z.string(),
  label: z.string().optional(),
});

// Contacts schema
const contactsSchema = z.object({
  emails: z.array(contactEntrySchema).optional().default([]),
  phones: z.array(contactEntrySchema).optional().default([]),
  addresses: z.array(addressEntrySchema).optional().default([]),
  social: z.array(socialEntrySchema).optional(),
});

// Preferences schema
const preferencesSchema = z.object({
  language: z.string().optional().default('en'),
  dateFormat: z.string().optional().default('YYYY-MM-DD'),
  communicationStyle: z.enum(['formal', 'casual', 'professional']).optional().default('professional'),
  responseLength: z.enum(['concise', 'detailed', 'balanced']).optional().default('balanced'),
  codeStyle: z.object({
    indentation: z.enum(['tabs', 'spaces']),
    indentSize: z.number(),
    quoteStyle: z.enum(['single', 'double']),
  }).optional(),
  custom: z.record(z.unknown()).optional().default({}),
});

// Create identity schema
const createIdentitySchema = z.object({
  name: z.string().min(1).max(255),
  displayName: z.string().max(255).optional(),
  title: z.string().max(255).optional(),
  company: z.string().max(255).optional(),
  bio: z.string().optional(),
  timezone: z.string().max(50).optional().default('UTC'),
  locale: z.string().max(10).optional().default('en-US'),
  contacts: contactsSchema.optional(),
  preferences: preferencesSchema.optional(),
  context: z.string().optional(),
  isDefault: z.boolean().optional().default(false),
});

// GET /api/v1/identities - List user identities
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(
      Math.max(1, Number.parseInt(searchParams.get('limit') || '20', 10) || 20),
      100
    );
    const offset = (page - 1) * limit;

    // Filter parameters
    const activeOnly = searchParams.get('active') === 'true';
    const search = searchParams.get('search')?.trim();
    const status = searchParams.get('status');

    // Sorting parameters
    const sortBy = searchParams.get('sortBy') || 'createdAt';
    const sortDir = searchParams.get('sortDir') || 'desc';

    // Validate sortBy to prevent SQL injection
    const validSortColumns = ['name', 'displayName', 'createdAt', 'updatedAt'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'createdAt';
    const sortDirection = sortDir === 'asc' ? asc : desc;

    // Build filter conditions
    const conditions = [eq(identities.userId, request.user.userId)];

    if (activeOnly || status === 'active') {
      conditions.push(eq(identities.isActive, true));
    } else if (status === 'inactive') {
      conditions.push(eq(identities.isActive, false));
    }

    if (search) {
      conditions.push(ilike(identities.name, `%${search}%`));
    }

    const whereClause = and(...conditions);

    // Build order by based on sort column
    const getOrderBy = () => {
      switch (sortColumn) {
        case 'name':
          return [sortDirection(identities.name)];
        case 'displayName':
          return [sortDirection(identities.displayName)];
        case 'updatedAt':
          return [sortDirection(identities.updatedAt)];
        case 'createdAt':
        default:
          return [sortDirection(identities.createdAt)];
      }
    };

    const [userIdentities, [{ total }]] = await Promise.all([
      db.query.identities.findMany({
        where: whereClause,
        orderBy: getOrderBy(),
        limit,
        offset,
      }),
      db.select({ total: count() }).from(identities).where(whereClause),
    ]);

    return paginatedResponse(userIdentities, total, page, limit);
  } catch (error) {
    return errorResponse(error);
  }
});

// POST /api/v1/identities - Create a new identity
export const POST = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const body = await request.json();
    const data = createIdentitySchema.parse(body);

    // If this is set as default, unset any existing default
    if (data.isDefault) {
      await db
        .update(identities)
        .set({ isDefault: false })
        .where(and(
          eq(identities.userId, request.user.userId),
          eq(identities.isDefault, true)
        ));
    }

    // Check if this is the user's first identity - make it default
    const [existingCount] = await db
      .select({ total: count() })
      .from(identities)
      .where(eq(identities.userId, request.user.userId));

    const isFirstIdentity = existingCount.total === 0;

    const [newIdentity] = await db
      .insert(identities)
      .values({
        userId: request.user.userId,
        name: data.name,
        displayName: data.displayName || data.name,
        title: data.title,
        company: data.company,
        bio: data.bio,
        timezone: data.timezone,
        locale: data.locale,
        contacts: data.contacts || { emails: [], phones: [], addresses: [] },
        preferences: data.preferences || {
          language: 'en',
          dateFormat: 'YYYY-MM-DD',
          communicationStyle: 'professional',
          responseLength: 'balanced',
          custom: {},
        },
        context: data.context,
        isDefault: data.isDefault || isFirstIdentity,
      })
      .returning();

    return successResponse(newIdentity, 201);
  } catch (error) {
    return errorResponse(error);
  }
});
