import type { STTOptions, STTResult } from './types';
import { loadApiKeyFromSecrets } from './utils';

/**
 * Speech-to-Text using OpenAI Whisper API
 */
export class WhisperSTT {
  private apiKey: string;
  private model: string;
  private language?: string;

  constructor(options: STTOptions = {}) {
    this.apiKey = options.apiKey
      || process.env.OPENAI_API_KEY
      || loadApiKeyFromSecrets('OPENAI_API_KEY')
      || '';
    this.model = options.model || 'whisper-1';
    this.language = options.language;
  }

  /**
   * Transcribe audio to text
   */
  async transcribe(audioBuffer: ArrayBuffer): Promise<STTResult> {
    if (!this.apiKey) {
      throw new Error('Missing OPENAI_API_KEY for Whisper STT. Set it in env or ~/.secrets.');
    }

    const form = new FormData();
    form.append('file', new Blob([audioBuffer], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', this.model);
    if (this.language) {
      form.append('language', this.language);
    }

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: form,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Whisper STT failed (${response.status}): ${errorText || response.statusText}`);
    }

    const result = await response.json() as { text?: string; language?: string };
    return {
      text: result.text || '',
      confidence: 1,
      language: result.language,
    };
  }

  /**
   * Start real-time transcription from microphone
   */
  async startListening(): Promise<AsyncGenerator<STTResult>> {
    throw new Error('Real-time transcription is not supported. Use VoiceManager.listen().');
  }
}

export class SystemSTT {
  async transcribe(_audioBuffer: ArrayBuffer): Promise<STTResult> {
    throw new Error('System STT is not available yet. Use Whisper STT instead.');
  }
}
