import { describe, expect, it } from 'vitest';
import { pluralForm, pluralKey } from './plural';

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

describe('pluralKey — the catalog key of a counted phrase', () => {
  it('joins the key and the count’s form with a dot, as the catalog spells them', () => {
    expect(pluralKey('operations.distribution.loadCount', 'ar', 1)).toBe(
      'operations.distribution.loadCount.one',
    );
    expect(pluralKey('operations.distribution.loadCount', 'ar', 2)).toBe(
      'operations.distribution.loadCount.two',
    );
    expect(pluralKey('operations.distribution.loadCount', 'ar', 4)).toBe(
      'operations.distribution.loadCount.few',
    );
    expect(pluralKey('operations.distribution.loadCount', 'ar', 11)).toBe(
      'operations.distribution.loadCount.many',
    );
    expect(pluralKey('operations.distribution.loadCount', 'ar', 100)).toBe(
      'operations.distribution.loadCount.other',
    );
    expect(pluralKey('x', 'en', 4)).toBe('x.other');
  });
});
