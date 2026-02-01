import type { Command, CommandContext, CommandResult, TokenUsage } from './types';
import type { CommandLoader } from './loader';
import { join } from 'path';
import { homedir, platform, release, arch } from 'os';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { getConfigDir } from '../config';
import { generateId } from '@oldpal/shared';
import { saveFeedbackEntry, type FeedbackType } from '../tools/feedback';
import type { ScheduledCommand } from '@oldpal/shared';
import {
  saveSchedule,
  listSchedules,
  deleteSchedule,
  updateSchedule,
  computeNextRun,
} from '../scheduler/store';

// Version constant - should match package.json
const VERSION = '0.6.13';

type ConnectorAuthTimeoutResolve = (value: {
  exitCode: number;
  stdout: { toString: () => string };
}) => void;

function resolveAuthTimeout(resolve: ConnectorAuthTimeoutResolve): void {
  resolve({ exitCode: 1, stdout: { toString: () => '{}' } });
}

function splitArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char as '"' | "'";
      continue;
    }

    if (char === ' ' || char === '\t') {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) args.push(current);
  return args;
}

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
    loader.register(this.feedbackCommand());
    loader.register(this.scheduleCommand());
    loader.register(this.schedulesCommand());
    loader.register(this.unscheduleCommand());
    loader.register(this.pauseScheduleCommand());
    loader.register(this.resumeScheduleCommand());
    loader.register(this.connectorsCommand());
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
        const builtinByName = new Map<string, Command>();
        const customByName = new Map<string, Command>();

        for (const cmd of commands) {
          if (cmd.builtin) {
            builtinByName.set(cmd.name, cmd);
          } else {
            customByName.set(cmd.name, cmd);
          }
        }

        const builtinNames = Array.from(builtinByName.keys());
        const customNames = Array.from(customByName.keys());
        builtinNames.sort();
        customNames.sort();

        let message = '\n**Available Slash Commands**\n\n';

        if (builtinNames.length > 0) {
          message += '**Built-in Commands:**\n';
          for (const name of builtinNames) {
            const cmd = builtinByName.get(name);
            if (!cmd) continue;
            message += `  /${name} - ${cmd.description}\n`;
          }
          message += '\n';
        }

        if (customNames.length > 0) {
          message += '**Custom Commands:**\n';
          for (const name of customNames) {
            const cmd = customByName.get(name);
            if (!cmd) continue;
            message += `  /${name} - ${cmd.description}\n`;
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

        const errorStats = context.getErrorStats?.() ?? [];
        if (errorStats.length > 0) {
          message += '\n**Recent Errors:**\n';
          message += '| Code | Count | Last Occurrence |\n';
          message += '| --- | --- | --- |\n';
          for (const stat of errorStats.slice(0, 5)) {
            message += `| ${stat.code} | ${stat.count} | ${stat.lastOccurrence} |\n`;
          }
        }

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
          join(context.cwd, '.oldpal', 'settings.json'),
          join(context.cwd, '.oldpal', 'settings.local.json'),
          join(getConfigDir(), 'settings.json'),
        ];

        let message = '\n**Configuration**\n\n';
        message += '**Config File Locations:**\n';
        for (const path of configPaths) {
          const exists = existsSync(path);
          message += `  ${exists ? '✓' : '○'} ${path}\n`;
        }

        const envHome = process.env.HOME || process.env.USERPROFILE;
        const homeDir = envHome && envHome.trim().length > 0 ? envHome : homedir();

        message += '\n**Commands Directories:**\n';
        message += `  - Project: ${join(context.cwd, '.oldpal', 'commands')}\n`;
        message += `  - Global: ${join(homeDir, '.oldpal', 'commands')}\n`;

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
name: reflect
description: Reflect on the conversation and suggest next steps
tags: [reflection, next-steps]
---

# Reflection

Please summarize the last interaction and suggest 2-3 next steps.

- Keep it concise
- Focus on clarity
- Ask a follow-up question if needed
`;

        const examplePath = join(commandsDir, 'reflect.md');
        if (!existsSync(examplePath)) {
          writeFileSync(examplePath, exampleCommand);
        }

        let message = '\n**Initialized oldpal**\n\n';
        message += `Created: ${commandsDir}\n`;
        message += `Example: ${examplePath}\n\n`;
        message += 'You can now:\n';
        message += '  - Add custom commands to .oldpal/commands/\n';
        message += '  - Use /reflect to try the example command\n';
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
   * /schedule - Schedule a command
   */
  private scheduleCommand(): Command {
    return {
      name: 'schedule',
      description: 'Schedule a command (ISO time or cron)',
      builtin: true,
      selfHandled: true,
      handler: async (args, context) => {
        const parts = splitArgs(args);
        if (parts.length < 2) {
          context.emit('text', 'Usage:\n  /schedule <ISO time> <command>\n  /schedule cron "<expr>" <command>\n');
          context.emit('done');
          return { handled: true };
        }

        const now = Date.now();
        let kind: 'once' | 'cron' = 'once';
        let at: string | undefined;
        let cron: string | undefined;
        let commandStart = 1;

        if (parts[0] === 'cron') {
          kind = 'cron';
          cron = parts[1];
          commandStart = 2;
        } else {
          at = parts[0];
        }

        const command = parts.slice(commandStart).join(' ').trim();
        if (!command) {
          context.emit('text', 'Error: command is required.\n');
          context.emit('done');
          return { handled: true };
        }

        const schedule: ScheduledCommand = {
          id: generateId(),
          createdAt: now,
          updatedAt: now,
          createdBy: 'user',
          command,
          status: 'active',
          schedule: {
            kind,
            at,
            cron,
          },
        };

        schedule.nextRunAt = computeNextRun(schedule, now);
        if (!schedule.nextRunAt) {
          context.emit('text', 'Error: unable to compute next run time.\n');
          context.emit('done');
          return { handled: true };
        }

        await saveSchedule(context.cwd, schedule);
        context.emit(
          'text',
          `Scheduled ${schedule.command}\n  id: ${schedule.id}\n  next: ${new Date(schedule.nextRunAt).toISOString()}\n`
        );
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /schedules - List all schedules
   */
  private schedulesCommand(): Command {
    return {
      name: 'schedules',
      description: 'List scheduled commands',
      builtin: true,
      selfHandled: true,
      handler: async (_args, context) => {
        const schedules = await listSchedules(context.cwd);
        if (schedules.length === 0) {
          context.emit('text', 'No schedules found.\n');
          context.emit('done');
          return { handled: true };
        }

        let output = '\n| ID | Status | Next Run | Command |\n';
        output += '|----|--------|----------|---------|\n';
        for (const schedule of schedules.sort((a, b) => (a.nextRunAt || 0) - (b.nextRunAt || 0))) {
          const next = schedule.nextRunAt ? new Date(schedule.nextRunAt).toISOString() : 'n/a';
          output += `| ${schedule.id} | ${schedule.status} | ${next} | ${schedule.command} |\n`;
        }
        context.emit('text', output);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /unschedule - Delete a schedule
   */
  private unscheduleCommand(): Command {
    return {
      name: 'unschedule',
      description: 'Delete a scheduled command',
      builtin: true,
      selfHandled: true,
      handler: async (args, context) => {
        const id = args.trim();
        if (!id) {
          context.emit('text', 'Usage: /unschedule <id>\n');
          context.emit('done');
          return { handled: true };
        }

        const ok = await deleteSchedule(context.cwd, id);
        context.emit('text', ok ? `Deleted schedule ${id}.\n` : `Schedule ${id} not found.\n`);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /pause - Pause a schedule
   */
  private pauseScheduleCommand(): Command {
    return {
      name: 'pause',
      description: 'Pause a scheduled command',
      builtin: true,
      selfHandled: true,
      handler: async (args, context) => {
        const id = args.trim();
        if (!id) {
          context.emit('text', 'Usage: /pause <id>\n');
          context.emit('done');
          return { handled: true };
        }

        const updated = await updateSchedule(context.cwd, id, (schedule) => ({
          ...schedule,
          status: 'paused',
          updatedAt: Date.now(),
        }));
        context.emit('text', updated ? `Paused schedule ${id}.\n` : `Schedule ${id} not found.\n`);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /resume - Resume a schedule
   */
  private resumeScheduleCommand(): Command {
    return {
      name: 'resume',
      description: 'Resume a scheduled command',
      builtin: true,
      selfHandled: true,
      handler: async (args, context) => {
        const id = args.trim();
        if (!id) {
          context.emit('text', 'Usage: /resume <id>\n');
          context.emit('done');
          return { handled: true };
        }

        const updated = await updateSchedule(context.cwd, id, (schedule) => ({
          ...schedule,
          status: 'active',
          updatedAt: Date.now(),
          nextRunAt: computeNextRun(schedule, Date.now()),
        }));
        context.emit('text', updated ? `Resumed schedule ${id}.\n` : `Schedule ${id} not found.\n`);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /connectors - List and manage connectors
   */
  private connectorsCommand(): Command {
    return {
      name: 'connectors',
      description: 'List available connectors and their status',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const connectorName = args.trim().toLowerCase();

        // If a specific connector is requested, show details
        if (connectorName) {
          let connector: typeof context.connectors[number] | undefined;
          for (const item of context.connectors) {
            if (item.name.toLowerCase() === connectorName) {
              connector = item;
              break;
            }
          }

          if (!connector) {
            context.emit('text', `\nConnector "${connectorName}" not found.\n`);
            context.emit('text', `Use /connectors to see available connectors.\n`);
            context.emit('done');
            return { handled: true };
          }

          // Show detailed info for this connector
          let message = `\n**${connector.name}** Connector\n\n`;
          message += `CLI: \`${connector.cli}\`\n`;
          message += `Description: ${connector.description}\n\n`;

          // Check auth status
          try {
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            const timeoutPromise = new Promise<{ exitCode: number; stdout: { toString: () => string } }>((resolve) => {
              timeoutId = setTimeout(resolveAuthTimeout, 1000, resolve);
            });

            const result = await Promise.race([
              Bun.$`${connector.cli} auth status --format json`.quiet().nothrow(),
              timeoutPromise,
            ]);

            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            if (result.exitCode === 0) {
              const status = JSON.parse(result.stdout.toString());
              message += `**Auth Status:** ${status.authenticated ? '✓ Authenticated' : '○ Not authenticated'}\n`;
              if (status.user || status.email) {
                message += `**Account:** ${status.user || status.email}\n`;
              }
            } else {
              message += `**Auth Status:** ○ Not authenticated\n`;
            }
          } catch {
            message += `**Auth Status:** ? Unable to check\n`;
          }

          message += `\n**Available Commands:**\n`;
          for (const cmd of connector.commands) {
            message += `  ${cmd.name} - ${cmd.description}\n`;
          }

          message += `\n**Usage:**\n`;
          message += `  Ask the AI to use ${connector.name} (e.g., "list my ${connector.name} items")\n`;
          message += `  Or run directly: \`${connector.cli} <command>\`\n`;

          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        // List all connectors
        let message = '\n**Available Connectors**\n\n';

        if (context.connectors.length === 0) {
          message += 'No connectors found.\n\n';
          message += 'Connectors are auto-discovered from installed `connect-*` CLIs on your PATH.\n';
          message += 'Install a connector with:\n';
          message += '  `bun add -g connect-<name>`\n\n';
          message += 'Then run `/connectors` again to verify it is detected.\n';
        } else {
          // Check auth status for each
          const statuses: string[] = [];
          for (const connector of context.connectors) {
            let status = '○';
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            try {
              const timeoutPromise = new Promise<{ exitCode: number; stdout: { toString: () => string } }>((resolve) => {
                timeoutId = setTimeout(resolveAuthTimeout, 1000, resolve);
              });

              const result = await Promise.race([
                Bun.$`${connector.cli} auth status --format json`.quiet().nothrow(),
                timeoutPromise,
              ]);

              if (timeoutId) {
                clearTimeout(timeoutId);
              }

              if (result.exitCode === 0) {
                try {
                  const parsed = JSON.parse(result.stdout.toString());
                  status = parsed.authenticated ? '✓' : '○';
                } catch {
                  status = '○';
                }
              }
            } catch {
              status = '?';
            } finally {
              if (timeoutId) {
                clearTimeout(timeoutId);
              }
            }
            statuses.push(status);
          }

          message += '| Status | Connector | Commands |\n';
          message += '|--------|-----------|----------|\n';

          for (let i = 0; i < context.connectors.length; i++) {
            const connector = context.connectors[i];
            const status = statuses[i];
            const cmdCount = connector.commands.length;
            message += `| ${status} | ${connector.name.padEnd(12)} | ${cmdCount} commands |\n`;
          }

          message += `\n${context.connectors.length} connector(s) available.\n\n`;
          message += '**Legend:** ✓ authenticated | ○ not authenticated | ? unknown\n\n';
          message += '**Commands:**\n';
          message += '  `/connectors <name>` - Show details for a connector\n';
          message += '  `connect-<name> auth login` - Authenticate a connector\n';
        }

        context.emit('text', message);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /feedback - Submit feedback or report issues
   */
  private feedbackCommand(): Command {
    return {
      name: 'feedback',
      description: 'Submit feedback or report an issue on GitHub',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const rawArgs = args.trim();
        const [maybeType, ...rest] = rawArgs.split(/\s+/);
        const normalizedType = maybeType?.toLowerCase();
        const typeMap: Record<string, FeedbackType> = {
          bug: 'bug',
          issue: 'bug',
          feature: 'feature',
          request: 'feature',
          feedback: 'feedback',
        };
        const typeToken = normalizedType && typeMap[normalizedType] ? normalizedType : null;
        const feedbackType: FeedbackType = typeToken ? typeMap[typeToken] : 'feedback';
        const summary = typeToken ? rest.join(' ').trim() : rawArgs;

        // Collect system info
        const systemInfo = {
          version: VERSION,
          platform: platform(),
          release: release(),
          arch: arch(),
          nodeVersion: process.version,
          bunVersion: typeof Bun !== 'undefined' ? Bun.version : 'N/A',
        };

        // GitHub repo URL
        const repoUrl = 'https://github.com/hasna/oldpal';

        // Build issue body template
        const issueBody = `## Description

<!-- Describe the issue or feedback here -->

## Steps to Reproduce (if bug)

1.
2.
3.

## Expected Behavior

<!-- What did you expect to happen? -->

## Actual Behavior

<!-- What actually happened? -->

## System Information

- **oldpal version**: ${systemInfo.version}
- **Platform**: ${systemInfo.platform} ${systemInfo.release} (${systemInfo.arch})
- **Bun version**: ${systemInfo.bunVersion}
- **Node version**: ${systemInfo.nodeVersion}

## Additional Context

<!-- Add any other context about the problem here -->
`;

        // Determine issue template based on feedback type
        let issueTitle = '';
        let labels = '';

        if (feedbackType === 'bug' || feedbackType === 'issue') {
          issueTitle = '[Bug] ';
          labels = 'bug';
        } else if (feedbackType === 'feature' || feedbackType === 'request') {
          issueTitle = '[Feature Request] ';
          labels = 'enhancement';
        } else {
          issueTitle = '[Feedback] ';
          labels = 'feedback';
        }

        // Save locally
        const localEntry = {
          id: generateId(),
          createdAt: new Date().toISOString(),
          type: feedbackType,
          title: summary || (feedbackType === 'bug' ? 'Bug report' : feedbackType === 'feature' ? 'Feature request' : 'Feedback'),
          description: summary || 'Submitted via /feedback',
          source: 'command',
          metadata: {
            cwd: context.cwd,
          },
        };
        let localPath = '';
        try {
          const saved = saveFeedbackEntry(localEntry);
          localPath = saved.path;
        } catch {
          localPath = '';
        }

        // Build GitHub new issue URL
        const issueUrl = new URL(`${repoUrl}/issues/new`);
        issueUrl.searchParams.set('title', issueTitle);
        issueUrl.searchParams.set('body', issueBody);
        if (labels) {
          issueUrl.searchParams.set('labels', labels);
        }

        // Truncate URL if too long (GitHub has limits)
        let finalUrl = issueUrl.toString();
        if (finalUrl.length > 8000) {
          // Shorten the body if URL is too long
          const shortBody = `## Description

<!-- Describe the issue or feedback here -->

## System Information

- **oldpal version**: ${systemInfo.version}
- **Platform**: ${systemInfo.platform} (${systemInfo.arch})
- **Bun version**: ${systemInfo.bunVersion}
`;
          const shortUrl = new URL(`${repoUrl}/issues/new`);
          shortUrl.searchParams.set('title', issueTitle);
          shortUrl.searchParams.set('body', shortBody);
          if (labels) {
            shortUrl.searchParams.set('labels', labels);
          }
          finalUrl = shortUrl.toString();
        }

        // Open browser
        try {
          const openCmd = platform() === 'darwin' ? 'open' :
                         platform() === 'win32' ? 'start' : 'xdg-open';

          await Bun.$`${openCmd} ${finalUrl}`.quiet();

          let message = '\n**Opening GitHub to submit feedback...**\n\n';
          message += 'A browser window should open with a pre-filled issue template.\n';
          message += 'Please fill in the details and submit.\n\n';
          if (localPath) {
            message += `Saved locally: ${localPath}\n\n`;
          }
          message += `If the browser doesn't open, visit:\n${repoUrl}/issues/new\n`;

          context.emit('text', message);
        } catch {
          let message = '\n**Submit Feedback**\n\n';
          message += `Please visit: ${repoUrl}/issues/new\n\n`;
          if (localPath) {
            message += `Saved locally: ${localPath}\n\n`;
          }
          message += '**System Information:**\n';
          message += `- oldpal version: ${systemInfo.version}\n`;
          message += `- Platform: ${systemInfo.platform} ${systemInfo.release}\n`;
          message += `- Bun version: ${systemInfo.bunVersion}\n`;

          context.emit('text', message);
        }

        context.emit('done');
        return { handled: true };
      },
    };
  }
}

export const __test__ = {
  resolveAuthTimeout,
};
