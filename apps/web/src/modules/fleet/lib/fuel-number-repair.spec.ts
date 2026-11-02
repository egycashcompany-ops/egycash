// «تصحيح أرقام الكروت» (6d) — the screen's pure rules: when the entry box shows, what «تأكيد
// التنفيذ ✓» sends (only once reviewed, only the ready units), how held units and the records they
// hold are counted, the pair's balances, how a changed value is shown, and which log lines are
// «سُجِّلت قبل التصحيح».
import { describe, expect, it } from 'vitest';
import {
  type FleetFuelCardMovementDto,
  type FleetFuelNumberRepairResultDto,
} from '@ecms/contracts';
import {
  REPAIR_CLEAN,
  repairChanged269,
  repairDone,
  repairPartial,
} from '../fuel-number-repair-fixtures';
import {
  EXECUTE_GRANTS,
  beforeRepair,
  changeShown,
  changedCarsOf,
  entryShows,
  executeBodyOf,
  executedRecordsOf,
  expiryMoves,
  hasAnyCard,
  heldUnitsOf,
  mayExecute,
  noPinReadyOf,
  pairBalancesOf,
  readyCyclesOf,
  recordsOf,
  repairLineAtOf,
  statementDiffers,
  unitStateOf,
} from './fuel-number-repair';

describe('the entry box on «مطابقة أرصدة الكروت»', () => {
  it('shows while the repair is pending or partial, where its cards exist', () => {
    expect(entryShows(REPAIR_CLEAN)).toBe(true);
    expect(entryShows(repairPartial())).toBe(true);
    expect(entryShows(repairChanged269())).toBe(true);
  });
  it('does not show once done, before the dry run is read, or where none of the 17 cards exist', () => {
    expect(entryShows(repairDone())).toBe(false);
    expect(entryShows(undefined)).toBe(false);
    const empty = structuredClone(REPAIR_CLEAN);
    for (const cycle of empty.cycles) for (const row of cycle.rows) row.cardId = null;
    for (const row of empty.pair.rows) row.cardId = null;
    expect(hasAnyCard(empty)).toBe(false);
    expect(entryShows(empty)).toBe(false);
  });
});

describe('«تأكيد التنفيذ ✓»', () => {
  it('sends nothing until «راجعتُ الصفوف» is ticked', () => {
    expect(executeBodyOf(REPAIR_CLEAN, false)).toBeNull();
  });
  it('sends the dry run’s ready units, in execution order, once ticked', () => {
    expect(executeBodyOf(REPAIR_CLEAN, true)).toEqual({
      reviewed: true,
      units: ['C4', 'C5', 'C6', 'pair'],
    });
  });
  it('never names a held unit, nor one already done', () => {
    expect(executeBodyOf(repairChanged269(), true)?.units).toEqual(['C4', 'C6', 'pair']);
    expect(executeBodyOf(repairPartial(), true)?.units).toEqual(['C5', 'C6', 'pair']);
    expect(executeBodyOf(repairDone(), true)).toBeNull();
  });
  it('needs both grants the server asks — card edit and charge approval', () => {
    expect(EXECUTE_GRANTS).toEqual(['fleetFuelCard.edit', 'fleetFuelCharge.approve']);
    const of = (keys: string[]) => (key: string) => keys.includes(key);
    expect(mayExecute(of(['fleetFuelCard.edit', 'fleetFuelCharge.approve']))).toBe(true);
    expect(mayExecute(of(['fleetFuelCard.edit']))).toBe(false);
    expect(mayExecute(of(['fleetFuelCharge.approve']))).toBe(false);
    expect(mayExecute(of(['fleetFuelCard.view']))).toBe(false);
  });
});

describe('units, held and counted', () => {
  it('reads each unit’s state and size from the dry run', () => {
    const held = repairChanged269();
    expect(unitStateOf(held, 'C5')).toBe('held');
    expect(unitStateOf(held, 'C4')).toBe('ready');
    expect(unitStateOf(held, 'pair')).toBe('ready');
    expect(recordsOf(held, 'C4')).toBe(4);
    expect(recordsOf(held, 'C5')).toBe(5);
    expect(recordsOf(held, 'C6')).toBe(6);
    expect(recordsOf(held, 'pair')).toBe(2);
    expect(readyCyclesOf(held).map((cycle) => cycle.unit)).toEqual(['C4', 'C6']);
  });
  it('names the held unit, the car that changed in it, and the records waiting with it', () => {
    expect(heldUnitsOf(REPAIR_CLEAN)).toEqual([]);
    expect(heldUnitsOf(repairChanged269())).toEqual([
      { unit: 'C5', n: 2, changed: ['269'], records: 5 },
    ]);
    expect(changedCarsOf(repairChanged269().cycles[1]?.rows ?? [])).toEqual(['269']);
  });
  it('counts what an execution wrote in records, not units', () => {
    const result: FleetFuelNumberRepairResultDto = {
      at: '2026-11-02T10:31:00.000Z',
      executed: ['C4', 'C6', 'pair'],
      alreadyDone: [],
      held: ['C5'],
      notRequested: [],
      repair: repairChanged269(),
    };
    expect(executedRecordsOf(result)).toBe(12);
  });
  it('the confirmation names the records left without a PIN among the READY cycles only', () => {
    expect(noPinReadyOf(REPAIR_CLEAN)).toEqual(['284', '269', '230', '256', '251']);
    expect(noPinReadyOf(repairChanged269())).toEqual(['256', '251']);
    expect(noPinReadyOf(repairDone())).toEqual([]);
  });
});

describe('a row’s figures', () => {
  it('an expiry «يتغيّر» only when the day differs', () => {
    expect(expiryMoves({ expiryBefore: '2027-03-31', expiryAfter: '2027-03-31' })).toBe(false);
    expect(expiryMoves({ expiryBefore: '2028-11-30', expiryAfter: '2027-03-31' })).toBe(true);
    expect(
      expiryMoves({ expiryBefore: '2027-03-31T00:00:00.000Z', expiryAfter: '2027-03-31' }),
    ).toBe(false);
  });
  it('the pair: «بديل» only where the go-live statement differs from the new opening (283)', () => {
    const [a, b] = REPAIR_CLEAN.pair.rows;
    expect(statementDiffers(a)).toBe(false);
    expect(statementDiffers(b)).toBe(true);
  });
  it('the pair’s balance: live → live + Δ while pending; once done, live − Δ → live', () => {
    const [a, b] = REPAIR_CLEAN.pair.rows;
    expect(pairBalancesOf(a, false)).toEqual({ before: 23130.62, after: 11258 });
    expect(pairBalancesOf(b, false)).toEqual({ before: 2758, after: 14630.62 });
    const [doneA] = repairDone().pair.rows;
    expect(pairBalancesOf(doneA, true)).toEqual({ before: 23130.62, after: 11258 });
    // Below zero stays below zero — the screen draws it in red.
    expect(
      pairBalancesOf({ balance: 500, balanceAfter: -11372.62, delta: -11872.62 }, false),
    ).toEqual({ before: 500, after: -11372.62 });
    expect(pairBalancesOf({ balance: null, balanceAfter: null, delta: 1 }, true)).toEqual({
      before: null,
      after: null,
    });
  });
});

describe('a value changed by hand, as shown', () => {
  it('a number as its last four, a day, a name, yes/no for the PIN, a photo', () => {
    expect(changeShown('number', '2813')).toEqual({ kind: 'number', last4: '2813' });
    expect(changeShown('expiry', '2027-11-30')).toEqual({ kind: 'date', day: '2027-11-30' });
    expect(changeShown('name', 'EGYCASH-8618-S778864')).toEqual({
      kind: 'text',
      text: 'EGYCASH-8618-S778864',
    });
    expect(changeShown('vehicle', '232')).toEqual({ kind: 'text', text: '232' });
    expect(changeShown('pin', 'yes')).toEqual({ kind: 'pin', stored: true });
    expect(changeShown('pin', 'no')).toEqual({ kind: 'pin', stored: false });
    expect(changeShown('photo', '0935')).toEqual({ kind: 'photo', last4: '0935' });
    expect(changeShown('photo', 'other')).toEqual({ kind: 'photoOther' });
    expect(changeShown('photo', null)).toEqual({ kind: 'none' });
  });
});

describe('the card’s log: the lines before the repair', () => {
  const line = (id: string, kind: FleetFuelCardMovementDto['kind'], at: string) =>
    ({ id, kind, at }) as FleetFuelCardMovementDto;
  it('marks the lines older than the card’s `dataFix` line — never the line itself', () => {
    const lines = [
      line('later', 'charge', '2026-11-03T08:00:00.000Z'),
      line('fix', 'dataFix', '2026-11-02T10:31:00.000Z'),
      line('older', 'charge', '2026-10-23T08:40:00.000Z'),
    ];
    const at = repairLineAtOf(lines);
    expect(at).toBe(Date.parse('2026-11-02T10:31:00.000Z'));
    expect(lines.map((one) => beforeRepair(one, at))).toEqual([false, false, true]);
  });
  it('marks nothing on a card the repair never touched', () => {
    const lines = [line('older', 'charge', '2026-10-23T08:40:00.000Z')];
    expect(repairLineAtOf(lines)).toBeNull();
    expect(beforeRepair(lines[0] as FleetFuelCardMovementDto, null)).toBe(false);
  });
});
