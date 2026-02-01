import { join } from 'path';
import { homedir } from 'os';
import type { OldpalConfig, HookConfig } from '@oldpal/shared';

const DEFAULT_CONFIG: OldpalConfig = {
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
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
    },
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
    regenRate: 5,
    lowEnergyThreshold: 30,
    criticalThreshold: 10,
    maxEnergy: 100,
    costs: {
      message: 2,
      toolCall: 5,
      llmCall: 3,
      longContext: 10,
    },
  },
  validation: {
    mode: 'strict',
    maxUserMessageLength: 100_000,
    maxToolOutputLength: 50_000,
    maxTotalContextTokens: 180_000,
    maxFileReadSize: 10 * 1024 * 1024,
  },
};

function mergeConfig(base: OldpalConfig, override?: Partial<OldpalConfig>): OldpalConfig {
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
  };
}

/**
 * Get the path to the oldpal config directory
 */
export function getConfigDir(): string {
  const override = process.env.OLDPAL_DIR;
  if (override && override.trim()) {
    return override;
  }
  const envHome = process.env.HOME || process.env.USERPROFILE;
  const homeDir = envHome && envHome.trim().length > 0 ? envHome : homedir();
  return join(homeDir, '.oldpal');
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
  return join(cwd, '.oldpal');
}

/**
 * Load configuration from multiple sources (merged)
 * Priority: project local > project > user > default
 */
export async function loadConfig(cwd: string = process.cwd()): Promise<OldpalConfig> {
  let config: OldpalConfig = { ...DEFAULT_CONFIG };

  // Load user config
  const userConfigPath = getConfigPath('settings.json');
  const userConfig = await loadJsonFile<Partial<OldpalConfig>>(userConfigPath);
  config = mergeConfig(config, userConfig || undefined);

  // Load project config
  const projectConfigPath = join(getProjectConfigDir(cwd), 'settings.json');
  const projectConfig = await loadJsonFile<Partial<OldpalConfig>>(projectConfigPath);
  config = mergeConfig(config, projectConfig || undefined);

  // Load project local config (git-ignored)
  const localConfigPath = join(getProjectConfigDir(cwd), 'settings.local.json');
  const localConfig = await loadJsonFile<Partial<OldpalConfig>>(localConfigPath);
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
    mkdir(join(configDir, 'sessions'), { recursive: true }),
    mkdir(join(configDir, 'skills'), { recursive: true }),
    mkdir(join(configDir, 'temp'), { recursive: true }),
    mkdir(join(configDir, 'heartbeats'), { recursive: true }),
    mkdir(join(configDir, 'state'), { recursive: true }),
    mkdir(join(configDir, 'energy'), { recursive: true }),
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
 * Load system prompt from OLDPAL.md files
 * Priority: project .oldpal/OLDPAL.md > global ~/.oldpal/OLDPAL.md
 * If both exist, they are concatenated (global first, then project)
 */
export async function loadSystemPrompt(cwd: string = process.cwd()): Promise<string | null> {
  const prompts: string[] = [];

  // Load global system prompt
  const globalPromptPath = getConfigPath('OLDPAL.md');
  const globalPrompt = await loadTextFile(globalPromptPath);
  if (globalPrompt) {
    prompts.push(globalPrompt);
  }

  // Load project system prompt
  const projectPromptPath = join(getProjectConfigDir(cwd), 'OLDPAL.md');
  const projectPrompt = await loadTextFile(projectPromptPath);
  if (projectPrompt) {
    prompts.push(projectPrompt);
  }

  if (prompts.length === 0) {
    return null;
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
