// The catalogs' search box matches the TEXT typed, never a pattern built from it.
import { describe, expect, it } from 'vitest';
import { containsText, escapeRegExp } from './catalog-search';

const matches = (search: string, value: string): boolean => {
  const { $regex, $options } = containsText(search);
  return new RegExp($regex, $options).test(value);
};

describe('catalog search', () => {
  // The failure this exists for: an unbalanced bracket is not a valid pattern, and Mongo answered
  // the whole request with an error.
  it('accepts text that is not a valid pattern', () => {
    expect(() => new RegExp(containsText('فرع (المعادي').$regex)).not.toThrow();
    expect(matches('فرع (المعادي', 'فرع (المعادي) الرئيسي')).toBe(true);
  });

  it('matches regex syntax literally, not as syntax', () => {
    expect(matches('a.c', 'abc')).toBe(false);
    expect(matches('a.c', 'xa.cx')).toBe(true);
    expect(matches('1+1', '11')).toBe(false);
    expect(matches('1+1', '1+1')).toBe(true);
    expect(matches('.*', 'anything')).toBe(false);
  });

  it('still matches anywhere and ignores case', () => {
    expect(matches('cib', 'CIB — Zamalek')).toBe(true);
    expect(matches('مصر', 'بنك مصر')).toBe(true);
  });

  it('escapes every character RegExp treats as syntax', () => {
    const syntax = '.*+?^${}()|[]\\';
    expect(new RegExp(`^${escapeRegExp(syntax)}$`).test(syntax)).toBe(true);
  });
});
