import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor } from './registry';
import { ToolExecutionError, ErrorCodes } from '../errors';
import { createSkill, type SkillScope } from '../skills/create';

function normalizeScope(input: unknown): SkillScope | null {
  if (!input) return null;
  const value = String(input).trim().toLowerCase();
  if (value === 'project' || value === 'global') return value;
  return null;
}

function normalizeAllowedTools(input: unknown): string[] | undefined {
  if (!input) return undefined;
  if (Array.isArray(input)) {
    const tools = input.map((tool) => String(tool).trim()).filter(Boolean);
    return tools.length > 0 ? tools : undefined;
  }
  if (typeof input === 'string') {
    const tools = input.split(',').map((tool) => tool.trim()).filter(Boolean);
    return tools.length > 0 ? tools : undefined;
  }
  return undefined;
}

export class SkillTool {
  static readonly tool: Tool = {
    name: 'skill_create',
    description: 'Create a skill (SKILL.md). Requires explicit scope (project or global).',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name without the "skill-" prefix.',
        },
        scope: {
          type: 'string',
          description: 'Where to create the skill.',
          enum: ['project', 'global'],
        },
        description: {
          type: 'string',
          description: 'Short description for the skill.',
        },
        content: {
          type: 'string',
          description: 'Skill body content (markdown).',
        },
        allowed_tools: {
          type: 'array',
          description: 'Allowed tools for the skill (array or comma-separated string).',
          items: { type: 'string', description: 'Tool name' },
        },
        argument_hint: {
          type: 'string',
          description: 'Argument hint for invocation.',
        },
        overwrite: {
          type: 'boolean',
          description: 'Overwrite if skill already exists.',
          default: false,
        },
        cwd: {
          type: 'string',
          description: 'Working directory for project scope (autofilled).',
        },
      },
      required: ['name'],
    },
  };

  static readonly executor: ToolExecutor = async (input) => {
    const rawName = String(input.name || '').trim();
    if (!rawName) {
      throw new ToolExecutionError('Skill name is required.', {
        toolName: 'skill_create',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
        suggestion: 'Provide a skill name without the "skill-" prefix.',
      });
    }

    const scope = normalizeScope(input.scope);
    if (!scope) {
      throw new ToolExecutionError('Scope is required (project or global).', {
        toolName: 'skill_create',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
        suggestion: 'Ask the user: project (default) or global?',
      });
    }

    const cwd = String(input.cwd || process.cwd());
    const allowedTools = normalizeAllowedTools(input.allowed_tools ?? input.allowedTools);

    const result = await createSkill({
      name: rawName,
      scope,
      description: input.description ? String(input.description) : undefined,
      content: input.content ? String(input.content) : undefined,
      allowedTools,
      argumentHint: input.argument_hint ? String(input.argument_hint) : undefined,
      overwrite: Boolean(input.overwrite),
      cwd,
    });

    return [
      `Created skill "${result.name}" (${result.scope}).`,
      `Location: ${result.filePath}`,
      `Invoke with: $${result.name} [args] or /${result.name} [args]`,
    ].join('\n');
  };
}
