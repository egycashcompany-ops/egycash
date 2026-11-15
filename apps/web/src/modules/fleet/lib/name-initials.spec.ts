import { describe, expect, it } from 'vitest';
import { BLOCKED_INITIAL_PAIRS, nameInitials } from './name-initials';

describe('nameInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(nameInitials('محمود فتحي النجار')).toBe('مف');
    expect(nameInitials('رامي فوزي عبد العزيز')).toBe('رف');
  });

  it('skips the article: «السيد» gives «س»', () => {
    expect(nameInitials('ابراهيم السيد')).toBe('اس');
    expect(nameInitials('السيد محمد')).toBe('سم');
  });

  it('keeps a bare «ال» as it is (no letter after the article)', () => {
    expect(nameInitials('ال محمد')).toBe('ام');
  });

  it('joins with the separator asked for', () => {
    expect(nameInitials('ابراهيم السيد', ' ')).toBe('ا س');
  });

  it('shows the first letter alone when the pair is a blocked word', () => {
    expect(nameInitials('كريم السيد منصور')).toBe('ك');
    expect(nameInitials('كريم سعيد')).toBe('ك');
    expect(nameInitials('زكي بدوي')).toBe('ز');
    expect(nameInitials('طارق زكي')).toBe('ط');
    expect(nameInitials('شريف خالد')).toBe('ش');
    expect(nameInitials('تامر فوزي')).toBe('ت');
  });

  it('blocks the pair whatever the separator', () => {
    expect(nameInitials('كريم السيد', ' ')).toBe('ك');
  });

  it('never returns a blocked pair for any blocked list entry', () => {
    for (const pair of BLOCKED_INITIAL_PAIRS) {
      const [a, b] = [...pair];
      expect(nameInitials(`${a}اا ${b}اا`)).toBe(a);
      expect(nameInitials(`${a}اا ال${b}اا`, ' ')).toBe(a);
    }
  });

  it('copes with one word, extra spaces and an empty name', () => {
    expect(nameInitials('  كمال  ')).toBe('ك');
    expect(nameInitials('كمال    عبد')).toBe('كع');
    expect(nameInitials('')).toBe('');
    expect(nameInitials('   ')).toBe('');
  });
});
