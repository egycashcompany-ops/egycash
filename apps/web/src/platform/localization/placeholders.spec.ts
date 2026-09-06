// `translate()` substitutes `{{name}}` and nothing else. A key written with single braces is not a
// near miss: it renders the braces to the reader, literally — `{count} موظف` on a live screen was
// how this was found, and 115 more placeholders turned out to carry the same one-character defect.
//
// This reads the dictionary SOURCE rather than rendering every key: the defect is textual, and a
// textual check is the one that cannot be dodged by a key nobody happens to render in a test.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { translate } from './i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, 'i18n.ts'), 'utf8');

/** A `{name}` that is not part of a `{{name}}`. */
const SINGLE_BRACE = /(?<!\{)\{([a-zA-Z]+)\}(?!\})/g;

describe('dictionary placeholders', () => {
  it('never use a single-brace placeholder, which translate() would show literally', () => {
    const offenders = [...SOURCE.matchAll(SINGLE_BRACE)].map((m) => m[0]);
    expect(offenders).toEqual([]);
  });

  it('fills the employees row count in both languages', () => {
    expect(translate('ar', 'employees.list.count', { count: 1671 })).toBe('1671 موظف');
    expect(translate('en', 'employees.list.count', { count: 1671 })).toBe('1671 employees');
  });
});
