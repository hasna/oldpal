import { join } from 'path';
import { homedir } from 'os';
import type { AssistantsConfig, HookConfig } from '@hasna/assistants-shared';

/**
 * Default system prompt - used when no ASSISTANTS.md files are found
 */
const DEFAULT_SYSTEM_PROMPT = `You are Hasna Assistant, a helpful AI assistant running in the terminal.

## Runtime Environment
- Use **Bun** as the default runtime for JavaScript/TypeScript scripts
- When creating scripts, use the shebang \`#!/usr/bin/env bun\`
- Prefer Bun APIs (Bun.file, Bun.write, etc.) over Node.js equivalents when available
- For package management, prefer \`bun install\` over \`npm install\`

## Code Style
- Write clean, readable code with meaningful variable names
- Add comments only when the logic isn't self-evident
- Prefer simple solutions over complex abstractions
- Use TypeScript when type safety is beneficial

## Communication
- Be concise and direct in responses
- Ask clarifying questions when requirements are ambiguous
- Explain your reasoning when making architectural decisions
`;

const DEFAULT_CONFIG: AssistantsConfig = {
  llm: {
    provider: 'anthropic',
    model: 'claude-opus-4-5',
    maxTokens: 8192,
  },
  voice: {
    enabled: false,
    stt: {
      provider: 'whisper',
      model: 'whisper-1',
      language: 'en',
    },
    tts: {
      provider: 'elevenlabs',
      voiceId: '',
      model: 'eleven_turbo_v2_5',
      stability: 0.5,
      similarityBoost: 0.75,
      speed: 1.0,
    },
    autoListen: false,
  },
  connectors: [],
  scheduler: {
    enabled: true,
    heartbeatIntervalMs: 30000,
  },
  heartbeat: {
    enabled: true,
    intervalMs: 15000,
    staleThresholdMs: 120000,
  },
  context: {
    enabled: true,
    maxContextTokens: 180000,
    targetContextTokens: 150000,
    summaryTriggerRatio: 0.8,
    keepRecentMessages: 10,
    keepSystemPrompt: true,
    summaryStrategy: 'hybrid',
    summaryMaxTokens: 2000,
    maxMessages: 500,
  },
  energy: {
    enabled: true,
    regenRate: 500,
    lowEnergyThreshold: 3000,
    criticalThreshold: 1000,
    maxEnergy: 10000,
    costs: {
      message: 200,
      toolCall: 500,
      llmCall: 300,
      longContext: 1000,
    },
  },
  validation: {
    mode: 'strict',
    maxUserMessageLength: 100_000,
    maxToolOutputLength: 50_000,
    maxTotalContextTokens: 180_000,
    maxFileReadSize: 10 * 1024 * 1024,
  },
  inbox: {
    enabled: false,
    provider: 'ses',
    cache: {
      enabled: true,
      maxAgeDays: 30,
      maxSizeMb: 500,
    },
  },
  wallet: {
    enabled: false,
    // No local storage - cards only in AWS Secrets Manager
    security: {
      maxReadsPerHour: 10,
    },
  },
};

function mergeConfig(base: AssistantsConfig, override?: Partial<AssistantsConfig>): AssistantsConfig {
  if (!override) return base;

  const mergedVoice = base.voice || override.voice
    ? {
        ...(base.voice || {}),
        ...(override.voice || {}),
        enabled: override.voice?.enabled ?? base.voice?.enabled ?? false,
        stt: {
          ...(base.voice?.stt || {}),
          ...(override.voice?.stt || {}),
          provider: override.voice?.stt?.provider ?? base.voice?.stt?.provider ?? 'whisper',
        },
        tts: {
          ...(base.voice?.tts || {}),
          ...(override.voice?.tts || {}),
          provider: override.voice?.tts?.provider ?? base.voice?.tts?.provider ?? 'elevenlabs',
          voiceId: override.voice?.tts?.voiceId ?? base.voice?.tts?.voiceId ?? '',
        },
        autoListen: override.voice?.autoListen ?? base.voice?.autoListen ?? false,
        wake: {
          ...(base.voice?.wake || {}),
          ...(override.voice?.wake || {}),
          enabled: override.voice?.wake?.enabled ?? base.voice?.wake?.enabled ?? false,
          word: override.voice?.wake?.word ?? base.voice?.wake?.word ?? '',
        },
      }
    : undefined;

  return {
    ...base,
    ...override,
    llm: {
      ...base.llm,
      ...(override.llm || {}),
    },
    voice: mergedVoice,
    connectors: override.connectors ?? base.connectors,
    skills: override.skills ?? base.skills,
    hooks: override.hooks ?? base.hooks,
    scheduler: {
      ...(base.scheduler || {}),
      ...(override.scheduler || {}),
    },
    heartbeat: {
      ...(base.heartbeat || {}),
      ...(override.heartbeat || {}),
    },
    context: {
      ...(base.context || {}),
      ...(override.context || {}),
    },
    energy: {
      ...(base.energy || {}),
      ...(override.energy || {}),
    },
    validation: {
      ...(base.validation || {}),
      ...(override.validation || {}),
      perTool: {
        ...(base.validation?.perTool || {}),
        ...(override.validation?.perTool || {}),
      },
    },
    inbox: {
      ...(base.inbox || {}),
      ...(override.inbox || {}),
      // Only merge storage if at least one config defines it with bucket
      storage: (base.inbox?.storage?.bucket || override.inbox?.storage?.bucket)
        ? {
            bucket: override.inbox?.storage?.bucket ?? base.inbox?.storage?.bucket ?? '',
            region: override.inbox?.storage?.region ?? base.inbox?.storage?.region ?? 'us-east-1',
            prefix: override.inbox?.storage?.prefix ?? base.inbox?.storage?.prefix,
            credentialsProfile: override.inbox?.storage?.credentialsProfile ?? base.inbox?.storage?.credentialsProfile,
          }
        : undefined,
      ses: {
        ...(base.inbox?.ses || {}),
        ...(override.inbox?.ses || {}),
      },
      resend: {
        ...(base.inbox?.resend || {}),
        ...(override.inbox?.resend || {}),
      },
      cache: {
        ...(base.inbox?.cache || {}),
        ...(override.inbox?.cache || {}),
      },
    },
    wallet: {
      ...(base.wallet || {}),
      ...(override.wallet || {}),
      // Only merge secrets if region is configured
      secrets: (base.wallet?.secrets?.region || override.wallet?.secrets?.region)
        ? {
            region: override.wallet?.secrets?.region ?? base.wallet?.secrets?.region ?? 'us-east-1',
            prefix: override.wallet?.secrets?.prefix ?? base.wallet?.secrets?.prefix,
            credentialsProfile: override.wallet?.secrets?.credentialsProfile ?? base.wallet?.secrets?.credentialsProfile,
          }
        : undefined,
      security: {
        ...(base.wallet?.security || {}),
        ...(override.wallet?.security || {}),
      },
    },
  };
}

/**
 * Get the path to the assistants config directory
 */
export function getConfigDir(): string {
  const assistantsOverride = process.env.ASSISTANTS_DIR;
  if (assistantsOverride && assistantsOverride.trim()) {
    return assistantsOverride;
  }
  const envHome = process.env.HOME || process.env.USERPROFILE;
  const homeDir = envHome && envHome.trim().length > 0 ? envHome : homedir();
  return join(homeDir, '.assistants');
}

/**
 * Get the path to a specific config file
 */
export function getConfigPath(filename: string): string {
  return join(getConfigDir(), filename);
}

/**
 * Get the path to the project config directory
 */
export function getProjectConfigDir(cwd: string = process.cwd()): string {
  return join(cwd, '.assistants');
}

/**
 * Load configuration from multiple sources (merged)
 * Priority: project local > project > user > default
 */
export async function loadConfig(cwd: string = process.cwd()): Promise<AssistantsConfig> {
  let config: AssistantsConfig = { ...DEFAULT_CONFIG };

  // Load user config
  const userConfigPath = getConfigPath('config.json');
  const legacyUserConfigPath = getConfigPath('settings.json');
  const userConfig = (await loadJsonFile<Partial<AssistantsConfig>>(userConfigPath))
    || (await loadJsonFile<Partial<AssistantsConfig>>(legacyUserConfigPath));
  config = mergeConfig(config, userConfig || undefined);

  // Load project config
  const projectConfigPath = join(getProjectConfigDir(cwd), 'config.json');
  const projectConfig = await loadJsonFile<Partial<AssistantsConfig>>(projectConfigPath);
  config = mergeConfig(config, projectConfig || undefined);

  // Load project local config (git-ignored)
  const localConfigPath = join(getProjectConfigDir(cwd), 'config.local.json');
  const localConfig = await loadJsonFile<Partial<AssistantsConfig>>(localConfigPath);
  config = mergeConfig(config, localConfig || undefined);

  return config;
}

/**
 * Load hooks configuration from multiple sources (merged)
 */
export async function loadHooksConfig(cwd: string = process.cwd()): Promise<HookConfig> {
  const hooks: HookConfig = {};

  // Load user hooks
  const userHooksPath = getConfigPath('hooks.json');
  const userHooks = await loadJsonFile<{ hooks: HookConfig }>(userHooksPath);
  if (userHooks?.hooks) {
    mergeHooks(hooks, userHooks.hooks);
  }

  // Load project hooks
  const projectHooksPath = join(getProjectConfigDir(cwd), 'hooks.json');
  const projectHooks = await loadJsonFile<{ hooks: HookConfig }>(projectHooksPath);
  if (projectHooks?.hooks) {
    mergeHooks(hooks, projectHooks.hooks);
  }

  return hooks;
}

/**
 * Merge hooks from source into target
 */
function mergeHooks(target: HookConfig, source: HookConfig): void {
  for (const [event, matchers] of Object.entries(source)) {
    if (!target[event]) {
      target[event] = [];
    }
    target[event].push(...matchers);
  }
}

/**
 * Load a JSON file, returning null if it doesn't exist
 */
async function loadJsonFile<T>(path: string): Promise<T | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return null;
    }
    return await file.json();
  } catch {
    return null;
  }
}

/**
 * Ensure the config directory exists (using native fs for speed)
 */
export async function ensureConfigDir(sessionId?: string): Promise<void> {
  const { mkdir } = await import('fs/promises');
  const configDir = getConfigDir();

  // Create all directories in parallel
  const dirs = [
    mkdir(configDir, { recursive: true }),
    mkdir(join(configDir, 'logs'), { recursive: true }),
    mkdir(join(configDir, 'assistants'), { recursive: true }),
    mkdir(join(configDir, 'shared', 'skills'), { recursive: true }),
    mkdir(join(configDir, 'migration'), { recursive: true }),
    mkdir(join(configDir, 'temp'), { recursive: true }),
    mkdir(join(configDir, 'heartbeats'), { recursive: true }),
    mkdir(join(configDir, 'state'), { recursive: true }),
    mkdir(join(configDir, 'energy'), { recursive: true }),
    mkdir(join(configDir, 'inbox'), { recursive: true }),
  ];

  // Create session-specific temp folder if provided
  if (sessionId) {
    dirs.push(mkdir(join(configDir, 'temp', sessionId), { recursive: true }));
  }

  await Promise.all(dirs);
}

/**
 * Get the temp folder path for a session
 */
export function getTempFolder(sessionId: string): string {
  return join(getConfigDir(), 'temp', sessionId);
}

/**
 * Load system prompt from ASSISTANTS.md files
 * Priority: project .assistants/ASSISTANTS.md > global ~/.assistants/ASSISTANTS.md
 * If both exist, they are concatenated (global first, then project)
 */
export async function loadSystemPrompt(cwd: string = process.cwd()): Promise<string | null> {
  const prompts: string[] = [];

  // Load global system prompt
  const globalPromptPath = getConfigPath('ASSISTANTS.md');
  const globalPrompt = await loadTextFile(globalPromptPath);
  if (globalPrompt) prompts.push(globalPrompt);

  // Load project system prompt
  const projectPromptPath = join(getProjectConfigDir(cwd), 'ASSISTANTS.md');
  const projectPrompt = await loadTextFile(projectPromptPath);
  if (projectPrompt) prompts.push(projectPrompt);

  if (prompts.length === 0) {
    // Use default system prompt when no user prompts exist
    return DEFAULT_SYSTEM_PROMPT;
  }

  return prompts.join('\n\n---\n\n');
}

/**
 * Load a text file, returning null if it doesn't exist
 */
async function loadTextFile(path: string): Promise<string | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return null;
    }
    return await file.text();
  } catch {
    return null;
  }
}
