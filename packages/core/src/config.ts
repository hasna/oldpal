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
  connectors: [
    'notion',
    'googledrive',
    'gmail',
    'googlecalendar',
    'linear',
    'slack',
  ],
};

/**
 * Get the path to the oldpal config directory
 */
export function getConfigDir(): string {
  return join(homedir(), '.oldpal');
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
  const config: OldpalConfig = { ...DEFAULT_CONFIG };

  // Load user config
  const userConfigPath = getConfigPath('settings.json');
  const userConfig = await loadJsonFile<Partial<OldpalConfig>>(userConfigPath);
  if (userConfig) {
    Object.assign(config, userConfig);
    if (userConfig.llm) config.llm = { ...config.llm, ...userConfig.llm };
    if (userConfig.voice) config.voice = { ...config.voice, ...userConfig.voice };
  }

  // Load project config
  const projectConfigPath = join(getProjectConfigDir(cwd), 'settings.json');
  const projectConfig = await loadJsonFile<Partial<OldpalConfig>>(projectConfigPath);
  if (projectConfig) {
    Object.assign(config, projectConfig);
    if (projectConfig.llm) config.llm = { ...config.llm, ...projectConfig.llm };
    if (projectConfig.voice) config.voice = { ...config.voice, ...projectConfig.voice };
  }

  // Load project local config (git-ignored)
  const localConfigPath = join(getProjectConfigDir(cwd), 'settings.local.json');
  const localConfig = await loadJsonFile<Partial<OldpalConfig>>(localConfigPath);
  if (localConfig) {
    Object.assign(config, localConfig);
    if (localConfig.llm) config.llm = { ...config.llm, ...localConfig.llm };
    if (localConfig.voice) config.voice = { ...config.voice, ...localConfig.voice };
  }

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
 * Ensure the config directory exists
 */
export async function ensureConfigDir(): Promise<void> {
  const configDir = getConfigDir();
  await Bun.$`mkdir -p ${configDir}`;
  await Bun.$`mkdir -p ${configDir}/sessions`;
  await Bun.$`mkdir -p ${configDir}/skills`;
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
