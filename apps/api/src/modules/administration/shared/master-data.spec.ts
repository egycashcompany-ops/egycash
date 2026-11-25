// The duplicate answer, the stale edit's and the search every master register shares (design
// §5.15, §19.3, §19.4). Both ways a duplicate arrives end in one 409 naming its field: the early
// check, and a unique index's refusal in either shape — BaseRepository's `ConflictError` on a
// create, the raw E11000 of `findOneAndUpdate` on an edit. A refusal the register's own question
// cannot explain goes on as it came, rather than as a guessed field.
import { ErrorCodes, type AdministrationDuplicateField } from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import { AppError, ConflictError, StaleDocumentError } from '../../../shared/errors';
import {
  assertCurrentVersion,
  assertNotTaken,
  explainDuplicate,
  masterSearchClause,
} from './master-data';

const taken = (field: AdministrationDuplicateField | null) => () => Promise.resolve(field);

const rawDuplicate = Object.assign(new Error('E11000 duplicate key error collection'), {
  code: 11000,
});

describe('assertNotTaken', () => {
  it('passes a free write, and refuses a taken one with 409 ADMINISTRATION_DUPLICATE', async () => {
    await expect(assertNotTaken(taken(null))).resolves.toBeUndefined();
    await expect(assertNotTaken(taken('code'))).rejects.toMatchObject({
      code: ErrorCodes.ADMINISTRATION_DUPLICATE,
      httpStatus: 409,
      details: [{ field: 'code', code: 'duplicate' }],
    });
  });
});

describe('assertCurrentVersion', () => {
  it('passes a body written against the row as it is', () => {
    expect(() => assertCurrentVersion({ __v: 3 }, 3)).not.toThrow();
  });

  it.each([
    ['older', 2],
    ['newer', 4],
  ])('refuses a body written against an %s version with 409 STALE_DOCUMENT', (_label, version) => {
    expect(() => assertCurrentVersion({ __v: 3 }, version)).toThrow(StaleDocumentError);
  });
});

describe('explainDuplicate', () => {
  it.each([
    ['a create, through ConflictError', new ConflictError()],
    ['an edit, raw from the driver', rawDuplicate],
  ])('names the field the winning row holds, after %s', async (_label, error) => {
    const answer = await explainDuplicate(error, taken('name'));
    expect(answer).toBeInstanceOf(AppError);
    expect(answer).toMatchObject({
      code: ErrorCodes.ADMINISTRATION_DUPLICATE,
      details: [{ field: 'name' }],
    });
  });

  it('lets a refusal the check cannot explain go on as it came', async () => {
    expect(await explainDuplicate(rawDuplicate, taken(null))).toBe(rawDuplicate);
  });

  it('never asks about any other failure', async () => {
    const stale = new StaleDocumentError();
    let asked = false;
    const answer = await explainDuplicate(stale, () => {
      asked = true;
      return Promise.resolve('name');
    });
    expect(answer).toBe(stale);
    expect(asked).toBe(false);
  });
});

describe('masterSearchClause', () => {
  it('is null when nothing is searched', () => {
    expect(masterSearchClause(undefined)).toBeNull();
    expect(masterSearchClause('')).toBeNull();
  });

  it('matches the code and both names as typed, and the folded key', () => {
    const clause = masterSearchClause('قطعه');
    expect(clause?.map((part) => Object.keys(part)[0])).toEqual([
      'code',
      'name.ar',
      'name.en',
      'nameKey',
    ]);
    expect(clause?.[3]?.nameKey?.test('قطعهغيار')).toBe(true);
  });

  it('matches a register’s own fields as typed too — an item’s barcode', () => {
    const clause = masterSearchClause('6221', ['barcode']);
    expect(clause?.map((part) => Object.keys(part)[0])).toEqual([
      'code',
      'name.ar',
      'name.en',
      'nameKey',
      'barcode',
    ]);
    expect(clause?.[4]?.barcode?.test('6221234567890')).toBe(true);
  });

  it('leaves the folded key out when the text folds to nothing', () => {
    expect(masterSearchClause('ـ')?.map((part) => Object.keys(part)[0])).toEqual([
      'code',
      'name.ar',
      'name.en',
    ]);
  });
});
