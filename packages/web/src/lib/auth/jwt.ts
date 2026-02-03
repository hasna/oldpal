import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

// Development-only fallback secrets - never use in production
const DEV_SECRET = 'development-secret-key-change-in-production';
const DEV_REFRESH_SECRET = 'development-refresh-secret-key-change';

// Track if we've warned about dev secrets (log only once)
let devSecretWarningLogged = false;

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;

  // In production, require proper secrets
  if (process.env.NODE_ENV === 'production') {
    if (!secret) {
      throw new Error(
        'JWT_SECRET environment variable is required in production. ' +
          'Set a secure random string (at least 32 characters) as your JWT secret.'
      );
    }
    if (secret === DEV_SECRET) {
      throw new Error(
        'JWT_SECRET must not use the default development value in production. ' +
          'Generate a secure random string for production use.'
      );
    }
  } else if (!secret && !devSecretWarningLogged) {
    // In development, warn about using default secrets
    console.warn(
      '[JWT] Using default development secret. Set JWT_SECRET and JWT_REFRESH_SECRET environment variables for security.'
    );
    devSecretWarningLogged = true;
  }

  return new TextEncoder().encode(secret || DEV_SECRET);
}

function getRefreshSecret(): Uint8Array {
  const secret = process.env.JWT_REFRESH_SECRET;

  // In production, require proper secrets
  if (process.env.NODE_ENV === 'production') {
    if (!secret) {
      throw new Error(
        'JWT_REFRESH_SECRET environment variable is required in production. ' +
          'Set a secure random string (at least 32 characters) as your refresh token secret.'
      );
    }
    if (secret === DEV_REFRESH_SECRET) {
      throw new Error(
        'JWT_REFRESH_SECRET must not use the default development value in production. ' +
          'Generate a secure random string for production use.'
      );
    }
  }

  return new TextEncoder().encode(secret || DEV_REFRESH_SECRET);
}

// Lazy initialization to defer secret validation until first use
let _jwtSecret: Uint8Array | null = null;
let _refreshSecret: Uint8Array | null = null;

function getJwtSecretLazy(): Uint8Array {
  if (!_jwtSecret) {
    _jwtSecret = getJwtSecret();
  }
  return _jwtSecret;
}

function getRefreshSecretLazy(): Uint8Array {
  if (!_refreshSecret) {
    _refreshSecret = getRefreshSecret();
  }
  return _refreshSecret;
}

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
    .sign(getJwtSecretLazy());
}

export async function createRefreshToken(payload: Omit<RefreshTokenPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(getRefreshSecretLazy());
}

export async function verifyAccessToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecretLazy());
    return payload as TokenPayload;
  } catch {
    return null;
  }
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getRefreshSecretLazy());
    return payload as RefreshTokenPayload;
  } catch {
    return null;
  }
}

export function getRefreshTokenExpiry(): Date {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
}
