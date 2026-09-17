// The one property every reason must have: it says the same thing in both languages.
//
// The screen is Arabic. Before this catalogue, the reasons on it were English strings written at
// the point of decision, and the person approving 2,600 writes was reading «conflicting duplicate
// rows for one employment» under an Arabic heading. A reason is now a `{ ar, en }` value chosen at
// render time — and the thing that has to stay true is that no entry can lose either half.
//
// Source-level and exhaustive by construction: every function in every catalogue is CALLED here
// with representative arguments, so a new reason added without Arabic fails this file, not a
// manager's afternoon.
import { describe, expect, it } from 'vitest';
import { orgNotes, personReasons, refusalReasons, rowReasons } from './reasons';

const ARABIC = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;

/**
 * Every catalogue entry EXCEPT `personReasons.unexpected`, which wraps a thrown error's message
 * untranslated on purpose — it has its own test below. Listing the exemption by name here is what
 * keeps it an exemption: a second untranslated entry would still fail.
 */
const every: { name: string; value: { ar: string; en: string } }[] = [
  ...Object.entries(rowReasons).map(([name, fn]) => ({
    name: `rowReasons.${name}`,
    value: (fn as (...a: unknown[]) => { ar: string; en: string })(
      name === 'duplicatePeriod' ? true : name === 'badCodeShape' ? '0100313' : 'انقطاع',
    ),
  })),
  ...Object.entries(personReasons)
    .filter(([name]) => name !== 'unexpected')
    .map(([name, fn]) => ({
      name: `personReasons.${name}`,
      value: (fn as (...a: unknown[]) => { ar: string; en: string })('0100313'),
    })),
  ...Object.entries(refusalReasons).map(([name, fn]) => ({
    name: `refusalReasons.${name}`,
    value: (fn as () => { ar: string; en: string })(),
  })),
  ...Object.entries(orgNotes).map(([name, fn]) => ({
    name: `orgNotes.${name}`,
    value: (fn as (...a: unknown[]) => { ar: string; en: string })('المهندسين', 'BR1', '010'),
  })),
];

describe('every reason the import can produce', () => {
  it.each(every.map((e) => [e.name, e.value] as const))('%s carries both languages', (_n, v) => {
    expect(v.ar.trim()).not.toBe('');
    expect(v.en.trim()).not.toBe('');
  });

  /**
   * The Arabic half must actually be Arabic. A catalogue entry that copied the English into `ar`
   * would pass an «is not empty» check and put English on the Arabic screen all over again.
   */
  it.each(every.map((e) => [e.name, e.value] as const))('%s is Arabic in ar', (_n, v) => {
    expect(v.ar).toMatch(ARABIC);
  });

  it.each(every.map((e) => [e.name, e.value] as const))('%s is English in en', (_n, v) => {
    expect(v.en).toMatch(LATIN);
  });

  /**
   * `unexpected` is the one entry allowed to be the same in both: it wraps a thrown error's
   * message, which nobody translated. It is excluded from the Arabic check above by being given
   * an Arabic argument — and pinned here so that exemption is a fact and not an accident.
   */
  it('passes an unexpected error message through unchanged in both halves', () => {
    const v = personReasons.unexpected('boom');
    expect(v).toEqual({ ar: 'boom', en: 'boom' });
  });
});

describe('the English half did not move', () => {
  /** `plan.spec.ts` pins these; operators have read them in logs. Only the screen changed. */
  it('keeps the phrases the existing tests and logs already know', () => {
    expect(rowReasons.exitReasonBlank().en).toBe('exit reason is blank — fill it in and re-run');
    expect(rowReasons.duplicatePeriod(true).en).toContain('conflicting duplicate rows');
    expect(rowReasons.badCodeShape('X').en).toContain('not <3-digit branch><4-digit number>');
    expect(rowReasons.exitBeforeHire().en).toContain('before the hiring date');
    expect(refusalReasons.nationalIdDiffers().en).toContain('already holds a different National ID');
  });
});
