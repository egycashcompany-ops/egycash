import { describe, expect, it } from 'vitest';
import { isLicensingClass, licensingSuffix } from './licensing-class';

describe('which licence classes put a car on the board', () => {
  it('takes the ones whose last word is «ت»', () => {
    expect(isLicensingClass('برقاش ت')).toBe(true);
    expect(isLicensingClass('العجوزة ت')).toBe(true);
    // Whatever spacing the admin typed — the name is data, and a double space is not a decision.
    expect(isLicensingClass('  برقاش   ت  ')).toBe(true);
  });

  it('refuses the «م» twins, which is the whole point of the rule', () => {
    // «لكن اللى برقاش م متبقاش موجوده» — and the pair differ by one letter, so a rule that read
    // «starts with برقاش» would put both on the board.
    expect(isLicensingClass('برقاش م')).toBe(false);
    expect(isLicensingClass('العجوزة م')).toBe(false);
    expect(licensingSuffix('برقاش م')).toBe('م');
  });

  it('matches the WORD, not the letter — a class ending in ت is not a licensing class', () => {
    // «بيت» ends with the letter; it is not «… ت». Matching the letter would have put every such
    // class on the board with nothing on the screen to explain why it was there.
    expect(isLicensingClass('بيت')).toBe(false);
    expect(isLicensingClass('مرور بيت')).toBe(false);
    expect(licensingSuffix('بيت')).toBeNull();
  });

  it('answers «no» rather than throwing for a class that is missing or unnamed', () => {
    // A vehicle may carry no class at all, and a lean read hands back whatever the document held.
    expect(isLicensingClass(null)).toBe(false);
    expect(isLicensingClass(undefined)).toBe(false);
    expect(isLicensingClass('')).toBe(false);
    expect(licensingSuffix('')).toBeNull();
  });

  it('is not fooled by a name that merely CONTAINS the word', () => {
    expect(isLicensingClass('ت برقاش')).toBe(false);
  });
});
