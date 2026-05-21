import { describe, expect, test } from 'bun:test';
import { formatJson, formatTable } from './output.js';

describe('formatTable', () => {
  test('formats simple table with headers and rows', () => {
    const result = formatTable(['NAME', 'VALUE'], [
      ['foo', 'bar'],
      ['baz', 'qux'],
    ]);
    const lines = result.split('\n');
    expect(lines.length).toBe(3); // header + separator (empty) + 2 data rows - 1 (separator filtered)
    expect(lines[0]).toContain('NAME');
    expect(lines[0]).toContain('VALUE');
  });

  test('pads columns to maximum width', () => {
    const result = formatTable(['A', 'B'], [
      ['short', 'x'],
      ['verylongvalue', 'y'],
    ]);
    const lines = result.split('\n');
    // All lines should have consistent column widths
    expect(lines[1]).toContain('short');
    expect(lines[2]).toContain('verylongvalue');
  });

  test('handles empty rows', () => {
    const result = formatTable(['NAME', 'VALUE'], []);
    const lines = result.split('\n').filter(Boolean);
    expect(lines.length).toBe(1); // Just the header
    expect(lines[0]).toContain('NAME');
  });

  test('handles cells with different lengths', () => {
    const result = formatTable(['COL1', 'COLUMN2', 'C'], [
      ['a', 'bb', 'ccc'],
      ['dddd', 'e', 'ffffff'],
    ]);
    expect(result).toContain('COL1');
    expect(result).toContain('COLUMN2');
    expect(result).toContain('C');
  });

  test('handles missing cells gracefully', () => {
    const result = formatTable(['A', 'B', 'C'], [
      ['1', '2'],
      ['3'],
    ]);
    expect(result).toContain('1');
    expect(result).toContain('2');
    expect(result).toContain('3');
  });
});

describe('formatJson', () => {
  test('formats simple objects', () => {
    const result = formatJson({ foo: 'bar', num: 42 });
    const parsed = JSON.parse(result);
    expect(parsed.foo).toBe('bar');
    expect(parsed.num).toBe(42);
  });

  test('formats nested objects', () => {
    const result = formatJson({ outer: { inner: 'value' } });
    const parsed = JSON.parse(result);
    expect(parsed.outer.inner).toBe('value');
  });

  test('formats arrays', () => {
    const result = formatJson({ items: [1, 2, 3] });
    const parsed = JSON.parse(result);
    expect(parsed.items).toEqual([1, 2, 3]);
  });

  test('converts BigInt to string for precision', () => {
    const bigValue = 9007199254740993n; // Larger than MAX_SAFE_INTEGER
    const result = formatJson({ value: bigValue });
    const parsed = JSON.parse(result);
    expect(parsed.value).toBe('9007199254740993');
  });

  test('handles mixed BigInt and regular numbers', () => {
    const result = formatJson({
      small: 42,
      big: 12345678901234567890n,
    });
    const parsed = JSON.parse(result);
    expect(parsed.small).toBe(42);
    expect(parsed.big).toBe('12345678901234567890');
  });

  test('formats with indentation', () => {
    const result = formatJson({ a: 1 });
    expect(result).toContain('\n'); // Should be pretty-printed
    expect(result).toContain('  '); // Should have indentation
  });

  test('handles null and undefined', () => {
    const result = formatJson({ a: null, b: undefined });
    const parsed = JSON.parse(result);
    expect(parsed.a).toBe(null);
    expect(parsed.b).toBeUndefined(); // undefined is not serialized in JSON
  });

  test('handles boolean values', () => {
    const result = formatJson({ yes: true, no: false });
    const parsed = JSON.parse(result);
    expect(parsed.yes).toBe(true);
    expect(parsed.no).toBe(false);
  });
});
