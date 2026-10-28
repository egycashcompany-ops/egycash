// The store's one stock write, pinned where it is enforced: in the FILTER of a single atomic
// update. Two people taking the last unit at once must not both succeed, and a read-then-write
// cannot promise that — so what is asserted is the shape of the write itself: the sufficiency and
// the active state are conditions of the same `findOneAndUpdate` as the `$inc`, and a miss is read
// back in the same transaction to say WHICH refusal it was. Whether MongoDB honours an atomic
// filter is not this codebase's claim to make; that this code hands it one is.
import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BusinessRuleError, NotFoundError } from '../../../shared/errors';
import { ItConsumableModel } from './consumable.model';
import { itConsumableRepository } from './consumable.repository';
import { stockEffect } from './consumable-stock';

const ID = new Types.ObjectId();
const USER = String(new Types.ObjectId());
const BRANCH = String(new Types.ObjectId());
const SESSION = { transaction: 'the issue' } as never;

const item = (over: Record<string, unknown> = {}) => ({
  _id: ID,
  code: 'CON-00007',
  onHandQty: 2,
  issuedQty: 0,
  scrappedQty: 0,
  active: true,
  ...over,
});

/** `findOneAndUpdate(...).lean().exec()` answering `value`. */
const writes = (value: unknown) =>
  vi
    .spyOn(ItConsumableModel, 'findOneAndUpdate')
    .mockReturnValue({ lean: () => ({ exec: async () => value }) } as never);

/** `findOne(...).session(s).lean().exec()` answering `value`, remembering the session it joined. */
const readsBack = (value: unknown) => {
  const joined: unknown[] = [];
  const spy = vi.spyOn(ItConsumableModel, 'findOne').mockReturnValue({
    session: (session: unknown) => {
      joined.push(session);
      return { lean: () => ({ exec: async () => value }) };
    },
  } as never);
  return { spy, joined };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('taking stock out', () => {
  it('asks for at least the quantity taken, and an active item, in the same filter as the $inc', async () => {
    const update = writes(item({ onHandQty: 0, issuedQty: 2, scrappedQty: 2 }));

    const after = await itConsumableRepository.moveStock(
      String(ID),
      stockEffect('issued', 2, 'replacement'),
      { session: SESSION, by: USER, activeFor: 'issue' },
    );

    const [filter, change, options] = update.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, Record<string, unknown>>,
      Record<string, unknown>,
    ];
    expect(filter).toEqual({
      $and: [{ isDeleted: false }, { _id: ID, onHandQty: { $gte: 2 }, active: true }],
    });
    // The replacement's damaged unit is scrap too — but on hand moves by the new unit alone.
    expect(change.$inc).toEqual({ onHandQty: -2, issuedQty: 2, scrappedQty: 2 });
    // No version bump: a movement touches none of the facts an edit form holds.
    expect(change.$inc).not.toHaveProperty('__v');
    expect(change.$set).toEqual({ updatedBy: new Types.ObjectId(USER) });
    expect(options).toMatchObject({ new: true, session: SESSION });
    expect(after.onHandQty).toBe(0);
  });

  it('scraps under the same guard, and a retired item may still be scrapped', async () => {
    const update = writes(item({ onHandQty: 1, scrappedQty: 1 }));
    await itConsumableRepository.moveStock(String(ID), stockEffect('scrapped', 1), {
      session: SESSION,
      by: USER,
    });
    const [filter] = update.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(filter).toEqual({ $and: [{ isDeleted: false }, { _id: ID, onHandQty: { $gte: 1 } }] });
  });

  it('reads the item back IN THE SAME TRANSACTION to say why it missed — not enough', async () => {
    writes(null);
    const { joined } = readsBack(item({ onHandQty: 1 }));

    const attempt = itConsumableRepository.moveStock(String(ID), stockEffect('issued', 2), {
      session: SESSION,
      by: USER,
      activeFor: 'issue',
    });

    await expect(attempt).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(attempt).rejects.toThrow('item CON-00007 has 1 on hand and cannot give 2');
    expect(joined).toEqual([SESSION]);
  });

  it('— retired', async () => {
    writes(null);
    readsBack(item({ active: false }));
    await expect(
      itConsumableRepository.moveStock(String(ID), stockEffect('issued', 1), {
        session: SESSION,
        by: USER,
        activeFor: 'issue',
      }),
    ).rejects.toThrow('item CON-00007 is inactive and cannot be issued');
  });

  it('— or not there at all, or not the caller’s to see: a 404', async () => {
    writes(null);
    readsBack(null);
    await expect(
      itConsumableRepository.moveStock(String(ID), stockEffect('scrapped', 1), {
        session: SESSION,
        by: USER,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      itConsumableRepository.moveStock('not-an-id', stockEffect('scrapped', 1), {
        session: SESSION,
        by: USER,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('putting stock in', () => {
  it('needs no quantity on hand — and a delivery is refused for a retired item', async () => {
    const update = writes(item({ onHandQty: 7 }));
    await itConsumableRepository.moveStock(String(ID), stockEffect('received', 5), {
      session: SESSION,
      by: USER,
      activeFor: 'receive',
    });
    const [filter, change] = update.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, Record<string, unknown>>,
    ];
    expect(filter).toEqual({ $and: [{ isDeleted: false }, { _id: ID, active: true }] });
    expect(change.$inc).toEqual({ onHandQty: 5, issuedQty: 0, scrappedQty: 0 });

    vi.restoreAllMocks();
    writes(null);
    readsBack(item({ active: false }));
    await expect(
      itConsumableRepository.moveStock(String(ID), stockEffect('received', 5), {
        session: SESSION,
        by: USER,
        activeFor: 'receive',
      }),
    ).rejects.toThrow('item CON-00007 is inactive and cannot receive stock');
  });

  it('takes a return back even for a retired item — the unit physically came back', async () => {
    const update = writes(item({ onHandQty: 3, active: false }));
    await itConsumableRepository.moveStock(String(ID), stockEffect('returned', 1), {
      session: SESSION,
      by: USER,
    });
    const [filter] = update.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(filter).toEqual({ $and: [{ isDeleted: false }, { _id: ID }] });
  });
});

describe('scope', () => {
  it('writes and reads back only within the stores the caller reaches', async () => {
    const update = writes(null);
    const { spy: read } = readsBack(null);
    const scope = {
      scope: 'branch' as const,
      userId: USER,
      branchId: BRANCH,
      departmentId: null,
      sectionId: null,
    };

    await expect(
      itConsumableRepository.moveStock(String(ID), stockEffect('scrapped', 1), {
        session: SESSION,
        by: USER,
        scope,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const store = { branchId: new Types.ObjectId(BRANCH) };
    expect(update.mock.calls[0]?.[0]).toEqual({
      $and: [{ isDeleted: false }, store, { _id: ID, onHandQty: { $gte: 1 } }],
    });
    expect(read.mock.calls[0]?.[0]).toEqual({ $and: [{ isDeleted: false }, store, { _id: ID }] });
  });
});
