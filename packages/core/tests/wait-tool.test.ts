import { describe, expect, test } from 'bun:test';
import { WaitTool } from '../src/tools/wait';

describe('WaitTool', () => {
  test('returns immediately for zero duration', async () => {
    const result = await WaitTool.executor({ seconds: 0 });
    expect(result).toContain('Waited 0s');
  });
});
