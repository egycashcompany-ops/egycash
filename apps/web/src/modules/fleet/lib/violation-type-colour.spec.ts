import { describe, expect, it } from 'vitest';
import { violationTypeColour } from './violation-type-colour';

describe('violationTypeColour', () => {
  it('gives one type the SAME colour every time it is asked', () => {
    // The point of hashing rather than counting: a reader who learns «عكس is the amber one» must
    // still be right after a reload, on another machine, and on page two.
    const a = violationTypeColour('6a9d63e43ac3d0d2148b2360');
    expect(violationTypeColour('6a9d63e43ac3d0d2148b2360')).toBe(a);
    expect(violationTypeColour('6a9d63e43ac3d0d2148b2360')).toBe(a);
  });

  it('does not depend on how many other types exist or what order they came in', () => {
    // One argument, spelled out. `.map(violationTypeColour)` would hand the callback the array
    // INDEX as a second argument — which is the position form, and would make this test about the
    // opposite of what it claims. The signature refuses a bare number for exactly that reason.
    const first = ['t1', 't2', 't3'].map((id) => violationTypeColour(id));
    const shuffled = ['t3', 't1', 't2'].map((id) => violationTypeColour(id));
    expect(shuffled[1]).toBe(first[0]);
    expect(shuffled[2]).toBe(first[1]);
    expect(shuffled[0]).toBe(first[2]);
  });

  it('given a POSITION, gives every type up to eight a different colour', () => {
    // The promise the hash cannot make. On a real catalog it gave «سرعة» and «تليفون» the same
    // indigo out of eight slots, and two fines that look identical are what the colour exists to
    // prevent — so a caller holding the catalog passes the position instead.
    const eight = Array.from({ length: 8 }, (_, index) =>
      violationTypeColour(`type-${index}`, { index }),
    );
    expect(new Set(eight).size).toBe(8);
    // And the ninth wraps rather than throwing: a colour is a hint, never the identity.
    expect(violationTypeColour('type-8', { index: 8 })).toBe(eight[0]);
  });

  it('tells different types apart', () => {
    // Not a promise that ANY two differ — eight hues cannot colour nine types — but that the
    // handful a fleet actually files under do not collapse into one.
    const four = ['speed', 'reverse', 'belt', 'phone'].map((id) => violationTypeColour(id));
    expect(new Set(four).size).toBe(4);
  });

  it('gives an unclassified row a neutral, never a real type’s colour', () => {
    const none = violationTypeColour(null);
    expect(none).toContain('slate');
    expect(violationTypeColour('')).toBe(none);
    expect(violationTypeColour(undefined)).toBe(none);
    expect(['speed', 'reverse', 'belt', 'phone'].map((id) => violationTypeColour(id))).not.toContain(none);
  });
});
