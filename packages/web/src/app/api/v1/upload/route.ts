import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { BadRequestError } from '@/lib/api/errors';

// Configuration
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

/**
 * Generate a unique filename
 */
function generateFilename(originalName: string, userId: string): string {
  const ext = path.extname(originalName).toLowerCase() || '.jpg';
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${userId}-${timestamp}-${random}${ext}`;
}

/**
 * Ensure upload directory exists
 */
async function ensureUploadDir(subdir: string): Promise<string> {
  const dir = path.join(UPLOAD_DIR, subdir);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  return dir;
}

/**
 * POST /api/v1/upload - Upload a file
 * Supports: avatars, general files
 * Returns: { url: string, filename: string }
 */
export const POST = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const type = formData.get('type') as string | null; // 'avatar' | 'attachment'

    if (!file) {
      return errorResponse(new BadRequestError('No file provided'));
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return errorResponse(
        new BadRequestError(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`)
      );
    }

    // Determine upload type and validate
    const uploadType = type || 'avatar';

    if (uploadType === 'avatar') {
      // Validate image type for avatars
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        return errorResponse(
          new BadRequestError(
            `Invalid file type. Allowed types: ${ALLOWED_IMAGE_TYPES.join(', ')}`
          )
        );
      }
    }

    // Generate filename and determine directory
    const subdir = uploadType === 'avatar' ? 'avatars' : 'files';
    const uploadDir = await ensureUploadDir(subdir);
    const filename = generateFilename(file.name, request.user.userId);
    const filepath = path.join(uploadDir, filename);

    // Convert file to buffer and write
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filepath, buffer);

    // Return the public URL
    const url = `/uploads/${subdir}/${filename}`;

    return successResponse({
      url,
      filename,
      originalName: file.name,
      size: file.size,
      type: file.type,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return errorResponse(error);
  }
});

/**
 * DELETE /api/v1/upload - Delete a file
 */
export const DELETE = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const fileUrl = searchParams.get('url');

    if (!fileUrl) {
      return errorResponse(new BadRequestError('No file URL provided'));
    }

    // Security: Only allow deleting files that start with /uploads/
    if (!fileUrl.startsWith('/uploads/')) {
      return errorResponse(new BadRequestError('Invalid file URL'));
    }

    // Extract the relative path and construct full path
    const relativePath = fileUrl.replace('/uploads/', '');
    const filepath = path.join(UPLOAD_DIR, relativePath);

    // Security: Ensure the resolved path is within UPLOAD_DIR
    const resolvedPath = path.resolve(filepath);
    if (!resolvedPath.startsWith(path.resolve(UPLOAD_DIR))) {
      return errorResponse(new BadRequestError('Invalid file path'));
    }

    // Check if file exists and delete
    if (existsSync(filepath)) {
      const { unlink } = await import('fs/promises');
      await unlink(filepath);
    }

    return successResponse({ message: 'File deleted' });
  } catch (error) {
    console.error('Delete error:', error);
    return errorResponse(error);
  }
});
