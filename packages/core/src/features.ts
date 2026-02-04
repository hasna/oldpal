/**
 * Feature detection utilities
 * Helps determine which optional features are available at runtime
 */

/**
 * Check if AWS credentials are configured in the environment
 */
export function isAWSConfigured(): boolean {
  return !!(
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
  );
}

/**
 * Check if ElevenLabs TTS is configured
 */
export function isElevenLabsConfigured(): boolean {
  return !!process.env.ELEVENLABS_API_KEY;
}

/**
 * Check if OpenAI (for Whisper STT) is configured
 */
export function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * Check if Exa (web search) is configured
 */
export function isExaConfigured(): boolean {
  return !!process.env.EXA_API_KEY;
}

/**
 * Check if macOS system voice is available
 */
export function isSystemVoiceAvailable(): boolean {
  return process.platform === 'darwin';
}

/**
 * Feature availability summary
 */
export interface FeatureAvailability {
  /** Core chat - always available with ANTHROPIC_API_KEY */
  coreChat: boolean;
  /** AWS features (inbox, wallet, secrets) */
  awsFeatures: boolean;
  /** ElevenLabs text-to-speech */
  elevenLabsTTS: boolean;
  /** OpenAI Whisper speech-to-text */
  whisperSTT: boolean;
  /** Exa enhanced web search */
  exaSearch: boolean;
  /** macOS system voice */
  systemVoice: boolean;
}

/**
 * Get summary of available features based on environment
 */
export function getFeatureAvailability(): FeatureAvailability {
  return {
    coreChat: !!process.env.ANTHROPIC_API_KEY,
    awsFeatures: isAWSConfigured(),
    elevenLabsTTS: isElevenLabsConfigured(),
    whisperSTT: isOpenAIConfigured(),
    exaSearch: isExaConfigured(),
    systemVoice: isSystemVoiceAvailable(),
  };
}

/**
 * Get a human-readable feature status message
 */
export function getFeatureStatusMessage(): string {
  const features = getFeatureAvailability();
  const lines: string[] = [];

  if (!features.coreChat) {
    lines.push('⚠️  ANTHROPIC_API_KEY not set - core chat disabled');
  } else {
    lines.push('✓ Core chat enabled');
  }

  if (features.awsFeatures) {
    lines.push('✓ AWS features available (inbox, wallet, secrets)');
  } else {
    lines.push('○ AWS features disabled (set AWS_REGION to enable)');
  }

  if (features.elevenLabsTTS) {
    lines.push('✓ ElevenLabs TTS available');
  }

  if (features.whisperSTT) {
    lines.push('✓ Whisper STT available');
  }

  if (features.systemVoice) {
    lines.push('✓ System voice available (macOS)');
  }

  if (features.exaSearch) {
    lines.push('✓ Exa enhanced search available');
  }

  return lines.join('\n');
}
