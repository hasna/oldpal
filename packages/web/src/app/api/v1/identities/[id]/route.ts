import { z } from 'zod';
import { db } from '@/db';
import { identities } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError, ForbiddenError, BadRequestError, validateUUID } from '@/lib/api/errors';
import { eq, and } from 'drizzle-orm';

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
  emails: z.array(contactEntrySchema).optional(),
  phones: z.array(contactEntrySchema).optional(),
  addresses: z.array(addressEntrySchema).optional(),
  virtualAddresses: z.array(contactEntrySchema).optional(),
  social: z.array(socialEntrySchema).optional(),
});

// Preferences schema
const preferencesSchema = z.object({
  language: z.string().optional(),
  dateFormat: z.string().optional(),
  communicationStyle: z.enum(['formal', 'casual', 'professional']).optional(),
  responseLength: z.enum(['concise', 'detailed', 'balanced']).optional(),
  codeStyle: z.object({
    indentation: z.enum(['tabs', 'spaces']),
    indentSize: z.number(),
    quoteStyle: z.enum(['single', 'double']),
  }).optional(),
  custom: z.record(z.unknown()).optional(),
});

// Update identity schema
const updateIdentitySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  displayName: z.string().max(255).optional().nullable(),
  title: z.string().max(255).optional().nullable(),
  company: z.string().max(255).optional().nullable(),
  bio: z.string().optional().nullable(),
  timezone: z.string().max(50).optional(),
  locale: z.string().max(10).optional(),
  contacts: contactsSchema.optional(),
  preferences: preferencesSchema.optional(),
  context: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

async function resolveParams(
  context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<object> }
): Promise<Record<string, string> | undefined> {
  if (!context?.params) return undefined;
  const params = await Promise.resolve(context.params as Record<string, string>);
  return params;
}

// GET /api/v1/identities/:id - Get an identity
export const GET = withAuth(async (request: AuthenticatedRequest, context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<object> }) => {
  try {
    const params = await resolveParams(context);
    const id = params?.id;
    if (!id) {
      return errorResponse(new BadRequestError('Missing identity id'));
    }
    validateUUID(id, 'identity id');

    const identity = await db.query.identities.findFirst({
      where: eq(identities.id, id),
    });

    if (!identity) {
      return errorResponse(new NotFoundError('Identity not found'));
    }

    if (identity.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    return successResponse(identity);
  } catch (error) {
    return errorResponse(error);
  }
});

// PATCH /api/v1/identities/:id - Update an identity
export const PATCH = withAuth(async (request: AuthenticatedRequest, context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<object> }) => {
  try {
    const params = await resolveParams(context);
    const id = params?.id;
    if (!id) {
      return errorResponse(new BadRequestError('Missing identity id'));
    }
    validateUUID(id, 'identity id');

    const body = await request.json();
    const data = updateIdentitySchema.parse(body);

    // Check ownership
    const existingIdentity = await db.query.identities.findFirst({
      where: eq(identities.id, id),
    });

    if (!existingIdentity) {
      return errorResponse(new NotFoundError('Identity not found'));
    }

    if (existingIdentity.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    // If setting as default, unset other defaults first
    if (data.isDefault === true) {
      await db
        .update(identities)
        .set({ isDefault: false })
        .where(and(
          eq(identities.userId, request.user.userId),
          eq(identities.isDefault, true)
        ));
    }

    // Build the update object, only including fields that were provided
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    // Copy simple fields if provided
    if (data.name !== undefined) updateData.name = data.name;
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.title !== undefined) updateData.title = data.title;
    if (data.company !== undefined) updateData.company = data.company;
    if (data.bio !== undefined) updateData.bio = data.bio;
    if (data.timezone !== undefined) updateData.timezone = data.timezone;
    if (data.locale !== undefined) updateData.locale = data.locale;
    if (data.context !== undefined) updateData.context = data.context;
    if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    // Merge contacts if provided
    if (data.contacts) {
      updateData.contacts = {
        emails: data.contacts.emails ?? existingIdentity.contacts?.emails ?? [],
        phones: data.contacts.phones ?? existingIdentity.contacts?.phones ?? [],
        addresses: data.contacts.addresses ?? existingIdentity.contacts?.addresses ?? [],
        virtualAddresses: data.contacts.virtualAddresses ?? existingIdentity.contacts?.virtualAddresses ?? [],
        social: data.contacts.social ?? existingIdentity.contacts?.social,
      };
    }

    // Merge preferences if provided
    if (data.preferences) {
      updateData.preferences = {
        language: data.preferences.language ?? existingIdentity.preferences?.language ?? 'en',
        dateFormat: data.preferences.dateFormat ?? existingIdentity.preferences?.dateFormat ?? 'YYYY-MM-DD',
        communicationStyle: data.preferences.communicationStyle ?? existingIdentity.preferences?.communicationStyle ?? 'professional',
        responseLength: data.preferences.responseLength ?? existingIdentity.preferences?.responseLength ?? 'balanced',
        codeStyle: data.preferences.codeStyle ?? existingIdentity.preferences?.codeStyle,
        custom: data.preferences.custom ?? existingIdentity.preferences?.custom ?? {},
      };
    }

    const [updatedIdentity] = await db
      .update(identities)
      .set(updateData)
      .where(eq(identities.id, id))
      .returning();

    return successResponse(updatedIdentity);
  } catch (error) {
    return errorResponse(error);
  }
});

// DELETE /api/v1/identities/:id - Delete an identity
export const DELETE = withAuth(async (request: AuthenticatedRequest, context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<object> }) => {
  try {
    const params = await resolveParams(context);
    const id = params?.id;
    if (!id) {
      return errorResponse(new BadRequestError('Missing identity id'));
    }
    validateUUID(id, 'identity id');

    // Check ownership
    const existingIdentity = await db.query.identities.findFirst({
      where: eq(identities.id, id),
    });

    if (!existingIdentity) {
      return errorResponse(new NotFoundError('Identity not found'));
    }

    if (existingIdentity.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    await db.delete(identities).where(eq(identities.id, id));

    // If this was the default identity, set another one as default
    if (existingIdentity.isDefault) {
      const nextIdentity = await db.query.identities.findFirst({
        where: eq(identities.userId, request.user.userId),
        orderBy: (identities, { desc }) => [desc(identities.createdAt)],
      });

      if (nextIdentity) {
        await db
          .update(identities)
          .set({ isDefault: true })
          .where(eq(identities.id, nextIdentity.id));
      }
    }

    return successResponse({ message: 'Identity deleted' });
  } catch (error) {
    return errorResponse(error);
  }
});
