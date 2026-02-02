import { OAuth2Client } from 'google-auth-library';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = `${process.env.NEXT_PUBLIC_URL || 'http://localhost:3001'}/api/v1/auth/oauth/google/callback`;

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

export function generateGoogleAuthUrl(state?: string): string {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    state,
    prompt: 'consent',
  });
}

export interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  picture?: string;
}

export async function getGoogleUserInfo(code: string): Promise<GoogleUserInfo> {
  const client = getOAuthClient();

  const { tokens } = await client.getToken(code);
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
