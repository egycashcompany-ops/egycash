// Counting the parts of an Arabic name — the rule behind the "this name is not quadruple" advice.
//
// Counting spaces is wrong in BOTH directions, which is the whole reason this is a function and
// not an inline `split(' ').length`: a compound part inflates the count, and a name with fewer
// parts than words deflates it. Every case below is an ordinary Egyptian name, not an edge case.
import { describe, expect, it } from 'vitest';
import { countNameParts, isQuadrupleName } from './field-rules';

describe('counting name parts', () => {
  it('counts plain names by word', () => {
    expect(countNameParts('أحمد')).toBe(1);
    expect(countNameParts('أحمد محمد')).toBe(2);
    expect(countNameParts('أحمد محمد علي')).toBe(3);
    expect(countNameParts('أحمد محمد علي حسن')).toBe(4);
  });

  it('treats a compound part as ONE part', () => {
    // Five words, four parts.
    expect(countNameParts('عبد الرحمن محمد علي حسن')).toBe(4);
    // Four words, three parts — the case a naive count would wave through as quadruple.
    expect(countNameParts('محمد عبد الله علي')).toBe(3);
    expect(countNameParts('أبو بكر محمد أحمد علي')).toBe(4);
  });

  it('handles two compound parts in one name', () => {
    expect(countNameParts('عبد الرحمن عبد الله محمد علي')).toBe(4);
  });

  it('never lets a trailing binder swallow nothing', () => {
    // A name that ends mid-compound is short, and must be counted short rather than crashing or
    // silently counting the dangling word as a whole part it is not.
    expect(countNameParts('محمد علي عبد')).toBe(3);
    expect(countNameParts('عبد')).toBe(1);
  });

  it('is unbothered by spacing', () => {
    expect(countNameParts('  أحمد   محمد  علي حسن  ')).toBe(4);
    expect(countNameParts('')).toBe(0);
    expect(countNameParts('   ')).toBe(0);
  });
});

describe('the quadruple test', () => {
  it('passes four parts and anything longer', () => {
    expect(isQuadrupleName('أحمد محمد علي حسن')).toBe(true);
    expect(isQuadrupleName('عبد الرحمن محمد علي حسن')).toBe(true);
    expect(isQuadrupleName('أحمد محمد علي حسن إبراهيم')).toBe(true);
  });

  it('fails anything shorter, compound parts included', () => {
    expect(isQuadrupleName('أحمد محمد')).toBe(false);
    expect(isQuadrupleName('أحمد محمد علي')).toBe(false);
    expect(isQuadrupleName('محمد عبد الله علي')).toBe(false);
  });
});
