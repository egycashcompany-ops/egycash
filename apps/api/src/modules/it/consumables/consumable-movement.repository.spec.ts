// The ledger's ONE write, pinned where it is enforced: in the FILTER of a single atomic update.
// «تعديل الجهاز» reaches the device of an ISSUED row at the version the caller read, within their
// scope — and nothing else of any row: no quantity, no kind, no person, no memo. What is asserted
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
