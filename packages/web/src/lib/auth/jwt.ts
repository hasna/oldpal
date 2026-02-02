import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'development-secret-key-change-in-production');
const JWT_REFRESH_SECRET = new TextEncoder().encode(process.env.JWT_REFRESH_SECRET || 'development-refresh-secret-key-change');

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

export interface TokenPayload extends JWTPayload {
  userId: string;
  email: string;
  role: 'user' | 'admin';
}

export interface RefreshTokenPayload extends JWTPayload {
  userId: string;
  family: string;
}

export async function createAccessToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(JWT_SECRET);
}

export async function createRefreshToken(payload: Omit<RefreshTokenPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(JWT_REFRESH_SECRET);
}

export async function verifyAccessToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as TokenPayload;
  } catch {
    return null;
  }
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_REFRESH_SECRET);
    return payload as RefreshTokenPayload;
  } catch {
    return null;
  }
}

export function getRefreshTokenExpiry(): Date {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
}
