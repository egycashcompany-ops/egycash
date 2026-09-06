// Counting the parts of an Arabic name — the rule behind the "this name is not quadruple" advice.
//
// Counting spaces is wrong in BOTH directions, which is the whole reason this is a function and
// not an inline `split(' ').length`: a compound part inflates the count, and a name with fewer
// parts than words deflates it. Every case below is an ordinary Egyptian name, not an edge case.
import { describe, expect, it } from 'vitest';
import { countNameParts, isQuadrupleName, loginProfileNames, splitFullName } from './field-rules';
import { LocalizedStringSchema } from './localized';

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

// ── The first/last split a login profile stores ──────────────────────────────
//
// A different question from counting parts, and deliberately a simpler rule: "what does this person
// go by, and what is the rest". It exists because the answer has to be the SAME in two places — the
// server splitting a name when it provisions an account at hire, and the create-login dialog
// filling its boxes from the employee record instead of asking someone to retype a stored name.
describe('splitFullName', () => {
  it('takes the first word, and everything after it', () => {
    expect(splitFullName('محمد أحمد علي حسن')).toEqual({ first: 'محمد', last: 'أحمد علي حسن' });
    expect(splitFullName('Mohamed Ahmed Ali')).toEqual({ first: 'Mohamed', last: 'Ahmed Ali' });
  });

  it('repeats a single-word name rather than leaving the last name empty', () => {
    // The profile requires both. Half a name is not an improvement on a repeated one, and an empty
    // box is a form that cannot be submitted.
    expect(splitFullName('محمد')).toEqual({ first: 'محمد', last: 'محمد' });
  });

  it('survives the spacing a pasted name actually arrives with', () => {
    expect(splitFullName('  محمد   أحمد  ')).toEqual({ first: 'محمد', last: 'أحمد' });
    expect(splitFullName('محمد\tأحمد')).toEqual({ first: 'محمد', last: 'أحمد' });
  });

  it('does not crash on an empty name', () => {
    expect(splitFullName('')).toEqual({ first: '', last: '' });
    expect(splitFullName('   ')).toEqual({ first: '', last: '' });
  });
});

describe('loginProfileNames', () => {
  it('builds both languages from both full names', () => {
    expect(loginProfileNames('محمد أحمد علي', 'Mohamed Ahmed Ali')).toEqual({
      firstName: { ar: 'محمد', en: 'Mohamed' },
      lastName: { ar: 'أحمد علي', en: 'Ahmed Ali' },
    });
  });

  it('falls back to the ARABIC name when the record carries no English one', () => {
    // Most records do not. A profile reading «محمد» under English is readable; an empty one cannot
    // be submitted at all, since `LocalizedStringSchema` requires both sides.
    expect(loginProfileNames('محمد أحمد علي', null)).toEqual({
      firstName: { ar: 'محمد', en: 'محمد' },
      lastName: { ar: 'أحمد علي', en: 'أحمد علي' },
    });
  });

  it('produces a value LocalizedStringSchema accepts', () => {
    // The whole point of the fallback: what comes out of here is submitted straight to
    // `CreateEmployeeLoginSchema`, whose two name fields are `LocalizedStringSchema` (min(1) both
    // sides). A name that arrives empty on either side would make the dialog unsubmittable.
    const names = loginProfileNames('محمد', null);
    expect(LocalizedStringSchema.safeParse(names.firstName).success).toBe(true);
    expect(LocalizedStringSchema.safeParse(names.lastName).success).toBe(true);
  });

  it('keeps a compound name whole on the last-name side', () => {
    // `splitFullName` takes only the first word, so «عبد» never ends up stranded as a first name
    // separated from what it binds to — unless the person's own first part IS the compound, which
    // is the one case a first-word rule cannot see and a human can fix in the box.
    expect(loginProfileNames('محمد عبد الله علي', null).lastName.ar).toBe('عبد الله علي');
  });
});
