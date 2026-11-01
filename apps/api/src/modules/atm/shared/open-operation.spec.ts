// The owner's rule (2026-10-13, per day since 2026-10-27 — port doc OD-1) in its pure parts: which lines of a batch open,
// what counts as the rule's refusal, and that both operation schemas declare the index that makes
// it race-proof — with the partial filter the service check's own "open" query matches.
import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '@ecms/contracts';
import { ConflictError, StaleDocumentError } from '../../../shared/errors';
import { AtmReplenishmentModel } from '../replenishments/replenishment.model';
import { AtmMaintenanceModel } from '../maintenances/maintenance.model';
import { atmIndexBuildPlan, atmIndexedModels } from '../atm-indexes';
import { leaderCascadeGroups } from './operation-log.repository';
import {
  OPEN_OPERATION_INDEX_NAMES,
  RETIRED_OPEN_OPERATION_INDEX_NAMES,
  alreadyOpenError,
  codesBlockedByMove,
  decideOpenLines,
  isAlreadyOpenError,
  isOpenOperationDuplicate,
  openDayOf,
  openOperationPartialFilter,
} from './open-operation';
import { Types } from 'mongoose';

const known = (...codes: string[]) => {
  const set = new Set(codes);
  return (code: string): boolean => set.has(code);
};

describe('decideOpenLines — one batch, in input order', () => {
  it('opens a known code that has no open operation', () => {
    expect(decideOpenLines(['101'], known('101'), new Set())).toEqual(['open']);
  });

  it('refuses a code that already has an open operation', () => {
    expect(decideOpenLines(['101', '102'], known('101', '102'), new Set(['101']))).toEqual([
      'alreadyOpen',
      'open',
    ]);
  });

  it('opens a code repeated in the batch ONCE — on its first line — and refuses the repeats', () => {
    expect(decideOpenLines(['101', '102', '101', '101'], known('101', '102'), new Set())).toEqual([
      'open',
      'open',
      'alreadyOpen',
      'alreadyOpen',
    ]);
  });

  it('keeps unknown before the rule: a code no machine answers for is unknown, every time', () => {
    expect(decideOpenLines(['999', '999'], known(), new Set(['999']))).toEqual([
      'unknown',
      'unknown',
    ]);
  });

  it('skips blank lines without claiming anything', () => {
    expect(decideOpenLines(['', '101', ''], known('101'), new Set())).toEqual([
      'blank',
      'open',
      'blank',
    ]);
  });

  it('does not mutate the already-open set it was handed', () => {
    const open = new Set<string>();
    decideOpenLines(['101'], known('101'), open);
    expect(open.size).toBe(0);
  });
});

describe('the refusal and the race', () => {
  it('answers 409 under one stable code, naming only the machine code', () => {
    const error = alreadyOpenError('replenishment', '101');
    expect(error.httpStatus).toBe(409);
    expect(error.code).toBe(ErrorCodes.ATM_OPERATION_ALREADY_OPEN);
    expect(error.message).toBe('machine 101 already has an open replenishment that day');
    expect(isAlreadyOpenError(error)).toBe(true);
    expect(isAlreadyOpenError(new ConflictError())).toBe(false);
    expect(isAlreadyOpenError(new StaleDocumentError())).toBe(false);
  });

  it('reads a lost race in both forms the repository surfaces it', () => {
    // `create` maps E11000 to a DUPLICATE ConflictError; `findOneAndUpdate` lets the driver's through.
    expect(isOpenOperationDuplicate(new ConflictError())).toBe(true);
    expect(isOpenOperationDuplicate({ code: 11000, keyPattern: { machineCode: 1 } })).toBe(true);
    expect(isOpenOperationDuplicate(new StaleDocumentError())).toBe(false);
    expect(isOpenOperationDuplicate(alreadyOpenError('maintenance', '101'))).toBe(false);
    expect(isOpenOperationDuplicate(new Error('boom'))).toBe(false);
    expect(isOpenOperationDuplicate(null)).toBe(false);
  });
});

describe('the race-proof index, declared on both operation logs', () => {
  it.each([
    ['replenishment', AtmReplenishmentModel],
    ['maintenance', AtmMaintenanceModel],
  ] as const)(
    '%s: unique on the code AND day, over open live rows with a non-empty code and a stored day',
    (kind, model) => {
      const plan = atmIndexBuildPlan(model.schema.indexes());
      const entry = plan.find((p) => p.options['name'] === OPEN_OPERATION_INDEX_NAMES[kind]);
      expect(entry).toBeDefined();
      expect(entry?.keys).toEqual({ machineCode: 1, openDay: 1 });
      expect(entry?.unique).toBe(true);
      expect(entry?.options['partialFilterExpression']).toEqual({
        closedAt: null,
        isDeleted: false,
        machineCode: { $gt: '' },
        openDay: { $gt: '' },
      });
      // The any-day index of the rule's first form is no longer declared — the boot drops it.
      expect(plan.some((p) => p.options['name'] === RETIRED_OPEN_OPERATION_INDEX_NAMES[kind])).toBe(
        false,
      );
    },
  );

  it('lists the retired index on each operation log for the boot to drop', () => {
    const retired = Object.fromEntries(
      atmIndexedModels().map((entry) => [entry.collection, entry.retired ?? []]),
    );
    expect(retired['atm_replenishments']).toEqual(['ux_open_replenishment_per_code']);
    expect(retired['atm_maintenances']).toEqual(['ux_open_maintenance_per_code']);
  });

  it('hands every schema its own filter object', () => {
    expect(openOperationPartialFilter()).not.toBe(openOperationPartialFilter());
  });

  it('is built at boot: both collections are on the index builder’s list, rows kept out of its log', () => {
    const listed = atmIndexedModels().filter((entry) =>
      ['atm_replenishments', 'atm_maintenances'].includes(entry.collection),
    );
    expect(listed.map((entry) => entry.collection).sort()).toEqual([
      'atm_maintenances',
      'atm_replenishments',
    ]);
    expect(listed.every((entry) => !entry.rowsInLog)).toBe(true);
    // The settlements' operation records join them (docs/12-planning/atm-settlements-phase1.md
    // §4.10): plan lines, line preparations and route assignments hold counts and seals. Every
    // other collection — the master, the register — keeps its report exactly as before.
    const rowsOut = [
      'atm_line_preparations',
      'atm_maintenances',
      'atm_plan_lines',
      'atm_replenishments',
      'atm_route_assignments',
    ];
    expect(
      atmIndexedModels()
        .filter((entry) => !entry.rowsInLog)
        .map((entry) => entry.collection)
        .sort(),
    ).toEqual(rowsOut);
    expect(
      atmIndexedModels()
        .filter((entry) => !rowsOut.includes(entry.collection))
        .every((entry) => entry.rowsInLog),
    ).toBe(true);
  });
});

describe('the day an operation belongs to', () => {
  it('is the Cairo calendar day of the open time, not the UTC one', () => {
    // 23:30Z on the 26th is 01:30 (EET) or 02:30 (EEST) on the 27th in Cairo.
    expect(openDayOf(new Date('2026-10-26T23:30:00.000Z'))).toBe('2026-10-27');
    expect(openDayOf(new Date('2026-10-27T09:00:00.000Z'))).toBe('2026-10-27');
  });
});

describe('codesBlockedByMove — the bulk edit of the open time', () => {
  const row = (machineCode: string, closedAt: Date | null = null) => ({ machineCode, closedAt });

  it('blocks a code two moved open rows share — one instant, one day', () => {
    expect(codesBlockedByMove([row('101'), row('102'), row('101')], new Set())).toEqual(['101']);
  });

  it('blocks a code already open that day in a row not being moved', () => {
    expect(codesBlockedByMove([row('101'), row('102')], new Set(['102']))).toEqual(['102']);
  });

  it('ignores closed rows and empty codes — the rule covers neither', () => {
    expect(
      codesBlockedByMove([row('101', new Date()), row('101'), row(''), row('')], new Set()),
    ).toEqual([]);
  });

  it('names each code once', () => {
    expect(codesBlockedByMove([row('101'), row('101'), row('101')], new Set(['101']))).toEqual([
      '101',
    ]);
  });
});

describe('leaderCascadeGroups — one cascade per branch, area and shift', () => {
  const branch = new Types.ObjectId();
  const at = (iso: string, area = 'Smouha', branchId = branch) => ({
    branchId,
    area,
    openedAt: new Date(iso),
  });

  it('keeps the first row of each group and drops the rest', () => {
    const rows = [
      at('2026-10-27T08:00:00.000Z'), // 10:00 Cairo — day shift
      at('2026-10-27T10:00:00.000Z'), // 12:00 — the same day shift
      at('2026-10-27T15:00:00.000Z'), // 17:00 — the night shift
      at('2026-10-27T08:00:00.000Z', 'Miami'), // another area
      at('2026-10-27T08:00:00.000Z', 'Smouha', new Types.ObjectId()), // another branch
    ];
    expect(leaderCascadeGroups(rows)).toEqual([rows[0], rows[2], rows[3], rows[4]]);
  });
});
