import { resolve, normalize } from 'path';
import { lstat, realpath } from 'fs/promises';

export interface PathValidationOptions {
  allowSymlinks?: boolean;
  allowedPaths?: string[];
  blockedPaths?: string[];
}

export interface PathValidationResult {
  valid: boolean;
  resolved: string;
  error?: string;
}

export async function validatePath(
  inputPath: string,
  options: PathValidationOptions = {}
): Promise<PathValidationResult> {
  const normalized = normalize(inputPath);
  const resolved = resolve(normalized);

  const allowedPaths = options.allowedPaths?.map((p) => resolve(p));
  const blockedPaths = options.blockedPaths?.map((p) => resolve(p));

  if (normalized.includes('..')) {
    const real = await realpath(resolved).catch(() => resolved);
    if (!isWithinAllowed(real, allowedPaths)) {
      return { valid: false, resolved, error: 'Path traversal detected' };
    }
  }

  if (!options.allowSymlinks) {
    try {
      const stat = await lstat(resolved);
      if (stat.isSymbolicLink()) {
        const target = await realpath(resolved);
        if (!isWithinAllowed(target, allowedPaths)) {
          return { valid: false, resolved, error: 'Symlink points outside allowed paths' };
        }
      }
    } catch {
      // File does not exist yet.
    }
  }

  if (blockedPaths && blockedPaths.some((blocked) => resolved.startsWith(blocked))) {
    return { valid: false, resolved, error: 'Path is in blocked list' };
  }

  if (!isWithinAllowed(resolved, allowedPaths)) {
    return { valid: false, resolved, error: 'Path is outside allowed paths' };
  }

  return { valid: true, resolved };
}

function isWithinAllowed(path: string, allowed?: string[]): boolean {
  if (!allowed || allowed.length === 0) return true;
  return allowed.some((allowedPath) => path === allowedPath || path.startsWith(`${allowedPath}/`));
}
