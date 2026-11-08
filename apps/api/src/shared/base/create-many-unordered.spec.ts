// `createManyUnordered`: one insert for a batch, and an honest account of each row.
//
// The model is REAL and only the driver call is replaced, so Mongoose's own unordered bookkeeping
// runs exactly as in production — validation before the insert, and the remapping of the driver's
// write errors to INPUT indexes (the driver counts only the rows that passed validation). That
// remapping is what the duplicate mapping stands on, and it is a Mongoose internal: these specs pin
// it, so an upgrade that changes it fails here rather than mislabelling rows on a live board.
import mongoose, { Schema, Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type BaseDocFields, baseFields, baseSchemaOptions } from './base.model';
import { BaseRepository, PartialCreateError, type CreateManyResult } from './base.repository';

interface RowDoc extends BaseDocFields {
  code: string;
}

const RowModel =
  (mongoose.models.CreateManyUnorderedSpecRow as mongoose.Model<RowDoc> | undefined) ??
  mongoose.model<RowDoc>(
    'CreateManyUnorderedSpecRow',
    new Schema<RowDoc>(
      { code: { type: String, required: true }, ...baseFields },
      baseSchemaOptions,
    ),
  );
const repository = new BaseRepository<RowDoc>(RowModel);

/**
 * The driver's `WriteError`, shape for shape: the raw error as an own property, everything else a
 * prototype getter — which is why Mongoose's `{ ...writeError }` remap loses `code`.
 */
class DriverWriteError {
  constructor(readonly err: { code: number; index: number; errmsg: string }) {}
  get code(): number {
    return this.err.code;
  }
  get index(): number {
    return this.err.index;
  }
}

/** What the driver throws for an unordered insert with refused rows (indexes are DRIVER indexes). */
const bulkError = (refused: { index: number; code: number }[]): Error =>
  new mongoose.mongo.MongoBulkWriteError(
    {
      message: 'write failed',
      code: refused[0]?.code ?? 0,
      writeErrors: refused.map(
        (row) => new DriverWriteError({ ...row, errmsg: `E${String(row.code)}` }),
      ) as never,
    },
    {} as never,
  );

type DriverInsert = (docs: Record<string, unknown>[], options: Record<string, unknown>) => unknown;
/** Replace the driver's insert. Async, as the driver's is: a throw becomes its rejection. */
const driverInsert = (impl: DriverInsert) => {
  const spy = vi.fn(async (docs: Record<string, unknown>[], options: Record<string, unknown>) =>
    impl(docs, options),
  );
  (RowModel.collection as unknown as { insertMany: typeof spy }).insertMany = spy;
  return spy;
};
const succeed: DriverInsert = (docs) => ({ acknowledged: true, insertedCount: docs.length });

const by = new Types.ObjectId();
const codesOf = (result: CreateManyResult<RowDoc>) =>
  result.inserted.map(({ index, doc }) => [index, doc.code]);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createManyUnordered — every row lands', () => {
  it('writes the batch in ONE insert, unordered, stamped as `create` stamps a row', async () => {
    const insert = driverInsert(succeed);
    const result = await repository.createManyUnordered([{ code: 'a' }, { code: 'b' }], {
      by: String(by),
    });

    expect(insert).toHaveBeenCalledTimes(1);
    const [docs, options] = insert.mock.calls[0] ?? [];
    expect(docs).toHaveLength(2);
    expect(options).toMatchObject({ ordered: false, throwOnValidationError: true });
    // No session asked for, none passed — the driver's own implicit session, as `create` gets.
    expect(options).not.toHaveProperty('session');

    expect(codesOf(result)).toEqual([
      [0, 'a'],
      [1, 'b'],
    ]);
    expect(result.duplicateIndexes).toEqual([]);
    const [first] = result.inserted;
    // A plain object, as `create` returns — with the model's defaults, stamps and timestamps.
    expect(first?.doc).not.toBeInstanceOf(mongoose.Document);
    expect(first?.doc).toMatchObject({ createdBy: by, updatedBy: by, isDeleted: false, __v: 0 });
    expect(first?.doc.createdAt).toBeInstanceOf(Date);
    expect(first?.doc._id).toBeInstanceOf(Types.ObjectId);
  });

  it('stamps a system write (`by: null`) as null, and passes a caller session through', async () => {
    const insert = driverInsert(succeed);
    const session = { id: 'session' } as unknown as mongoose.ClientSession;
    const result = await repository.createManyUnordered([{ code: 'a' }], { by: null, session });
    expect(result.inserted[0]?.doc).toMatchObject({ createdBy: null, updatedBy: null });
    expect(insert.mock.calls[0]?.[1]).toMatchObject({ session });
  });

  it('an empty batch is no write at all', async () => {
    const insert = driverInsert(succeed);
    expect(await repository.createManyUnordered([], { by: null })).toEqual({
      inserted: [],
      duplicateIndexes: [],
    });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('createManyUnordered — a row a unique index refuses', () => {
  it('is reported by its INPUT index, and the rest of the batch stands', async () => {
    driverInsert(() => {
      throw bulkError([{ index: 1, code: 11000 }]);
    });
    const result = await repository.createManyUnordered(
      [{ code: 'a' }, { code: 'b' }, { code: 'c' }],
      { by: null },
    );
    expect(codesOf(result)).toEqual([
      [0, 'a'],
      [2, 'c'],
    ]);
    expect(result.duplicateIndexes).toEqual([1]);
  });

  it('several duplicates, all reported, ascending — none of them an error', async () => {
    driverInsert(() => {
      throw bulkError([
        { index: 0, code: 11000 },
        { index: 2, code: 11000 },
      ]);
    });
    const result = await repository.createManyUnordered(
      [{ code: 'a' }, { code: 'b' }, { code: 'c' }],
      { by: null },
    );
    expect(codesOf(result)).toEqual([[1, 'b']]);
    expect(result.duplicateIndexes).toEqual([0, 2]);
  });
});

describe('createManyUnordered — any other failure throws, naming what landed', () => {
  it('a validation failure: the driver never sees that row, and a duplicate after it keeps its INPUT index', async () => {
    // Row 0 fails validation, so the driver is sent rows 1, 2, 3 — and refuses its own index 1,
    // which is INPUT row 2. Reading the driver's index would blame row 1, which landed.
    const insert = driverInsert(() => {
      throw bulkError([{ index: 1, code: 11000 }]);
    });
    const error = await repository
      .createManyUnordered([{}, { code: 'b' }, { code: 'c' }, { code: 'd' }], { by: null })
      .catch((caught: unknown) => caught);

    expect(insert.mock.calls[0]?.[0]).toHaveLength(3);
    expect(error).toBeInstanceOf(PartialCreateError);
    const partial = error as PartialCreateError<RowDoc>;
    expect(codesOf(partial.result)).toEqual([
      [1, 'b'],
      [3, 'd'],
    ]);
    expect(partial.result.duplicateIndexes).toEqual([2]);
    // The caller rethrows what insertMany threw — here the driver's bulk error.
    expect((partial.cause as Error).name).toBe('MongoBulkWriteError');
  });

  it('a write error that is not a duplicate: the other rows are named, the error carried', async () => {
    driverInsert(() => {
      throw bulkError([{ index: 1, code: 121 }]);
    });
    const error = await repository
      .createManyUnordered([{ code: 'a' }, { code: 'b' }, { code: 'c' }], { by: null })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PartialCreateError);
    const partial = error as PartialCreateError<RowDoc>;
    expect(codesOf(partial.result)).toEqual([
      [0, 'a'],
      [2, 'c'],
    ]);
    expect(partial.result.duplicateIndexes).toEqual([]);
  });

  it('a validation failure alone: every valid row was written, the failure still thrown', async () => {
    // Without `throwOnValidationError` Mongoose would DROP row 1 and report success.
    driverInsert(succeed);
    const error = await repository
      .createManyUnordered([{ code: 'a' }, {}], { by: null })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PartialCreateError);
    const partial = error as PartialCreateError<RowDoc>;
    expect(codesOf(partial.result)).toEqual([[0, 'a']]);
    expect((partial.cause as Error).name).toBe('MongooseBulkWriteError');
  });

  it('every row invalid: nothing is sent, nothing claimed', async () => {
    const insert = driverInsert(succeed);
    const error = await repository
      .createManyUnordered([{}, {}], { by: null })
      .catch((caught: unknown) => caught);
    expect(insert).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(PartialCreateError);
    expect((error as PartialCreateError<RowDoc>).result).toEqual({
      inserted: [],
      duplicateIndexes: [],
    });
  });

  it('an error with no per-row verdict (the connection dropped) is rethrown as it is — no row claimed', async () => {
    const dropped = new Error('connection reset');
    driverInsert(() => {
      throw dropped;
    });
    await expect(
      repository.createManyUnordered([{ code: 'a' }, { code: 'b' }], { by: null }),
    ).rejects.toBe(dropped);
  });
});
