/**
 * Speech-to-Text module (Whisper)
 * TODO: Implement in Phase 3
 */

export interface STTOptions {
  model?: string;
  language?: string;
}

export interface STTResult {
  text: string;
  confidence: number;
  duration: number;
}

/**
 * Speech-to-Text using OpenAI Whisper API
 */
export class WhisperSTT {
  private apiKey: string;
  private model: string;
  private language: string;

  constructor(options: STTOptions = {}) {
    this.apiKey = process.env.OPENAI_API_KEY || '';
    this.model = options.model || 'whisper-1';
    this.language = options.language || 'en';
  }

  /**
   * Transcribe audio to text
   */
  async transcribe(audioBuffer: ArrayBuffer): Promise<STTResult> {
    // TODO: Implement Whisper API call
    throw new Error('Voice STT not implemented yet - coming in Phase 3');
  }

  /**
   * Start real-time transcription from microphone
   */
  async startListening(): Promise<AsyncGenerator<STTResult>> {
    // TODO: Implement real-time transcription
    throw new Error('Voice STT not implemented yet - coming in Phase 3');
  }
}
