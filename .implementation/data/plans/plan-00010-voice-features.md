# Plan: Voice Input/Output Features

**Plan ID:** 00010
**Status:** Completed
**Priority:** Low
**Estimated Effort:** Large (5+ days)
**Dependencies:** None

---

## Overview

Add voice capabilities including speech-to-text (STT) for input and text-to-speech (TTS) for output. Enable natural voice conversations with the assistant.

## Current State

- Text-only input/output
- No audio processing
- No voice API integrations
- No microphone access

## Requirements

### Functional
1. Speech-to-text input (Whisper API)
2. Text-to-speech output (ElevenLabs API)
3. Voice activation option
4. Configurable voice settings
5. Interrupt/cancel voice output

### Non-Functional
1. Low latency for natural conversation
2. Good audio quality
3. Offline fallback (system TTS)
4. Minimal resource usage when idle

## Technical Design

### Voice Configuration

```typescript
// packages/core/src/voice/types.ts

interface VoiceConfig {
  enabled: boolean;
  stt: STTConfig;
  tts: TTSConfig;
  wakeWord?: string;  // Optional wake word
  autoListen: boolean; // Auto-listen after response
}

interface STTConfig {
  provider: 'whisper' | 'system';
  language: string;
  model?: string;  // Whisper model size
}

interface TTSConfig {
  provider: 'elevenlabs' | 'system';
  voiceId?: string;
  speed: number;
  stability?: number;
  similarityBoost?: number;
}

const DEFAULT_CONFIG: VoiceConfig = {
  enabled: false,
  stt: {
    provider: 'whisper',
    language: 'en',
    model: 'whisper-1',
  },
  tts: {
    provider: 'elevenlabs',
    speed: 1.0,
    stability: 0.5,
    similarityBoost: 0.75,
  },
  autoListen: false,
};
```

### Speech-to-Text

```typescript
// packages/core/src/voice/stt.ts

interface STTResult {
  text: string;
  confidence: number;
  language?: string;
}

interface STTProvider {
  transcribe(audio: Buffer): Promise<STTResult>;
  startStream?(): AsyncGenerator<STTResult>;
}

class WhisperSTT implements STTProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async transcribe(audio: Buffer): Promise<STTResult> {
    const formData = new FormData();
    formData.append('file', new Blob([audio], { type: 'audio/wav' }), 'audio.wav');
    formData.append('model', 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    const result = await response.json();
    return {
      text: result.text,
      confidence: 1, // Whisper doesn't return confidence
    };
  }
}

class SystemSTT implements STTProvider {
  // Uses system speech recognition (macOS dictation, etc.)
  async transcribe(audio: Buffer): Promise<STTResult> {
    // Platform-specific implementation
    throw new Error('System STT not implemented');
  }
}
```

### Text-to-Speech

```typescript
// packages/core/src/voice/tts.ts

interface TTSProvider {
  synthesize(text: string): Promise<Buffer>;
  streamSynthesize?(text: string): AsyncGenerator<Buffer>;
}

class ElevenLabsTTS implements TTSProvider {
  private apiKey: string;
  private voiceId: string;
  private settings: { stability: number; similarityBoost: number };

  constructor(apiKey: string, voiceId: string, settings: any) {
    this.apiKey = apiKey;
    this.voiceId = voiceId;
    this.settings = settings;
  }

  async synthesize(text: string): Promise<Buffer> {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: {
            stability: this.settings.stability,
            similarity_boost: this.settings.similarityBoost,
          },
        }),
      }
    );

    return Buffer.from(await response.arrayBuffer());
  }

  async *streamSynthesize(text: string): AsyncGenerator<Buffer> {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: {
            stability: this.settings.stability,
            similarity_boost: this.settings.similarityBoost,
          },
        }),
      }
    );

    const reader = response.body!.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield Buffer.from(value);
    }
  }
}

class SystemTTS implements TTSProvider {
  async synthesize(text: string): Promise<Buffer> {
    // Use macOS 'say' command or espeak on Linux
    const { execSync } = await import('child_process');

    if (process.platform === 'darwin') {
      const outFile = `/tmp/tts-${Date.now()}.aiff`;
      execSync(`say -o ${outFile} "${text.replace(/"/g, '\\"')}"`);
      return await readFile(outFile);
    }

    throw new Error('System TTS not available on this platform');
  }
}
```

### Audio Player

```typescript
// packages/core/src/voice/player.ts

class AudioPlayer {
  private currentProcess?: any;
  private playing: boolean = false;

  async play(audio: Buffer): Promise<void> {
    this.playing = true;

    // Write to temp file and play with system player
    const tempFile = `/tmp/oldpal-audio-${Date.now()}.mp3`;
    await writeFile(tempFile, audio);

    return new Promise((resolve, reject) => {
      const player = process.platform === 'darwin' ? 'afplay' : 'aplay';
      this.currentProcess = spawn(player, [tempFile]);

      this.currentProcess.on('close', () => {
        this.playing = false;
        unlink(tempFile).catch(() => {});
        resolve();
      });

      this.currentProcess.on('error', reject);
    });
  }

  async playStream(chunks: AsyncGenerator<Buffer>): Promise<void> {
    // Stream playback for lower latency
    this.playing = true;
    // Implementation depends on platform
  }

  stop(): void {
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.playing = false;
    }
  }

  isPlaying(): boolean {
    return this.playing;
  }
}
```

### Voice Manager

```typescript
// packages/core/src/voice/manager.ts

class VoiceManager {
  private config: VoiceConfig;
  private stt: STTProvider;
  private tts: TTSProvider;
  private player: AudioPlayer;
  private recorder: AudioRecorder;

  constructor(config: VoiceConfig) {
    this.config = config;
    this.player = new AudioPlayer();
    this.recorder = new AudioRecorder();

    // Initialize providers
    this.stt = config.stt.provider === 'whisper'
      ? new WhisperSTT(process.env.OPENAI_API_KEY!)
      : new SystemSTT();

    this.tts = config.tts.provider === 'elevenlabs'
      ? new ElevenLabsTTS(
          process.env.ELEVENLABS_API_KEY!,
          config.tts.voiceId!,
          config.tts
        )
      : new SystemTTS();
  }

  async listen(): Promise<string> {
    const audio = await this.recorder.record();
    const result = await this.stt.transcribe(audio);
    return result.text;
  }

  async speak(text: string): Promise<void> {
    if (this.tts.streamSynthesize) {
      await this.player.playStream(this.tts.streamSynthesize(text));
    } else {
      const audio = await this.tts.synthesize(text);
      await this.player.play(audio);
    }
  }

  stopSpeaking(): void {
    this.player.stop();
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }
}
```

### Commands

```typescript
// Add to packages/core/src/commands/builtin.ts

const voiceCommands = {
  '/voice': {
    description: 'Toggle voice mode',
    execute: async (args, context) => {
      const voice = context.voiceManager;
      if (args === 'on') {
        voice.enable();
        return 'Voice mode enabled. Press Space to speak.';
      } else if (args === 'off') {
        voice.disable();
        return 'Voice mode disabled.';
      }
      return `Voice mode: ${voice.isEnabled() ? 'on' : 'off'}`;
    },
  },

  '/say': {
    description: 'Speak text aloud',
    execute: async (args, context) => {
      await context.voiceManager.speak(args);
      return '';
    },
  },
};
```

## Implementation Steps

### Step 1: Add Voice Types
- [x] Define VoiceConfig
- [x] Define STT types
- [x] Define TTS types
- [x] Create defaults

**Files:**
- `packages/core/src/voice/types.ts`

### Step 2: Implement STT Providers
- [x] Implement WhisperSTT
- [x] Implement SystemSTT
- [x] Add audio recording

**Files:**
- `packages/core/src/voice/stt.ts`
- `packages/core/src/voice/recorder.ts`

### Step 3: Implement TTS Providers
- [x] Implement ElevenLabsTTS
- [x] Implement SystemTTS
- [x] Add streaming support

**Files:**
- `packages/core/src/voice/tts.ts`

### Step 4: Implement Audio Player
- [x] Create AudioPlayer class
- [x] Add playback control
- [x] Add streaming playback

**Files:**
- `packages/core/src/voice/player.ts`

### Step 5: Implement VoiceManager
- [x] Create VoiceManager class
- [x] Integrate STT and TTS
- [x] Add listen/speak methods

**Files:**
- `packages/core/src/voice/manager.ts`

### Step 6: Add Commands
- [x] Add /voice command
- [x] Add /say command
- [x] Add /listen command

**Files:**
- `packages/core/src/commands/builtin.ts`

### Step 7: Integrate with Terminal
- [x] Add voice mode UI
- [x] Add speaking indicator
- [x] Handle interrupts

**Files:**
- `packages/terminal/src/components/App.tsx`
- `packages/terminal/src/components/VoiceIndicator.tsx`

### Step 8: Add Tests
- [x] Test STT providers
- [x] Test TTS providers
- [x] Test VoiceManager

**Files:**
- `packages/core/tests/voice.test.ts`

## Testing Strategy

```typescript
describe('WhisperSTT', () => {
  it('should transcribe audio');
  it('should handle API errors');
});

describe('ElevenLabsTTS', () => {
  it('should synthesize speech');
  it('should stream audio');
});

describe('VoiceManager', () => {
  it('should coordinate listen and speak');
  it('should handle interrupts');
});
```

## Rollout Plan

1. Add voice types
2. Implement STT providers
3. Implement TTS providers
4. Build audio player
5. Create VoiceManager
6. Add commands
7. Integrate with terminal
8. Add documentation

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| API costs | Medium | System fallbacks, usage tracking |
| Latency | High | Streaming, caching |
| Platform support | Medium | Platform-specific implementations |
| Audio quality | Low | Configurable settings |

---


## Open Questions

- TBD
## Approval

- [ ] Technical design approved
- [ ] Implementation steps clear
- [ ] Tests defined
- [ ] Ready to implement
