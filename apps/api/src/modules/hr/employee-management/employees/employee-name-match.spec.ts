// The name-matching rule, on spellings — the shapes the old fleet book actually contains.
import { describe, expect, it } from 'vitest';
import { compactName, matchEmployeesByName } from './employee-name-match';

const staff = [
  { id: 'a', name: 'مصطفى عثمان محمود عثمان' },
  { id: 'b', name: 'أمير محمد محمد أحمد صالح' },
  { id: 'c', name: 'عماد صابر عبدالفتاح عطية' },
  { id: 'd', name: 'محمد أحمد سعيد حسن' },
  { id: 'e', name: 'محمد أحمد كامل علي' },
  { id: 'f', name: 'محمد' },
];

const ids = (result: Map<string, { id: string }[]>, name: string): string[] =>
  (result.get(name) ?? []).map((employee) => employee.id);

describe('the whole name, folded', () => {
  it('matches the exact spelling, and the same name with a hamza dropped', () => {
    const result = matchEmployeesByName(['مصطفى عثمان محمود عثمان', 'امير محمد محمد احمد صالح'], staff);
    expect(ids(result, 'مصطفى عثمان محمود عثمان')).toEqual(['a']);
    expect(ids(result, 'امير محمد محمد احمد صالح')).toEqual(['b']);
  });

  it('ignores the spacing inside compound names — «احمدصالح», «عبد الفتاح»', () => {
    const result = matchEmployeesByName(['امير محمد محمد احمدصالح', 'عماد صابر عبد الفتاح عطيه'], staff);
    expect(ids(result, 'امير محمد محمد احمدصالح')).toEqual(['b']);
    expect(ids(result, 'عماد صابر عبد الفتاح عطيه')).toEqual(['c']);
  });

  it('is what both sides are compared by', () => {
    expect(compactName('عبد الفتاح')).toBe(compactName('عبدالفتاح'));
    expect(compactName('أحمد صالح ')).toBe('احمدصالح');
  });
});

describe('a prefix of the name, for a book that wrote fewer of the names', () => {
  it('matches two names to the one employee they begin', () => {
    expect(ids(matchEmployeesByName(['مصطفى عثمان'], staff), 'مصطفى عثمان')).toEqual(['a']);
  });

  it('returns EVERY employee two names could begin — an ambiguity, for the caller to report', () => {
    expect(ids(matchEmployeesByName(['محمد احمد'], staff), 'محمد احمد')).toEqual(['d', 'e']);
  });

  it('a single name is nobody in particular — exact only, never a prefix', () => {
    // «محمد» is the start of half the company; the one employee whose whole name it IS matches.
    expect(ids(matchEmployeesByName(['محمد'], staff), 'محمد')).toEqual(['f']);
    expect(ids(matchEmployeesByName(['مصطفى'], staff), 'مصطفى')).toEqual([]);
  });

  it('the exact match wins over prefixes — a whole name is not also a prefix of a longer one', () => {
    const result = matchEmployeesByName(['محمد'], [...staff, { id: 'g', name: 'محمد علي' }]);
    expect(ids(result, 'محمد')).toEqual(['f']);
  });
});

describe('the answer', () => {
  it('is keyed by the name AS ASKED, and empty for a name HR does not have', () => {
    const result = matchEmployeesByName(['  احتياطى ', ''], staff);
    expect(result.get('  احتياطى ')).toEqual([]);
    expect(result.get('')).toEqual([]);
    expect(result.size).toBe(2);
  });
});
