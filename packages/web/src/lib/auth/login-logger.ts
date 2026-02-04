import { db } from '@/db';
import { loginHistory } from '@/db/schema';
import { eq, and, desc } from 'drizzle-orm';

interface LoginAttemptData {
  userId: string;
  success: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
  failureReason?: string | null;
}

interface ParsedUserAgent {
  device: string;
  browser: string;
  os: string;
}

// Simple user agent parsing (in production, use a library like ua-parser-js)
function parseUserAgent(userAgent: string | null | undefined): ParsedUserAgent {
  if (!userAgent) {
    return { device: 'Unknown', browser: 'Unknown', os: 'Unknown' };
  }

  let device = 'Desktop';
  let browser = 'Unknown';
  let os = 'Unknown';

  // Detect device type
  if (/mobile/i.test(userAgent)) {
    device = 'Mobile';
  } else if (/tablet|ipad/i.test(userAgent)) {
    device = 'Tablet';
  }

  // Detect browser
  if (/firefox/i.test(userAgent)) {
    browser = 'Firefox';
  } else if (/edg/i.test(userAgent)) {
    browser = 'Edge';
  } else if (/chrome/i.test(userAgent)) {
    browser = 'Chrome';
  } else if (/safari/i.test(userAgent)) {
    browser = 'Safari';
  } else if (/opera|opr/i.test(userAgent)) {
    browser = 'Opera';
  }

  // Detect OS
  if (/windows/i.test(userAgent)) {
    os = 'Windows';
  } else if (/macintosh|mac os/i.test(userAgent)) {
    os = 'macOS';
  } else if (/linux/i.test(userAgent)) {
    os = 'Linux';
  } else if (/android/i.test(userAgent)) {
    os = 'Android';
  } else if (/iphone|ipad|ipod/i.test(userAgent)) {
    os = 'iOS';
  }

  return { device, browser, os };
}

// Check if this is a new device for the user
async function isNewDevice(userId: string, userAgent: string | null | undefined): Promise<boolean> {
  if (!userAgent) return false;

  const parsed = parseUserAgent(userAgent);

  // Check if we've seen this device/browser/os combination before
  const existingLogin = await db.query.loginHistory.findFirst({
    where: and(
      eq(loginHistory.userId, userId),
      eq(loginHistory.device, parsed.device),
      eq(loginHistory.browser, parsed.browser),
      eq(loginHistory.os, parsed.os),
      eq(loginHistory.success, true)
    ),
  });

  return !existingLogin;
}

export async function logLoginAttempt(data: LoginAttemptData): Promise<void> {
  try {
    const parsed = parseUserAgent(data.userAgent);
    const isNew = data.success ? await isNewDevice(data.userId, data.userAgent) : false;

    await db.insert(loginHistory).values({
      userId: data.userId,
      success: data.success,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      device: parsed.device,
      browser: parsed.browser,
      os: parsed.os,
      isNewDevice: isNew,
      failureReason: data.failureReason,
    });
  } catch (error) {
    // Don't fail the login if logging fails
    console.error('Failed to log login attempt:', error);
  }
}

export async function getRecentLogins(userId: string, limit = 20) {
  return db.query.loginHistory.findMany({
    where: eq(loginHistory.userId, userId),
    orderBy: [desc(loginHistory.createdAt)],
    limit,
  });
}

export async function getFailedLoginAttempts(userId: string, since: Date) {
  return db.query.loginHistory.findMany({
    where: and(
      eq(loginHistory.userId, userId),
      eq(loginHistory.success, false)
    ),
    orderBy: [desc(loginHistory.createdAt)],
  });
}
