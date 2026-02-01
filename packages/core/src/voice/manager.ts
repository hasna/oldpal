import type { VoiceConfig } from '@oldpal/shared';
import type { STTProvider, TTSProvider, VoiceState } from './types';
import type { RecordOptions } from './recorder';
import { WhisperSTT, SystemSTT } from './stt';
import { ElevenLabsTTS, SystemTTS } from './tts';
import { AudioPlayer, type PlayOptions } from './player';
import { AudioRecorder } from './recorder';

export interface AudioPlayerLike {
  play: (audio: ArrayBuffer, options?: PlayOptions) => Promise<void>;
  playStream?: (chunks: AsyncGenerator<ArrayBuffer>, options?: PlayOptions) => Promise<void>;
  stop: () => void;
  isPlaying: () => boolean;
}

export interface AudioRecorderLike {
  record: (options?: RecordOptions) => Promise<ArrayBuffer>;
  stop: () => void;
}

export interface VoiceManagerOptions {
  stt?: STTProvider;
  tts?: TTSProvider;
  player?: AudioPlayerLike;
  recorder?: AudioRecorderLike;
}

export class VoiceManager {
  private config: VoiceConfig;
  private stt: STTProvider;
  private tts: TTSProvider;
  private player: AudioPlayerLike;
  private recorder: AudioRecorderLike;
  private enabled: boolean;
  private isSpeaking = false;
  private isListening = false;

  constructor(config: VoiceConfig, options: VoiceManagerOptions = {}) {
    this.config = config;
    this.enabled = config.enabled ?? false;
    this.player = options.player ?? new AudioPlayer();
    this.recorder = options.recorder ?? new AudioRecorder();
    this.stt = options.stt ?? this.createSttProvider();
    this.tts = options.tts ?? this.createTtsProvider();
  }

  enable(): void {
    this.enabled = true;
    this.config.enabled = true;
  }

  disable(): void {
    this.enabled = false;
    this.config.enabled = false;
    this.stopSpeaking();
    this.stopListening();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getState(): VoiceState {
    return {
      enabled: this.enabled,
      isSpeaking: this.isSpeaking,
      isListening: this.isListening,
      sttProvider: this.config.stt.provider,
      ttsProvider: this.config.tts.provider,
    };
  }

  async speak(text: string): Promise<void> {
    if (!this.enabled) {
      throw new Error('Voice mode is disabled. Use /voice on to enable.');
    }
    const trimmed = text.trim();
    if (!trimmed) return;

    this.isSpeaking = true;
    try {
      if (this.tts.stream && this.player.playStream) {
        const format = this.config.tts.provider === 'elevenlabs' ? 'mp3' : 'wav';
        await this.player.playStream(this.tts.stream(trimmed), { format });
      } else {
        const result = await this.tts.synthesize(trimmed);
        await this.player.play(result.audio, { format: result.format });
      }
    } finally {
      this.isSpeaking = false;
    }
  }

  async listen(options?: RecordOptions): Promise<string> {
    if (!this.enabled) {
      throw new Error('Voice mode is disabled. Use /voice on to enable.');
    }
    this.isListening = true;
    try {
      const audio = await this.recorder.record(options);
      const result = await this.stt.transcribe(audio);
      return result.text;
    } finally {
      this.isListening = false;
    }
  }

  stopSpeaking(): void {
    this.player.stop();
    this.isSpeaking = false;
  }

  stopListening(): void {
    this.recorder.stop();
    this.isListening = false;
  }

  private createSttProvider(): STTProvider {
    if (this.config.stt.provider === 'system') {
      return new SystemSTT();
    }
    return new WhisperSTT({
      model: this.config.stt.model,
      language: this.config.stt.language,
    });
  }

  private createTtsProvider(): TTSProvider {
    if (this.config.tts.provider === 'system') {
      return new SystemTTS({
        voiceId: this.config.tts.voiceId,
        model: this.config.tts.model,
        stability: this.config.tts.stability,
        similarityBoost: this.config.tts.similarityBoost,
        speed: this.config.tts.speed,
      });
    }
    return new ElevenLabsTTS({
      voiceId: this.config.tts.voiceId,
      model: this.config.tts.model,
      stability: this.config.tts.stability,
      similarityBoost: this.config.tts.similarityBoost,
      speed: this.config.tts.speed,
    });
  }
}
