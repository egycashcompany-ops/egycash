// The owner's rule (2026-10-13, port doc OD-1) in its pure parts: which lines of a batch open,
// what counts as the rule's refusal, and that both operation schemas declare the index that makes
// it race-proof — with the partial filter the service check's own "open" query matches.
import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '@ecms/contracts';
import { ConflictError, StaleDocumentError } from '../../../shared/errors';
import { AtmReplenishmentModel } from '../replenishments/replenishment.model';
import { AtmMaintenanceModel } from '../maintenances/maintenance.model';
import { atmIndexBuildPlan, atmIndexedModels } from '../atm-indexes';
import {
  OPEN_OPERATION_INDEX_NAMES,
  alreadyOpenError,
  decideOpenLines,
  isAlreadyOpenError,
  isOpenOperationDuplicate,
  openOperationPartialFilter,
} from './open-operation';

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
    expect(error.message).toBe('machine 101 already has an open replenishment');
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
    '%s: unique on the code, over open live rows with a non-empty code',
    (kind, model) => {
      const plan = atmIndexBuildPlan(model.schema.indexes());
      const entry = plan.find((p) => p.options['name'] === OPEN_OPERATION_INDEX_NAMES[kind]);
      expect(entry).toBeDefined();
      expect(entry?.keys).toEqual({ machineCode: 1 });
      expect(entry?.unique).toBe(true);
      expect(entry?.options['partialFilterExpression']).toEqual({
        closedAt: null,
        isDeleted: false,
        machineCode: { $gt: '' },
      });
    },
  );

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
    // The master and the register keep their report exactly as before.
    expect(
      atmIndexedModels()
        .filter((entry) => !['atm_replenishments', 'atm_maintenances'].includes(entry.collection))
        .every((entry) => entry.rowsInLog),
    ).toBe(true);
  });
});
