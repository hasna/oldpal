import { describe, expect, test, afterEach, beforeEach } from 'bun:test';
import { ElevenLabsTTS } from '../src/voice/tts';
import { WhisperSTT } from '../src/voice/stt';
import { VoiceManager } from '../src/voice/manager';
import type { STTProvider, TTSProvider } from '../src/voice/types';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
let tempHome: string | null = null;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'assistants-voice-test-'));
  process.env.HOME = tempHome;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_VOICE_ID;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_VOICE_ID;
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = null;
  }
  process.env.HOME = originalHome;
});

describe('WhisperSTT', () => {
  test('throws when API key is missing', async () => {
    const stt = new WhisperSTT();
    await expect(stt.transcribe(new ArrayBuffer(1))).rejects.toThrow('OPENAI_API_KEY');
  });

  test('transcribes audio via API', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBe('Bearer test-key');
      return new Response(JSON.stringify({ text: 'hello', language: 'en' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const stt = new WhisperSTT();
    const result = await stt.transcribe(new ArrayBuffer(2));
    expect(result.text).toBe('hello');
    expect(result.language).toBe('en');
  });
});

describe('ElevenLabsTTS', () => {
  test('throws when API key is missing', async () => {
    const tts = new ElevenLabsTTS({ voiceId: 'voice' });
    await expect(tts.synthesize('hi')).rejects.toThrow('ELEVENLABS_API_KEY');
  });

  test('synthesizes audio via API', async () => {
    process.env.ELEVENLABS_API_KEY = 'el-key';
    const payload = new Uint8Array([1, 2, 3]).buffer;
    globalThis.fetch = (async (_input: RequestInfo | URL) => {
      return new Response(payload, { status: 200 });
    }) as typeof fetch;

    const tts = new ElevenLabsTTS({ voiceId: 'voice' });
    const result = await tts.synthesize('hello');
    expect(result.audio).toBeInstanceOf(ArrayBuffer);
    expect(result.format).toBe('mp3');
  });

  test('streams audio chunks', async () => {
    process.env.ELEVENLABS_API_KEY = 'el-key';
    const chunk = new Uint8Array([4, 5, 6]);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });

    globalThis.fetch = (async () => {
      return new Response(stream, { status: 200 });
    }) as typeof fetch;

    const tts = new ElevenLabsTTS({ voiceId: 'voice' });
    const generator = tts.stream('hello');
    const first = await generator.next();
    expect(first.done).toBe(false);
    expect(first.value).toBeInstanceOf(ArrayBuffer);
  });
});

describe('VoiceManager', () => {
  test('coordinates listen and speak with injected providers', async () => {
    const stt: STTProvider = {
      transcribe: async () => ({ text: 'transcribed', confidence: 1 }),
    };
    const tts: TTSProvider = {
      synthesize: async () => ({ audio: new ArrayBuffer(1), format: 'mp3' }),
    };
    const player = {
      play: async () => {},
      stop: () => {},
      isPlaying: () => false,
    };
    const recorder = {
      record: async () => new ArrayBuffer(1),
      stop: () => {},
    };

    const manager = new VoiceManager(
      {
        enabled: true,
        stt: { provider: 'whisper', model: 'whisper-1', language: 'en' },
        tts: { provider: 'elevenlabs', voiceId: 'voice' },
      },
      {
        stt,
        tts,
        player,
        recorder,
      }
    );

    const transcript = await manager.listen({ durationSeconds: 1 });
    expect(transcript).toBe('transcribed');
    await expect(manager.speak('hello')).resolves.toBeUndefined();
  });
});
