import type { ToolResult } from '@hasna/assistants-shared';

/**
 * Truncate tool result for display - keeps it readable
 */
export function truncateToolResult(
  toolResult: ToolResult,
  maxLines = 15,
  maxChars = 3000,
  options?: { verbose?: boolean }
): string {
  const toolName = toolResult.toolName || 'tool';
  const rawContent = toolResult.rawContent ?? toolResult.content ?? '';
  let content = String(toolResult.content || rawContent);

  if (options?.verbose) {
    let full = String(rawContent);
    full = stripAnsi(full).replace(/\t/g, '  ');
    return full.trimEnd();
  }

  // Try to format the result more nicely based on the tool
  const formatted = formatToolResultNicely(toolName, content, toolResult.isError);
  if (formatted) {
    return formatted;
  }

  const prefix = toolResult.isError ? `Error: ` : '';

  // Strip ANSI codes
  content = stripAnsi(content);

  // Replace tabs with spaces
  content = content.replace(/\t/g, '  ');

  // Truncate by lines first
  const lines = content.split('\n');
  if (lines.length > maxLines) {
    content = lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines)`;
  }

  // Then truncate by chars
  if (content.length > maxChars) {
    content = content.slice(0, maxChars) + '...';
  }

  return prefix + content.trimEnd();
}

/**
 * Format tool results in a more user-friendly way
 */
function formatToolResultNicely(toolName: string, content: string, isError?: boolean): string | null {
  if (isError) {
    // Simplify common error messages
    if (content.includes('ENOENT') || content.includes('no such file')) {
      return '⚠ File not found';
    }
    if (content.includes('EACCES') || content.includes('permission denied')) {
      return '⚠ Permission denied';
    }
    if (content.includes('ETIMEDOUT') || content.includes('timeout')) {
      return '⚠ Request timed out';
    }
    return null; // Use default formatting
  }

  switch (toolName) {
    case 'schedule':
      return formatScheduleResult(content);
    case 'submit_feedback':
      return formatFeedbackResult(content);
    case 'read':
      return formatReadResult(content);
    case 'write':
      return formatWriteResult(content);
    case 'glob':
      return formatGlobResult(content);
    case 'grep':
      return formatGrepResult(content);
    case 'bash':
      return formatBashResult(content);
    case 'web_search':
      return formatSearchResult(content);
    default:
      return null; // Use default formatting
  }
}

function formatScheduleResult(content: string): string | null {
  const trimmed = content.trim().toLowerCase();
  if (trimmed === 'no schedules found.' || trimmed.includes('no schedules')) {
    return '📅 No scheduled tasks';
  }
  if (trimmed.includes('created') || trimmed.includes('scheduled')) {
    return '✓ Schedule created';
  }
  if (trimmed.includes('deleted') || trimmed.includes('removed')) {
    return '✓ Schedule deleted';
  }
  if (trimmed.includes('paused')) {
    return '⏸ Schedule paused';
  }
  if (trimmed.includes('resumed')) {
    return '▶ Schedule resumed';
  }
  // Check if it's a list of schedules
  if (content.includes('id:') || content.includes('command:')) {
    const lines = content.split('\n').filter((line) => line.trim());
    return `📅 ${lines.length} scheduled task${lines.length !== 1 ? 's' : ''}`;
  }
  return null;
}

function formatFeedbackResult(content: string): string | null {
  if (content.includes('submitted') || content.includes('created')) {
    return '✓ Feedback submitted';
  }
  return null;
}

function formatReadResult(content: string): string | null {
  const lines = content.split('\n').length;
  if (lines > 20) {
    return `📄 Read ${lines} lines`;
  }
  return null; // Show actual content for small files
}

function formatWriteResult(content: string): string | null {
  if (content.includes('written') || content.includes('saved') || content.includes('created')) {
    return '✓ File saved';
  }
  return null;
}

function formatGlobResult(content: string): string | null {
  const lines = content.split('\n').filter((line) => line.trim());
  if (lines.length === 0) {
    return '🔍 No files found';
  }
  if (lines.length > 10) {
    return `🔍 Found ${lines.length} files`;
  }
  return null; // Show actual files for small results
}

function formatGrepResult(content: string): string | null {
  const lines = content.split('\n').filter((line) => line.trim());
  if (lines.length === 0) {
    return '🔍 No matches found';
  }
  if (lines.length > 10) {
    return `🔍 Found ${lines.length} matches`;
  }
  return null; // Show actual matches for small results
}

function formatBashResult(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return '✓ Command completed';
  }
  // For very short output, let it show
  if (trimmed.length < 100 && !trimmed.includes('\n')) {
    return null;
  }
  const lines = trimmed.split('\n').length;
  if (lines > 20) {
    return `✓ Output: ${lines} lines`;
  }
  return null;
}

function formatSearchResult(content: string): string | null {
  // Try to count results
  const resultCount = (content.match(/https?:\/\//g) || []).length;
  if (resultCount > 0) {
    return `🔍 Found ${resultCount} result${resultCount !== 1 ? 's' : ''}`;
  }
  return null;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*m/g, '');
}
