import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { homedir } from 'os';
import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor } from './registry';
import { generateId } from '@hasna/assistants-shared';
import { getRuntime } from '../runtime';
import { isPrivateHostOrResolved } from '../security/network-validator';

// Security limits for image fetching
const FETCH_TIMEOUT_MS = 30_000; // 30 seconds
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Check if viu is available
 */
async function getViuPath(): Promise<string | null> {
  const runtime = getRuntime();
  const explicitPath = process.env.ASSISTANTS_VIU_PATH || process.env.VIU_PATH;
  if (explicitPath) {
    try {
      const result = await runtime.shell`${explicitPath} --version`.quiet().nothrow();
      if (result.exitCode === 0) {
        return explicitPath;
      }
    } catch {
      // Fall through to search
    }
  }

  // Check common locations
  const envHome = process.env.HOME || process.env.USERPROFILE;
  const homeDir = envHome && envHome.trim().length > 0 ? envHome : homedir();

  const locations = [
    'viu',
    join(homeDir, '.cargo', 'bin', 'viu'),
    '/usr/local/bin/viu',
    '/opt/homebrew/bin/viu',
  ];

  for (const path of locations) {
    try {
      const result = await runtime.shell`${path} --version`.quiet().nothrow();
      if (result.exitCode === 0) {
        return path;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * ImageDisplay tool - display images in the terminal
 */
export class ImageDisplayTool {
  static readonly tool: Tool = {
    name: 'display_image',
    description: 'Display an image in the terminal. Works with local files and URLs. Supports PNG, JPG, GIF, BMP, and other common formats.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the image file or URL to fetch',
        },
        width: {
          type: 'number',
          description: 'Width in characters (optional, defaults to terminal width)',
        },
        height: {
          type: 'number',
          description: 'Height in characters (optional)',
        },
      },
      required: ['path'],
    },
  };

  static readonly executor: ToolExecutor = async (input) => {
    const imagePath = input.path as string;
    const width = input.width as number | undefined;
    const height = input.height as number | undefined;

    // Check if viu is available
    const viuPath = await getViuPath();
    if (!viuPath) {
      return 'Error: viu is not installed. Install with: cargo install viu';
    }

    let localPath = imagePath;
    let tempFile: string | null = null;

    // If it's a URL, download to temp file
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      try {
        // SSRF protection: block private/internal network addresses
        const url = new URL(imagePath);
        if (await isPrivateHostOrResolved(url.hostname)) {
          return 'Error: Cannot fetch from local/private network addresses for security reasons';
        }

        // Fetch with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        let response: Response;
        try {
          response = await fetch(imagePath, { signal: controller.signal });
        } finally {
          clearTimeout(timeoutId);
        }

        if (!response.ok) {
          return `Error: Failed to fetch image: HTTP ${response.status}`;
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) {
          return `Error: URL does not point to an image (content-type: ${contentType})`;
        }

        // Check Content-Length if available
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
          const size = parseInt(contentLength, 10);
          if (!isNaN(size) && size > MAX_IMAGE_SIZE_BYTES) {
            return `Error: Image too large (${Math.round(size / 1024 / 1024)}MB exceeds ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB limit)`;
          }
        }

        // Stream the response and enforce size limit
        const chunks: Uint8Array[] = [];
        let totalSize = 0;
        const reader = response.body?.getReader();

        if (!reader) {
          return 'Error: Failed to read image response';
        }

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            totalSize += value.length;
            if (totalSize > MAX_IMAGE_SIZE_BYTES) {
              return `Error: Image too large (exceeds ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB limit)`;
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }

        const buffer = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of chunks) {
          buffer.set(chunk, offset);
          offset += chunk.length;
        }

        const ext = contentType.split('/')[1]?.split(';')[0] || 'png';
        tempFile = join(tmpdir(), `assistants-image-${generateId()}.${ext}`);
        writeFileSync(tempFile, buffer);
        localPath = tempFile;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return `Error: Image fetch timed out after ${FETCH_TIMEOUT_MS / 1000} seconds`;
        }
        return `Error: Failed to fetch image: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    // Check if local file exists
    if (!existsSync(localPath)) {
      return `Error: Image file not found: ${localPath}`;
    }

    try {
      // Build viu command
      const args: string[] = [];

      if (width) {
        args.push('-w', String(width));
      }
      if (height) {
        args.push('-h', String(height));
      }
      args.push(localPath);

      const escapeShellArg = (value: string): string => `"${value.replace(/(["\\])/g, '\\$1')}"`;
      const argString = args.map(escapeShellArg).join(' ');

      // Run viu to display the image
      const runtime = getRuntime();
      const result = await runtime.shell`${viuPath} ${argString}`.quiet().nothrow();

      if (result.exitCode !== 0) {
        const stderr = result.stderr.toString().trim();
        return `Error displaying image: ${stderr || 'Unknown error'}`;
      }

      // viu outputs directly to terminal, we just need to confirm success
      // The actual image is displayed via terminal escape sequences
      const output = result.stdout.toString();

      // For terminals that support it, output contains the escape sequences
      // We need to actually print this to show the image
      if (output) {
        process.stdout.write(output);
      }

      return `Image displayed: ${imagePath}${width ? ` (width: ${width})` : ''}${height ? ` (height: ${height})` : ''}`;
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      // Clean up temp file
      if (tempFile && existsSync(tempFile)) {
        try {
          unlinkSync(tempFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  };
}

/**
 * Image tools collection
 */
export class ImageTools {
  static registerAll(registry: { register: (tool: Tool, executor: ToolExecutor) => void }): void {
    registry.register(ImageDisplayTool.tool, ImageDisplayTool.executor);
  }
}

export const __test__ = {
  getViuPath,
};
