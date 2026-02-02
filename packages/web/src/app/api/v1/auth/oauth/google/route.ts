import { NextRequest, NextResponse } from 'next/server';
import { generateGoogleAuthUrl, isGoogleOAuthConfigured } from '@/lib/auth/oauth';
import { errorResponse } from '@/lib/api/response';
import { BadRequestError } from '@/lib/api/errors';
import { randomUUID } from 'crypto';

export async function GET(request: NextRequest) {
  try {
    if (!isGoogleOAuthConfigured()) {
      return errorResponse(new BadRequestError('Google OAuth is not configured'));
    }

    // Generate state for CSRF protection
    const state = randomUUID();

    // Store state in a short-lived cookie
    const authUrl = generateGoogleAuthUrl(state);

    const response = NextResponse.redirect(authUrl);

    // Set state cookie (expires in 10 minutes)
    response.cookies.set('oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
      path: '/',
    });

    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
