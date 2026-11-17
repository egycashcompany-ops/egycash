// A memo after «تعديل الجهاز» — «تتحدّث بالجهاز الجديد» (owner, 2026-11-17): the ONE line that is the
// movement gets the device re-snapshotted, so a reprint prints the new one, and nothing else of the
// paper moves — least of all the signed copy already filed. Pinned in the shape of the one atomic
// write that does it.
import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ItConsumableMemoModel } from './consumable-memo.model';
import { itConsumableMemoRepository } from './consumable-memo.repository';

const MEMO = new Types.ObjectId();
const MOVEMENT = new Types.ObjectId();
const OTHER_MOVEMENT = new Types.ObjectId();
const OLD_DEVICE = new Types.ObjectId();
const NEW_DEVICE = new Types.ObjectId();
const USER = String(new Types.ObjectId());
const SESSION = { transaction: 'the correction' } as never;

/** `findOneAndUpdate(...).lean().exec()` answering `value`. */
const writes = (value: unknown) =>
  vi
    .spyOn(ItConsumableMemoModel, 'findOneAndUpdate')
    .mockReturnValue({ lean: () => ({ exec: async () => value }) } as never);

/** The memo as it read before the write: two lines, the second the movement being changed. */
const before = {
  _id: MEMO,
  lines: [
    { movementId: OTHER_MOVEMENT, assetId: null, assetCode: null, assetName: null },
    {
      movementId: MOVEMENT,
      assetId: OLD_DEVICE,
      assetCode: 'AST-00031',
      assetName: 'Lenovo ThinkCentre',
    },
  ],
  signedCopy: { fileId: new Types.ObjectId() },
  __v: 2,
};

const device = { assetId: NEW_DEVICE, assetCode: 'AST-00044', assetName: 'HP LaserJet 400' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the memo line of a changed device', () => {
  it('finds the live memo by the line that is this movement, and sets that line’s three snapshot fields only', async () => {
    const update = writes(before);

    const line = await itConsumableMemoRepository.setLineDevice(MEMO, MOVEMENT, device, {
      by: USER,
      session: SESSION,
    });

    const [filter, change, options] = update.mock.calls[0] ?? [];
    const text = JSON.stringify(filter);
    expect(text).toContain(`"_id":"${String(MEMO)}"`);
    expect(text).toContain(`"lines.movementId":"${String(MOVEMENT)}"`);
    expect(text).toContain('"isDeleted":false');
    expect(change).toEqual({
      $set: {
        'lines.$.assetId': NEW_DEVICE,
        'lines.$.assetCode': 'AST-00044',
        'lines.$.assetName': 'HP LaserJet 400',
        updatedBy: new Types.ObjectId(USER),
      },
      $inc: { __v: 1 },
    });
    // The signed copy, the number, the signer and every other line are not in the write at all.
    expect(JSON.stringify(change)).not.toContain('signedCopy');
    expect(options).toMatchObject({ new: false, session: SESSION });
    // The line as the paper printed it before — the audit's «from».
    expect(line).toEqual(before.lines[1]);
  });

  it('clears all three when the device is taken off', async () => {
    const update = writes(before);
    await itConsumableMemoRepository.setLineDevice(MEMO, MOVEMENT, null, {
      by: USER,
      session: SESSION,
    });
    expect(update.mock.calls[0]?.[1]).toMatchObject({
      $set: { 'lines.$.assetId': null, 'lines.$.assetCode': null, 'lines.$.assetName': null },
    });
  });

  it('answers null when there is no such paper — the workforce reset purges the memos', async () => {
    writes(null);
    expect(
      await itConsumableMemoRepository.setLineDevice(MEMO, MOVEMENT, device, {
        by: USER,
        session: SESSION,
      }),
    ).toBeNull();
  });
});
