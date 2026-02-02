import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor } from './registry';
import { ToolExecutionError, ErrorCodes } from '../errors';
import { createSkill, type SkillScope } from '../skills/create';
import type { SkillLoader } from '../skills/loader';

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

export function createSkillListTool(getLoader: () => SkillLoader | null) {
  const tool: Tool = {
    name: 'skills_list',
    description: 'List available skills and their descriptions.',
    parameters: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description: 'Project directory to scan for skills.',
        },
      },
    },
  };

  const executor: ToolExecutor = async (input) => {
    const loader = getLoader();
    if (!loader) {
      throw new ToolExecutionError('Skill loader is not available.', {
        toolName: 'skills_list',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
      });
    }
    const cwd = typeof input.cwd === 'string' && input.cwd.trim().length > 0 ? input.cwd : process.cwd();
    await loader.loadAll(cwd, { includeContent: false });
    const descriptions = loader.getSkillDescriptions();
    return descriptions || 'No skills loaded.';
  };

  return { tool, executor };
}

export function createSkillReadTool(getLoader: () => SkillLoader | null) {
  const tool: Tool = {
    name: 'skill_read',
    description: 'Load and return the full content of a skill.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name to load.',
        },
      },
      required: ['name'],
    },
  };

  const executor: ToolExecutor = async (input) => {
    const loader = getLoader();
    if (!loader) {
      throw new ToolExecutionError('Skill loader is not available.', {
        toolName: 'skill_read',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
      });
    }
    const name = String(input.name || '').trim();
    if (!name) {
      throw new ToolExecutionError('Skill name is required.', {
        toolName: 'skill_read',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: false,
        retryable: false,
      });
    }
    const skill = await loader.ensureSkillContent(name);
    if (!skill) {
      throw new ToolExecutionError(`Skill "${name}" not found.`, {
        toolName: 'skill_read',
        toolInput: input,
        code: ErrorCodes.TOOL_NOT_FOUND,
        recoverable: true,
        retryable: false,
      });
    }
    return skill.content || '(empty skill content)';
  };

  return { tool, executor };
}
