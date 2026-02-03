import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import { randomBytes, createHash } from 'crypto';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = `${process.env.NEXT_PUBLIC_URL || 'http://localhost:3001'}/api/v1/auth/oauth/google/callback`;

/**
 * Generate PKCE code_verifier (random 43-128 character string)
 */
export function generateCodeVerifier(): string {
  // 32 bytes = 43 chars in base64url
  return randomBytes(32).toString('base64url');
}

/**
 * Generate PKCE code_challenge from code_verifier using SHA256
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

let oauthClient: OAuth2Client | null = null;

function getOAuthClient(): OAuth2Client {
  if (!oauthClient) {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      throw new Error('Google OAuth credentials not configured');
    }
    oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  }
  return oauthClient;
}

export function generateGoogleAuthUrl(state?: string, codeChallenge?: string): string {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    state,
    prompt: 'consent',
    // PKCE parameters
    ...(codeChallenge && {
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    }),
  });
}

export interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  picture?: string;
}

export async function getGoogleUserInfo(code: string, codeVerifier?: string): Promise<GoogleUserInfo> {
  const client = getOAuthClient();

  const { tokens } = await client.getToken({
    code,
    // Pass code_verifier for PKCE validation
    ...(codeVerifier && { codeVerifier }),
  });
  client.setCredentials(tokens);

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token!,
    audience: GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error('Failed to get user info from Google');
  }

  return {
    id: payload.sub!,
    email: payload.email!,
    verified_email: payload.email_verified || false,
    name: payload.name || payload.email!,
    picture: payload.picture,
  };
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}
