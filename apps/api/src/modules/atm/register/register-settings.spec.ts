// The register's code mapping read through the branch links (`atm.branchLinks`) — pure. The
// owner's report (2026-10-28): EGYCASH-1's rows filed under the linked October showed only under
// «كل الشركة». What is pinned: one lookup resolves a code's branch; the raw setting is kept for the
// card; two codes resolving to one branch give it ONE canonical code, the one mapped directly to
// it; and "mapped" means some code RESOLVES to the branch.
import { describe, expect, it } from 'vitest';
import { registerBranchMapping } from './register-settings';

const MOH = '650000000000000000000001';
const OCT = '650000000000000000000005';
const ALEX = '650000000000000000000004';
const TANTA = '650000000000000000000002';
/** October works as Mohandessin. */
const LINKS = new Map([[OCT, MOH]]);

describe('registerBranchMapping', () => {
  it('without links: every code is its raw branch, one code per branch', () => {
    const m = registerBranchMapping(
      [
        { code: 'EGYCASH-4', branchId: ALEX },
        { code: 'EGYCASH-2', branchId: TANTA },
      ],
      new Map(),
    );
    expect([...m.branchIdByCode]).toEqual([
      ['EGYCASH-2', TANTA],
      ['EGYCASH-4', ALEX],
    ]);
    expect(m.canonicalCodeOf(ALEX)).toBe('EGYCASH-4');
    expect(m.isMapped(TANTA)).toBe(true);
    expect(m.isMapped(MOH)).toBe(false);
    expect(m.canonicalCodeOf(MOH)).toBeNull();
    expect(m.canonicalCodeOf(null)).toBeNull();
    expect(m.isMapped(undefined)).toBe(false);
  });

  it('a code mapped to a linked source resolves to the target; the raw mapping is kept', () => {
    const m = registerBranchMapping([{ code: 'EGYCASH-1', branchId: OCT }], LINKS);
    expect(m.rawBranchIdByCode.get('EGYCASH-1')).toBe(OCT);
    expect(m.branchIdByCode.get('EGYCASH-1')).toBe(MOH);
    expect([...m.codesByBranchId]).toEqual([[MOH, ['EGYCASH-1']]]);
    expect(m.resolveBranch(OCT)).toBe(MOH);
    expect(m.resolveBranch(ALEX)).toBe(ALEX);
    // Mohandessin is mapped — through October — and so is a row still filed under October.
    expect(m.isMapped(MOH)).toBe(true);
    expect(m.isMapped(OCT)).toBe(true);
    expect(m.canonicalCodeOf(OCT)).toBe('EGYCASH-1');
    expect(m.canonicalCodeOf(MOH)).toBe('EGYCASH-1');
  });

  it('two codes on one branch: the one mapped DIRECTLY to it is canonical, both are its codes', () => {
    // The card saves in code order and the setting allows each branch once on RAW ids, so
    // EGYCASH-5 can only reach Mohandessin through October (map-register §4).
    const m = registerBranchMapping(
      [
        { code: 'EGYCASH-1', branchId: MOH },
        { code: 'EGYCASH-5', branchId: OCT },
      ],
      LINKS,
    );
    expect(m.codesByBranchId.get(MOH)).toEqual(['EGYCASH-1', 'EGYCASH-5']);
    expect(m.canonicalCodeOf(MOH)).toBe('EGYCASH-1');
    expect(m.canonicalCodeOf(OCT)).toBe('EGYCASH-1');
    // The direct code wins even when it comes later in sheet order.
    const late = registerBranchMapping(
      [
        { code: 'EGYCASH-1', branchId: OCT },
        { code: 'EGYCASH-5', branchId: MOH },
      ],
      LINKS,
    );
    expect(late.codesByBranchId.get(MOH)).toEqual(['EGYCASH-1', 'EGYCASH-5']);
    expect(late.canonicalCodeOf(MOH)).toBe('EGYCASH-5');
  });

  it('two codes resolving only through sources: the first in sheet order', () => {
    const SHEIKH = '650000000000000000000006';
    const m = registerBranchMapping(
      [
        { code: 'EGYCASH-6', branchId: SHEIKH },
        { code: 'EGYCASH-3', branchId: OCT },
      ],
      new Map([
        [OCT, MOH],
        [SHEIKH, MOH],
      ]),
    );
    expect(m.codesByBranchId.get(MOH)).toEqual(['EGYCASH-3', 'EGYCASH-6']);
    expect(m.canonicalCodeOf(MOH)).toBe('EGYCASH-3');
  });

  it('a branch’s linked sources are every source working as it, a code on them or not', () => {
    // After «نقل البيانات» re-points October's EGYCASH-1 to Mohandessin, October holds no code —
    // and is still read as Mohandessin (review finding: the receipt default and a filter
    // remembered on October lost their branch).
    const SHEIKH = '650000000000000000000006';
    const links = new Map([
      [OCT, MOH],
      [SHEIKH, MOH],
    ]);
    const m = registerBranchMapping([{ code: 'EGYCASH-1', branchId: MOH }], links);
    expect(m.sourcesOf(MOH)).toEqual([OCT, SHEIKH]);
    // Asked of a source, the answer is its target's: the sources stand together.
    expect(m.sourcesOf(OCT)).toEqual([OCT, SHEIKH]);
    expect(m.sourcesOf(ALEX)).toEqual([]);
    expect(registerBranchMapping([], new Map()).sourcesOf(MOH)).toEqual([]);
  });

  it('one lookup, as the refiner moves a caller once — a chain is never followed', () => {
    // The links refuse chains (atm-settings.ts); were one stored, OCT → MOH stops at MOH.
    const m = registerBranchMapping(
      [{ code: 'EGYCASH-1', branchId: OCT }],
      new Map([
        [OCT, MOH],
        [MOH, TANTA],
      ]),
    );
    expect(m.branchIdByCode.get('EGYCASH-1')).toBe(MOH);
  });

  it('compares ids as `String(ObjectId)` writes them — lower case', () => {
    const m = registerBranchMapping(
      [{ code: 'EGYCASH-4', branchId: '65000000000000000000000A' }],
      new Map(),
    );
    expect(m.isMapped('65000000000000000000000a')).toBe(true);
    expect(m.rawBranchIdByCode.get('EGYCASH-4')).toBe('65000000000000000000000a');
  });
});
