// Simple user agent parsing (in production, use a library like ua-parser-js)
export interface ParsedUserAgent {
  device: string;
  browser: string;
  os: string;
}

export function parseUserAgent(userAgent: string | null | undefined): ParsedUserAgent {
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
