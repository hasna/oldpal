import type { Command, CommandContext, CommandResult, TokenUsage } from './types';
import type { CommandLoader } from './loader';
import { join } from 'path';
import { homedir, platform, release, arch } from 'os';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { getConfigDir } from '../config';
import { generateId } from '@hasna/assistants-shared';
import { saveFeedbackEntry, type FeedbackType } from '../tools/feedback';
import type { ScheduledCommand } from '@hasna/assistants-shared';
import { getSecurityLogger, severityFromString } from '../security/logger';
import {
  saveSchedule,
  listSchedules,
  deleteSchedule,
  updateSchedule,
  computeNextRun,
} from '../scheduler/store';
import {
  createProject,
  deleteProject,
  ensureDefaultProject,
  findProjectByName,
  hasProjectNameConflict,
  listProjects,
  readProject,
  updateProject,
  type ProjectContextEntry,
  type ProjectPlan,
  type ProjectPlanStep,
  type ProjectRecord,
} from '../projects/store';
import { buildProjectContext } from '../projects/context';
import { VerificationSessionStore } from '../sessions/verification';
import { nativeHookRegistry } from '../hooks';

// Version lookup - prefer explicit env to avoid stale hardcoded values
const VERSION =
  process.env.ASSISTANTS_VERSION ||
  process.env.npm_package_version ||
  'unknown';

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
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quote) {
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
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
 * Built-in slash commands for assistants
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
    loader.register(this.contextCommand());
    loader.register(this.projectsCommand());
    loader.register(this.plansCommand());
    loader.register(this.summarizeCommand());
    loader.register(this.restCommand());
    loader.register(this.voiceCommand());
    loader.register(this.sayCommand());
    loader.register(this.listenCommand());
    loader.register(this.assistantCommand());
    loader.register(this.identityCommand());
    loader.register(this.whoamiCommand());
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
    loader.register(this.securityLogCommand());
    loader.register(this.verificationCommand());
    loader.register(this.exitCommand());
  }

  /**
   * /voice - Toggle voice mode or show status
   */
  private voiceCommand(): Command {
    return {
      name: 'voice',
      description: 'Control voice mode (on/off/status/stop)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        if (!context.getVoiceState) {
          context.emit('text', 'Voice support is not available in this build.\n');
          context.emit('done');
          return { handled: true };
        }

        const trimmed = args.trim().toLowerCase();
        if (trimmed === 'on') {
          context.enableVoice?.();
          context.emit('text', 'Voice mode enabled.\n');
          context.emit('done');
          return { handled: true };
        }
        if (trimmed === 'off') {
          context.disableVoice?.();
          context.emit('text', 'Voice mode disabled.\n');
          context.emit('done');
          return { handled: true };
        }
        if (trimmed === 'stop') {
          context.stopSpeaking?.();
          context.stopListening?.();
          context.emit('text', 'Voice output/input stopped.\n');
          context.emit('done');
          return { handled: true };
        }

        const state = context.getVoiceState();
        if (!state) {
          context.emit('text', 'Voice support is not available.\n');
          context.emit('done');
          return { handled: true };
        }
        const status = state.enabled ? 'on' : 'off';
        const activity = state.isSpeaking ? 'speaking' : state.isListening ? 'listening' : 'idle';
        context.emit('text', `Voice mode: ${status} (${activity})\n`);
        if (state.sttProvider || state.ttsProvider) {
          context.emit('text', `STT: ${state.sttProvider || 'unknown'} · TTS: ${state.ttsProvider || 'unknown'}\n`);
        }
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /say - Speak text aloud
   */
  private sayCommand(): Command {
    return {
      name: 'say',
      description: 'Speak text aloud with TTS',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const text = args.trim();
        if (!text) {
          context.emit('text', 'Usage: /say <text>\n');
          context.emit('done');
          return { handled: true };
        }
        if (!context.speak) {
          context.emit('text', 'Voice support is not available.\n');
          context.emit('done');
          return { handled: true };
        }

        try {
          await context.speak(text);
          context.emit('done');
        } catch (error) {
          context.emit('error', error instanceof Error ? error.message : String(error));
        }
        return { handled: true };
      },
    };
  }

  /**
   * /listen - Record audio and send transcription
   */
  private listenCommand(): Command {
    return {
      name: 'listen',
      description: 'Record audio and send transcription',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        if (!context.listen) {
          context.emit('text', 'Voice support is not available.\n');
          context.emit('done');
          return { handled: true };
        }

        let durationSeconds: number | undefined;
        const trimmed = args.trim();
        if (trimmed) {
          const parsed = Number(trimmed);
          if (!Number.isNaN(parsed) && parsed > 0) {
            durationSeconds = parsed;
          }
        }

        try {
          const transcript = await context.listen({ durationSeconds });
          if (!transcript.trim()) {
            context.emit('text', '(No speech detected)\n');
            context.emit('done');
            return { handled: true };
          }
          return { handled: false, prompt: transcript };
        } catch (error) {
          context.emit('error', error instanceof Error ? error.message : String(error));
          return { handled: true };
        }
      },
    };
  }

  /**
   * /assistant - Manage assistants
   */
  private assistantCommand(): Command {
    return {
      name: 'assistant',
      description: 'Manage assistants (list, create, switch, delete)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const manager = context.getAssistantManager?.();
        if (!manager) {
          context.emit('text', 'Assistant manager not available.\n');
          context.emit('done');
          return { handled: true };
        }

        const [action, ...rest] = args.trim().split(/\s+/).filter(Boolean);
        const target = rest.join(' ');

        if (!action) {
          const active = manager.getActive();
          if (!active) {
            context.emit('text', 'No active assistant.\n');
          } else {
            context.emit('text', `Current assistant: ${active.name}\n`);
            context.emit('text', `ID: ${active.id}\n`);
            if (active.description) context.emit('text', `Description: ${active.description}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        if (action === 'list') {
          const assistants = manager.listAssistants();
          if (assistants.length === 0) {
            context.emit('text', 'No assistants found.\n');
          } else {
            context.emit('text', '\nAssistants:\n');
            for (const assistant of assistants) {
              const marker = manager.getActiveId() === assistant.id ? '*' : ' ';
              context.emit('text', ` ${marker} ${assistant.name} (${assistant.id})\n`);
            }
          }
          context.emit('done');
          return { handled: true };
        }

        if (action === 'create') {
          if (!target) {
            context.emit('text', 'Usage: /assistant create <name>\n');
            context.emit('done');
            return { handled: true };
          }
          const created = await manager.createAssistant({ name: target });
          context.emit('text', `Created assistant ${created.name} (${created.id}).\n`);
          context.emit('done');
          return { handled: true };
        }

        if (action === 'switch') {
          if (!target) {
            context.emit('text', 'Usage: /assistant switch <name|id>\n');
            context.emit('done');
            return { handled: true };
          }
          const assistants = manager.listAssistants();
          const match = assistants.find((assistant) =>
            assistant.id === target || assistant.name.toLowerCase() === target.toLowerCase()
          );
          if (!match) {
            context.emit('text', `Assistant not found: ${target}\n`);
            context.emit('done');
            return { handled: true };
          }
          await context.switchAssistant?.(match.id);
          context.emit('text', `Switched to ${match.name}.\n`);
          context.emit('done');
          return { handled: true };
        }

        if (action === 'delete') {
          if (!target) {
            context.emit('text', 'Usage: /assistant delete <name|id>\n');
            context.emit('done');
            return { handled: true };
          }
          const assistants = manager.listAssistants();
          const match = assistants.find((assistant) =>
            assistant.id === target || assistant.name.toLowerCase() === target.toLowerCase()
          );
          if (!match) {
            context.emit('text', `Assistant not found: ${target}\n`);
            context.emit('done');
            return { handled: true };
          }
          await manager.deleteAssistant(match.id);
          context.emit('text', `Deleted assistant ${match.name}.\n`);
          context.emit('done');
          return { handled: true };
        }

        if (action === 'settings') {
          const active = manager.getActive();
          if (!active) {
            context.emit('text', 'No active assistant.\n');
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Assistant settings for ${active.name}:\n`);
          context.emit('text', JSON.stringify(active.settings, null, 2) + '\n');
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', 'Unknown /assistant command.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /identity - Manage identities
   */
  private identityCommand(): Command {
    return {
      name: 'identity',
      description: 'Manage identities for the current assistant',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const manager = context.getIdentityManager?.();
        if (!manager) {
          context.emit('text', 'Identity manager not available.\n');
          context.emit('done');
          return { handled: true };
        }

        const [action, ...rest] = args.trim().split(/\s+/).filter(Boolean);
        const target = rest.join(' ');

        if (!action) {
          const active = manager.getActive();
          if (!active) {
            context.emit('text', 'No active identity.\n');
          } else {
            context.emit('text', `Current identity: ${active.name}\n`);
            context.emit('text', `ID: ${active.id}\n`);
            context.emit('text', `Display name: ${active.profile.displayName}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        if (action === 'list') {
          const identities = manager.listIdentities();
          if (identities.length === 0) {
            context.emit('text', 'No identities found.\n');
          } else {
            context.emit('text', '\nIdentities:\n');
            for (const identity of identities) {
              const marker = manager.getActive()?.id === identity.id ? '*' : ' ';
              context.emit('text', ` ${marker} ${identity.name} (${identity.id})\n`);
            }
          }
          context.emit('done');
          return { handled: true };
        }

        if (action === 'create') {
          if (!target) {
            context.emit('text', 'Usage: /identity create <name>\n');
            context.emit('done');
            return { handled: true };
          }
          const created = await manager.createIdentity({ name: target });
          await context.refreshIdentityContext?.();
          context.emit('text', `Created identity ${created.name} (${created.id}).\n`);
          context.emit('done');
          return { handled: true };
        }

        if (action === 'switch') {
          if (!target) {
            context.emit('text', 'Usage: /identity switch <name|id>\n');
            context.emit('done');
            return { handled: true };
          }
          const identities = manager.listIdentities();
          const match = identities.find((identity) =>
            identity.id === target || identity.name.toLowerCase() === target.toLowerCase()
          );
          if (!match) {
            context.emit('text', `Identity not found: ${target}\n`);
            context.emit('done');
            return { handled: true };
          }
          await context.switchIdentity?.(match.id);
          context.emit('text', `Switched to ${match.name}.\n`);
          context.emit('done');
          return { handled: true };
        }

        if (action === 'delete') {
          if (!target) {
            context.emit('text', 'Usage: /identity delete <name|id>\n');
            context.emit('done');
            return { handled: true };
          }
          const identities = manager.listIdentities();
          const match = identities.find((identity) =>
            identity.id === target || identity.name.toLowerCase() === target.toLowerCase()
          );
          if (!match) {
            context.emit('text', `Identity not found: ${target}\n`);
            context.emit('done');
            return { handled: true };
          }
          await manager.deleteIdentity(match.id);
          await context.refreshIdentityContext?.();
          context.emit('text', `Deleted identity ${match.name}.\n`);
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', 'Unknown /identity command.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /whoami - Show current assistant + identity
   */
  private whoamiCommand(): Command {
    return {
      name: 'whoami',
      description: 'Show active assistant and identity',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (_args, context) => {
        const assistant = context.getAssistantManager?.()?.getActive();
        const identity = context.getIdentityManager?.()?.getActive();
        if (!assistant || !identity) {
          context.emit('text', 'No active assistant or identity.\n');
          context.emit('done');
          return { handled: true };
        }
        context.emit('text', `Assistant: ${assistant.name}\n`);
        context.emit('text', `Identity: ${identity.name}\n`);
        context.emit('text', `Display name: ${identity.profile.displayName}\n`);
        context.emit('done');
        return { handled: true };
      },
    };
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
        message += '  - Create custom commands in .assistants/commands/*.md\n';
        message += '  - Global commands go in ~/.assistants/commands/*.md\n';
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
   * /verification - Manage scope verification feature
   */
  private verificationCommand(): Command {
    return {
      name: 'verification',
      description: 'Manage scope verification (list/view/enable/disable)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const arg = args.trim().toLowerCase();
        const store = new VerificationSessionStore(getConfigDir());

        if (arg === 'disable' || arg === 'off') {
          nativeHookRegistry.setConfig({
            ...nativeHookRegistry.getConfig(),
            scopeVerification: {
              ...nativeHookRegistry.getConfig().scopeVerification,
              enabled: false,
            },
          });
          context.emit('text', 'Scope verification disabled.\n');
          context.emit('done');
          return { handled: true };
        }

        if (arg === 'enable' || arg === 'on') {
          nativeHookRegistry.setConfig({
            ...nativeHookRegistry.getConfig(),
            scopeVerification: {
              ...nativeHookRegistry.getConfig().scopeVerification,
              enabled: true,
            },
          });
          context.emit('text', 'Scope verification enabled.\n');
          context.emit('done');
          return { handled: true };
        }

        if (arg === 'status') {
          const config = nativeHookRegistry.getConfig();
          const enabled = config.scopeVerification?.enabled !== false;
          const maxRetries = config.scopeVerification?.maxRetries ?? 2;
          context.emit('text', `Scope verification: ${enabled ? 'enabled' : 'disabled'}\n`);
          context.emit('text', `Max retries: ${maxRetries}\n`);
          context.emit('done');
          return { handled: true };
        }

        if (arg === '' || arg === 'list') {
          const sessions = store.listRecent(10);
          if (sessions.length === 0) {
            context.emit('text', 'No verification sessions found.\n');
            context.emit('done');
            return { handled: true };
          }

          context.emit('text', 'Recent verification sessions:\n\n');
          for (const session of sessions) {
            const date = new Date(session.createdAt).toLocaleString();
            const status = session.result === 'pass' ? '✓' : session.result === 'force-continue' ? '→' : '✗';
            context.emit('text', `${status} ${session.id.slice(0, 8)} - ${date} - ${session.result}\n`);
            context.emit('text', `  Goals: ${session.goals.slice(0, 2).join(', ')}${session.goals.length > 2 ? '...' : ''}\n`);
          }
          context.emit('text', '\nUse /verification <id> to view details.\n');
          context.emit('done');
          return { handled: true };
        }

        // Try to find a session by ID (partial match)
        const sessions = store.listRecent(100);
        const match = sessions.find((s) => s.id.startsWith(arg) || s.id === arg);

        if (!match) {
          context.emit('text', `No verification session found matching "${arg}".\n`);
          context.emit('done');
          return { handled: true };
        }

        // Display session details
        context.emit('text', `\n=== Verification Session ${match.id} ===\n\n`);
        context.emit('text', `Created: ${new Date(match.createdAt).toLocaleString()}\n`);
        context.emit('text', `Parent Session: ${match.parentSessionId}\n`);
        context.emit('text', `Result: ${match.result}\n\n`);

        context.emit('text', `Goals:\n`);
        for (const goal of match.goals) {
          context.emit('text', `  • ${goal}\n`);
        }

        context.emit('text', `\nAnalysis:\n`);
        for (const analysis of match.verificationResult.goalsAnalysis) {
          const icon = analysis.met ? '✓' : '✗';
          context.emit('text', `  ${icon} ${analysis.goal}\n`);
          context.emit('text', `    ${analysis.evidence}\n`);
        }

        context.emit('text', `\nReason: ${match.reason}\n`);

        if (match.suggestions && match.suggestions.length > 0) {
          context.emit('text', `\nSuggestions:\n`);
          for (const suggestion of match.suggestions) {
            context.emit('text', `  • ${suggestion}\n`);
          }
        }

        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /exit - Exit assistants
   */
  private exitCommand(): Command {
    return {
      name: 'exit',
      description: 'Exit assistants',
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
        const rawPercent = usage.maxContextTokens > 0
          ? Math.round((usage.totalTokens / usage.maxContextTokens) * 100)
          : 0;
        const usedPercent = Math.max(0, Math.min(100, rawPercent));

        let message = '\n**Token Usage**\n\n';
        message += `Input: ${usage.inputTokens.toLocaleString()}\n`;
        message += `Output: ${usage.outputTokens.toLocaleString()}\n`;
        message += `Total: ${usage.totalTokens.toLocaleString()} / ${usage.maxContextTokens.toLocaleString()} (${usedPercent}%)\n`;

        // Visual progress bar
        const barLength = 30;
        const filledLength = Math.max(0, Math.min(barLength, Math.round((usedPercent / 100) * barLength)));
        const bar = '█'.repeat(filledLength) + '░'.repeat(Math.max(0, barLength - filledLength));
        message += `\n[${bar}] ${usedPercent}%\n`;

        context.emit('text', message);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /context - Manage injected project context or show context status
   */
  private contextCommand(): Command {
    return {
      name: 'context',
      description: 'Manage injected project context (files, connectors, notes) or show status',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const parts = splitArgs(args);
        const sub = parts[0] || 'status';

        if (sub === 'help') {
          const usage = [
            'Usage:',
            '  /context status',
            '  /context list',
            '  /context add file <path>',
            '  /context add connector <name>',
            '  /context add database <name>',
            '  /context add note <text>',
            '  /context add entity <text>',
            '  /context remove <id>',
            '  /context clear',
          ].join('\n');
          context.emit('text', `\n${usage}\n`);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'status') {
          const info = context.getContextInfo?.();
          if (!info) {
            context.emit('text', '\nContext summarization is not available.\n');
            context.emit('done');
            return { handled: true };
          }

          const { config, state } = info;
          const rawPercent = config.maxContextTokens > 0
            ? Math.round((state.totalTokens / config.maxContextTokens) * 100)
            : 0;
          const usedPercent = Math.max(0, Math.min(100, rawPercent));

          let message = '\n**Context Status**\n\n';
          message += `**Messages:** ${state.messageCount}\n`;
          message += `**Estimated Tokens:** ${state.totalTokens.toLocaleString()} / ${config.maxContextTokens.toLocaleString()} (${usedPercent}%)\n`;
          message += `**Summary Count:** ${state.summaryCount}\n`;
          message += `**Strategy:** ${config.summaryStrategy}\n`;
          message += `**Keep Recent Messages:** ${config.keepRecentMessages}\n`;

          if (state.lastSummaryAt) {
            message += `**Last Summary:** ${state.lastSummaryAt}\n`;
            if (state.lastSummaryTokensBefore && state.lastSummaryTokensAfter) {
              message += `**Last Summary Tokens:** ${state.lastSummaryTokensBefore.toLocaleString()} -> ${state.lastSummaryTokensAfter.toLocaleString()}\n`;
            }
          }

          const barLength = 30;
          const filledLength = Math.max(0, Math.min(barLength, Math.round((usedPercent / 100) * barLength)));
          const bar = '█'.repeat(filledLength) + '░'.repeat(Math.max(0, barLength - filledLength));
          message += `\n[${bar}] ${usedPercent}%\n`;

          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        const project = await this.ensureActiveProject(context, true);
        if (!project) {
          context.emit('text', 'No project found. Use /projects new <name> first.\n');
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'list') {
          if (project.context.length === 0) {
            context.emit('text', `\nNo context entries for project "${project.name}".\n`);
            context.emit('done');
            return { handled: true };
          }
          let output = `\n**Context Entries (${project.name})**\n\n`;
          for (const entry of project.context) {
            const label = entry.label ? ` (${entry.label})` : '';
            output += `- ${entry.id} [${entry.type}] ${entry.value}${label}\n`;
          }
          context.emit('text', output);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'clear') {
          const updated = await updateProject(context.cwd, project.id, (current) => ({
            ...current,
            context: [],
            updatedAt: Date.now(),
          }));
          if (updated) {
            await this.applyProjectContext(context, updated);
            context.emit('text', `Cleared context entries for "${updated.name}".\n`);
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Failed to clear context entries for "${project.name}".\n`);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'remove') {
          const id = parts[1];
          if (!id) {
            context.emit('text', 'Usage: /context remove <id>\n');
            context.emit('done');
            return { handled: true };
          }
          if (!project.context.some((entry) => entry.id === id)) {
            context.emit('text', `Context entry not found: ${id}\n`);
            context.emit('done');
            return { handled: true };
          }
          const updated = await updateProject(context.cwd, project.id, (current) => ({
            ...current,
            context: current.context.filter((entry) => entry.id !== id),
            updatedAt: Date.now(),
          }));
          if (updated) {
            await this.applyProjectContext(context, updated);
            context.emit('text', `Removed context entry ${id} from "${updated.name}".\n`);
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Failed to remove context entry ${id} from "${project.name}".\n`);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'add') {
          const type = parts[1];
          const value = parts.slice(2).join(' ').trim();
          if (!type) {
            context.emit('text', 'Usage: /context add <type> <value>\n');
            context.emit('done');
            return { handled: true };
          }

          const allowedTypes: ProjectContextEntry['type'][] = ['file', 'connector', 'database', 'note', 'entity'];
          const entryType = allowedTypes.includes(type as ProjectContextEntry['type'])
            ? (type as ProjectContextEntry['type'])
            : 'note';
          const entryValue = entryType === 'note' && !value ? parts.slice(1).join(' ').trim() : value;
          if (!entryValue) {
            context.emit('text', 'Error: context value is required.\n');
            context.emit('done');
            return { handled: true };
          }

          const entry: ProjectContextEntry = {
            id: generateId(),
            type: entryType,
            value: entryValue,
            addedAt: Date.now(),
          };

          const updated = await updateProject(context.cwd, project.id, (current) => ({
            ...current,
            context: [...current.context, entry],
            updatedAt: Date.now(),
          }));

          if (updated) {
            await this.applyProjectContext(context, updated);
            context.emit('text', `Added ${entry.type} context to "${updated.name}".\n`);
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Failed to add context entry to "${project.name}".\n`);
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', 'Unknown /context command. Use /context help.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /projects - Manage projects in the current folder
   */
  private projectsCommand(): Command {
    return {
      name: 'projects',
      description: 'Manage projects inside this folder',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const parts = splitArgs(args);
        const sub = parts[0] || 'list';

        if (sub === 'help') {
          const usage = [
            'Usage:',
            '  /projects list',
            '  /projects new <name>',
            '  /projects use <id|name>',
            '  /projects show [id|name]',
            '  /projects delete <id|name>',
            '  /projects describe <id|name> <description>',
          ].join('\n');
          context.emit('text', `\n${usage}\n`);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'list' || sub === 'ls') {
          const projects = await listProjects(context.cwd);
          if (projects.length === 0) {
            context.emit('text', '\nNo projects found. Use /projects new <name>.\n');
            context.emit('done');
            return { handled: true };
          }
          const activeId = context.getActiveProjectId?.();
          let output = '\n**Projects**\n\n';
          for (const project of projects) {
            const marker = project.id === activeId ? '*' : ' ';
            output += `${marker} ${project.name} (${project.id})\n`;
          }
          context.emit('text', output);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'new' || sub === 'create') {
          const name = parts.slice(1).join(' ').trim();
          if (!name) {
            context.emit('text', 'Usage: /projects new <name>\n');
            context.emit('done');
            return { handled: true };
          }
          const existing = await listProjects(context.cwd);
          if (hasProjectNameConflict(existing, name)) {
            context.emit('text', `Project "${name}" already exists.\n`);
            context.emit('done');
            return { handled: true };
          }
          const project = await createProject(context.cwd, name);
          context.setActiveProjectId?.(project.id);
          await this.applyProjectContext(context, project);
          context.emit('text', `Created project "${project.name}" (${project.id}).\n`);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'use' || sub === 'switch') {
          const target = parts.slice(1).join(' ').trim();
          if (!target) {
            context.emit('text', 'Usage: /projects use <id|name>\n');
            context.emit('done');
            return { handled: true };
          }
          const project = await this.resolveProject(context, target);
          if (!project) {
            context.emit('text', `Project not found: ${target}\n`);
            context.emit('done');
            return { handled: true };
          }
          context.setActiveProjectId?.(project.id);
          await this.applyProjectContext(context, project);
          context.emit('text', `Switched to project "${project.name}".\n`);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'show' || sub === 'info') {
          const target = parts.slice(1).join(' ').trim();
          const project = target
            ? await this.resolveProject(context, target)
            : await this.ensureActiveProject(context, false);
          if (!project) {
            context.emit('text', 'No project selected. Use /projects use <id|name>.\n');
            context.emit('done');
            return { handled: true };
          }
          let output = `\n**Project: ${project.name}**\n\n`;
          output += `ID: ${project.id}\n`;
          if (project.description) {
            output += `Description: ${project.description}\n`;
          }
          output += `Context entries: ${project.context.length}\n`;
          output += `Plans: ${project.plans.length}\n`;
          context.emit('text', output);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'describe' || sub === 'desc') {
          const target = parts[1];
          const description = parts.slice(2).join(' ').trim();
          if (!target || !description) {
            context.emit('text', 'Usage: /projects describe <id|name> <description>\n');
            context.emit('done');
            return { handled: true };
          }
          const project = await this.resolveProject(context, target);
          if (!project) {
            context.emit('text', `Project not found: ${target}\n`);
            context.emit('done');
            return { handled: true };
          }
          const updated = await updateProject(context.cwd, project.id, (current) => ({
            ...current,
            description,
            updatedAt: Date.now(),
          }));
          if (updated) {
            await this.applyProjectContext(context, updated);
            context.emit('text', `Updated project "${updated.name}".\n`);
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Failed to update project "${project.name}".\n`);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'delete' || sub === 'rm') {
          const target = parts.slice(1).join(' ').trim();
          if (!target) {
            context.emit('text', 'Usage: /projects delete <id|name>\n');
            context.emit('done');
            return { handled: true };
          }
          const project = await this.resolveProject(context, target);
          if (!project) {
            context.emit('text', `Project not found: ${target}\n`);
            context.emit('done');
            return { handled: true };
          }
          const ok = await deleteProject(context.cwd, project.id);
          if (ok) {
            if (context.getActiveProjectId?.() === project.id) {
              context.setActiveProjectId?.(null);
              context.setProjectContext?.(null);
            }
            context.emit('text', `Deleted project "${project.name}".\n`);
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Failed to delete project "${project.name}".\n`);
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', 'Unknown /projects command. Use /projects help.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /plans - Manage plans for the active project
   */
  private plansCommand(): Command {
    return {
      name: 'plans',
      description: 'Manage plans linked to the active project',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const parts = splitArgs(args);
        const sub = parts[0] || 'list';

        if (sub === 'help') {
          const usage = [
            'Usage:',
            '  /plans list',
            '  /plans new <title>',
            '  /plans show <planId>',
            '  /plans add <planId> <step>',
            '  /plans set <planId> <stepId> <todo|doing|done|blocked>',
            '  /plans remove <planId> <stepId>',
            '  /plans delete <planId>',
          ].join('\n');
          context.emit('text', `\n${usage}\n`);
          context.emit('done');
          return { handled: true };
        }

        const project = await this.ensureActiveProject(context, true);
        if (!project) {
          context.emit('text', 'No project found. Use /projects new <name> first.\n');
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'list' || sub === 'ls') {
          if (project.plans.length === 0) {
            context.emit('text', `\nNo plans for project "${project.name}".\n`);
            context.emit('done');
            return { handled: true };
          }
          let output = `\n**Plans (${project.name})**\n\n`;
          for (const plan of project.plans) {
            output += `- ${plan.id} ${plan.title} (${plan.steps.length} steps)\n`;
          }
          context.emit('text', output);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'new' || sub === 'create') {
          const title = parts.slice(1).join(' ').trim();
          if (!title) {
            context.emit('text', 'Usage: /plans new <title>\n');
            context.emit('done');
            return { handled: true };
          }
          const now = Date.now();
          const plan: ProjectPlan = {
            id: generateId(),
            title,
            createdAt: now,
            updatedAt: now,
            steps: [],
          };
          const updated = await updateProject(context.cwd, project.id, (current) => ({
            ...current,
            plans: [...current.plans, plan],
            updatedAt: now,
          }));
          if (updated) {
            await this.applyProjectContext(context, updated);
            context.emit('text', `Created plan "${plan.title}" (${plan.id}).\n`);
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Failed to create plan "${plan.title}".\n`);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'show') {
          const id = parts[1];
          if (!id) {
            context.emit('text', 'Usage: /plans show <planId>\n');
            context.emit('done');
            return { handled: true };
          }
          const plan = project.plans.find((p) => p.id === id);
          if (!plan) {
            context.emit('text', `Plan not found: ${id}\n`);
            context.emit('done');
            return { handled: true };
          }
          let output = `\n**Plan: ${plan.title}**\n\n`;
          output += `ID: ${plan.id}\n`;
          if (plan.steps.length === 0) {
            output += 'No steps yet.\n';
          } else {
            for (const step of plan.steps) {
              output += `- ${step.id} [${step.status}] ${step.text}\n`;
            }
          }
          context.emit('text', output);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'add') {
          const planId = parts[1];
          const text = parts.slice(2).join(' ').trim();
          if (!planId || !text) {
            context.emit('text', 'Usage: /plans add <planId> <step>\n');
            context.emit('done');
            return { handled: true };
          }
          if (!project.plans.some((plan) => plan.id === planId)) {
            context.emit('text', `Plan not found: ${planId}\n`);
            context.emit('done');
            return { handled: true };
          }
          const now = Date.now();
          const step: ProjectPlanStep = {
            id: generateId(),
            text,
            status: 'todo',
            createdAt: now,
            updatedAt: now,
          };
          const updated = await updateProject(context.cwd, project.id, (current) => ({
            ...current,
            plans: current.plans.map((plan) =>
              plan.id === planId
                ? { ...plan, steps: [...plan.steps, step], updatedAt: now }
                : plan
            ),
            updatedAt: now,
          }));
          if (updated) {
            await this.applyProjectContext(context, updated);
            context.emit('text', `Added step to plan ${planId}.\n`);
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Failed to add step to plan ${planId}.\n`);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'set') {
          const planId = parts[1];
          const stepId = parts[2];
          const status = parts[3] as ProjectPlanStep['status'] | undefined;
          if (!planId || !stepId || !status) {
            context.emit('text', 'Usage: /plans set <planId> <stepId> <todo|doing|done|blocked>\n');
            context.emit('done');
            return { handled: true };
          }
          const plan = project.plans.find((item) => item.id === planId);
          if (!plan) {
            context.emit('text', `Plan not found: ${planId}\n`);
            context.emit('done');
            return { handled: true };
          }
          if (!plan.steps.some((step) => step.id === stepId)) {
            context.emit('text', `Step not found: ${stepId}\n`);
            context.emit('done');
            return { handled: true };
          }
          const allowed: ProjectPlanStep['status'][] = ['todo', 'doing', 'done', 'blocked'];
          if (!allowed.includes(status)) {
            context.emit('text', 'Invalid status. Use todo, doing, done, or blocked.\n');
            context.emit('done');
            return { handled: true };
          }
          const now = Date.now();
          const updated = await updateProject(context.cwd, project.id, (current) => ({
            ...current,
            plans: current.plans.map((plan) =>
              plan.id === planId
                ? {
                    ...plan,
                    steps: plan.steps.map((step) =>
                      step.id === stepId ? { ...step, status, updatedAt: now } : step
                    ),
                    updatedAt: now,
                  }
                : plan
            ),
            updatedAt: now,
          }));
          if (updated) {
            await this.applyProjectContext(context, updated);
            context.emit('text', `Updated step ${stepId} to ${status}.\n`);
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Failed to update step ${stepId}.\n`);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'remove') {
          const planId = parts[1];
          const stepId = parts[2];
          if (!planId || !stepId) {
            context.emit('text', 'Usage: /plans remove <planId> <stepId>\n');
            context.emit('done');
            return { handled: true };
          }
          const plan = project.plans.find((item) => item.id === planId);
          if (!plan) {
            context.emit('text', `Plan not found: ${planId}\n`);
            context.emit('done');
            return { handled: true };
          }
          if (!plan.steps.some((step) => step.id === stepId)) {
            context.emit('text', `Step not found: ${stepId}\n`);
            context.emit('done');
            return { handled: true };
          }
          const now = Date.now();
          const updated = await updateProject(context.cwd, project.id, (current) => ({
            ...current,
            plans: current.plans.map((plan) =>
              plan.id === planId
                ? { ...plan, steps: plan.steps.filter((step) => step.id !== stepId), updatedAt: now }
                : plan
            ),
            updatedAt: now,
          }));
          if (updated) {
            await this.applyProjectContext(context, updated);
            context.emit('text', `Removed step ${stepId} from plan ${planId}.\n`);
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Failed to remove step ${stepId} from plan ${planId}.\n`);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'delete' || sub === 'rm') {
          const planId = parts[1];
          if (!planId) {
            context.emit('text', 'Usage: /plans delete <planId>\n');
            context.emit('done');
            return { handled: true };
          }
          if (!project.plans.some((plan) => plan.id === planId)) {
            context.emit('text', `Plan not found: ${planId}\n`);
            context.emit('done');
            return { handled: true };
          }
          const now = Date.now();
          const updated = await updateProject(context.cwd, project.id, (current) => ({
            ...current,
            plans: current.plans.filter((plan) => plan.id !== planId),
            updatedAt: now,
          }));
          if (updated) {
            await this.applyProjectContext(context, updated);
            context.emit('text', `Deleted plan ${planId}.\n`);
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Failed to delete plan ${planId}.\n`);
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', 'Unknown /plans command. Use /plans help.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /summarize - Force context summarization
   */
  private summarizeCommand(): Command {
    return {
      name: 'summarize',
      description: 'Summarize and compress the current conversation',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        if (!context.summarizeContext) {
          context.emit('text', '\nContext summarization is not available.\n');
          context.emit('done');
          return { handled: true };
        }

        const result = await context.summarizeContext();
        if (!result.summarized) {
          context.emit('text', '\nNothing to summarize right now.\n');
          context.emit('done');
          return { handled: true };
        }

        let message = '\n**Context Summary Generated**\n\n';
        message += `Summarized ${result.summarizedCount} message(s).\n`;
        message += `Tokens: ${result.tokensBefore.toLocaleString()} -> ${result.tokensAfter.toLocaleString()}\n\n`;
        if (result.summary) {
          message += `${result.summary}\n`;
        }

        context.emit('text', message);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /rest - Recharge assistant energy
   */
  private restCommand(): Command {
    return {
      name: 'rest',
      description: 'Recharge assistant energy',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        if (!context.restEnergy) {
          context.emit('text', '\nEnergy system is not available.\n');
          context.emit('done');
          return { handled: true };
        }

        const parsed = parseInt(args.trim(), 10);
        const amount = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
        context.restEnergy(amount);

        const state = context.getEnergyState?.();
        if (state) {
          const percent = Math.round((state.current / Math.max(1, state.max)) * 100);
          context.emit('text', `\nEnergy restored. Current level: ${percent}% (${state.current}/${state.max}).\n`);
        } else {
          context.emit('text', '\nEnergy restored.\n');
        }
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
        message += '\nAdd skills to ~/.assistants/assistants-shared/skills/ or .assistants/skills/\n';
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
      description: 'Show current session status, energy, identity, and token usage',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const usage = this.tokenUsage;
        const rawPercent = usage.maxContextTokens > 0
          ? Math.round((usage.totalTokens / usage.maxContextTokens) * 100)
          : 0;
        const usedPercent = Math.max(0, Math.min(100, rawPercent));

        let message = '\n**Session Status**\n\n';
        message += `**Session ID:** ${context.sessionId}\n`;
        message += `**Working Directory:** ${context.cwd}\n`;

        // Identity info
        const assistant = context.getAssistantManager?.()?.getActive();
        const identity = context.getIdentityManager?.()?.getActive();
        if (assistant) {
          message += `**Assistant:** ${assistant.name}`;
          if (identity) {
            message += ` · ${identity.name}`;
          }
          message += '\n';
        }

        // Energy state
        const energyState = context.getEnergyState?.();
        if (energyState) {
          const energyPercent = Math.round((energyState.current / Math.max(1, energyState.max)) * 100);
          const energyBar = '█'.repeat(Math.round(energyPercent / 10)) + '░'.repeat(10 - Math.round(energyPercent / 10));
          const energyEmoji = energyPercent > 70 ? '⚡' : energyPercent > 30 ? '🔋' : '🪫';
          message += `**Energy:** ${energyEmoji} [${energyBar}] ${energyPercent}% (${energyState.current}/${energyState.max})\n`;
        }

        // Voice state
        const voiceState = context.getVoiceState?.();
        if (voiceState?.enabled) {
          const voiceActivity = voiceState.isSpeaking ? 'speaking' : voiceState.isListening ? 'listening' : 'idle';
          message += `**Voice:** ${voiceActivity}`;
          if (voiceState.sttProvider || voiceState.ttsProvider) {
            message += ` (STT: ${voiceState.sttProvider || 'n/a'}, TTS: ${voiceState.ttsProvider || 'n/a'})`;
          }
          message += '\n';
        }

        if (context.getActiveProjectId) {
          const projectId = context.getActiveProjectId();
          if (projectId) {
            message += `**Active Project:** ${projectId}\n`;
          }
        }
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
        const filledLength = Math.max(0, Math.min(barLength, Math.round((usedPercent / 100) * barLength)));
        const bar = '█'.repeat(filledLength) + '░'.repeat(Math.max(0, barLength - filledLength));
        message += `\n  [${bar}] ${usedPercent}%\n`;

        const contextInfo = context.getContextInfo?.();
        if (contextInfo) {
          const contextRawPercent = contextInfo.config.maxContextTokens > 0
            ? Math.round((contextInfo.state.totalTokens / contextInfo.config.maxContextTokens) * 100)
            : 0;
          const contextUsedPercent = Math.max(0, Math.min(100, contextRawPercent));
          message += '\n**Context Summary:**\n';
          message += `  Messages: ${contextInfo.state.messageCount}\n`;
          message += `  Estimated Tokens: ${contextInfo.state.totalTokens.toLocaleString()} / ${contextInfo.config.maxContextTokens.toLocaleString()} (${contextUsedPercent}%)\n`;
          message += `  Summaries: ${contextInfo.state.summaryCount}\n`;
          if (contextInfo.state.lastSummaryAt) {
            message += `  Last Summary: ${contextInfo.state.lastSummaryAt}\n`;
          }
        }

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
          join(context.cwd, '.assistants', 'config.json'),
          join(context.cwd, '.assistants', 'config.local.json'),
          join(getConfigDir(), 'config.json'),
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
        message += `  - Project: ${join(context.cwd, '.assistants', 'commands')}\n`;
        message += `  - Global: ${join(homeDir, '.assistants', 'commands')}\n`;

        context.emit('text', message);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /init - Initialize assistants in current project
   */
  private initCommand(): Command {
    return {
      name: 'init',
      description: 'Initialize assistants config and create example command',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const commandsDir = join(context.cwd, '.assistants', 'commands');

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

        let message = '\n**Initialized assistants**\n\n';
        message += `Created: ${commandsDir}\n`;
        message += `Example: ${examplePath}\n\n`;
        message += 'You can now:\n';
        message += '  - Add custom commands to .assistants/commands/\n';
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
      content: '',
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
          sessionId: context.sessionId,
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
      content: '',
      handler: async (_args, context) => {
        const schedules = await listSchedules(context.cwd);
        if (schedules.length === 0) {
          context.emit('text', 'No schedules found.\n');
          context.emit('done');
          return { handled: true };
        }

        const escapeCell = (value: string) =>
          value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
        let output = '\n| ID | Status | Next Run | Command |\n';
        output += '|----|--------|----------|---------|\n';
        for (const schedule of schedules.sort((a, b) => (a.nextRunAt || 0) - (b.nextRunAt || 0))) {
          const next = schedule.nextRunAt ? new Date(schedule.nextRunAt).toISOString() : 'n/a';
          output += `| ${schedule.id} | ${schedule.status} | ${next} | ${escapeCell(schedule.command)} |\n`;
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
      content: '',
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
      content: '',
      handler: async (args, context) => {
        const id = args.trim();
        if (!id) {
          const schedules = await listSchedules(context.cwd);
          if (schedules.length === 0) {
            context.emit('text', 'No schedules found.\n');
          } else {
            const lines = schedules
              .sort((a, b) => (a.nextRunAt || 0) - (b.nextRunAt || 0))
              .map((schedule) => `- ${schedule.id} [${schedule.status}] ${schedule.command}`);
            context.emit('text', `Usage: /pause <id>\n\nAvailable schedules:\n${lines.join('\n')}\n`);
          }
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
      content: '',
      handler: async (args, context) => {
        const id = args.trim();
        if (!id) {
          const schedules = await listSchedules(context.cwd);
          if (schedules.length === 0) {
            context.emit('text', 'No schedules found.\n');
          } else {
            const lines = schedules
              .sort((a, b) => (a.nextRunAt || 0) - (b.nextRunAt || 0))
              .map((schedule) => `- ${schedule.id} [${schedule.status}] ${schedule.command}`);
            context.emit('text', `Usage: /resume <id>\n\nAvailable schedules:\n${lines.join('\n')}\n`);
          }
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
          const cli = connector.cli || `connect-${connector.name}`;
          const description = connector.description?.trim() || 'No description provided.';
          let message = `\n**${connector.name}** Connector\n\n`;
          message += `CLI: \`${cli}\`\n`;
          message += `Description: ${description}\n\n`;

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
          for (const cmd of connector.commands || []) {
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
          const checkAuth = async (connector: typeof context.connectors[number]): Promise<string> => {
            let status = '○';
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            try {
              const cli = connector.cli || `connect-${connector.name}`;
              const timeoutPromise = new Promise<{ exitCode: number; stdout: { toString: () => string } }>((resolve) => {
                timeoutId = setTimeout(resolveAuthTimeout, 1000, resolve);
              });

              const result = await Promise.race([
                Bun.$`${cli} auth status --format json`.quiet().nothrow(),
                timeoutPromise,
              ]);

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
            return status;
          };

          const statuses = await Promise.all(context.connectors.map((connector) => checkAuth(connector)));

          const escapeCell = (value: string) => value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
          message += '| Status | Connector | Commands |\n';
          message += '|--------|-----------|----------|\n';

          for (let i = 0; i < context.connectors.length; i++) {
            const connector = context.connectors[i];
            const status = statuses[i];
            const cmdCount = connector.commands?.length ?? 0;
            message += `| ${status} | ${escapeCell(connector.name)} | ${cmdCount} commands |\n`;
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
   * /security-log - Show recent security events
   */
  private securityLogCommand(): Command {
    return {
      name: 'security-log',
      description: 'Show recent security events (optional: limit, severity, type)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const parts = splitArgs(args);
        let limit = 20;
        let severity = undefined as ReturnType<typeof severityFromString>;
        let eventType: 'blocked_command' | 'path_violation' | 'validation_failure' | undefined;

        for (const part of parts) {
          if (/^\d+$/.test(part)) {
            limit = Math.min(Number(part), 200);
            continue;
          }
          const parsedSeverity = severityFromString(part);
          if (parsedSeverity) {
            severity = parsedSeverity;
            continue;
          }
          if (part === 'blocked_command' || part === 'path_violation' || part === 'validation_failure') {
            eventType = part;
          }
        }

        const logger = getSecurityLogger();
        const events = logger.getEvents({ severity, eventType }).slice(-limit);

        if (events.length === 0) {
          context.emit('text', '\n**Security Log**\n\nNo security events recorded.\n');
          context.emit('done');
          return { handled: true };
        }

        let message = '\n**Security Log**\n\n';
        message += '| Time | Severity | Type | Details |\n';
        message += '| --- | --- | --- | --- |\n';
        for (const event of events) {
          const rawDetail =
            event.details?.reason ||
            event.details?.path ||
            event.details?.command ||
            event.details?.tool ||
            'n/a';
          const detail = String(rawDetail).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
          message += `| ${event.timestamp} | ${event.severity} | ${event.eventType} | ${detail} |\n`;
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
        const repoUrl = 'https://github.com/hasna/assistants';

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

- **assistants version**: ${systemInfo.version}
- **Platform**: ${systemInfo.platform} ${systemInfo.release} (${systemInfo.arch})
- **Bun version**: ${systemInfo.bunVersion}
- **Node version**: ${systemInfo.nodeVersion}

## Additional Context

<!-- Add any other context about the problem here -->
`;

        // Determine issue template based on feedback type
        let issueTitle = '';
        let labels = '';

        if (feedbackType === 'bug') {
          issueTitle = '[Bug] ';
          labels = 'bug';
        } else if (feedbackType === 'feature') {
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
          const saved = saveFeedbackEntry(localEntry, context.cwd);
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

- **assistants version**: ${systemInfo.version}
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
          message += `- assistants version: ${systemInfo.version}\n`;
          message += `- Platform: ${systemInfo.platform} ${systemInfo.release}\n`;
          message += `- Bun version: ${systemInfo.bunVersion}\n`;

          context.emit('text', message);
        }

        context.emit('done');
        return { handled: true };
      },
    };
  }

  private async resolveProject(context: CommandContext, target: string): Promise<ProjectRecord | null> {
    const byId = await readProject(context.cwd, target);
    if (byId) return byId;
    return findProjectByName(context.cwd, target);
  }

  private async ensureActiveProject(
    context: CommandContext,
    createIfMissing: boolean
  ): Promise<ProjectRecord | null> {
    const activeId = context.getActiveProjectId?.();
    if (activeId) {
      const project = await readProject(context.cwd, activeId);
      if (project) return project;
    }

    if (!createIfMissing) return null;

    const project = await ensureDefaultProject(context.cwd);
    context.setActiveProjectId?.(project.id);
    await this.applyProjectContext(context, project);
    return project;
  }

  private async applyProjectContext(context: CommandContext, project: ProjectRecord): Promise<void> {
    if (!context.setProjectContext) return;
    const projectContext = await buildProjectContext(project, {
      cwd: context.cwd,
      connectors: context.connectors,
    });
    context.setProjectContext(projectContext);
  }
}

export const __test__ = {
  resolveAuthTimeout,
};
