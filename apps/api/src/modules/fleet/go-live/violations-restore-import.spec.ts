// Putting back what people did on the violations screen from the 24th on — the rules that decide
// what a person changed, what the fine looked like at the cutoff, and which book row is its twin.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { type FleetViolationDoc } from '../violations/violation.model';
import {
  atCutoff,
  docValue,
  foldFineEdits,
  sameStored,
  twinKey,
  type AuditTrailEntry,
} from './violations-restore-import';

const HERE = dirname(fileURLToPath(import.meta.url));
const code = (name: string): string => readFileSync(join(HERE, name), 'utf8');

const car = new Types.ObjectId();
const other = new Types.ObjectId();
const type = new Types.ObjectId();

const fine = (o: Partial<FleetViolationDoc> = {}): FleetViolationDoc =>
  ({
    _id: new Types.ObjectId(),
    kind: 'vehicle',
    vehicleId: car,
    vehicleCode: null,
    violationTypeId: type,
    amount: 500,
    year: 2026,
    count: 1,
    unitValue: 500,
    date: null,
    filedYear: null,
    homeVehicleId: null,
    driverEmployeeId: null,
    driverName: null,
    collected: false,
    isDeleted: true,
    __v: 3,
    ...o,
  }) as unknown as FleetViolationDoc;

const entry = (o: Partial<AuditTrailEntry>): AuditTrailEntry => ({
  entityId: 'x',
  action: 'update',
  at: new Date('2026-09-25T10:00:00.000Z'),
  userId: 'u1',
  changes: [],
  ...o,
});

describe('what a person changed after the cutoff', () => {
  it('keeps the FIRST old value and the LAST new value of each field', () => {
    const edits = foldFineEdits([
      entry({
        at: new Date('2026-09-26T00:00:00Z'),
        changes: [{ field: 'amount', old: 600, new: 700 }],
      }),
      entry({
        at: new Date('2026-09-25T00:00:00Z'),
        changes: [{ field: 'amount', old: 500, new: 600 }],
      }),
      entry({ changes: [{ field: 'collected', old: false, new: true }] }),
    ]);
    expect(edits.before).toEqual({ amount: 500, collected: false });
    expect(edits.after).toEqual({ amount: 700, collected: true });
    expect(edits.deleted).toBeNull();
  });

  it('drops a field set and set back — nothing to put back', () => {
    const edits = foldFineEdits([
      entry({
        at: new Date('2026-09-25T00:00:00Z'),
        changes: [{ field: 'collected', old: false, new: true }],
      }),
      entry({
        at: new Date('2026-09-26T00:00:00Z'),
        changes: [{ field: 'collected', old: true, new: false }],
      }),
    ]);
    expect(edits.after).toEqual({});
  });

  it('reads ids and dates back in the shape the row stores them', () => {
    expect(docValue('vehicleId', String(other))).toEqual(other);
    expect(docValue('date', '2026-05-11T00:00:00.000Z')).toEqual(
      new Date('2026-05-11T00:00:00.000Z'),
    );
    expect(docValue('collected', true)).toBe(true);
    expect(sameStored(other, String(other))).toBe(true);
    expect(sameStored(new Date('2026-05-11T00:00:00Z'), '2026-05-11T00:00:00.000Z')).toBe(true);
    expect(sameStored(null, undefined)).toBe(true);
  });

  it('notes a delete, and who made it', () => {
    const edits = foldFineEdits([entry({ action: 'delete', userId: String(other) })]);
    expect(edits.deleted?.by).toBe(String(other));
  });
});

describe('the twin among the book’s rows', () => {
  it('is found from the fine AS IT WAS at the cutoff — a carry after it is undone first', () => {
    // Carried onto `other` on the 25th: the swept row now sits there, the book's copy on `car`.
    const swept = fine({ vehicleId: other, homeVehicleId: car, collected: true });
    const edits = foldFineEdits([
      entry({
        changes: [
          { field: 'vehicleId', old: String(car), new: String(other) },
          { field: 'homeVehicleId', old: null, new: String(car) },
        ],
      }),
    ]);
    const book = fine({ isDeleted: false });
    expect(twinKey(atCutoff(swept, edits))).toBe(twinKey(book));
  });

  it('tells two fines of one car apart by what the import keys them on', () => {
    expect(twinKey(fine({ count: 2 }))).not.toBe(twinKey(fine({ count: 1 })));
  });
});

describe('the step', () => {
  const step = code('violations-restore.ts');
  const rules = code('violations-restore-import.ts');

  it('reads only what a PERSON did, between the cutoff and the end of the reload', () => {
    expect(rules).toContain("'actor.userId': { $ne: null }");
    expect(rules).toContain('const inWindow = trail.filter((entry) => entry.at < to);');
    expect(step).toContain('VIOLATIONS_RELOAD_CUTOFF,');
  });

  it('writes only onto the book’s live rows, and never over a change made since', () => {
    expect(rules).toContain('fromOldBook: true, isDeleted: false');
    expect(rules).toContain(
      'const guard: Record<string, unknown> = { _id: twin._id, isDeleted: false, __v: twin.__v };',
    );
    expect(rules).toContain('if (tickedSince.has(block))');
  });

  it('waits for the reload, and refuses before the claim', () => {
    const wait = step.indexOf('waitForGoLiveRuns([VIOLATIONS_RELOAD_MARK])');
    const claim = step.indexOf('claimGoLiveRun(VIOLATIONS_RESTORE_MARK');
    expect(wait).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(wait);
  });
});
