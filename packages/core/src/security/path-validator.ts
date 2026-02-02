import { homedir } from 'os';
import { resolve, relative, isAbsolute } from 'path';
import { lstat, realpath } from 'fs/promises';

const PROTECTED_PATHS = [
  '/etc/passwd',
  '/etc/shadow',
  '/etc/sudoers',
  '~/.secrets',
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
  const expandedTarget = expandHome(targetPath);
  const resolved = resolve(expandedTarget);
  const home = homedir();

  for (const protectedPath of PROTECTED_PATHS) {
    const expanded = protectedPath.replace('~', home);
    if (isWithinPath(resolved, expanded)) {
      return {
        safe: false,
        reason: `Cannot ${operation} protected path: ${protectedPath}`,
      };
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

function expandHome(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) {
    return resolve(homedir(), value.slice(2));
  }
  return value;
}

function isWithinPath(target: string, base: string): boolean {
  const rel = relative(base, target);
  if (rel === '') return true;
  if (rel.startsWith('..')) return false;
  if (isAbsolute(rel)) return false;
  return true;
}
