// The arithmetic of «خد من متبقي عربيه وضيفه على الحادث ده» — tested without a database.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  addMoney,
  allocateTransfer,
  carRemaining,
  fileRemaining,
  liveTransfers,
  receivingCap,
  sumLive,
  type ReceivingFigures,
  type TransferSource,
} from './accident-transfer';
import { type FleetAccidentTransfer } from './accident.model';

const file = (
  day: string | null,
  owes: number,
  over: Partial<TransferSource> = {},
): TransferSource => ({
  _id: new Types.ObjectId(),
  occurredAt: day === null ? null : new Date(`${day}T00:00:00Z`),
  createdAt: new Date('2026-01-01T00:00:00Z'),
  // `owes` as collected − paid, company cost zero — the figure the row prints.
  amountCollected: Math.max(owes, 0),
  companyCost: 0,
  paidAmount: Math.max(-owes, 0),
  transferredIn: 0,
  transferredOut: 0,
  ...over,
});

describe('a file’s and a car’s remaining', () => {
  it('counts what transfers moved in and out, as the row prints it', () => {
    expect(
      fileRemaining({
        amountCollected: 1500,
        companyCost: 500,
        paidAmount: 1300,
        transferredIn: 1500,
        transferredOut: 200,
      }),
    ).toBe(2000);
  });

  it('reads a file written before transfers existed as having none', () => {
    expect(fileRemaining({ amountCollected: 100, companyCost: 0, paidAmount: 40 })).toBe(60);
  });

  it('sums a car NET — a file paid beyond what it owed lowers the car’s total', () => {
    expect(carRemaining([file('2026-01-01', 1000), file('2026-02-01', -400)])).toBe(600);
  });

  it('sums the car the way the strip does — raw figures, rounded once', () => {
    // Three files of half a piastre each: the strip reads 0.02 (0.015 rounded), and so must the car.
    const halves = [0, 1, 2].map(() => file(null, 0.005));
    expect(carRemaining(halves)).toBe(0.02);
  });

  it('adds to the piastre, with no binary residue', () => {
    expect(carRemaining([file(null, 0.1), file(null, 0.2)])).toBe(0.3);
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(addMoney(0.3, -0.1)).toBe(0.2);
  });
});

describe('allocateTransfer — «أقدم حادث عليه متبقي الأول»', () => {
  it('draws from the OLDEST file first, then the next, until the amount is met', () => {
    const newer = file('2026-03-01', 200);
    const older = file('2024-01-01', 1000);
    const allocation = allocateTransfer([newer, older], 1100);
    expect(allocation.ok).toBe(true);
    if (!allocation.ok) return;
    expect(allocation.lines.map((l) => [String(l.accidentId), l.amount])).toEqual([
      [String(older._id), 1000],
      [String(newer._id), 100],
    ]);
  });

  it('takes only what a file still owes, and skips one that owes nothing', () => {
    const paid = file('2024-01-01', 0);
    const over = file('2024-02-01', -50);
    const owes = file('2024-03-01', 300);
    const allocation = allocateTransfer([paid, over, owes], 200);
    expect(allocation.ok && allocation.lines.map((l) => String(l.accidentId))).toEqual([
      String(owes._id),
    ]);
  });

  it('counts what was already taken from a file', () => {
    const drawn = file('2024-01-01', 1000, { transferredOut: 900 });
    const next = file('2024-02-01', 500);
    const allocation = allocateTransfer([drawn, next], 300);
    expect(allocation.ok && allocation.lines.map((l) => l.amount)).toEqual([100, 200]);
  });

  it('REFUSES more than the car has, naming what it does have', () => {
    expect(allocateTransfer([file('2024-01-01', 1000), file('2024-02-01', 200)], 1200.01)).toEqual({
      ok: false,
      available: 1200,
    });
  });

  it('caps by the NET total, not by the files that still owe', () => {
    // 1,000 owed on one file and 400 overpaid on another: the car has 600, not 1,000.
    expect(allocateTransfer([file('2024-01-01', 1000), file('2024-02-01', -400)], 700)).toEqual({
      ok: false,
      available: 600,
    });
    const allowed = allocateTransfer([file('2024-01-01', 1000), file('2024-02-01', -400)], 600);
    expect(allowed.ok && allowed.lines.map((l) => l.amount)).toEqual([600]);
  });

  it('refuses a car with nothing remaining, and a zero amount', () => {
    expect(allocateTransfer([file('2024-01-01', -10)], 1)).toEqual({ ok: false, available: 0 });
    expect(allocateTransfer([], 1)).toEqual({ ok: false, available: 0 });
    expect(allocateTransfer([file('2024-01-01', 10)], 0).ok).toBe(false);
  });

  it('takes the WHOLE remaining when asked for exactly that', () => {
    const allocation = allocateTransfer(
      [file('2024-01-01', 700.5), file('2024-02-01', 299.5)],
      1000,
    );
    expect(allocation.ok && allocation.lines.map((l) => l.amount)).toEqual([700.5, 299.5]);
  });

  it('draws lines that add up to EXACTLY the amount typed, to the piastre', () => {
    const files = [file('2024-01-01', 0.1), file('2024-01-02', 0.2), file('2024-01-03', 10)];
    const allocation = allocateTransfer(files, 0.35);
    expect(allocation.ok).toBe(true);
    if (!allocation.ok) return;
    expect(allocation.lines.map((l) => l.amount)).toEqual([0.1, 0.2, 0.05]);
    expect(Math.round(allocation.lines.reduce((sum, l) => sum + l.amount * 100, 0))).toBe(35);
  });

  it('treats a file from the old book with no date as the oldest', () => {
    const dated = file('2020-01-01', 100);
    const undated = file(null, 100);
    const allocation = allocateTransfer([dated, undated], 50);
    expect(allocation.ok && String(allocation.lines[0]?.accidentId)).toBe(String(undated._id));
  });

  it('breaks a tie on the day by when the file was recorded', () => {
    const later = file('2024-01-01', 100, { createdAt: new Date('2024-01-05T00:00:00Z') });
    const earlier = file('2024-01-01', 100, { createdAt: new Date('2024-01-02T00:00:00Z') });
    const allocation = allocateTransfer([later, earlier], 50);
    expect(allocation.ok && String(allocation.lines[0]?.accidentId)).toBe(String(earlier._id));
  });
});

describe('receivingCap — «اعرف المبلغ اللى بالسالب كام وشيله»', () => {
  /** A receiving file `below` zero: collected 0, paid `below`, nothing moved yet. */
  const short = (below: number, over: Partial<ReceivingFigures> = {}): ReceivingFigures => ({
    amountCollected: 0,
    companyCost: 0,
    paidAmount: below,
    transferredIn: 0,
    transferredOut: 0,
    ...over,
  });

  it('allows up to the file’s whole negative — and the negative exactly', () => {
    expect(receivingCap(short(300), 100)).toEqual({ ok: true });
    expect(receivingCap(short(300), 300)).toEqual({ ok: true });
  });

  it('REFUSES a piastre past it, naming the negative', () => {
    expect(receivingCap(short(300), 300.01)).toEqual({ ok: false, deficit: 300 });
  });

  it('refuses any take onto a file at zero or above — it has no negative', () => {
    expect(receivingCap(short(0), 0.01)).toEqual({ ok: false, deficit: 0 });
    expect(receivingCap({ amountCollected: 500, companyCost: 0, paidAmount: 0 }, 1)).toEqual({
      ok: false,
      deficit: 0,
    });
  });

  it('reads all five figures: collected + company − paid + in − out', () => {
    // 1,000 + 200 − 2,000 = −800; 300 already taken in → −500; 100 given out → −600.
    const file = short(2000, {
      amountCollected: 1000,
      companyCost: 200,
      transferredIn: 300,
      transferredOut: 100,
    });
    expect(receivingCap(file, 600)).toEqual({ ok: true });
    expect(receivingCap(file, 600.01)).toEqual({ ok: false, deficit: 600 });
  });

  it('counts what the file already took: a second take fills only the rest', () => {
    expect(receivingCap(short(500, { transferredIn: 400 }), 100)).toEqual({ ok: true });
    expect(receivingCap(short(500, { transferredIn: 400 }), 100.01)).toEqual({
      ok: false,
      deficit: 100,
    });
    expect(receivingCap(short(500, { transferredIn: 500 }), 0.01)).toEqual({
      ok: false,
      deficit: 0,
    });
  });

  it('reads a file written before transfers existed as having none', () => {
    expect(receivingCap({ amountCollected: 0, companyCost: 0, paidAmount: 50 }, 50)).toEqual({
      ok: true,
    });
  });

  it('compares in piastres — no binary residue refuses the exact negative', () => {
    // 0.1 + 0.2 − 0.6 is −0.30000000000000004 in floating point: the negative is 0.30.
    const file = short(0.6, { amountCollected: 0.1, companyCost: 0.2 });
    expect(receivingCap(file, 0.3)).toEqual({ ok: true });
    expect(receivingCap(file, 0.31)).toEqual({ ok: false, deficit: 0.3 });
    expect(receivingCap(short(19.99), 19.99)).toEqual({ ok: true });
  });
});

describe('the transfers that still count', () => {
  const transfer = (amount: number, voided: boolean): FleetAccidentTransfer => ({
    _id: new Types.ObjectId(),
    fromVehicleId: new Types.ObjectId(),
    fromVehicleCode: '214',
    amount,
    lines: [],
    at: new Date(),
    by: null,
    byName: null,
    voidedAt: voided ? new Date() : null,
    voidedBy: null,
    voidReason: voided ? 'removed' : null,
  });

  it('leaves a removed transfer on the file and out of every sum', () => {
    const transfersIn = [transfer(1500, false), transfer(400, true), transfer(0.1, false)];
    expect(liveTransfers({ transfersIn })).toHaveLength(2);
    expect(sumLive(liveTransfers({ transfersIn }))).toBe(1500.1);
  });

  it('reads a file with no transfers at all as having none', () => {
    expect(liveTransfers({})).toEqual([]);
    expect(sumLive([])).toBe(0);
  });
});
