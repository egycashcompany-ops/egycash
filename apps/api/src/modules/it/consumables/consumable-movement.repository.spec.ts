// The ledger's ONE correctable fact, pinned where it is enforced: in the FILTER of a single atomic
// update. «تعديل الجهاز» reaches the device of an ISSUED row at the version the caller read, within
// their scope — on a counted one with the reading taken on it, which reaches the other counted rows
// of its memo on that printer too (one memo, one printer, one reading) — and nothing else of any
// row: no quantity, no kind, no person, no memo. What is asserted
// is the shape of the write itself; whether MongoDB honours an atomic filter is not this
// codebase's claim to make, that this code hands it one is.
import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BusinessRuleError, NotFoundError, StaleDocumentError } from '../../../shared/errors';
import { ItConsumableMovementModel } from './consumable-movement.model';
import { itConsumableMovementRepository } from './consumable-movement.repository';

const ID = new Types.ObjectId();
const DEVICE = new Types.ObjectId();
const BEFORE = new Types.ObjectId();
const USER = String(new Types.ObjectId());
const BRANCH = String(new Types.ObjectId());
const SESSION = { transaction: 'the correction' } as never;
const scope = { scope: 'branch', userId: USER, branchId: BRANCH } as never;

/** `findOneAndUpdate(...).lean().exec()` answering `value`. */
const writes = (value: unknown) =>
  vi
    .spyOn(ItConsumableMovementModel, 'findOneAndUpdate')
    .mockReturnValue({ lean: () => ({ exec: async () => value }) } as never);

/** `findOne(...).session(s).lean().exec()` answering `value`, remembering the session it joined. */
const readsBack = (value: unknown) => {
  const joined: unknown[] = [];
  const spy = vi.spyOn(ItConsumableMovementModel, 'findOne').mockReturnValue({
    session: (session: unknown) => {
      joined.push(session);
      return { lean: () => ({ exec: async () => value }) };
    },
  } as never);
  return { spy, joined };
};

const set = (version = 3) =>
  itConsumableMovementRepository.setInstalledOn(String(ID), DEVICE, {
    version,
    previous: BEFORE,
    scope,
    by: USER,
    session: SESSION,
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the device an issued unit sits in', () => {
  it('asks for this id, its version, an issue, a live row and the caller’s store — in the same filter as the $set', async () => {
    const update = writes({ _id: ID, kind: 'issued', assetId: DEVICE, __v: 4 });

    const after = await set();

    expect(after).toMatchObject({ assetId: DEVICE, __v: 4 });
    const [filter, change, options] = update.mock.calls[0] ?? [];
    const text = JSON.stringify(filter);
    expect(text).toContain(`"_id":"${String(ID)}"`);
    expect(text).toContain('"__v":3');
    expect(text).toContain('"kind":"issued"');
    // …still naming the device they read: a change of it in between is somebody else's first.
    expect(text).toContain(`"assetId":"${String(BEFORE)}"`);
    expect(text).toContain('"isDeleted":false');
    // Scoped on the movement's store, as every read of the ledger is.
    expect(text).toContain(BRANCH);
    expect(options).toMatchObject({ new: true, session: SESSION });
    // The device and who changed it — nothing else of the row — the version moves on, and the
    // device it named before is kept for FR-5's delete guard.
    expect(change).toEqual({
      $set: { assetId: DEVICE, updatedBy: new Types.ObjectId(USER) },
      $inc: { __v: 1 },
      $addToSet: { installedOnBefore: BEFORE },
    });
  });

  it('clears it with null', async () => {
    const update = writes({ _id: ID, kind: 'issued', assetId: null, __v: 1 });
    await itConsumableMovementRepository.setInstalledOn(String(ID), null, {
      version: 0,
      previous: DEVICE,
      scope,
      by: USER,
      session: SESSION,
    });
    expect(update.mock.calls[0]?.[1]).toMatchObject({
      $set: { assetId: null },
      $addToSet: { installedOnBefore: DEVICE },
    });
  });

  it('a row that named no device has nothing to keep as «before»', async () => {
    const update = writes({ _id: ID, kind: 'issued', assetId: DEVICE, __v: 1 });
    await itConsumableMovementRepository.setInstalledOn(String(ID), DEVICE, {
      version: 0,
      previous: null,
      scope,
      by: USER,
      session: SESSION,
    });
    const [filter, change] = update.mock.calls[0] ?? [];
    expect(JSON.stringify(filter)).toContain('"assetId":null');
    expect(change).not.toHaveProperty('$addToSet');
  });

  // «عداد الطابعة» (2026-11-19) — on a counted issue the reading goes with the device, in the same
  // one write.
  it('sets the reading taken on the device it now names, and takes a reset off when it is none', async () => {
    const update = writes({ _id: ID, kind: 'issued', assetId: DEVICE, __v: 4 });
    await itConsumableMovementRepository.setInstalledOn(String(ID), DEVICE, {
      version: 3,
      previous: BEFORE,
      scope,
      by: USER,
      session: SESSION,
      counter: { reading: 31000, reset: false },
    });
    expect(update.mock.calls[0]?.[1]).toEqual({
      $set: { assetId: DEVICE, updatedBy: new Types.ObjectId(USER), counterReading: 31000 },
      $unset: { counterReset: '' },
      $inc: { __v: 1 },
      $addToSet: { installedOnBefore: BEFORE },
    });
  });

  it('sets a reset as true — present only when it is one', async () => {
    const update = writes({ _id: ID, kind: 'issued', assetId: DEVICE, __v: 4 });
    await itConsumableMovementRepository.setInstalledOn(String(ID), DEVICE, {
      version: 3,
      previous: BEFORE,
      scope,
      by: USER,
      session: SESSION,
      counter: { reading: 40, reset: true },
    });
    expect(update.mock.calls[0]?.[1]).toMatchObject({
      $set: { counterReading: 40, counterReset: true },
    });
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('$unset');
  });

  it('takes the reading off with the device («بدون جهاز»)', async () => {
    const update = writes({ _id: ID, kind: 'issued', assetId: null, __v: 1 });
    await itConsumableMovementRepository.setInstalledOn(String(ID), null, {
      version: 0,
      previous: DEVICE,
      scope,
      by: USER,
      session: SESSION,
      counter: { reading: null, reset: false },
    });
    expect(update.mock.calls[0]?.[1]).toMatchObject({
      $set: { assetId: null },
      $unset: { counterReading: '', counterReset: '' },
    });
  });

  it('a reading corrected on the device it already names keeps no «before»', async () => {
    const update = writes({ _id: ID, kind: 'issued', assetId: DEVICE, __v: 1 });
    await itConsumableMovementRepository.setInstalledOn(String(ID), DEVICE, {
      version: 0,
      previous: DEVICE,
      scope,
      by: USER,
      session: SESSION,
      counter: { reading: 15500, reset: false },
    });
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('$addToSet');
  });

  it('a miss read back in the same transaction: gone or out of scope is not found', async () => {
    writes(null);
    const { joined } = readsBack(null);
    await expect(set()).rejects.toThrow(NotFoundError);
    expect(joined).toEqual([SESSION]);
  });

  it('a miss on a row that is not an issue says so — retrying would not help', async () => {
    writes(null);
    readsBack({ _id: ID, kind: 'received', __v: 3 });
    const refusal = set();
    await expect(refusal).rejects.toThrow(BusinessRuleError);
    await expect(refusal).rejects.toThrow(/received/u);
  });

  it('a miss on an issue that is still there is somebody else’s change first', async () => {
    writes(null);
    readsBack({ _id: ID, kind: 'issued', __v: 4 });
    await expect(set()).rejects.toThrow(StaleDocumentError);
  });

  it('an id that is not one is not found, and nothing is asked', async () => {
    const update = writes(null);
    await expect(
      itConsumableMovementRepository.setInstalledOn('not-an-id', DEVICE, {
        version: 0,
        previous: null,
        scope,
        by: USER,
        session: SESSION,
      }),
    ).rejects.toThrow(NotFoundError);
    expect(update).not.toHaveBeenCalled();
  });
});

// «One memo, one printer, one reading» — the reading written on one counted row of a memo, written
// to the memo's other counted rows on that printer, and nothing else of them.
describe('the reading of a memo’s other rows on one printer', () => {
  const MEMO = new Types.ObjectId();
  const SIBLINGS = [new Types.ObjectId(), new Types.ObjectId()];

  /** `updateMany(...).exec()` answering `matchedCount`. */
  const writesMany = (matchedCount: number) =>
    vi
      .spyOn(ItConsumableMovementModel, 'updateMany')
      .mockReturnValue({ exec: async () => ({ matchedCount }) } as never);

  const write = (reset = false) =>
    itConsumableMovementRepository.setMemoCounterOnPrinter(
      SIBLINGS,
      { memoId: MEMO, assetId: DEVICE },
      { reading: 15500, reset },
      { by: USER, session: SESSION },
    );

  it('asks for these ids, of this memo, on this printer, counted issues, live — in the same filter as the $set', async () => {
    const update = writesMany(2);
    await write();
    const [filter, change, options] = update.mock.calls[0] ?? [];
    expect(filter).toEqual({
      kind: 'issued',
      counterReading: { $type: 'number' },
      isDeleted: false,
      _id: { $in: SIBLINGS },
      memoId: MEMO,
      assetId: DEVICE,
    });
    // The reading and who wrote it — nothing else of the rows — and each version moves on.
    expect(change).toEqual({
      $set: { counterReading: 15500, updatedBy: new Types.ObjectId(USER) },
      $unset: { counterReset: '' },
      $inc: { __v: 1 },
    });
    expect(options).toEqual({ session: SESSION });
  });

  it('sets a reset as true — present only when it is one', async () => {
    const update = writesMany(2);
    await write(true);
    expect(update.mock.calls[0]?.[1]).toEqual({
      $set: { counterReading: 15500, updatedBy: new Types.ObjectId(USER), counterReset: true },
      $inc: { __v: 1 },
    });
  });

  it('a row the filter no longer finds is somebody’s change first — 409', async () => {
    writesMany(1);
    await expect(write()).rejects.toThrow(StaleDocumentError);
  });

  it('no other row asks nothing', async () => {
    const update = writesMany(0);
    await itConsumableMovementRepository.setMemoCounterOnPrinter(
      [],
      { memoId: MEMO, assetId: DEVICE },
      { reading: 1, reset: false },
      { by: USER, session: SESSION },
    );
    expect(update).not.toHaveBeenCalled();
  });
});

describe('a printer’s counter timeline', () => {
  /** `find(...).select().sort().session().lean().exec()`, remembering each step. */
  const finds = () => {
    const seen: { filter?: unknown; select?: unknown; sort?: unknown; session?: unknown } = {};
    const chain = {
      select: (value: unknown) => {
        seen.select = value;
        return chain;
      },
      sort: (value: unknown) => {
        seen.sort = value;
        return chain;
      },
      session: (value: unknown) => {
        seen.session = value;
        return chain;
      },
      lean: () => ({ exec: async () => [] }),
    };
    vi.spyOn(ItConsumableMovementModel, 'find').mockImplementation(((filter: unknown) => {
      seen.filter = filter;
      return chain;
    }) as never);
    return seen;
  };

  it('reads every counted issue onto the printers — across every store, in order, in the transaction', async () => {
    const seen = finds();
    await itConsumableMovementRepository.counterTimelineSystem([DEVICE], SESSION);
    // Unscoped on purpose: no branch clause — a reading is the printer's, whichever store fed it.
    expect(seen.filter).toEqual({
      kind: 'issued',
      counterReading: { $type: 'number' },
      isDeleted: false,
      assetId: { $in: [DEVICE] },
    });
    expect(seen.sort).toEqual({ at: 1, _id: 1 });
    expect(seen.session).toBe(SESSION);
    expect(seen.select).toMatchObject({ counterReading: 1, counterReset: 1, memoId: 1, at: 1 });
  });

  it('asks nothing for no printer', async () => {
    const spy = vi.spyOn(ItConsumableMovementModel, 'find');
    expect(await itConsumableMovementRepository.counterTimelineSystem([])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('an item’s counted issues, in order', async () => {
    const seen = finds();
    await itConsumableMovementRepository.counterRowsOfItem(ID);
    expect(seen.filter).toEqual({
      kind: 'issued',
      counterReading: { $type: 'number' },
      isDeleted: false,
      consumableId: ID,
    });
    expect(seen.sort).toEqual({ at: 1, _id: 1 });
  });
});
