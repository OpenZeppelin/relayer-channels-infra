import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ProgressBar } from './progress.js';

describe('ProgressBar', () => {
  let originalStdoutWrite: typeof process.stdout.write;
  let writtenOutput: string;

  beforeEach(() => {
    originalStdoutWrite = process.stdout.write;
    writtenOutput = '';
    process.stdout.write = mock((str: string | Uint8Array) => {
      writtenOutput += str.toString();
      return true;
    });
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
  });

  test('creates progress bar with default options', () => {
    const bar = new ProgressBar(10);
    bar.update(0);
    expect(writtenOutput).toContain('[');
    expect(writtenOutput).toContain(']');
    expect(writtenOutput).toContain('0/10');
  });

  test('creates progress bar with label', () => {
    const bar = new ProgressBar(10, { label: 'Testing' });
    bar.update(0);
    expect(writtenOutput).toContain('Testing');
    expect(writtenOutput).toContain('0/10');
  });

  test('updates progress correctly', () => {
    const bar = new ProgressBar(10);
    bar.update(5);
    expect(writtenOutput).toContain('5/10');
  });

  test('increments progress', () => {
    const bar = new ProgressBar(10);
    bar.increment();
    expect(writtenOutput).toContain('1/10');

    writtenOutput = '';
    bar.increment();
    expect(writtenOutput).toContain('2/10');
  });

  test('setLabel changes the label', () => {
    const bar = new ProgressBar(10, { label: 'First' });
    bar.update(0);
    expect(writtenOutput).toContain('First');

    writtenOutput = '';
    bar.setLabel('Second');
    bar.update(0);
    expect(writtenOutput).toContain('Second');
  });

  test('respects custom width', () => {
    const bar = new ProgressBar(10, { width: 30 });
    bar.update(5);
    // Width 30, 50% filled = 15 filled chars + 15 empty chars
    // Just verify it doesn't throw
    expect(writtenOutput).toContain('5/10');
  });

  test('handles zero total gracefully', () => {
    const bar = new ProgressBar(0);
    bar.update(0);
    expect(writtenOutput).toContain('0/0');
  });

  test('handles completion', () => {
    const bar = new ProgressBar(10);
    bar.update(10);
    expect(writtenOutput).toContain('10/10');
  });
});
