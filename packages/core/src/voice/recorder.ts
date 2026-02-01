import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFileSync, unlink } from 'fs';
import { findExecutable } from './utils';

export interface RecordOptions {
  durationSeconds?: number;
  sampleRate?: number;
  channels?: number;
}

interface RecorderCommand {
  command: string;
  args: string[];
}

export class AudioRecorder {
  private currentProcess: ReturnType<typeof spawn> | null = null;

  async record(options: RecordOptions = {}): Promise<ArrayBuffer> {
    if (this.currentProcess) {
      throw new Error('Audio recorder is already running.');
    }

    const duration = options.durationSeconds ?? 5;
    const sampleRate = options.sampleRate ?? 16000;
    const channels = options.channels ?? 1;
    const output = join(tmpdir(), `oldpal-record-${Date.now()}.wav`);

    const recorder = this.resolveRecorder(sampleRate, channels, duration, output);
    if (!recorder) {
      throw new Error('No supported audio recorder found. Install sox or ffmpeg.');
    }

    await new Promise<void>((resolve, reject) => {
      this.currentProcess = spawn(recorder.command, recorder.args, { stdio: 'ignore' });
      this.currentProcess.on('close', (code) => {
        this.currentProcess = null;
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('Audio recording failed.'));
        }
      });
      this.currentProcess.on('error', (error) => {
        this.currentProcess = null;
        reject(error);
      });
    });

    const data = readFileSync(output);
    unlink(output, () => {});
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }

  stop(): void {
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
    }
  }

  private resolveRecorder(
    sampleRate: number,
    channels: number,
    duration: number,
    output: string
  ): RecorderCommand | null {
    const sox = findExecutable('sox');
    if (sox) {
      return {
        command: sox,
        args: [
          '-d',
          '-c',
          String(channels),
          '-r',
          String(sampleRate),
          '-b',
          '16',
          output,
          'trim',
          '0',
          String(duration),
        ],
      };
    }

    const ffmpeg = findExecutable('ffmpeg');
    if (ffmpeg) {
      const baseArgs = ['-y', '-t', String(duration), '-ac', String(channels), '-ar', String(sampleRate)];
      if (process.platform === 'darwin') {
        return { command: ffmpeg, args: ['-f', 'avfoundation', '-i', ':0', ...baseArgs, output] };
      }
      if (process.platform === 'linux') {
        return { command: ffmpeg, args: ['-f', 'alsa', '-i', 'default', ...baseArgs, output] };
      }
    }

    const arecord = findExecutable('arecord');
    if (arecord) {
      return {
        command: arecord,
        args: [
          '-d',
          String(duration),
          '-f',
          'S16_LE',
          '-r',
          String(sampleRate),
          '-c',
          String(channels),
          output,
        ],
      };
    }

    return null;
  }
}
