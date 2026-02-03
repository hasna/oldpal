import { NextRequest, NextResponse } from 'next/server';
import {
  generateGoogleAuthUrl,
  isGoogleOAuthConfigured,
  generateCodeVerifier,
  generateCodeChallenge,
} from '@/lib/auth/oauth';
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

    // Generate PKCE code_verifier and code_challenge
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    // Generate auth URL with PKCE challenge
    const authUrl = generateGoogleAuthUrl(state, codeChallenge);

    const response = NextResponse.redirect(authUrl);

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 600, // 10 minutes
      path: '/',
    };

    // Set state cookie (expires in 10 minutes)
    response.cookies.set('oauth_state', state, cookieOptions);

    // Store PKCE code_verifier in cookie (needed for token exchange)
    response.cookies.set('oauth_code_verifier', codeVerifier, cookieOptions);

    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
