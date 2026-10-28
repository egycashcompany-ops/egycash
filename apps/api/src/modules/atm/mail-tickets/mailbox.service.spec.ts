// The mailbox card's branch rows as they are saved (`mailboxBranchesFiledAs`) — pure. A mail is
// filed under its machine's RESOLVED branch (`atm.branchLinks`), so a row for a linked SOURCE is
// saved as its target, and dropped when the target is listed already: the owner's «فرع أكتوبر شغال
// هو والمهندسين مع بعض» (2026-10-28).
import { describe, expect, it } from 'vitest';
import { mailboxBranchesFiledAs } from './mailbox.service';

const MOH = '650000000000000000000001';
const OCT = '650000000000000000000005';
const SHEIKH = '650000000000000000000006';
const ALEX = '650000000000000000000004';
const LINKS = new Map([
  [OCT, MOH],
  [SHEIKH, MOH],
]);

describe('mailboxBranchesFiledAs', () => {
  it('without links: the rows as sent', () => {
    const rows = [
      { branchId: ALEX, category: 'Green Category' },
      { branchId: MOH, category: null },
    ];
    expect(mailboxBranchesFiledAs(rows, new Map())).toEqual(rows);
  });

  it('a source alone is saved as its target, in its place, with its colour', () => {
    expect(
      mailboxBranchesFiledAs(
        [
          { branchId: ALEX, category: null },
          { branchId: OCT, category: 'Orange Category' },
        ],
        LINKS,
      ),
    ).toEqual([
      { branchId: ALEX, category: null },
      { branchId: MOH, category: 'Orange Category' },
    ]);
  });

  it('a source beside its target is dropped — the target’s own row and colour stay', () => {
    for (const rows of [
      [
        { branchId: OCT, category: 'Orange Category' },
        { branchId: MOH, category: 'Red Category' },
      ],
      [
        { branchId: MOH, category: 'Red Category' },
        { branchId: OCT, category: 'Orange Category' },
      ],
    ]) {
      expect(mailboxBranchesFiledAs(rows, LINKS)).toEqual([
        { branchId: MOH, category: 'Red Category' },
      ]);
    }
  });

  it('two sources of one target: the first stands for it, each branch once', () => {
    expect(
      mailboxBranchesFiledAs(
        [
          { branchId: SHEIKH, category: null },
          { branchId: OCT, category: 'Orange Category' },
        ],
        LINKS,
      ),
    ).toEqual([{ branchId: MOH, category: null }]);
  });
});
