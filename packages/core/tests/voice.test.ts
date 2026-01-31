import { describe, expect, test } from 'bun:test';
import { ElevenLabsTTS } from '../src/voice/tts';
import { WhisperSTT } from '../src/voice/stt';

describe('Voice modules', () => {
  test('ElevenLabsTTS throws for unimplemented synthesize', async () => {
    const tts = new ElevenLabsTTS({ voiceId: 'voice' });
    await expect(tts.synthesize('hi')).rejects.toThrow('not implemented');
  });

  test('ElevenLabsTTS throws for unimplemented stream', async () => {
    const tts = new ElevenLabsTTS({ voiceId: 'voice' });
    const stream = tts.stream('hi');
    await expect(stream.next()).rejects.toThrow('not implemented');
  });

  test('WhisperSTT throws for unimplemented transcribe', async () => {
    const stt = new WhisperSTT();
    await expect(stt.transcribe(new ArrayBuffer(1))).rejects.toThrow('not implemented');
  });

  test('WhisperSTT throws for unimplemented startListening', async () => {
    const stt = new WhisperSTT();
    await expect(stt.startListening()).rejects.toThrow('not implemented');
  });
});
