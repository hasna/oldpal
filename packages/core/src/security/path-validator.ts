import { homedir } from 'os';
import { resolve } from 'path';
import { lstat, realpath } from 'fs/promises';

const PROTECTED_PATHS = [
  '/etc/passwd',
  '/etc/shadow',
  '/etc/sudoers',
  '~/.ssh',
  '~/.gnupg',
  '~/.aws/credentials',
  '~/.kube/config',
];

export interface PathSafetyResult {
  safe: boolean;
  reason?: string;
}

export interface PathSafetyOptions {
  cwd?: string;
}

export async function isPathSafe(
  targetPath: string,
  operation: 'read' | 'write' | 'delete',
  options: PathSafetyOptions = {}
): Promise<PathSafetyResult> {
  const resolved = resolve(targetPath);
  const home = homedir();

  for (const protectedPath of PROTECTED_PATHS) {
    const expanded = protectedPath.replace('~', home);
    if (resolved.startsWith(expanded)) {
      if (operation === 'write' || operation === 'delete') {
        return {
          safe: false,
          reason: `Cannot ${operation} protected path: ${protectedPath}`,
        };
      }
    }
  }

  try {
    const stat = await lstat(resolved);
    if (stat.isSymbolicLink()) {
      const target = await realpath(resolved);
      const root = options.cwd ? resolve(options.cwd) : process.cwd();
      if (!target.startsWith(root)) {
        return {
          safe: false,
          reason: 'Symlink points outside working directory',
        };
      }
    }
  } catch {
    // Ignore missing paths.
  }

  return { safe: true };
}
