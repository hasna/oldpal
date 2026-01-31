import type { Tool } from '@oldpal/shared';
import type { ToolExecutor } from './registry';

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
    const timeout = (input.timeout as number) || 30000;

    try {
      // Validate URL
      const parsedUrl = new URL(url);

      // Block local/private IPs for security
      const hostname = parsedUrl.hostname;
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('172.')
      ) {
        return 'Error: Cannot fetch from local/private network addresses for security reasons';
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'oldpal/1.0 (AI Assistant)',
          'Accept': extractType === 'json' ? 'application/json' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return `Error: HTTP ${response.status} ${response.statusText}`;
      }

      const contentType = response.headers.get('content-type') || '';

      if (extractType === 'json') {
        try {
          const json = await response.json();
          return JSON.stringify(json, null, 2);
        } catch {
          return 'Error: Response is not valid JSON';
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
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return `Error: Request timed out after ${timeout}ms`;
        }
        return `Error: ${error.message}`;
      }
      return `Error: ${String(error)}`;
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
      },
      required: ['query'],
    },
  };

  static readonly executor: ToolExecutor = async (input) => {
    const query = input.query as string;
    const maxResults = Math.min((input.max_results as number) || 5, 10);

    try {
      // Use DuckDuckGo HTML search (no API key needed)
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'oldpal/1.0 (AI Assistant)',
          'Accept': 'text/html',
        },
      });

      if (!response.ok) {
        return `Error: Search request failed with HTTP ${response.status}`;
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
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
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
    const url = decodeURIComponent(match[1].replace(/\/l\/\?uddg=/, '').split('&')[0]);
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
      },
      required: ['url'],
    },
  };

  static readonly executor: ToolExecutor = async (input) => {
    const url = input.url as string;
    const method = (input.method as string) || 'GET';
    const headers = (input.headers as Record<string, string>) || {};
    const body = input.body as string | undefined;
    const timeout = 30000;

    try {
      const parsedUrl = new URL(url);

      // Block local/private IPs
      const hostname = parsedUrl.hostname;
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('172.')
      ) {
        return 'Error: Cannot fetch from local/private network addresses for security reasons';
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          'User-Agent': 'oldpal/1.0 (AI Assistant)',
          ...headers,
        },
        body: body && ['POST', 'PUT'].includes(method) ? body : undefined,
      });

      clearTimeout(timeoutId);

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
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return `Error: Request timed out after ${timeout}ms`;
        }
        return `Error: ${error.message}`;
      }
      return `Error: ${String(error)}`;
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
