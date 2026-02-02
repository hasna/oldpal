import type { Tool, AskUserRequest, AskUserResponse } from '@hasna/assistants-shared';
import type { ToolExecutor } from './registry';
import { ToolExecutionError, ErrorCodes } from '../errors';

export type AskUserHandler = (request: AskUserRequest) => Promise<AskUserResponse>;

export function createAskUserTool(getHandler: () => AskUserHandler | null): {
  tool: Tool;
  executor: ToolExecutor;
} {
  const tool: Tool = {
    name: 'ask_user',
    description: 'Ask the user clarifying questions and return structured answers.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short title shown above the questions.',
        },
        description: {
          type: 'string',
          description: 'Optional context for the user.',
        },
        questions: {
          type: 'array',
          description: 'Questions to ask the user.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Stable id for this question.' },
              question: { type: 'string', description: 'The question text.' },
              options: { type: 'array', items: { type: 'string', description: 'Option label' } },
              placeholder: { type: 'string', description: 'Placeholder text for input.' },
              multiline: { type: 'boolean', description: 'Whether the answer can be multi-line.' },
              required: { type: 'boolean', description: 'Whether the answer is required.' },
            },
            required: ['id', 'question'],
          },
        },
      },
      required: ['questions'],
    },
  };

  const executor: ToolExecutor = async (input) => {
    const handler = getHandler();
    if (!handler) {
      throw new ToolExecutionError('User input is not available in this environment.', {
        toolName: 'ask_user',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
        suggestion: 'Ask the user directly in chat.',
      });
    }

    const questions = Array.isArray(input.questions) ? input.questions : [];
    if (questions.length === 0) {
      throw new ToolExecutionError('ask_user requires at least one question.', {
        toolName: 'ask_user',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
        suggestion: 'Provide an array of questions with id and question fields.',
      });
    }
    if (questions.length > 6) {
      throw new ToolExecutionError('ask_user supports up to 6 questions at a time.', {
        toolName: 'ask_user',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
        suggestion: 'Split into multiple ask_user calls.',
      });
    }

    const request: AskUserRequest = {
      title: input.title ? String(input.title) : undefined,
      description: input.description ? String(input.description) : undefined,
      questions: questions.map((entry) => ({
        id: String(entry.id || ''),
        question: String(entry.question || ''),
        options: Array.isArray(entry.options)
          ? entry.options.map((opt: unknown) => String(opt))
          : undefined,
        placeholder: entry.placeholder ? String(entry.placeholder) : undefined,
        multiline: Boolean(entry.multiline),
        required: entry.required !== undefined ? Boolean(entry.required) : undefined,
      })),
    };

    for (const q of request.questions) {
      if (!q.id || !q.question) {
        throw new ToolExecutionError('Each ask_user question must include id and question.', {
          toolName: 'ask_user',
          toolInput: input,
          code: ErrorCodes.TOOL_EXECUTION_FAILED,
          recoverable: true,
          retryable: false,
        });
      }
    }

    const response = await handler(request);
    return JSON.stringify(response.answers ?? {}, null, 2);
  };

  return { tool, executor };
}
