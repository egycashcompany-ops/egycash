// «مطابقة شيت شركة الوقود» on the fleet dashboard — the pure digest of one company's LAST read sheet.
//
// The promises (plan D12, critic C7/C8):
//   · `differing` = the session's balance LINES (the cards whose balance differed at the read);
//   · `undecided` = the lines with no decision; a line held back for the card-number repair
//     (`inRepair`) is undecided while nobody refuses it — and decided once somebody does;
//   · `undecidedNet` = Σ (sheet − system) of the undecided lines AS AT THE READ, to the piastre;
//   · under a branch only the lines of the branch's cards count; the sheet's day stays the company's;
//   · «تاريخ الشيت» as written at the read; a session read before it was recorded falls back to the
//     CAIRO day of the read (`readDay`), never a UTC day.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { sheetDigest, type FuelSheetSession } from './fuel-sheet-digest';

const CARD = (n: number): string => `64b00000000000000000c0${String(n).padStart(2, '0')}`;

const line = (
  n: number,
  sheetBalance: number,
  systemBalance: number,
  over: { decision?: 'apply' | 'reject' | null; inRepair?: boolean } = {},
) => ({
  cardId: new Types.ObjectId(CARD(n)),
  sheetBalance,
  systemBalance,
  decision: over.decision ?? null,
  ...(over.inRepair === undefined ? {} : { inRepair: over.inRepair }),
});

/** Read at 23:30Z on 11 November — already the 12th in Cairo. */
const SESSION: FuelSheetSession = {
  sheetDate: new Date('2026-11-10T00:00:00.000Z'),
  readAt: new Date('2026-11-11T23:30:00.000Z'),
  lines: [
    line(1, 500, 650), // −150, undecided
    line(2, 1200, 1000, { decision: 'apply' }), // decided ✓
    line(3, 80.1, 0.2, { inRepair: true }), // held for the repair, nobody refused: undecided
    line(4, 300, 400, { decision: 'reject' }), // decided ✗
    line(5, 40.3, 40.1, { inRepair: true, decision: 'reject' }), // in repair but refused: decided
  ],
};

describe('sheetDigest — one company’s last read sheet, as at its read', () => {
  it('counts the lines, the undecided ones (a line in repair included) and their net', () => {
    expect(sheetDigest(SESSION)).toEqual({
      sheetDate: '2026-11-10',
      readDay: '2026-11-12',
      differing: 5,
      undecided: 2,
      // (500 − 650) + (80.1 − 0.2) = −70.1, to the piastre (no binary residue).
      undecidedNet: -70.1,
    });
  });

  it('the figures are the stored ones: a card that moved since does not move them', () => {
    // The digest never reads a card — only `sheetBalance` / `systemBalance` as stored at the read.
    const again = sheetDigest({ ...SESSION, lines: [...(SESSION.lines ?? [])] });
    expect(again).toEqual(sheetDigest(SESSION));
  });

  it('under a branch: only the lines of the branch’s cards; the sheet’s day stays the company’s', () => {
    expect(sheetDigest(SESSION, new Set([CARD(1), CARD(2), CARD(9)]))).toEqual({
      sheetDate: '2026-11-10',
      readDay: '2026-11-12',
      differing: 2,
      undecided: 1,
      undecidedNet: -150,
    });
    // A branch none of whose cards differed: zeros, never a missing figure.
    expect(sheetDigest(SESSION, new Set([CARD(9)]))).toMatchObject({
      differing: 0,
      undecided: 0,
      undecidedNet: 0,
    });
  });

  it('everything decided: 0 undecided and a net of exactly 0 (never −0)', () => {
    const decided = sheetDigest({
      ...SESSION,
      lines: [line(1, 100, 200, { decision: 'apply' }), line(2, 0.1, 0.3, { decision: 'reject' })],
    });
    expect(decided.undecided).toBe(0);
    expect(Object.is(decided.undecidedNet, 0)).toBe(true);
  });

  it('a session read before «تاريخ الشيت» was recorded: no sheet day, the Cairo day of the read', () => {
    const older: FuelSheetSession = { readAt: SESSION.readAt, lines: SESSION.lines ?? [] };
    expect(sheetDigest(older)).toMatchObject({ sheetDate: null, readDay: '2026-11-12' });
    expect(sheetDigest({ ...SESSION, sheetDate: null })).toMatchObject({ sheetDate: null });
  });

  it('a sheet that differed nowhere: zeros', () => {
    expect(sheetDigest({ readAt: new Date('2026-11-12T08:00:00.000Z') })).toEqual({
      sheetDate: null,
      readDay: '2026-11-12',
      differing: 0,
      undecided: 0,
      undecidedNet: 0,
    });
  });
});
