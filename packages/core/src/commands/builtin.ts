import type { Command, CommandContext, CommandResult, TokenUsage } from './types';
import type { CommandLoader } from './loader';
import { join } from 'path';
import { homedir, platform, release, arch } from 'os';
import { getRuntime } from '../runtime';
import { buildCommandArgs } from '../utils/command-line';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { getConfigDir } from '../config';
import { generateId } from '@hasna/assistants-shared';
import { saveFeedbackEntry, type FeedbackType } from '../tools/feedback';
import type { ScheduledCommand } from '@hasna/assistants-shared';
import { getSecurityLogger, severityFromString } from '../security/logger';
import type { InboxManager } from '../inbox';
import type { WalletManager } from '../wallet';
import type { SecretsManager } from '../secrets';
import type { MessagesManager } from '../messages';
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
import { createSkill, type SkillScope } from '../skills/create';
import {
  listJobs,
  listJobsForSession,
  readJob,
  deleteJob,
  cleanupSessionJobs,
  type Job,
} from '../jobs';

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

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
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
    loader.register(this.skillCommand());
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
    loader.register(this.inboxCommand());
    loader.register(this.walletCommand());
    loader.register(this.secretsCommand());
    loader.register(this.jobsCommand());
    loader.register(this.messagesCommand());
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

        // /assistant prompt <text> - Set the assistant's system prompt addition
        if (action === 'prompt') {
          const active = manager.getActive();
          if (!active) {
            context.emit('text', 'No active assistant.\n');
            context.emit('done');
            return { handled: true };
          }

          if (!target) {
            // Show current prompt
            if (active.settings.systemPromptAddition) {
              context.emit('text', `Current system prompt for ${active.name}:\n`);
              context.emit('text', active.settings.systemPromptAddition + '\n');
            } else {
              context.emit('text', `No system prompt set for ${active.name}.\n`);
              context.emit('text', 'Usage: /assistant prompt <text>\n');
            }
            context.emit('done');
            return { handled: true };
          }

          // Set the prompt
          await manager.updateAssistant(active.id, {
            settings: {
              ...active.settings,
              systemPromptAddition: target,
            },
          });
          await context.refreshIdentityContext?.();
          context.emit('text', `System prompt updated for ${active.name}.\n`);
          context.emit('done');
          return { handled: true };
        }

        // /assistant prompt-clear - Clear the assistant's system prompt addition
        if (action === 'prompt-clear') {
          const active = manager.getActive();
          if (!active) {
            context.emit('text', 'No active assistant.\n');
            context.emit('done');
            return { handled: true };
          }

          const { systemPromptAddition, ...restSettings } = active.settings;
          await manager.updateAssistant(active.id, {
            settings: restSettings,
          });
          await context.refreshIdentityContext?.();
          context.emit('text', `System prompt cleared for ${active.name}.\n`);
          context.emit('done');
          return { handled: true };
        }

        // /assistant help
        if (action === 'help') {
          context.emit('text', '\n## Assistant Commands\n\n');
          context.emit('text', '/assistant                    Show current assistant\n');
          context.emit('text', '/assistant list               List all assistants\n');
          context.emit('text', '/assistant create <name>      Create new assistant\n');
          context.emit('text', '/assistant switch <name|id>   Switch to assistant\n');
          context.emit('text', '/assistant delete <name|id>   Delete assistant\n');
          context.emit('text', '/assistant settings           Show assistant settings\n');
          context.emit('text', '/assistant prompt [text]      Get/set assistant system prompt\n');
          context.emit('text', '/assistant prompt-clear       Clear assistant system prompt\n');
          context.emit('text', '/assistant help               Show this help\n');
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', 'Unknown /assistant command. Use /assistant help for options.\n');
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
        message += '  - The agent can use the wait/sleep tool to pause between actions\n';

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
        this.tokenUsage.cacheReadTokens = 0;
        this.tokenUsage.cacheWriteTokens = 0;
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
        this.tokenUsage.cacheReadTokens = 0;
        this.tokenUsage.cacheWriteTokens = 0;
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
  /**
   * /inbox - Manage agent inbox
   */
  private inboxCommand(): Command {
    return {
      name: 'inbox',
      description: 'Manage agent inbox (list, fetch, read, send emails)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const manager = context.getInboxManager?.();
        if (!manager) {
          context.emit('text', 'Inbox is not enabled. Configure inbox in config.json.\n');
          context.emit('done');
          return { handled: true };
        }

        const parts = splitArgs(args);
        const subcommand = parts[0]?.toLowerCase() || 'list';

        // /inbox or /inbox list
        if (subcommand === 'list' || (!parts[0] && !args.trim())) {
          const unreadOnly = parts.includes('--unread') || parts.includes('-u');
          const limitArg = parts.find((p) => p.match(/^\d+$/));
          const limit = limitArg ? parseInt(limitArg, 10) : 20;

          try {
            const emails = await manager.list({ limit, unreadOnly });
            if (emails.length === 0) {
              context.emit('text', unreadOnly ? 'No unread emails.\n' : 'Inbox is empty.\n');
            } else {
              context.emit('text', `\n## Inbox (${emails.length} email${emails.length === 1 ? '' : 's'})\n\n`);
              for (const email of emails) {
                const readIndicator = email.isRead ? '📖' : '📬';
                const attachmentIndicator = email.hasAttachments ? ' 📎' : '';
                const date = new Date(email.date).toLocaleDateString();
                context.emit('text', `${readIndicator} **${email.id}**${attachmentIndicator}\n`);
                context.emit('text', `   From: ${email.from}\n`);
                context.emit('text', `   Subject: ${email.subject}\n`);
                context.emit('text', `   Date: ${date}\n\n`);
              }
            }
          } catch (error) {
            context.emit('text', `Error listing emails: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /inbox fetch [limit]
        if (subcommand === 'fetch') {
          const limitArg = parts[1];
          const limit = limitArg ? parseInt(limitArg, 10) : 20;

          context.emit('text', 'Fetching emails...\n');
          try {
            const count = await manager.fetch({ limit });
            if (count === 0) {
              context.emit('text', 'No new emails found.\n');
            } else {
              context.emit('text', `Fetched ${count} new email(s).\n`);
            }
          } catch (error) {
            context.emit('text', `Error fetching: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /inbox read <id>
        if (subcommand === 'read') {
          const emailId = parts[1];
          if (!emailId) {
            context.emit('text', 'Usage: /inbox read <id>\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const email = await manager.read(emailId);
            if (!email) {
              context.emit('text', `Email ${emailId} not found.\n`);
            } else {
              // Import formatEmailAsMarkdown dynamically to avoid circular deps
              const { formatEmailAsMarkdown } = await import('../inbox/parser/email-parser');
              context.emit('text', '\n' + formatEmailAsMarkdown(email) + '\n');
            }
          } catch (error) {
            context.emit('text', `Error reading: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /inbox download <id> <index>
        if (subcommand === 'download') {
          const emailId = parts[1];
          const indexArg = parts[2];

          if (!emailId || !indexArg) {
            context.emit('text', 'Usage: /inbox download <email-id> <attachment-index>\n');
            context.emit('done');
            return { handled: true };
          }

          const index = parseInt(indexArg, 10);
          if (isNaN(index) || index < 0) {
            context.emit('text', 'Invalid attachment index.\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const path = await manager.downloadAttachment(emailId, index);
            context.emit('text', `Downloaded to: ${path}\n`);
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /inbox send <to> <subject>
        if (subcommand === 'send') {
          const to = parts[1];
          const subject = parts.slice(2).join(' ');

          if (!to || !subject) {
            context.emit('text', 'Usage: /inbox send <to> <subject>\n');
            context.emit('text', 'Then type your message and send.\n');
            context.emit('done');
            return { handled: true };
          }

          // This is interactive - we need to prompt for the body
          // For now, return a prompt to the LLM to help compose
          context.emit('done');
          return {
            handled: false,
            prompt: `Help me compose an email to ${to} with subject "${subject}". Ask me what I want to say, then use the inbox_send tool to send it.`,
          };
        }

        // /inbox reply <id>
        if (subcommand === 'reply') {
          const emailId = parts[1];
          if (!emailId) {
            context.emit('text', 'Usage: /inbox reply <id>\n');
            context.emit('done');
            return { handled: true };
          }

          // Load the email to show context
          try {
            const email = await manager.read(emailId);
            if (!email) {
              context.emit('text', `Email ${emailId} not found.\n`);
              context.emit('done');
              return { handled: true };
            }

            // Return a prompt to help compose the reply
            context.emit('done');
            return {
              handled: false,
              prompt: `Help me reply to this email from ${email.from.name || email.from.address} with subject "${email.subject}". Ask me what I want to say, then use the inbox_send tool with replyToId="${emailId}" to send it.`,
            };
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
            context.emit('done');
            return { handled: true };
          }
        }

        // /inbox address
        if (subcommand === 'address') {
          const address = manager.getEmailAddress();
          context.emit('text', `Agent email address: ${address}\n`);
          context.emit('done');
          return { handled: true };
        }

        // /inbox help
        if (subcommand === 'help') {
          context.emit('text', '\n## Inbox Commands\n\n');
          context.emit('text', '/inbox                     List emails (default)\n');
          context.emit('text', '/inbox list [--unread]     List emails, optionally unread only\n');
          context.emit('text', '/inbox fetch [limit]       Sync from S3 (default: 20)\n');
          context.emit('text', '/inbox read <id>           Read specific email\n');
          context.emit('text', '/inbox download <id> <n>   Download attachment\n');
          context.emit('text', '/inbox send <to> <subject> Compose and send email\n');
          context.emit('text', '/inbox reply <id>          Reply to an email\n');
          context.emit('text', '/inbox address             Show agent email address\n');
          context.emit('text', '/inbox help                Show this help\n');
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', `Unknown inbox command: ${subcommand}\n`);
        context.emit('text', 'Use /inbox help for available commands.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /wallet - Manage agent payment cards
   */
  private walletCommand(): Command {
    return {
      name: 'wallet',
      description: 'Manage payment cards in the agent wallet',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const manager = context.getWalletManager?.();
        if (!manager) {
          context.emit('text', 'Wallet is not enabled. Configure wallet in config.json.\n');
          context.emit('text', '\nTo enable:\n');
          context.emit('text', '```json\n');
          context.emit('text', '{\n');
          context.emit('text', '  "wallet": {\n');
          context.emit('text', '    "enabled": true,\n');
          context.emit('text', '    "secrets": {\n');
          context.emit('text', '      "region": "us-east-1"\n');
          context.emit('text', '    }\n');
          context.emit('text', '  }\n');
          context.emit('text', '}\n');
          context.emit('text', '```\n');
          context.emit('done');
          return { handled: true };
        }

        const parts = splitArgs(args);
        const subcommand = parts[0]?.toLowerCase() || 'list';

        // /wallet or /wallet list
        if (subcommand === 'list' || (!parts[0] && !args.trim())) {
          try {
            const cards = await manager.list();

            if (cards.length === 0) {
              context.emit('text', 'No cards stored in wallet.\n');
              context.emit('text', 'Use /wallet add to add a card.\n');
            } else {
              context.emit('text', `\n## Wallet (${cards.length} card${cards.length === 1 ? '' : 's'})\n\n`);
              for (const card of cards) {
                context.emit('text', `💳 **${card.name}** (${card.id})\n`);
                context.emit('text', `   **** **** **** ${card.last4}\n`);
                context.emit('text', `   Expires: ${card.expiry}\n\n`);
              }
              const status = manager.getRateLimitStatus();
              context.emit('text', `---\nRate limit: ${status.readsUsed}/${status.maxReads} reads this hour\n`);
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /wallet add
        if (subcommand === 'add') {
          context.emit('text', '\n## Add a Card\n\n');
          context.emit('text', '⚠️ **PCI DSS Warning**: Storing payment card data requires compliance with PCI DSS.\n');
          context.emit('text', 'Only store cards you have permission to use and ensure proper security controls.\n\n');
          context.emit('text', 'To add a card, use the wallet_add tool with:\n');
          context.emit('text', '- name: Friendly name (e.g., "Business Visa")\n');
          context.emit('text', '- cardholderName: Name on card\n');
          context.emit('text', '- cardNumber: Full card number\n');
          context.emit('text', '- expiryMonth: MM (01-12)\n');
          context.emit('text', '- expiryYear: YYYY\n');
          context.emit('text', '- cvv: Security code\n');
          context.emit('text', '- billingLine1, city, postalCode, country (optional)\n\n');
          context.emit('text', 'Cards are stored securely in AWS Secrets Manager, never locally.\n');
          context.emit('done');
          return { handled: true };
        }

        // /wallet remove <id>
        if (subcommand === 'remove') {
          const cardId = parts[1];
          if (!cardId) {
            context.emit('text', 'Usage: /wallet remove <card-id>\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const result = await manager.remove(cardId);
            if (result.success) {
              context.emit('text', `✓ ${result.message}\n`);
            } else {
              context.emit('text', `Error: ${result.message}\n`);
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /wallet status
        if (subcommand === 'status') {
          const status = manager.getRateLimitStatus();
          const credCheck = await manager.checkCredentials();

          context.emit('text', '\n## Wallet Status\n\n');
          context.emit('text', `AWS Credentials: ${credCheck.valid ? '✓ Valid' : '✗ Invalid'}\n`);
          if (!credCheck.valid && credCheck.error) {
            context.emit('text', `  Error: ${credCheck.error}\n`);
          }
          context.emit('text', `Rate Limit: ${status.readsUsed}/${status.maxReads} reads used\n`);
          context.emit('text', `Window Reset: ${status.windowResetMinutes} minutes\n`);
          context.emit('done');
          return { handled: true };
        }

        // /wallet warning
        if (subcommand === 'warning') {
          context.emit('text', '\n## ⚠️ PCI DSS Compliance Warning\n\n');
          context.emit('text', 'Storing payment card data requires compliance with PCI DSS (Payment Card Industry Data Security Standard).\n\n');
          context.emit('text', '**Before storing cards, ensure:**\n');
          context.emit('text', '1. You have explicit permission to store the card data\n');
          context.emit('text', '2. Your AWS account has appropriate security controls\n');
          context.emit('text', '3. Access is restricted to authorized personnel only\n');
          context.emit('text', '4. You maintain audit logs of card access\n');
          context.emit('text', '5. Cards are encrypted at rest (handled by AWS Secrets Manager)\n\n');
          context.emit('text', '**This wallet system provides:**\n');
          context.emit('text', '- Encryption at rest via AWS Secrets Manager\n');
          context.emit('text', '- Rate limiting to prevent abuse\n');
          context.emit('text', '- Agent isolation (cards scoped by agent ID)\n');
          context.emit('text', '- 30-day soft delete for recovery\n');
          context.emit('text', '- No local storage of card data\n\n');
          context.emit('text', '**You are responsible for:**\n');
          context.emit('text', '- Proper AWS IAM policies\n');
          context.emit('text', '- Network security and access controls\n');
          context.emit('text', '- Compliance with applicable regulations\n');
          context.emit('done');
          return { handled: true };
        }

        // /wallet help
        if (subcommand === 'help') {
          context.emit('text', '\n## Wallet Commands\n\n');
          context.emit('text', '/wallet                  List stored cards\n');
          context.emit('text', '/wallet list             List stored cards\n');
          context.emit('text', '/wallet add              Show instructions to add a card\n');
          context.emit('text', '/wallet remove <id>      Remove a card by ID\n');
          context.emit('text', '/wallet status           Show wallet status and credentials\n');
          context.emit('text', '/wallet warning          Show PCI compliance warning\n');
          context.emit('text', '/wallet help             Show this help\n\n');
          context.emit('text', '## Tools\n\n');
          context.emit('text', 'wallet_list              List cards (safe summaries)\n');
          context.emit('text', 'wallet_add               Add a new card\n');
          context.emit('text', 'wallet_get               Get card details (rate limited)\n');
          context.emit('text', 'wallet_remove            Remove a card\n');
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', `Unknown wallet command: ${subcommand}\n`);
        context.emit('text', 'Use /wallet help for available commands.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /secrets - Manage agent secrets (API keys, tokens, passwords)
   */
  private secretsCommand(): Command {
    return {
      name: 'secrets',
      description: 'Manage secrets (API keys, tokens, passwords)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const manager = context.getSecretsManager?.();
        if (!manager) {
          context.emit('text', 'Secrets management is not enabled. Configure secrets in config.json.\n');
          context.emit('text', '\nTo enable:\n');
          context.emit('text', '```json\n');
          context.emit('text', '{\n');
          context.emit('text', '  "secrets": {\n');
          context.emit('text', '    "enabled": true,\n');
          context.emit('text', '    "storage": {\n');
          context.emit('text', '      "region": "us-east-1"\n');
          context.emit('text', '    }\n');
          context.emit('text', '  }\n');
          context.emit('text', '}\n');
          context.emit('text', '```\n');
          context.emit('done');
          return { handled: true };
        }

        const parts = args.trim().split(/\s+/);
        const subcommand = parts[0]?.toLowerCase() || 'list';

        // /secrets or /secrets list [scope]
        if (subcommand === 'list' || (!parts[0] && !args.trim())) {
          try {
            const scope = parts[1]?.toLowerCase() || 'all';
            const secrets = await manager.list(scope as 'global' | 'agent' | 'all');

            if (secrets.length === 0) {
              context.emit('text', 'No secrets stored.\n');
              context.emit('text', 'Use secrets_set tool to store a secret.\n');
            } else {
              context.emit('text', `\n## Secrets (${secrets.length} secret${secrets.length === 1 ? '' : 's'})\n\n`);

              // Group by scope
              const globalSecrets = secrets.filter(s => s.scope === 'global');
              const agentSecrets = secrets.filter(s => s.scope === 'agent');

              if (globalSecrets.length > 0) {
                context.emit('text', '### Global Secrets\n');
                for (const secret of globalSecrets) {
                  context.emit('text', `- **${secret.name}**${secret.description ? ` - ${secret.description}` : ''}\n`);
                }
                context.emit('text', '\n');
              }

              if (agentSecrets.length > 0) {
                context.emit('text', '### Agent Secrets\n');
                for (const secret of agentSecrets) {
                  context.emit('text', `- **${secret.name}**${secret.description ? ` - ${secret.description}` : ''}\n`);
                }
                context.emit('text', '\n');
              }

              const status = manager.getRateLimitStatus();
              context.emit('text', `---\nRate limit: ${status.readsUsed}/${status.maxReads} reads this hour\n`);
            }
          } catch (error) {
            context.emit('text', `Error listing secrets: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /secrets get <name> [scope]
        if (subcommand === 'get') {
          const name = parts[1];
          if (!name) {
            context.emit('text', 'Usage: /secrets get <name> [scope]\n');
            context.emit('done');
            return { handled: true };
          }

          const scope = parts[2]?.toLowerCase() as 'global' | 'agent' | undefined;

          try {
            const value = await manager.get(name, scope, 'plain');
            if (value === null) {
              context.emit('text', `Secret "${name}" not found.\n`);
            } else {
              // Mask the value for display (show first 4 and last 4 chars if long enough)
              const valueStr = String(value);
              let maskedValue: string;
              if (valueStr.length <= 8) {
                maskedValue = '********';
              } else {
                maskedValue = valueStr.slice(0, 4) + '****' + valueStr.slice(-4);
              }
              context.emit('text', `\n**${name}**: ${maskedValue}\n`);
              context.emit('text', '\nTo use the full value, call secrets_get tool with the secret name.\n');
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /secrets set
        if (subcommand === 'set') {
          context.emit('text', '\n## Set a Secret\n\n');
          context.emit('text', 'To set a secret, use the secrets_set tool with:\n');
          context.emit('text', '- name: Secret name (e.g., "GITHUB_TOKEN", "STRIPE_API_KEY")\n');
          context.emit('text', '- value: Secret value\n');
          context.emit('text', '- description: Optional description\n');
          context.emit('text', '- scope: "global" or "agent" (default: agent)\n\n');
          context.emit('text', 'Secrets are stored securely in AWS Secrets Manager, never locally.\n');
          context.emit('done');
          return { handled: true };
        }

        // /secrets delete <name> [scope]
        if (subcommand === 'delete') {
          const name = parts[1];
          if (!name) {
            context.emit('text', 'Usage: /secrets delete <name> [scope]\n');
            context.emit('done');
            return { handled: true };
          }

          const scope = (parts[2]?.toLowerCase() as 'global' | 'agent') || 'agent';

          try {
            const result = await manager.delete(name, scope);
            if (result.success) {
              context.emit('text', `Secret "${name}" deleted. Recovery available for 7 days.\n`);
            } else {
              context.emit('text', `Error: ${result.message}\n`);
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /secrets export [scope]
        if (subcommand === 'export') {
          const scope = (parts[1]?.toLowerCase() as 'global' | 'agent' | 'all') || 'all';

          try {
            const envLines = await manager.export(scope);
            if (envLines.length === 0) {
              context.emit('text', 'No secrets to export.\n');
            } else {
              context.emit('text', '\n## Secrets Export (env format)\n\n');
              context.emit('text', '```bash\n');
              for (const line of envLines) {
                context.emit('text', `${line}\n`);
              }
              context.emit('text', '```\n');
              context.emit('text', '\nCopy these to your shell or .env file.\n');
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /secrets status
        if (subcommand === 'status') {
          const status = manager.getRateLimitStatus();
          const credCheck = await manager.checkCredentials();

          context.emit('text', '\n## Secrets Status\n\n');
          context.emit('text', `AWS Credentials: ${credCheck.valid ? 'Valid' : 'Invalid'}\n`);
          if (!credCheck.valid && credCheck.error) {
            context.emit('text', `  Error: ${credCheck.error}\n`);
          }
          context.emit('text', `Rate Limit: ${status.readsUsed}/${status.maxReads} reads used\n`);
          context.emit('text', `Window Reset: ${status.windowResetMinutes} minutes\n`);
          context.emit('done');
          return { handled: true };
        }

        // /secrets help
        if (subcommand === 'help') {
          context.emit('text', '\n## Secrets Commands\n\n');
          context.emit('text', '/secrets                  List all secrets (names only)\n');
          context.emit('text', '/secrets list [scope]     List secrets, optionally filtered by scope\n');
          context.emit('text', '/secrets get <name>       Get a secret value (masked)\n');
          context.emit('text', '/secrets set              Show instructions for secrets_set tool\n');
          context.emit('text', '/secrets delete <name>    Delete a secret\n');
          context.emit('text', '/secrets export [scope]   Export secrets as env format\n');
          context.emit('text', '/secrets status           Show status and credentials\n');
          context.emit('text', '/secrets help             Show this help\n\n');
          context.emit('text', '## Tools\n\n');
          context.emit('text', 'secrets_list              List secrets (names only)\n');
          context.emit('text', 'secrets_get               Get a secret value (rate limited)\n');
          context.emit('text', 'secrets_set               Create or update a secret\n');
          context.emit('text', 'secrets_delete            Delete a secret\n\n');
          context.emit('text', '## Scopes\n\n');
          context.emit('text', 'global - Shared across all agents\n');
          context.emit('text', 'agent  - Specific to this agent only\n');
          context.emit('text', 'all    - Both global and agent (default for list)\n');
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', `Unknown secrets command: ${subcommand}\n`);
        context.emit('text', 'Use /secrets help for available commands.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /jobs - List and manage background jobs
   */
  private jobsCommand(): Command {
    return {
      name: 'jobs',
      description: 'List and manage background jobs',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const parts = args.trim().split(/\s+/);
        const subcommand = parts[0]?.toLowerCase() || 'list';
        const arg = parts[1] || '';

        switch (subcommand) {
          case 'list':
          case '': {
            const jobs = await listJobsForSession(context.sessionId);
            if (jobs.length === 0) {
              context.emit('text', 'No jobs found for this session.\n');
              context.emit('done');
              return { handled: true };
            }

            // Sort by created time, newest first
            jobs.sort((a, b) => b.createdAt - a.createdAt);

            let output = '\n| Status | ID | Connector | Command | Age |\n';
            output += '|--------|----|-----------|---------|----- |\n';

            for (const job of jobs) {
              const age = this.formatAge(Date.now() - job.createdAt);
              const shortId = job.id.slice(0, 8);
              const command = job.command.slice(0, 30);
              output += `| ${job.status.toUpperCase()} | ${shortId} | ${job.connectorName} | ${command} | ${age} |\n`;
            }

            context.emit('text', output);
            context.emit('done');
            return { handled: true };
          }

          case 'all': {
            const jobs = await listJobs();
            if (jobs.length === 0) {
              context.emit('text', 'No jobs found.\n');
              context.emit('done');
              return { handled: true };
            }

            jobs.sort((a, b) => b.createdAt - a.createdAt);

            let output = '\n| Status | ID | Session | Connector | Command | Age |\n';
            output += '|--------|----|---------|-----------|---------|-----|\n';

            for (const job of jobs) {
              const age = this.formatAge(Date.now() - job.createdAt);
              const shortId = job.id.slice(0, 8);
              const shortSession = job.sessionId.slice(0, 8);
              const command = job.command.slice(0, 20);
              output += `| ${job.status.toUpperCase()} | ${shortId} | ${shortSession} | ${job.connectorName} | ${command} | ${age} |\n`;
            }

            context.emit('text', output);
            context.emit('done');
            return { handled: true };
          }

          case 'cancel': {
            if (!arg) {
              context.emit('text', 'Usage: /jobs cancel <job_id>\n');
              context.emit('done');
              return { handled: true };
            }

            // Find job by partial ID
            const jobs = await listJobs();
            const matches = jobs.filter((j) => j.id.startsWith(arg) || j.id === arg);

            if (matches.length === 0) {
              context.emit('text', `Job not found: ${arg}\n`);
              context.emit('done');
              return { handled: true };
            }

            if (matches.length > 1) {
              context.emit('text', `Ambiguous job ID. Matches: ${matches.map((j) => j.id).join(', ')}\n`);
              context.emit('done');
              return { handled: true };
            }

            const job = matches[0];
            if (!['pending', 'running'].includes(job.status)) {
              context.emit('text', `Cannot cancel job ${job.id}: status is ${job.status}\n`);
              context.emit('done');
              return { handled: true };
            }

            // Note: actual cancellation would need JobManager access
            // For now, just update status in store
            context.emit('text', `Job ${job.id} marked for cancellation. Use job_cancel tool for full cancellation.\n`);
            context.emit('done');
            return { handled: true };
          }

          case 'clear': {
            const cleaned = await cleanupSessionJobs(context.sessionId);
            context.emit('text', `Cleared ${cleaned} completed job(s).\n`);
            context.emit('done');
            return { handled: true };
          }

          case 'help': {
            const help = `
/jobs               List jobs for current session
/jobs list          List jobs for current session
/jobs all           List all jobs across sessions
/jobs <id>          Show details of a specific job
/jobs cancel <id>   Cancel a running job
/jobs clear         Clear completed jobs for this session
/jobs help          Show this help
`;
            context.emit('text', help);
            context.emit('done');
            return { handled: true };
          }

          default: {
            // Assume it's a job ID
            const jobs = await listJobs();
            const matches = jobs.filter((j) => j.id.startsWith(subcommand) || j.id === subcommand);

            if (matches.length === 0) {
              context.emit('text', `Job not found: ${subcommand}\nUse /jobs help for usage.\n`);
              context.emit('done');
              return { handled: true };
            }

            if (matches.length > 1) {
              context.emit('text', `Ambiguous job ID. Matches: ${matches.map((j) => j.id).join(', ')}\n`);
              context.emit('done');
              return { handled: true };
            }

            const job = matches[0];
            let output = `
Job ID: ${job.id}
Status: ${job.status}
Connector: ${job.connectorName}
Command: ${job.command}
Session: ${job.sessionId}
Created: ${new Date(job.createdAt).toISOString()}
`;

            if (job.startedAt) {
              output += `Started: ${new Date(job.startedAt).toISOString()}\n`;
            }

            if (job.completedAt) {
              output += `Completed: ${new Date(job.completedAt).toISOString()}\n`;
              const duration = job.completedAt - (job.startedAt || job.createdAt);
              output += `Duration: ${(duration / 1000).toFixed(1)}s\n`;
            }

            output += `Timeout: ${job.timeoutMs / 1000}s\n`;

            if (job.result) {
              output += `\nResult:\n${job.result.content}\n`;
            }

            if (job.error) {
              output += `\nError (${job.error.code}): ${job.error.message}\n`;
            }

            context.emit('text', output);
            context.emit('done');
            return { handled: true };
          }
        }
      },
    };
  }

  private formatAge(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  /**
   * /messages - Agent-to-agent messaging
   */
  private messagesCommand(): Command {
    return {
      name: 'messages',
      description: 'Agent-to-agent messaging (list, send, read, threads)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const manager = context.getMessagesManager?.();
        if (!manager) {
          context.emit('text', 'Messages are not enabled. Configure messages in config.json.\n');
          context.emit('text', '\nTo enable:\n');
          context.emit('text', '```json\n');
          context.emit('text', '{\n');
          context.emit('text', '  "messages": {\n');
          context.emit('text', '    "enabled": true\n');
          context.emit('text', '  }\n');
          context.emit('text', '}\n');
          context.emit('text', '```\n');
          context.emit('done');
          return { handled: true };
        }

        const parts = splitArgs(args);
        const subcommand = parts[0]?.toLowerCase() || 'list';

        // /messages or /messages list
        if (subcommand === 'list' || (!parts[0] && !args.trim())) {
          const unreadOnly = parts.includes('--unread') || parts.includes('-u');
          const limitArg = parts.find((p) => p.match(/^\d+$/));
          const limit = limitArg ? parseInt(limitArg, 10) : 20;

          try {
            const messages = await manager.list({ limit, unreadOnly });
            if (messages.length === 0) {
              context.emit('text', unreadOnly ? 'No unread messages.\n' : 'Inbox is empty.\n');
            } else {
              context.emit('text', `\n## Messages (${messages.length} message${messages.length === 1 ? '' : 's'})\n\n`);
              for (const msg of messages) {
                const statusIcon = msg.status === 'read' ? '📖' : msg.status === 'injected' ? '👁️' : '📬';
                const priorityIcon =
                  msg.priority === 'urgent'
                    ? ' 🔴'
                    : msg.priority === 'high'
                    ? ' 🟠'
                    : '';
                const date = new Date(msg.createdAt).toLocaleDateString();
                context.emit('text', `${statusIcon}${priorityIcon} **${msg.id}**\n`);
                context.emit('text', `   From: ${msg.fromAgentName}\n`);
                if (msg.subject) {
                  context.emit('text', `   Subject: ${msg.subject}\n`);
                }
                context.emit('text', `   Preview: ${msg.preview}\n`);
                context.emit('text', `   Date: ${date}${msg.replyCount > 0 ? ` | ${msg.replyCount} replies` : ''}\n\n`);
              }
            }
          } catch (error) {
            context.emit('text', `Error listing messages: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /messages threads
        if (subcommand === 'threads') {
          try {
            const threads = await manager.listThreads();
            if (threads.length === 0) {
              context.emit('text', 'No conversation threads found.\n');
            } else {
              context.emit('text', `\n## Threads (${threads.length})\n\n`);
              for (const thread of threads) {
                const participants = thread.participants.map((p) => p.agentName).join(', ');
                const updated = new Date(thread.updatedAt).toLocaleDateString();
                context.emit('text', `**${thread.threadId}**\n`);
                if (thread.subject) {
                  context.emit('text', `   Subject: ${thread.subject}\n`);
                }
                context.emit('text', `   Participants: ${participants}\n`);
                context.emit('text', `   Messages: ${thread.messageCount} (${thread.unreadCount} unread)\n`);
                context.emit('text', `   Updated: ${updated}\n\n`);
              }
            }
          } catch (error) {
            context.emit('text', `Error listing threads: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /messages read <id>
        if (subcommand === 'read') {
          const messageId = parts[1];
          if (!messageId) {
            context.emit('text', 'Usage: /messages read <id>\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const message = await manager.read(messageId);
            if (!message) {
              context.emit('text', `Message ${messageId} not found.\n`);
            } else {
              context.emit('text', `\n## Message: ${message.id}\n\n`);
              context.emit('text', `**From:** ${message.fromAgentName} (${message.fromAgentId})\n`);
              context.emit('text', `**To:** ${message.toAgentName} (${message.toAgentId})\n`);
              if (message.subject) {
                context.emit('text', `**Subject:** ${message.subject}\n`);
              }
              context.emit('text', `**Priority:** ${message.priority}\n`);
              context.emit('text', `**Sent:** ${new Date(message.createdAt).toLocaleString()}\n`);
              if (message.readAt) {
                context.emit('text', `**Read:** ${new Date(message.readAt).toLocaleString()}\n`);
              }
              context.emit('text', `**Thread:** ${message.threadId}\n`);
              if (message.parentId) {
                context.emit('text', `**In reply to:** ${message.parentId}\n`);
              }
              context.emit('text', '\n---\n\n');
              context.emit('text', message.body + '\n');
            }
          } catch (error) {
            context.emit('text', `Error reading message: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /messages thread <id>
        if (subcommand === 'thread') {
          const threadId = parts[1];
          if (!threadId) {
            context.emit('text', 'Usage: /messages thread <id>\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const messages = await manager.readThread(threadId);
            if (messages.length === 0) {
              context.emit('text', `Thread ${threadId} not found or empty.\n`);
            } else {
              context.emit('text', `\n## Thread: ${threadId}\n`);
              context.emit('text', `**${messages.length} message(s)**\n\n`);
              for (const msg of messages) {
                context.emit('text', '---\n');
                context.emit('text', `### From: ${msg.fromAgentName} → ${msg.toAgentName}\n`);
                if (msg.subject) {
                  context.emit('text', `**Subject:** ${msg.subject}\n`);
                }
                context.emit('text', `**Sent:** ${new Date(msg.createdAt).toLocaleString()}\n\n`);
                context.emit('text', msg.body + '\n');
                context.emit('text', `*ID: ${msg.id}*\n\n`);
              }
            }
          } catch (error) {
            context.emit('text', `Error reading thread: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /messages send <to> <subject>
        if (subcommand === 'send') {
          context.emit('text', 'To send a message, use the messages_send tool:\n\n');
          context.emit('text', 'Example:\n');
          context.emit('text', '```\n');
          context.emit('text', 'Use messages_send with:\n');
          context.emit('text', '  to: "AgentName"  (or agent ID)\n');
          context.emit('text', '  body: "Your message content"\n');
          context.emit('text', '  subject: "Optional subject" (optional)\n');
          context.emit('text', '  priority: "normal" (optional: low, normal, high, urgent)\n');
          context.emit('text', '```\n');
          context.emit('done');
          return { handled: true };
        }

        // /messages reply <id>
        if (subcommand === 'reply') {
          const messageId = parts[1];
          if (!messageId) {
            context.emit('text', 'Usage: /messages reply <id>\n');
            context.emit('done');
            return { handled: true };
          }

          context.emit('text', `To reply to message ${messageId}, use the messages_send tool:\n\n`);
          context.emit('text', 'Example:\n');
          context.emit('text', '```\n');
          context.emit('text', 'Use messages_send with:\n');
          context.emit('text', '  to: "<recipient>"\n');
          context.emit('text', '  body: "Your reply"\n');
          context.emit('text', `  replyTo: "${messageId}"\n`);
          context.emit('text', '```\n');
          context.emit('done');
          return { handled: true };
        }

        // /messages delete <id>
        if (subcommand === 'delete') {
          const messageId = parts[1];
          if (!messageId) {
            context.emit('text', 'Usage: /messages delete <id>\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const result = await manager.delete(messageId);
            context.emit('text', result.message + '\n');
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /messages agents
        if (subcommand === 'agents') {
          try {
            const agents = await manager.listAgents();
            if (agents.length === 0) {
              context.emit('text', 'No other agents found. Agents appear here after sending or receiving messages.\n');
            } else {
              context.emit('text', `\n## Known Agents (${agents.length})\n\n`);
              for (const agent of agents) {
                const lastSeen = new Date(agent.lastSeen).toLocaleDateString();
                context.emit('text', `- **${agent.name}** (ID: ${agent.id})\n`);
                context.emit('text', `  Last seen: ${lastSeen}\n`);
              }
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /messages stats
        if (subcommand === 'stats') {
          try {
            const stats = await manager.getStats();
            context.emit('text', '\n## Messages Statistics\n\n');
            context.emit('text', `Total Messages: ${stats.totalMessages}\n`);
            context.emit('text', `Unread: ${stats.unreadCount}\n`);
            context.emit('text', `Threads: ${stats.threadCount}\n`);
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /messages help
        if (subcommand === 'help') {
          context.emit('text', '\n## Messages Commands\n\n');
          context.emit('text', '/messages                List recent messages (default: 20)\n');
          context.emit('text', '/messages list [--unread] List messages, optionally unread only\n');
          context.emit('text', '/messages threads        List conversation threads\n');
          context.emit('text', '/messages read <id>      Read specific message\n');
          context.emit('text', '/messages thread <id>    Read entire thread\n');
          context.emit('text', '/messages send           Show how to send messages\n');
          context.emit('text', '/messages reply <id>     Show how to reply\n');
          context.emit('text', '/messages delete <id>    Delete a message\n');
          context.emit('text', '/messages agents         List known agents\n');
          context.emit('text', '/messages stats          Show inbox statistics\n');
          context.emit('text', '/messages help           Show this help\n\n');
          context.emit('text', '## Tools\n\n');
          context.emit('text', 'messages_send            Send a message to another agent\n');
          context.emit('text', 'messages_list            List inbox messages\n');
          context.emit('text', 'messages_read            Read a specific message\n');
          context.emit('text', 'messages_read_thread     Read entire thread\n');
          context.emit('text', 'messages_delete          Delete a message\n');
          context.emit('text', 'messages_list_agents     List known agents\n');
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', `Unknown messages command: ${subcommand}\n`);
        context.emit('text', 'Use /messages help for available commands.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

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
          let output = `\n**Context Entries (${singleLine(project.name)})**\n\n`;
          for (const entry of project.context) {
            const label = entry.label ? ` (${singleLine(entry.label)})` : '';
            output += `- ${entry.id} [${entry.type}] ${singleLine(entry.value)}${label}\n`;
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
            output += `${marker} ${singleLine(project.name)} (${project.id})\n`;
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
          let output = `\n**Project: ${singleLine(project.name)}**\n\n`;
          output += `ID: ${project.id}\n`;
          if (project.description) {
            output += `Description: ${singleLine(project.description)}\n`;
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
          let output = `\n**Plans (${singleLine(project.name)})**\n\n`;
          for (const plan of project.plans) {
            output += `- ${plan.id} ${singleLine(plan.title)} (${plan.steps.length} steps)\n`;
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
          let output = `\n**Plan: ${singleLine(plan.title)}**\n\n`;
          output += `ID: ${plan.id}\n`;
          if (plan.steps.length === 0) {
            output += 'No steps yet.\n';
          } else {
            for (const step of plan.steps) {
              output += `- ${step.id} [${step.status}] ${singleLine(step.text)}\n`;
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
   * /skill - Create/manage skills
   */
  private skillCommand(): Command {
    return {
      name: 'skill',
      description: 'Create or manage skills',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const tokens = splitArgs(args || '');
        const subcommand = tokens.shift()?.toLowerCase();

        const emitHelp = () => {
          let message = '\n**/skill commands**\n\n';
          message += '/skill create <name> [--project|--global] [options]\n';
          message += '\nOptions:\n';
          message += '  --project            Create in project (.assistants/skills)\n';
          message += '  --global             Create globally (~/.assistants/shared/skills)\n';
          message += '  --desc \"...\"         Description\n';
          message += '  --tools a,b,c        Allowed tools list\n';
          message += '  --hint \"...\"         Argument hint\n';
          message += '  --content \"...\"      Skill body content\n';
          message += '  --interactive         Ask follow-up questions\n';
          message += '  --force              Overwrite existing skill\n';
          message += '  --yes                Accept default (project) scope\n';
          message += '\nNotes:\n';
          message += '  - Skill directories must start with \"skill-\"\n';
          message += '  - Skill names should not include the word \"skill\"\n';
          context.emit('text', message);
          context.emit('done');
        };

        if (!subcommand || subcommand === 'help') {
          emitHelp();
          return { handled: true };
        }

        if (subcommand !== 'create') {
          context.emit('text', `Unknown /skill command: ${subcommand}\n`);
          context.emit('text', 'Use /skill help for available commands.\n');
          context.emit('done');
          return { handled: true };
        }

        let name: string | undefined;
        let scope: SkillScope | undefined;
        let description: string | undefined;
        let argumentHint: string | undefined;
        let content: string | undefined;
        let overwrite = false;
        let yes = false;
        let interactive = false;
        let allowedTools: string[] | undefined;

        for (let i = 0; i < tokens.length; i += 1) {
          const token = tokens[i];
          if (!token) continue;
          if (token.startsWith('--')) {
            switch (token) {
              case '--project':
                scope = 'project';
                break;
              case '--global':
                scope = 'global';
                break;
              case '--desc':
              case '--description':
                description = tokens[i + 1];
                i += 1;
                break;
              case '--tools': {
                const list = tokens[i + 1] || '';
                allowedTools = list
                  .split(',')
                  .map((tool) => tool.trim())
                  .filter(Boolean);
                i += 1;
                break;
              }
              case '--hint':
                argumentHint = tokens[i + 1];
                i += 1;
                break;
              case '--content':
                content = tokens[i + 1];
                i += 1;
                break;
              case '--interactive':
              case '--ask':
              case '--interview':
                interactive = true;
                break;
              case '--force':
              case '--overwrite':
                overwrite = true;
                break;
              case '--yes':
                yes = true;
                break;
              default:
                // ignore unknown flags
                break;
            }
          } else if (!name) {
            name = token;
          }
        }

        if (!name) {
          context.emit('text', 'Usage: /skill create <name> [--project|--global]\n');
          context.emit('done');
          return { handled: true };
        }

        if (interactive || (!scope && !yes)) {
          const known: string[] = [];
          if (scope) known.push(`scope: ${scope}`);
          if (description) known.push(`description: ${description}`);
          if (content) known.push(`content: provided`);
          if (allowedTools && allowedTools.length > 0) known.push(`allowed_tools: ${allowedTools.join(', ')}`);
          if (argumentHint) known.push(`argument_hint: ${argumentHint}`);

          const missing: string[] = [];
          if (!scope) missing.push('scope (project/global, default project)');
          if (!description) missing.push('description');
          if (!content) missing.push('content (multi-line allowed)');
          if (!allowedTools || allowedTools.length === 0) missing.push('allowed tools (optional)');
          if (!argumentHint) missing.push('argument hint (optional)');

          const knownBlock = known.length > 0 ? `Known values:\\n- ${known.join('\\n- ')}\\n\\n` : '';
          const missingBlock = missing.length > 0 ? `Ask for:\\n- ${missing.join('\\n- ')}\\n\\n` : '';

          context.emit('done');
          return {
            handled: false,
            prompt: `We are creating a new skill named \"${name}\".\\n\\n${knownBlock}${missingBlock}` +
              'Use the ask_user tool to interview the user and collect missing fields. ' +
              'Then call skill_create with name, scope, and any provided fields. ' +
              'If the user leaves optional fields blank, omit them. ' +
              'If scope is not specified, default to project.',
          };
        }

        const finalScope: SkillScope = scope ?? 'project';

        try {
          const result = await createSkill({
            name,
            scope: finalScope,
            description,
            allowedTools,
            argumentHint,
            content,
            cwd: context.cwd,
            overwrite,
          });

          await context.refreshSkills?.();

          let message = `\nCreated skill \"${result.name}\" (${result.scope}).\n`;
          message += `Location: ${result.filePath}\n`;
          message += `Invoke with: $${result.name} [args] or /${result.name} [args]\n`;
          if (!scope) {
            message += 'Defaulted to project scope. Use --global for a global skill.\n';
          }
          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        } catch (error) {
          context.emit('text', `Failed to create skill: ${error instanceof Error ? error.message : String(error)}\n`);
          context.emit('done');
          return { handled: true };
        }
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
        message += 'Create a skill with /skill create <name>\n\n';

        if (context.skills.length === 0) {
          message += 'No skills loaded.\n';
          message += '\nAdd skills to ~/.assistants/shared/skills/ or .assistants/skills/\n';
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
        const model = context.getModel?.() || 'unknown';
        message += `Current model: ${model}\n`;
        message += `Context window: ${this.tokenUsage.maxContextTokens.toLocaleString()} tokens\n\n`;
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

        if (kind === 'cron' && !cron) {
          context.emit('text', 'Usage:\n  /schedule cron "<expr>" <command>\n');
          context.emit('done');
          return { handled: true };
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
        if (schedule.nextRunAt <= now) {
          context.emit('text', 'Error: scheduled time must be in the future.\n');
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

        let computedNext: number | undefined;
        const updated = await updateSchedule(context.cwd, id, (schedule) => {
          computedNext = computeNextRun(schedule, Date.now());
          if (!computedNext) {
            return schedule;
          }
          return {
            ...schedule,
            status: 'active',
            updatedAt: Date.now(),
            nextRunAt: computedNext,
          };
        });
        if (!updated) {
          context.emit('text', `Schedule ${id} not found.\n`);
          context.emit('done');
          return { handled: true };
        }
        if (!computedNext) {
          context.emit('text', `Failed to compute next run for schedule ${id}.\n`);
          context.emit('done');
          return { handled: true };
        }
        context.emit('text', `Resumed schedule ${id}.\n`);
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

            const runtime = getRuntime();
            const cli = connector.cli || `connect-${connector.name}`;
            const execPromise = (async () => {
              const cmdParts = buildCommandArgs(cli, ['auth', 'status', '--format', 'json']);
              const proc = runtime.spawn(cmdParts, {
                cwd: process.cwd(),
                stdin: 'ignore',
                stdout: 'pipe',
                stderr: 'ignore',
              });
              const stdout = proc.stdout ? await new Response(proc.stdout).text() : '';
              const exitCode = await proc.exited;
              return { exitCode, stdout: { toString: () => stdout } };
            })();
            const result = await Promise.race([execPromise, timeoutPromise]);

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
          const commands = connector.commands || [];
          if (commands.length === 0) {
            message += '  (no commands discovered)\n';
          } else {
            for (const cmd of commands) {
              message += `  ${cmd.name} - ${cmd.description}\n`;
            }
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

              const runtime = getRuntime();
              const execPromise = (async () => {
                const cmdParts = buildCommandArgs(cli, ['auth', 'status', '--format', 'json']);
                const proc = runtime.spawn(cmdParts, {
                  cwd: process.cwd(),
                  stdin: 'ignore',
                  stdout: 'pipe',
                  stderr: 'ignore',
                });
                const stdout = proc.stdout ? await new Response(proc.stdout).text() : '';
                const exitCode = await proc.exited;
                return { exitCode, stdout: { toString: () => stdout } };
              })();
              const result = await Promise.race([execPromise, timeoutPromise]);

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
        const runtime = getRuntime();
        const systemInfo = {
          version: VERSION,
          platform: platform(),
          release: release(),
          arch: arch(),
          nodeVersion: process.version,
          runtimeName: runtime.name,
          runtimeVersion: runtime.version,
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
- **Runtime**: ${systemInfo.runtimeName} ${systemInfo.runtimeVersion}
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
- **Runtime**: ${systemInfo.runtimeName} ${systemInfo.runtimeVersion}
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

          const runtime = getRuntime();
          await runtime.shell`${openCmd} ${finalUrl}`.quiet();

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
          message += `- Runtime: ${systemInfo.runtimeName} ${systemInfo.runtimeVersion}\n`;

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
