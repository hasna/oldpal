import React from 'react';
import { describe, expect, test } from 'bun:test';
import { render } from 'ink';
import { PassThrough } from 'stream';
import { Input } from '../src/components/Input';

const stripAnsi = (text: string) => text.replace(/\x1B\[[0-9;]*m/g, '');

const createInkTestEnv = () => {
  const stdout = new PassThrough();
  let output = '';
  stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  const stdin = new PassThrough() as any;
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};
  stdin.resume = () => {};
  stdin.pause = () => {};
  return { stdout, stdin, getOutput: () => stripAnsi(output) };
};

describe('Input component', () => {
  test('shows default placeholder', async () => {
    const env = createInkTestEnv();
    const instance = render(<Input onSubmit={() => {}} />, { stdout: env.stdout, stdin: env.stdin });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Type a message');
    instance.unmount();
  });

  test('shows processing placeholder with queue', async () => {
    const env = createInkTestEnv();
    const instance = render(<Input onSubmit={() => {}} isProcessing queueLength={2} />, { stdout: env.stdout, stdin: env.stdin });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Type to queue');
    instance.unmount();
  });

  test('shows ask-user placeholder', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <Input onSubmit={() => {}} isAskingUser askPlaceholder="Answer now" />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Answer now');
    instance.unmount();
  });
});
