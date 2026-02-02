import type { Tool } from '@hasna/assistants-shared';
import { lookup as dnsLookup } from 'node:dns/promises';
import type { ToolExecutor } from './registry';
import { ErrorCodes, ToolExecutionError } from '../errors';

function abortController(controller: AbortController): void {
  controller.abort();
}

/**
 * WebFetch tool - fetch and extract content from URLs
 */
export class WebFetchTool {
  static readonly tool: Tool = {
    name: 'web_fetch',
    description: 'Fetch content from a URL and return the text content. Useful for reading web pages, documentation, API responses, etc.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch content from',
        },
        extract_type: {
          type: 'string',
          description: 'What to extract: "text" for readable text, "html" for raw HTML, "json" for JSON response',
          enum: ['text', 'html', 'json'],
          default: 'text',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)',
        },
      },
      required: ['url'],
    },
  };

  static readonly executor: ToolExecutor = async (input) => {
    const url = input.url as string;
    const extractType = (input.extract_type as string) || 'text';
    const timeoutInput = Number(input.timeout);
    const timeout = Number.isFinite(timeoutInput) && timeoutInput > 0 ? timeoutInput : 30000;

    try {
      let currentUrl = url;
      let redirects = 0;
      let response: Response | null = null;

      while (true) {
        // Validate URL
        const parsedUrl = new URL(currentUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          throw new ToolExecutionError('Only http/https URLs are supported', {
            toolName: 'web_fetch',
            toolInput: input,
            code: ErrorCodes.TOOL_EXECUTION_FAILED,
            recoverable: false,
            retryable: false,
            suggestion: 'Use a valid http or https URL.',
          });
        }

        // Block local/private IPs for security
      const hostname = parsedUrl.hostname;
      if (await isPrivateHostOrResolved(hostname)) {
        throw new ToolExecutionError('Cannot fetch from local/private network addresses for security reasons', {
          toolName: 'web_fetch',
          toolInput: input,
          code: ErrorCodes.TOOL_PERMISSION_DENIED,
          recoverable: false,
          retryable: false,
        });
      }

        const controller = new AbortController();
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        try {
          timeoutId = setTimeout(abortController, timeout, controller);
          response = await fetch(currentUrl, {
            signal: controller.signal,
            redirect: 'manual',
            headers: {
              'User-Agent': 'assistants/1.0 (AI Assistant)',
              'Accept': extractType === 'json' ? 'application/json' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
          });
        } finally {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        }

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          if (!location) {
            throw new ToolExecutionError('Redirect response missing Location header', {
              toolName: 'web_fetch',
              toolInput: input,
              code: ErrorCodes.TOOL_EXECUTION_FAILED,
              recoverable: true,
              retryable: false,
            });
          }
          redirects += 1;
          if (redirects > 5) {
            throw new ToolExecutionError('Too many redirects', {
              toolName: 'web_fetch',
              toolInput: input,
              code: ErrorCodes.TOOL_EXECUTION_FAILED,
              recoverable: true,
              retryable: false,
            });
          }
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        }

        break;
      }

      if (!response || !response.ok) {
        throw new ToolExecutionError(`HTTP ${response.status} ${response.statusText}`, {
          toolName: 'web_fetch',
          toolInput: input,
          code: ErrorCodes.TOOL_EXECUTION_FAILED,
          recoverable: true,
          retryable: false,
        });
      }

      const contentType = response.headers.get('content-type') || '';

      if (extractType === 'json') {
        try {
          const json = await response.json();
          return JSON.stringify(json, null, 2);
        } catch {
          throw new ToolExecutionError('Response is not valid JSON', {
            toolName: 'web_fetch',
            toolInput: input,
            code: ErrorCodes.TOOL_EXECUTION_FAILED,
            recoverable: false,
            retryable: false,
          });
        }
      }

      const html = await response.text();

      if (extractType === 'html') {
        // Truncate if too long
        const maxLength = 50000;
        if (html.length > maxLength) {
          return html.slice(0, maxLength) + '\n\n[Content truncated...]';
        }
        return html;
      }

      // Extract readable text from HTML
      const text = extractReadableText(html);

      // Truncate if too long
      const maxLength = 30000;
      if (text.length > maxLength) {
        return text.slice(0, maxLength) + '\n\n[Content truncated...]';
      }

      return text || 'No readable content found on page';
    } catch (error) {
      if (error instanceof ToolExecutionError) throw error;
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new ToolExecutionError(`Request timed out after ${timeout}ms`, {
            toolName: 'web_fetch',
            toolInput: input,
            code: ErrorCodes.TOOL_TIMEOUT,
            recoverable: true,
            retryable: true,
            suggestion: 'Try again or increase the timeout.',
          });
        }
        throw new ToolExecutionError(error.message, {
          toolName: 'web_fetch',
          toolInput: input,
          code: ErrorCodes.TOOL_EXECUTION_FAILED,
          recoverable: true,
          retryable: false,
        });
      }
      throw new ToolExecutionError(String(error), {
        toolName: 'web_fetch',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
      });
    }
  };
}

/**
 * WebSearch tool - search the web using DuckDuckGo
 */
export class WebSearchTool {
  static readonly tool: Tool = {
    name: 'web_search',
    description: 'Search the web using DuckDuckGo and return results. Useful for finding current information, documentation, news, etc.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5, max: 10)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 15000)',
        },
      },
      required: ['query'],
    },
  };

  static readonly executor: ToolExecutor = async (input) => {
    const query = input.query as string;
    const requested = Number(input.max_results);
    const maxResults = Number.isFinite(requested) && requested > 0
      ? Math.min(requested, 10)
      : 5;
    const timeoutInput = Number(input.timeout);
    const timeout = Number.isFinite(timeoutInput) && timeoutInput > 0 ? timeoutInput : 15000;

    try {
      // Use DuckDuckGo HTML search (no API key needed)
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const controller = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const response = await (async () => {
        try {
          timeoutId = setTimeout(abortController, timeout, controller);
          return await fetch(searchUrl, {
            headers: {
              'User-Agent': 'assistants/1.0 (AI Assistant)',
              'Accept': 'text/html',
            },
            signal: controller.signal,
          });
        } finally {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        }
      })();

      if (!response.ok) {
        throw new ToolExecutionError(`Search request failed with HTTP ${response.status}`, {
          toolName: 'web_search',
          toolInput: input,
          code: ErrorCodes.TOOL_EXECUTION_FAILED,
          recoverable: true,
          retryable: false,
        });
      }

      const html = await response.text();

      // Parse results from DuckDuckGo HTML
      const results = parseDuckDuckGoResults(html, maxResults);

      if (results.length === 0) {
        return `No results found for "${query}"`;
      }

      // Format results
      let output = `Search results for "${query}":\n\n`;
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        output += `${i + 1}. ${r.title}\n`;
        output += `   ${r.url}\n`;
        if (r.snippet) {
          output += `   ${r.snippet}\n`;
        }
        output += '\n';
      }

      return output.trim();
    } catch (error) {
      if (error instanceof Error && /aborted|timeout/i.test(error.message)) {
        throw new ToolExecutionError(`Search request timed out after ${timeout}ms`, {
          toolName: 'web_search',
          toolInput: input,
          code: ErrorCodes.TOOL_TIMEOUT,
          recoverable: true,
          retryable: true,
          suggestion: 'Try again or increase the timeout.',
        });
      }
      if (error instanceof ToolExecutionError) throw error;
      throw new ToolExecutionError(error instanceof Error ? error.message : String(error), {
        toolName: 'web_search',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
      });
    }
  };
}

/**
 * Extract readable text from HTML
 */
function extractReadableText(html: string): string {
  // Remove script and style elements
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');

  // Convert block elements to newlines
  text = text
    .replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote)[^>]*>/gi, '\n')
    .replace(/<\/?[^>]+>/g, ' ')  // Remove remaining tags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')  // Collapse whitespace
    .replace(/\n\s*\n/g, '\n\n')  // Collapse multiple newlines
    .trim();

  return text;
}

/**
 * Parse DuckDuckGo HTML search results
 */
function parseDuckDuckGoResults(html: string, maxResults: number): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  // Match result blocks - DuckDuckGo uses class="result" divs
  const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*)/gi;

  let match;
  while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
    const rawUrl = match[1].replace(/\/l\/\?uddg=/, '').split('&')[0];
    let url = rawUrl;
    try {
      url = decodeURIComponent(rawUrl);
    } catch {
      url = rawUrl;
    }
    const title = match[2].trim();
    const snippet = match[3].trim().replace(/&[^;]+;/g, ' ');

    if (url && title && !url.startsWith('//duckduckgo.com')) {
      results.push({ title, url, snippet });
    }
  }

  // Fallback: try simpler pattern
  if (results.length === 0) {
    const simpleRegex = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*class="[^"]*result[^"]*"[^>]*>([^<]+)/gi;
    while ((match = simpleRegex.exec(html)) !== null && results.length < maxResults) {
      const url = match[1];
      const title = match[2].trim();
      if (url && title) {
        results.push({ title, url, snippet: '' });
      }
    }
  }

  return results;
}

/**
 * Curl tool - alias for web_fetch with more familiar name
 */
export class CurlTool {
  static readonly tool: Tool = {
    name: 'curl',
    description: 'Fetch content from a URL (like curl). Returns text content from web pages, JSON from APIs, etc.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch',
        },
        method: {
          type: 'string',
          description: 'HTTP method (GET, POST, PUT, DELETE). Defaults to GET.',
          enum: ['GET', 'POST', 'PUT', 'DELETE'],
          default: 'GET',
        },
        headers: {
          type: 'object',
          description: 'Optional headers to send with the request',
        },
        body: {
          type: 'string',
          description: 'Request body for POST/PUT requests',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)',
        },
      },
      required: ['url'],
    },
  };

  static readonly executor: ToolExecutor = async (input) => {
    const url = input.url as string;
    const methodRaw = (input.method as string) || 'GET';
    const method = methodRaw.toUpperCase();
    const headers = (input.headers as Record<string, string>) || {};
    const body = input.body as string | undefined;
    const timeoutInput = Number(input.timeout);
    const timeout = Number.isFinite(timeoutInput) && timeoutInput > 0 ? timeoutInput : 30000;

    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
      throw new ToolExecutionError(`Unsupported HTTP method "${methodRaw}"`, {
        toolName: 'curl',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: false,
        retryable: false,
      });
    }

    try {
      let currentUrl = url;
      let redirects = 0;
      let response: Response | null = null;

      while (true) {
        const parsedUrl = new URL(currentUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          throw new ToolExecutionError('Only http/https URLs are supported', {
            toolName: 'curl',
            toolInput: input,
            code: ErrorCodes.TOOL_EXECUTION_FAILED,
            recoverable: false,
            retryable: false,
          });
        }

        // Block local/private IPs
      const hostname = parsedUrl.hostname;
      if (await isPrivateHostOrResolved(hostname)) {
        throw new ToolExecutionError('Cannot fetch from local/private network addresses for security reasons', {
          toolName: 'curl',
          toolInput: input,
          code: ErrorCodes.TOOL_PERMISSION_DENIED,
          recoverable: false,
          retryable: false,
        });
      }

        const controller = new AbortController();
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        try {
          timeoutId = setTimeout(abortController, timeout, controller);
          response = await fetch(currentUrl, {
            method,
            signal: controller.signal,
            redirect: 'manual',
            headers: {
              'User-Agent': 'assistants/1.0 (AI Assistant)',
              ...headers,
            },
            body: body && ['POST', 'PUT'].includes(method) ? body : undefined,
          });
        } finally {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        }

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (!['GET', 'HEAD'].includes(method)) {
            throw new ToolExecutionError('Redirects are only supported for GET/HEAD requests', {
              toolName: 'curl',
              toolInput: input,
              code: ErrorCodes.TOOL_EXECUTION_FAILED,
              recoverable: false,
              retryable: false,
            });
          }
          const location = response.headers.get('location');
          if (!location) {
            throw new ToolExecutionError('Redirect response missing Location header', {
              toolName: 'curl',
              toolInput: input,
              code: ErrorCodes.TOOL_EXECUTION_FAILED,
              recoverable: true,
              retryable: false,
            });
          }
          redirects += 1;
          if (redirects > 5) {
            throw new ToolExecutionError('Too many redirects', {
              toolName: 'curl',
              toolInput: input,
              code: ErrorCodes.TOOL_EXECUTION_FAILED,
              recoverable: true,
              retryable: false,
            });
          }
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        }

        break;
      }

      const contentType = response.headers.get('content-type') || '';
      let responseBody: string;

      if (contentType.includes('application/json')) {
        try {
          const json = await response.json();
          responseBody = JSON.stringify(json, null, 2);
        } catch {
          responseBody = await response.text();
        }
      } else {
        responseBody = await response.text();
        // Extract readable text from HTML
        if (contentType.includes('text/html')) {
          responseBody = extractReadableText(responseBody);
        }
      }

      // Truncate if too long
      const maxLength = 30000;
      if (responseBody.length > maxLength) {
        responseBody = responseBody.slice(0, maxLength) + '\n\n[Content truncated...]';
      }

      const statusLine = `HTTP ${response.status} ${response.statusText}`;
      return `${statusLine}\n\n${responseBody || '(empty response)'}`;
    } catch (error) {
      if (error instanceof ToolExecutionError) throw error;
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new ToolExecutionError(`Request timed out after ${timeout}ms`, {
            toolName: 'curl',
            toolInput: input,
            code: ErrorCodes.TOOL_TIMEOUT,
            recoverable: true,
            retryable: true,
            suggestion: 'Try again or increase the timeout.',
          });
        }
        throw new ToolExecutionError(error.message, {
          toolName: 'curl',
          toolInput: input,
          code: ErrorCodes.TOOL_EXECUTION_FAILED,
          recoverable: true,
          retryable: false,
        });
      }
      throw new ToolExecutionError(String(error), {
        toolName: 'curl',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
      });
    }
  };
}

/**
 * Web tools collection
 */
export class WebTools {
  static registerAll(registry: { register: (tool: Tool, executor: ToolExecutor) => void }): void {
    registry.register(WebFetchTool.tool, WebFetchTool.executor);
    registry.register(WebSearchTool.tool, WebSearchTool.executor);
    registry.register(CurlTool.tool, CurlTool.executor);
  }
}

type LookupFn = typeof dnsLookup;
let lookupFn: LookupFn = dnsLookup;

export function setDnsLookupForTests(fn?: LookupFn): void {
  lookupFn = fn ?? dnsLookup;
}

async function isPrivateHostOrResolved(hostname: string): Promise<boolean> {
  if (isPrivateHost(hostname)) {
    return true;
  }

  const host = normalizeHostname(hostname);
  if (host === '' || isIpLiteral(host)) {
    return false;
  }

  try {
    const results = await lookupFn(host, { all: true });
    for (const result of results) {
      if (isPrivateHost(result.address)) {
        return true;
      }
    }
  } catch {
    // If DNS lookup fails, do not block by default.
  }

  return false;
}

function isIpLiteral(hostname: string): boolean {
  if (hostname.includes(':')) return true;
  if (/^\d+$/.test(hostname)) return true;
  return /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
}

function normalizeHostname(hostname: string): string {
  let host = hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }

  const zoneIndex = host.indexOf('%');
  if (zoneIndex !== -1) {
    host = host.slice(0, zoneIndex);
  }

  host = host.replace(/\.$/, '');
  return host;
}

function isPrivateHost(hostname: string): boolean {
  let host = normalizeHostname(hostname);

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '127.0.0.1' || host === '::1' || host === '::' || host === '0:0:0:0:0:0:0:0') return true;
  if (/^\d+$/.test(host)) return true;

  if (host.startsWith('::ffff:')) {
    const mapped = host.slice('::ffff:'.length);
    if (mapped.includes('.')) {
      return isPrivateHost(mapped);
    }

    const hexMatch = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hexMatch) {
      const high = Number.parseInt(hexMatch[1], 16);
      const low = Number.parseInt(hexMatch[2], 16);
      const octets = [
        (high >> 8) & 0xff,
        high & 0xff,
        (low >> 8) & 0xff,
        low & 0xff,
      ];
      return isPrivateIPv4(octets);
    }
    return false;
  }

  if (host.includes(':')) {
    if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) {
      return true;
    }
    return false;
  }

  const match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;

  const octets: number[] = [];
  for (let i = 1; i <= 4; i++) {
    const value = Number.parseInt(match[i], 10);
    if (Number.isNaN(value)) return false;
    octets.push(value);
  }

  return isPrivateIPv4(octets);
}

function isPrivateIPv4(octets: number[]): boolean {
  if (octets[0] === 0) return true;
  if (octets[0] === 10) return true;
  if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return true;
  if (octets[0] === 169 && octets[1] === 254) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  if (octets[0] === 127) return true;
  return false;
}

export const __test__ = {
  abortController,
  extractReadableText,
  parseDuckDuckGoResults,
  isPrivateHostOrResolved,
  isIpLiteral,
  normalizeHostname,
  isPrivateHost,
  isPrivateIPv4,
};
