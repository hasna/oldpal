import type { Command, CommandContext, CommandResult, TokenUsage } from './types';
import type { CommandLoader } from './loader';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

/**
 * Built-in slash commands for oldpal
 */
export class BuiltinCommands {
  private tokenUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    maxContextTokens: 200000, // Claude's context window
  };

  /**
   * Register all built-in commands
   */
  registerAll(loader: CommandLoader): void {
    loader.register(this.helpCommand(loader));
    loader.register(this.clearCommand());
    loader.register(this.newCommand());
    loader.register(this.sessionCommand());
    loader.register(this.statusCommand());
    loader.register(this.tokensCommand());
    loader.register(this.compactCommand());
    loader.register(this.configCommand());
    loader.register(this.initCommand());
    loader.register(this.costCommand());
    loader.register(this.modelCommand());
    loader.register(this.skillsCommand(loader));
    loader.register(this.memoryCommand());
    loader.register(this.bugCommand());
    loader.register(this.prCommand());
    loader.register(this.reviewCommand());
    loader.register(this.exitCommand());
  }

  /**
   * Update token usage
   */
  updateTokenUsage(usage: Partial<TokenUsage>): void {
    Object.assign(this.tokenUsage, usage);
  }

  /**
   * Get current token usage
   */
  getTokenUsage(): TokenUsage {
    return { ...this.tokenUsage };
  }

  /**
   * /help - Show available commands
   */
  private helpCommand(loader: CommandLoader): Command {
    return {
      name: 'help',
      description: 'Show available slash commands',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const commands = loader.getCommands();
        const builtinCmds = commands.filter(c => c.builtin);
        const customCmds = commands.filter(c => !c.builtin);

        let message = '\n**Available Slash Commands**\n\n';

        if (builtinCmds.length > 0) {
          message += '**Built-in Commands:**\n';
          for (const cmd of builtinCmds.sort((a, b) => a.name.localeCompare(b.name))) {
            message += `  /${cmd.name} - ${cmd.description}\n`;
          }
          message += '\n';
        }

        if (customCmds.length > 0) {
          message += '**Custom Commands:**\n';
          for (const cmd of customCmds.sort((a, b) => a.name.localeCompare(b.name))) {
            message += `  /${cmd.name} - ${cmd.description}\n`;
          }
          message += '\n';
        }

        message += '**Tips:**\n';
        message += '  - Create custom commands in .oldpal/commands/*.md\n';
        message += '  - Global commands go in ~/.oldpal/commands/*.md\n';
        message += '  - Use /init to create a starter command\n';

        context.emit('text', message);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /clear - Clear conversation history
   */
  private clearCommand(): Command {
    return {
      name: 'clear',
      description: 'Clear conversation history and start fresh',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        context.clearMessages();
        this.tokenUsage.inputTokens = 0;
        this.tokenUsage.outputTokens = 0;
        this.tokenUsage.totalTokens = 0;
        context.emit('text', 'Conversation cleared. Starting fresh.\n');
        context.emit('done');
        return { handled: true, clearConversation: true };
      },
    };
  }

  /**
   * /new - Start a new conversation (alias for /clear)
   */
  private newCommand(): Command {
    return {
      name: 'new',
      description: 'Start a new conversation',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        context.clearMessages();
        this.tokenUsage.inputTokens = 0;
        this.tokenUsage.outputTokens = 0;
        this.tokenUsage.totalTokens = 0;
        context.emit('text', 'Starting new conversation.\n');
        context.emit('done');
        return { handled: true, clearConversation: true };
      },
    };
  }

  /**
   * /exit - Exit oldpal
   */
  private exitCommand(): Command {
    return {
      name: 'exit',
      description: 'Exit oldpal',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        context.emit('text', 'Goodbye!\n');
        context.emit('done');
        // Signal exit by returning special flag
        return { handled: true, exit: true };
      },
    };
  }

  /**
   * /session - List and switch sessions
   */
  private sessionCommand(): Command {
    return {
      name: 'session',
      description: 'List sessions or switch to a session by number',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        // Session management is handled by the terminal UI
        // This command signals what action to take
        const arg = args.trim();

        if (arg === 'new') {
          context.emit('done');
          return { handled: true, sessionAction: 'new' };
        }

        const num = parseInt(arg, 10);
        if (!isNaN(num) && num > 0) {
          context.emit('done');
          return { handled: true, sessionAction: 'switch', sessionNumber: num };
        }

        // No arg or invalid - signal to show session list
        context.emit('done');
        return { handled: true, sessionAction: 'list' };
      },
    };
  }

  /**
   * /tokens - Show token usage (alias for /status)
   */
  private tokensCommand(): Command {
    return {
      name: 'tokens',
      description: 'Show token usage',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const usage = this.tokenUsage;
        const usedPercent = Math.round((usage.totalTokens / usage.maxContextTokens) * 100);

        let message = '\n**Token Usage**\n\n';
        message += `Input: ${usage.inputTokens.toLocaleString()}\n`;
        message += `Output: ${usage.outputTokens.toLocaleString()}\n`;
        message += `Total: ${usage.totalTokens.toLocaleString()} / ${usage.maxContextTokens.toLocaleString()} (${usedPercent}%)\n`;

        // Visual progress bar
        const barLength = 30;
        const filledLength = Math.round((usedPercent / 100) * barLength);
        const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
        message += `\n[${bar}] ${usedPercent}%\n`;

        context.emit('text', message);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /skills - List available skills
   */
  private skillsCommand(loader: CommandLoader): Command {
    return {
      name: 'skills',
      description: 'List available skills',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        let message = '\n**Available Skills**\n\n';
        message += 'Skills are invoked with $skill-name [arguments] or /skill-name [arguments]\n\n';

        if (context.skills.length === 0) {
          message += 'No skills loaded.\n';
          message += '\nAdd skills to ~/.oldpal/skills/ or .oldpal/skills/\n';
        } else {
          for (const skill of context.skills) {
            const hint = skill.argumentHint ? ` ${skill.argumentHint}` : '';
            message += `  $${skill.name}${hint} - ${skill.description}\n`;
          }
          message += `\n${context.skills.length} skill(s) available.\n`;
        }

        context.emit('text', message);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /status - Show current session status
   */
  private statusCommand(): Command {
    return {
      name: 'status',
      description: 'Show current session status and token usage',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const usage = this.tokenUsage;
        const usedPercent = Math.round((usage.totalTokens / usage.maxContextTokens) * 100);

        let message = '\n**Session Status**\n\n';
        message += `**Working Directory:** ${context.cwd}\n`;
        message += `**Session ID:** ${context.sessionId}\n`;
        message += `**Messages:** ${context.messages.length}\n`;
        message += `**Available Tools:** ${context.tools.length}\n\n`;

        message += '**Token Usage:**\n';
        message += `  Input: ${usage.inputTokens.toLocaleString()}\n`;
        message += `  Output: ${usage.outputTokens.toLocaleString()}\n`;
        message += `  Total: ${usage.totalTokens.toLocaleString()} / ${usage.maxContextTokens.toLocaleString()} (${usedPercent}%)\n`;

        if (usage.cacheReadTokens || usage.cacheWriteTokens) {
          message += `  Cache Read: ${(usage.cacheReadTokens || 0).toLocaleString()}\n`;
          message += `  Cache Write: ${(usage.cacheWriteTokens || 0).toLocaleString()}\n`;
        }

        // Visual progress bar
        const barLength = 30;
        const filledLength = Math.round((usedPercent / 100) * barLength);
        const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
        message += `\n  [${bar}] ${usedPercent}%\n`;

        context.emit('text', message);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /compact - Summarize conversation to save context
   */
  private compactCommand(): Command {
    return {
      name: 'compact',
      description: 'Summarize conversation to save context space',
      builtin: true,
      selfHandled: false,
      content: `Please summarize our conversation so far into a concise format that preserves:
1. Key decisions made
2. Important context about the codebase
3. Current task/goal we're working on
4. Any constraints or requirements mentioned

Format the summary as a brief bullet-point list. This summary will replace the conversation history to save context space.`,
    };
  }

  /**
   * /config - Show or edit configuration
   */
  private configCommand(): Command {
    return {
      name: 'config',
      description: 'Show current configuration',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const configPaths = [
          join(context.cwd, '.oldpal', 'config.json'),
          join(homedir(), '.oldpal', 'config.json'),
        ];

        let message = '\n**Configuration**\n\n';
        message += '**Config File Locations:**\n';
        for (const path of configPaths) {
          const exists = existsSync(path);
          message += `  ${exists ? '✓' : '○'} ${path}\n`;
        }

        message += '\n**Commands Directories:**\n';
        message += `  - Project: ${join(context.cwd, '.oldpal', 'commands')}\n`;
        message += `  - Global: ${join(homedir(), '.oldpal', 'commands')}\n`;

        context.emit('text', message);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /init - Initialize oldpal in current project
   */
  private initCommand(): Command {
    return {
      name: 'init',
      description: 'Initialize oldpal config and create example command',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const commandsDir = join(context.cwd, '.oldpal', 'commands');

        // Create directories
        mkdirSync(commandsDir, { recursive: true });

        // Create example command
        const exampleCommand = `---
name: review
description: Review code changes for issues and improvements
tags: [code, review]
---

# Code Review

Please review the current code changes and provide feedback on:

1. **Code Quality**
   - Readability and maintainability
   - Following project conventions
   - Proper error handling

2. **Potential Issues**
   - Security vulnerabilities
   - Performance concerns
   - Edge cases not handled

3. **Suggestions**
   - Improvements to consider
   - Best practices to apply
   - Documentation needs

If there are staged git changes, focus on those. Otherwise, ask what code to review.
`;

        const examplePath = join(commandsDir, 'review.md');
        if (!existsSync(examplePath)) {
          writeFileSync(examplePath, exampleCommand);
        }

        let message = '\n**Initialized oldpal**\n\n';
        message += `Created: ${commandsDir}\n`;
        message += `Example: ${examplePath}\n\n`;
        message += 'You can now:\n';
        message += '  - Add custom commands to .oldpal/commands/\n';
        message += '  - Use /review to try the example command\n';
        message += '  - Run /help to see all available commands\n';

        context.emit('text', message);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /cost - Show estimated cost of the session
   */
  private costCommand(): Command {
    return {
      name: 'cost',
      description: 'Show estimated API cost for this session',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const usage = this.tokenUsage;

        // Claude 3.5 Sonnet pricing (approximate)
        const inputCostPer1M = 3.0;  // $3 per 1M input tokens
        const outputCostPer1M = 15.0; // $15 per 1M output tokens

        const inputCost = (usage.inputTokens / 1_000_000) * inputCostPer1M;
        const outputCost = (usage.outputTokens / 1_000_000) * outputCostPer1M;
        const totalCost = inputCost + outputCost;

        // Cache savings (if applicable)
        const cacheReadCostPer1M = 0.3; // $0.30 per 1M cached input tokens
        const cacheSavings = usage.cacheReadTokens
          ? ((usage.cacheReadTokens / 1_000_000) * (inputCostPer1M - cacheReadCostPer1M))
          : 0;

        let message = '\n**Estimated Session Cost**\n\n';
        message += `Input tokens: ${usage.inputTokens.toLocaleString()} (~$${inputCost.toFixed(4)})\n`;
        message += `Output tokens: ${usage.outputTokens.toLocaleString()} (~$${outputCost.toFixed(4)})\n`;
        message += `**Total: ~$${totalCost.toFixed(4)}**\n`;

        if (cacheSavings > 0) {
          message += `\nCache savings: ~$${cacheSavings.toFixed(4)}\n`;
        }

        message += '\n*Based on Claude 3.5 Sonnet pricing*\n';

        context.emit('text', message);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /model - Show or change the model
   */
  private modelCommand(): Command {
    return {
      name: 'model',
      description: 'Show current model information',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        let message = '\n**Model Information**\n\n';
        message += 'Current model: claude-sonnet-4-20250514 (Claude 4 Sonnet)\n';
        message += 'Context window: 200,000 tokens\n';
        message += 'Max output: 64,000 tokens\n\n';
        message += '*Model selection coming in a future update*\n';

        context.emit('text', message);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /memory - Show what the agent remembers
   */
  private memoryCommand(): Command {
    return {
      name: 'memory',
      description: 'Show conversation summary and key memories',
      builtin: true,
      selfHandled: false,
      content: `Please provide a summary of our conversation so far, including:

1. **Key Context** - What you know about this project/codebase
2. **Current Task** - What we're working on
3. **Decisions Made** - Any choices or agreements from our discussion
4. **Open Items** - Things we mentioned but haven't addressed yet

Keep it concise but comprehensive.`,
    };
  }

  /**
   * /bug - Report and analyze a bug
   */
  private bugCommand(): Command {
    return {
      name: 'bug',
      description: 'Analyze and help fix a bug',
      builtin: true,
      selfHandled: false,
      content: `Help me debug an issue. $ARGUMENTS

Please:
1. Understand the bug/error described
2. Identify likely causes
3. Search relevant code files
4. Propose a fix with code changes

If no bug is described, ask me to describe the issue I'm experiencing.`,
    };
  }

  /**
   * /pr - Create a pull request
   */
  private prCommand(): Command {
    return {
      name: 'pr',
      description: 'Create a pull request for current changes',
      builtin: true,
      selfHandled: false,
      content: `Help me create a pull request for the current changes.

1. First, check git status and staged changes
2. Review the diff to understand what changed
3. Write a clear PR title (max 72 chars)
4. Write a description with:
   - Summary of changes
   - Motivation/context
   - Testing done
   - Any notes for reviewers

Then create the PR using the gh CLI.`,
    };
  }

  /**
   * /review - Review code changes
   */
  private reviewCommand(): Command {
    return {
      name: 'review',
      description: 'Review code changes for issues',
      builtin: true,
      selfHandled: false,
      content: `Review the current code changes. $ARGUMENTS

Check for:
1. **Bugs** - Logic errors, edge cases, null checks
2. **Security** - Input validation, injection risks, secrets
3. **Performance** - N+1 queries, unnecessary loops, memory leaks
4. **Style** - Naming, formatting, code organization
5. **Tests** - Coverage, edge cases, assertions

If there are staged changes, review those. Otherwise, ask what to review.`,
    };
  }
}
