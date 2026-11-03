import { describe, expect, it } from 'vitest';
import { pluralForm } from './plural';

describe('pluralForm — the five Arabic forms and the two English ones', () => {
  it.each([
    [1, 'one'],
    [2, 'two'],
    [3, 'few'],
    [10, 'few'],
    [11, 'many'],
    [99, 'many'],
    [100, 'other'],
    [103, 'few'],
    [129, 'many'],
    [0, 'few'],
  ] as const)('Arabic %i → %s', (n, form) => {
    expect(pluralForm('ar', n)).toBe(form);
  });

  it('English has one and other only', () => {
    expect(pluralForm('en', 1)).toBe('one');
    expect(pluralForm('en', 2)).toBe('other');
    expect(pluralForm('en', 0)).toBe('other');
  });

  it('reads a fraction or a negative by its whole size', () => {
    expect(pluralForm('ar', 2.7)).toBe('two');
    expect(pluralForm('ar', -1)).toBe('one');
  });
});
