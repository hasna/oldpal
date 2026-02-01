export interface STTOptions {
  apiKey?: string;
  model?: string;
  language?: string;
}

export interface STTResult {
  text: string;
  confidence: number;
  duration?: number;
  language?: string;
}

export interface STTProvider {
  transcribe(audio: ArrayBuffer): Promise<STTResult>;
}

export interface TTSOptions {
  apiKey?: string;
  voiceId?: string;
  model?: string;
  stability?: number;
  similarityBoost?: number;
  speed?: number;
}

export interface TTSResult {
  audio: ArrayBuffer;
  duration?: number;
  format?: 'mp3' | 'wav' | 'aiff';
}

export interface TTSProvider {
  synthesize(text: string): Promise<TTSResult>;
  stream?(text: string): AsyncGenerator<ArrayBuffer>;
}

export interface VoiceState {
  enabled: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  sttProvider?: string;
  ttsProvider?: string;
}
