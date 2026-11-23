// «تعديل الجهاز» — «وضيف إمكانية تعديل الجهاز اللى عليه المستهلك بعد التسليم» (owner, 2026-11-17), and
// the memo «تتحدّث بالجهاز الجديد» — as the service decides it.
//
// With the data layer mocked (the issue spec's posture), what is pinned is the decision: the
// movement read within the store's read scope; only an issue has a device; a device named only
// within the caller's OWN asset grant — none at all without it — and never a disposed one; clearing
// needs no asset grant; the same device is answered with nothing written; a stale version is a
// conflict; the movement and its memo line change in ONE transaction, the line re-snapshotted from
// the register; and the two audit rows and the refresh signals follow the commit.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BusinessRuleError, NotFoundError, StaleDocumentError } from '../../../shared/errors';
import type * as MovementRepositoryModule from './consumable-movement.repository';

const mocks = vi.hoisted(() => ({
  unitOfWork: vi.fn(),
  audit: vi.fn(),
  publish: vi.fn(),
  findMovement: vi.fn(),
  setInstalledOn: vi.fn(),
  setMemoCounter: vi.fn(),
  setLineDevice: vi.fn(),
  findAsset: vi.fn(),
  reserve: vi.fn(),
  counterTimeline: vi.fn(),
}));

const ready = () => vi.fn(async () => undefined);

vi.mock('../../../platform/kernel/unit-of-work', () => ({ unitOfWork: mocks.unitOfWork }));
vi.mock('../shared/sequence', () => ({ reserveSequenceBlock: mocks.reserve }));
vi.mock('../../../platform/audit', () => ({ auditService: { record: mocks.audit } }));
vi.mock('../../../platform/realtime', () => ({ publishAuditedChange: mocks.publish }));
vi.mock('../assets/asset.repository', () => ({
  itAssetRepository: { findById: mocks.findAsset },
}));
vi.mock('./consumable.repository', () => ({
  itConsumableRepository: { ensureCollection: ready() },
}));
vi.mock('./consumable-movement.repository', async (importOriginal) => ({
  // The refusal's wording is the repository's own; only the data access is mocked.
  notAnIssue: (await importOriginal<typeof MovementRepositoryModule>()).notAnIssue,
  itConsumableMovementRepository: {
    findById: mocks.findMovement,
    setInstalledOn: mocks.setInstalledOn,
    setMemoCounterOnPrinter: mocks.setMemoCounter,
    counterTimelineSystem: mocks.counterTimeline,
    ensureCollection: ready(),
  },
}));
vi.mock('./consumable-memo.repository', () => ({
  itConsumableMemoRepository: { setLineDevice: mocks.setLineDevice, ensureCollection: ready() },
}));

const { itConsumableInstalledOnService } = await import('./consumable-installed-on.service');

const STORE = new Types.ObjectId();
const ITEM = new Types.ObjectId();
const MOVEMENT = new Types.ObjectId();
const MEMO = new Types.ObjectId();
const OLD_DEVICE = new Types.ObjectId();
const NEW_DEVICE = new Types.ObjectId();
/** The one transaction — so «inside it» is an assertion, not a hope. */
const SESSION = { transaction: 'the correction' };

const USER = String(new Types.ObjectId());
const ctx = { userId: USER, locale: 'en' } as never;
/** The STORE's read scope — what the movement is found within. */
const scope = { scope: 'branch', userId: USER, branchId: String(STORE) } as never;
/**
 * The ASSET register's scope — the caller's own `itAsset.view` — deliberately not the store's, so
 * «the device is read under the asset grant» is an assertion rather than a coincidence.
 */
const assetScope = { scope: 'organization', userId: USER, branchId: null } as never;

const movement = (over: Record<string, unknown> = {}) => ({
  _id: MOVEMENT,
  consumableId: ITEM,
  kind: 'issued',
  qty: 1,
  branchId: STORE,
  employeeId: new Types.ObjectId(),
  assetId: OLD_DEVICE,
  memoId: MEMO,
  __v: 0,
  ...over,
});

const device = (over: Record<string, unknown> = {}) => ({
  _id: NEW_DEVICE,
  assetCode: 'AST-00044',
  name: 'HP LaserJet 400',
  status: 'inStock',
  ...over,
});

/** The memo line as it read before the write — the old device, as the issue printed it. */
const printedLine = {
  movementId: MOVEMENT,
  assetId: OLD_DEVICE,
  assetCode: 'AST-00031',
  assetName: 'Lenovo ThinkCentre',
};

/** Whether the transaction had committed when each audit row was written. */
let committed = false;
const auditedWhileCommitted: boolean[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  committed = false;
  auditedWhileCommitted.length = 0;
  mocks.unitOfWork.mockImplementation(async (fn: (session: unknown) => Promise<unknown>) => {
    const result = await fn(SESSION);
    committed = true;
    return result;
  });
  mocks.audit.mockImplementation(async () => {
    auditedWhileCommitted.push(committed);
  });
  mocks.findMovement.mockResolvedValue(movement());
  mocks.findAsset.mockResolvedValue(device());
  mocks.setInstalledOn.mockImplementation(
    async (_id: string, assetId: Types.ObjectId | null, meta: { version: number }) =>
      movement({ assetId, __v: meta.version + 1 }),
  );
  mocks.setLineDevice.mockResolvedValue(printedLine);
  mocks.setMemoCounter.mockResolvedValue(undefined);
  mocks.reserve.mockResolvedValue(1);
  mocks.counterTimeline.mockResolvedValue([]);
});

const nothingWritten = () => {
  expect(mocks.unitOfWork).not.toHaveBeenCalled();
  expect(mocks.setInstalledOn).not.toHaveBeenCalled();
  expect(mocks.setMemoCounter).not.toHaveBeenCalled();
  expect(mocks.setLineDevice).not.toHaveBeenCalled();
  expect(mocks.audit).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
};

describe('changing the device', () => {
  it('moves the movement and its memo line together, in ONE transaction, the line re-snapshotted from the register', async () => {
    const updated = await itConsumableInstalledOnService.setInstalledOn(
      String(MOVEMENT),
      { assetId: String(NEW_DEVICE), version: 0 },
      ctx,
      scope,
      assetScope,
    );

    // The movement within the STORE's scope; the device within the ASSET grant's.
    expect(mocks.findMovement).toHaveBeenCalledWith(String(MOVEMENT), scope);
    expect(mocks.findAsset).toHaveBeenCalledWith(String(NEW_DEVICE), assetScope);

    expect(mocks.unitOfWork).toHaveBeenCalledTimes(1);
    expect(mocks.setInstalledOn).toHaveBeenCalledWith(String(MOVEMENT), NEW_DEVICE, {
      version: 0,
      // The device it named when read: the write's filter checks it, and keeps it as «before».
      previous: OLD_DEVICE,
      scope,
      by: USER,
      session: SESSION,
    });
    expect(mocks.setLineDevice).toHaveBeenCalledWith(
      MEMO,
      MOVEMENT,
      { assetId: NEW_DEVICE, assetCode: 'AST-00044', assetName: 'HP LaserJet 400' },
      { by: USER, session: SESSION },
    );
    expect(updated).toMatchObject({ assetId: NEW_DEVICE, __v: 1 });
  });

  it('records who changed it from which device to which — on the item and on the memo — after the commit', async () => {
    await itConsumableInstalledOnService.setInstalledOn(
      String(MOVEMENT),
      { assetId: String(NEW_DEVICE), version: 0 },
      ctx,
      scope,
      assetScope,
    );

    expect(auditedWhileCommitted).toEqual([true, true]);
    expect(mocks.audit).toHaveBeenNthCalledWith(1, {
      entityRef: { moduleId: 'it', entityType: 'consumable', entityId: String(ITEM) },
      action: 'update',
      changes: [
        { field: 'installedOn', old: String(OLD_DEVICE), new: String(NEW_DEVICE) },
        { field: 'movementId', old: null, new: String(MOVEMENT) },
      ],
    });
    expect(mocks.audit).toHaveBeenNthCalledWith(2, {
      entityRef: { moduleId: 'it', entityType: 'consumableMemo', entityId: String(MEMO) },
      action: 'update',
      changes: [
        {
          field: 'installedOn',
          old: {
            assetId: String(OLD_DEVICE),
            assetCode: 'AST-00031',
            assetName: 'Lenovo ThinkCentre',
          },
          new: {
            assetId: String(NEW_DEVICE),
            assetCode: 'AST-00044',
            assetName: 'HP LaserJet 400',
          },
        },
        { field: 'movementId', old: null, new: String(MOVEMENT) },
      ],
    });
  });

  it('refreshes the item’s and the memo’s screens WITH the store, so a branch-scoped reader reads again too', async () => {
    await itConsumableInstalledOnService.setInstalledOn(
      String(MOVEMENT),
      { assetId: String(NEW_DEVICE), version: 0 },
      ctx,
      scope,
      assetScope,
    );

    expect(mocks.publish).toHaveBeenCalledTimes(2);
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        entityRef: { moduleId: 'it', entityType: 'consumable', entityId: String(ITEM) },
        action: 'update',
        branchId: String(STORE),
      }),
    );
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        entityRef: { moduleId: 'it', entityType: 'consumableMemo', entityId: String(MEMO) },
        action: 'update',
        branchId: String(STORE),
      }),
    );
  });

  it('puts a device on an issue that had none', async () => {
    mocks.findMovement.mockResolvedValue(movement({ assetId: null }));
    mocks.setLineDevice.mockResolvedValue({
      movementId: MOVEMENT,
      assetId: null,
      assetCode: null,
      assetName: null,
    });

    await itConsumableInstalledOnService.setInstalledOn(
      String(MOVEMENT),
      { assetId: String(NEW_DEVICE), version: 0 },
      ctx,
      scope,
      assetScope,
    );

    expect(mocks.audit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        changes: expect.arrayContaining([
          { field: 'installedOn', old: null, new: String(NEW_DEVICE) },
        ]) as unknown,
      }),
    );
    expect(mocks.audit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        changes: expect.arrayContaining([
          expect.objectContaining({ field: 'installedOn', old: null }),
        ]) as unknown,
      }),
    );
  });
});

describe('clearing it — «بدون جهاز»', () => {
  it('clears the movement and the line’s three snapshot fields, and needs no asset grant', async () => {
    await itConsumableInstalledOnService.setInstalledOn(
      String(MOVEMENT),
      { assetId: null, version: 0 },
      ctx,
      scope,
      null,
    );

    // It names no device, so the register is not asked at all.
    expect(mocks.findAsset).not.toHaveBeenCalled();
    expect(mocks.setInstalledOn).toHaveBeenCalledWith(
      String(MOVEMENT),
      null,
      expect.objectContaining({ version: 0, previous: OLD_DEVICE, session: SESSION }),
    );
    expect(mocks.setLineDevice).toHaveBeenCalledWith(MEMO, MOVEMENT, null, {
      by: USER,
      session: SESSION,
    });
    expect(mocks.audit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        changes: [
          { field: 'installedOn', old: String(OLD_DEVICE), new: null },
          { field: 'movementId', old: null, new: String(MOVEMENT) },
        ],
      }),
    );
    expect(mocks.audit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        changes: expect.arrayContaining([
          expect.objectContaining({ field: 'installedOn', new: null }),
        ]) as unknown,
      }),
    );
  });
});

describe('the paper', () => {
  it('a movement whose memo is gone is still corrected — with no row on a memo that was not changed', async () => {
    // The workforce reset purges the papers and keeps the ledger.
    mocks.setLineDevice.mockResolvedValue(null);

    await itConsumableInstalledOnService.setInstalledOn(
      String(MOVEMENT),
      { assetId: String(NEW_DEVICE), version: 0 },
      ctx,
      scope,
      assetScope,
    );

    expect(mocks.setInstalledOn).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityRef: expect.objectContaining({ entityType: 'consumable' }) as unknown,
      }),
    );
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it('a movement that names no memo touches none', async () => {
    mocks.findMovement.mockResolvedValue(movement({ memoId: null }));

    await itConsumableInstalledOnService.setInstalledOn(
      String(MOVEMENT),
      { assetId: String(NEW_DEVICE), version: 0 },
      ctx,
      scope,
      assetScope,
    );

    expect(mocks.setInstalledOn).toHaveBeenCalledTimes(1);
    expect(mocks.setLineDevice).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });
});

describe('refused — nothing written', () => {
  it('a movement the caller cannot see, or a deleted one, is not found', async () => {
    mocks.findMovement.mockResolvedValue(null);
    await expect(
      itConsumableInstalledOnService.setInstalledOn(
        String(MOVEMENT),
        { assetId: String(NEW_DEVICE), version: 0 },
        ctx,
        scope,
        assetScope,
      ),
    ).rejects.toThrow(NotFoundError);
    nothingWritten();
  });

  it.each(['received', 'scrapped', 'returned', 'transferredOut', 'transferredIn'])(
    'only an issued unit sits in a device — a %s movement is refused',
    async (kind) => {
      mocks.findMovement.mockResolvedValue(movement({ kind, assetId: null, memoId: null }));
      const refusal = itConsumableInstalledOnService.setInstalledOn(
        String(MOVEMENT),
        { assetId: String(NEW_DEVICE), version: 0 },
        ctx,
        scope,
        assetScope,
      );
      await expect(refusal).rejects.toThrow(BusinessRuleError);
      await expect(refusal).rejects.toThrow(/only an issued movement/u);
      // Not even the device is looked up.
      expect(mocks.findAsset).not.toHaveBeenCalled();
      nothingWritten();
    },
  );

  it('even clearing is refused on a movement that is not an issue', async () => {
    mocks.findMovement.mockResolvedValue(movement({ kind: 'received', assetId: null }));
    await expect(
      itConsumableInstalledOnService.setInstalledOn(
        String(MOVEMENT),
        { assetId: null, version: 0 },
        ctx,
        scope,
        assetScope,
      ),
    ).rejects.toThrow(BusinessRuleError);
    nothingWritten();
  });

  it('without itAsset.view every device is «not found» — and the register is not asked', async () => {
    await expect(
      itConsumableInstalledOnService.setInstalledOn(
        String(MOVEMENT),
        { assetId: String(NEW_DEVICE), version: 0 },
        ctx,
        scope,
        null,
      ),
    ).rejects.toThrow(new NotFoundError('asset not found'));
    expect(mocks.findAsset).not.toHaveBeenCalled();
    nothingWritten();
  });

  it('a device outside the caller’s asset scope is «not found»', async () => {
    mocks.findAsset.mockResolvedValue(null);
    await expect(
      itConsumableInstalledOnService.setInstalledOn(
        String(MOVEMENT),
        { assetId: String(NEW_DEVICE), version: 0 },
        ctx,
        scope,
        assetScope,
      ),
    ).rejects.toThrow(new NotFoundError('asset not found'));
    nothingWritten();
  });

  it('even the device it already names is «not found» without the asset grant', async () => {
    await expect(
      itConsumableInstalledOnService.setInstalledOn(
        String(MOVEMENT),
        { assetId: String(OLD_DEVICE), version: 0 },
        ctx,
        scope,
        null,
      ),
    ).rejects.toThrow(NotFoundError);
    nothingWritten();
  });

  it('a disposed device takes nothing', async () => {
    mocks.findAsset.mockResolvedValue(device({ status: 'disposed' }));
    await expect(
      itConsumableInstalledOnService.setInstalledOn(
        String(MOVEMENT),
        { assetId: String(NEW_DEVICE), version: 0 },
        ctx,
        scope,
        assetScope,
      ),
    ).rejects.toThrow(/AST-00044 is disposed/u);
    nothingWritten();
  });

  it('a version somebody else moved on is a conflict, not an overwrite', async () => {
    mocks.findMovement.mockResolvedValue(movement({ __v: 2 }));
    await expect(
      itConsumableInstalledOnService.setInstalledOn(
        String(MOVEMENT),
        { assetId: String(NEW_DEVICE), version: 1 },
        ctx,
        scope,
        assetScope,
      ),
    ).rejects.toThrow(StaleDocumentError);
    nothingWritten();
  });

  it('a conflict found by the guarded write itself writes no audit row', async () => {
    // Somebody changed it between the read and the write: the write's own filter refuses it.
    mocks.setInstalledOn.mockRejectedValue(new StaleDocumentError());
    await expect(
      itConsumableInstalledOnService.setInstalledOn(
        String(MOVEMENT),
        { assetId: String(NEW_DEVICE), version: 0 },
        ctx,
        scope,
        assetScope,
      ),
    ).rejects.toThrow(StaleDocumentError);
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});

describe('the same device as now', () => {
  it('is answered with the movement as it is — nothing written, nothing audited', async () => {
    mocks.findAsset.mockResolvedValue(device({ _id: OLD_DEVICE }));
    const answer = await itConsumableInstalledOnService.setInstalledOn(
      String(MOVEMENT),
      // An upper-case copy of the id it already names is that id: compared as the register's id.
      { assetId: String(OLD_DEVICE).toUpperCase(), version: 0 },
      ctx,
      scope,
      assetScope,
    );
    expect(answer).toMatchObject({ _id: MOVEMENT, assetId: OLD_DEVICE });
    nothingWritten();
  });

  it('whatever version came with it — what was asked is what is', async () => {
    mocks.findAsset.mockResolvedValue(device({ _id: OLD_DEVICE }));
    mocks.findMovement.mockResolvedValue(movement({ __v: 5 }));
    const answer = await itConsumableInstalledOnService.setInstalledOn(
      String(MOVEMENT),
      { assetId: String(OLD_DEVICE), version: 0 },
      ctx,
      scope,
      assetScope,
    );
    expect(answer).toMatchObject({ assetId: OLD_DEVICE, __v: 5 });
    nothingWritten();
  });

  it('clearing what has no device writes nothing', async () => {
    mocks.findMovement.mockResolvedValue(movement({ assetId: null }));
    await itConsumableInstalledOnService.setInstalledOn(
      String(MOVEMENT),
      { assetId: null, version: 0 },
      ctx,
      scope,
      null,
    );
    nothingWritten();
  });

  it('a device disposed since it was installed is no reason to refuse leaving it as it is', async () => {
    mocks.findAsset.mockResolvedValue(device({ _id: OLD_DEVICE, status: 'disposed' }));
    await itConsumableInstalledOnService.setInstalledOn(
      String(MOVEMENT),
      { assetId: String(OLD_DEVICE), version: 0 },
      ctx,
      scope,
      assetScope,
    );
    nothingWritten();
  });

  it('an uncounted row writes no reading and takes no printer lock', async () => {
    await itConsumableInstalledOnService.setInstalledOn(
      String(MOVEMENT),
      { assetId: String(NEW_DEVICE), version: 0 },
      ctx,
      scope,
      assetScope,
    );
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.counterTimeline).not.toHaveBeenCalled();
    expect(mocks.setInstalledOn.mock.calls[0]?.[2]).not.toHaveProperty('counter');
    expect(mocks.setMemoCounter).not.toHaveBeenCalled();
  });
});

// «عداد الطابعة» (2026-11-19): on a counted issue the reading taken on the device is part of the one
// correctable fact — it moves with the device, is checked again where it lands, and leaves with it.
describe('a counted toner — the device and the reading taken on it', () => {
  const AT = new Date('2026-11-10T09:00:00.000Z');
  /** The toner issued onto the old printer at 15000. */
  const counted = (over: Record<string, unknown> = {}) =>
    movement({ at: AT, counterReading: 15000, ...over });
  /** A row on a printer's timeline, as the repository reads it. */
  const reading = (
    assetId: Types.ObjectId,
    at: string,
    counterReading: number,
    over: Record<string, unknown> = {},
  ) => ({
    _id: new Types.ObjectId(),
    consumableId: new Types.ObjectId(),
    assetId,
    at: new Date(at),
    memoId: new Types.ObjectId(),
    counterReading,
    ...over,
  });
  /** The row itself on the old printer's timeline. */
  const own = (over: Record<string, unknown> = {}) => ({
    _id: MOVEMENT,
    consumableId: ITEM,
    assetId: OLD_DEVICE,
    at: AT,
    memoId: MEMO,
    counterReading: 15000,
    ...over,
  });
  const change = (body: Record<string, unknown>, assets: ScopeLike = assetScope) =>
    itConsumableInstalledOnService.setInstalledOn(
      String(MOVEMENT),
      { assetId: String(NEW_DEVICE), version: 0, ...body } as never,
      ctx,
      scope,
      assets,
    );
  type ScopeLike = typeof assetScope | null;

  beforeEach(() => {
    mocks.findMovement.mockResolvedValue(counted());
    // The device named (under the asset grant), and the one it leaves (named as the ledger names
    // it, under the store's scope).
    mocks.findAsset.mockImplementation(async (assetId: string) =>
      assetId === String(OLD_DEVICE)
        ? device({ _id: OLD_DEVICE, assetCode: 'AST-00031', name: 'HP LaserJet 400' })
        : device(),
    );
  });

  it('a reading sent for a row recorded without one is refused — none is added afterwards', async () => {
    mocks.findMovement.mockResolvedValue(movement());
    await expect(change({ counterReading: 100 })).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      message: 'this issue was recorded without a counter reading; one is not added afterwards',
    });
    nothingWritten();
  });

  it('a device named with no reading is refused — a toner moves with the reading of its printer', async () => {
    await expect(change({})).rejects.toMatchObject({
      code: 'IT_CONSUMABLE_COUNTER_REQUIRED',
      httpStatus: 422,
      details: [{ field: 'counterReading', code: 'REQUIRED' }],
    });
    // Even on the device it already names: that is a correction, and it says what to.
    await expect(change({ assetId: String(OLD_DEVICE) })).rejects.toMatchObject({
      code: 'IT_CONSUMABLE_COUNTER_REQUIRED',
    });
    nothingWritten();
  });

  it('the same device with the same reading and reset writes nothing', async () => {
    await change({ assetId: String(OLD_DEVICE), counterReading: 15000 });
    await change({ assetId: String(OLD_DEVICE), counterReading: 15000, counterReset: false });
    nothingWritten();
  });

  it('moves it to another printer with that printer’s reading — both locked, the old checked, the new placed', async () => {
    mocks.counterTimeline.mockResolvedValue([
      reading(OLD_DEVICE, '2026-11-01T09:00:00.000Z', 9000),
      own(),
      reading(NEW_DEVICE, '2026-11-01T09:00:00.000Z', 30000),
    ]);
    await change({ counterReading: 31000 });

    expect(mocks.reserve).toHaveBeenCalledTimes(2);
    for (const printer of [OLD_DEVICE, NEW_DEVICE]) {
      expect(mocks.reserve).toHaveBeenCalledWith(`printerCounter:${String(printer)}`, 1, SESSION);
    }
    expect(mocks.counterTimeline).toHaveBeenCalledWith(
      expect.arrayContaining([OLD_DEVICE, NEW_DEVICE]),
      SESSION,
    );
    expect(mocks.setInstalledOn).toHaveBeenCalledWith(String(MOVEMENT), NEW_DEVICE, {
      version: 0,
      previous: OLD_DEVICE,
      scope,
      by: USER,
      session: SESSION,
      counter: { reading: 31000, reset: false },
    });
    // The paper's line follows the device.
    expect(mocks.setLineDevice).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenNthCalledWith(1, {
      entityRef: { moduleId: 'it', entityType: 'consumable', entityId: String(ITEM) },
      action: 'update',
      changes: [
        { field: 'installedOn', old: String(OLD_DEVICE), new: String(NEW_DEVICE) },
        { field: 'counterReading', old: 15000, new: 31000 },
        { field: 'movementId', old: null, new: String(MOVEMENT) },
      ],
    });
  });

  it('a reading the new printer’s timeline refuses is the placement’s refusal, on the field `counterReading`', async () => {
    mocks.counterTimeline.mockResolvedValue([
      own(),
      reading(NEW_DEVICE, '2026-11-01T09:00:00.000Z', 30000),
    ]);
    const refusal = change({ counterReading: 30000 });
    await expect(refusal).rejects.toMatchObject({
      code: 'IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS',
      details: [
        { field: 'counterReading', code: 'PREVIOUS_READING', message: '30000' },
        { field: 'counterReading', code: 'PREVIOUS_AT', message: '2026-11-01T09:00:00.000Z' },
      ],
    });
    await expect(refusal).rejects.toThrow(/AST-00044's last reading 30000/u);
    expect(mocks.setInstalledOn).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('backdated against a later reading on the new printer is refused', async () => {
    mocks.counterTimeline.mockResolvedValue([
      own(),
      reading(NEW_DEVICE, '2026-11-15T09:00:00.000Z', 30000),
    ]);
    await expect(change({ counterReading: 30500 })).rejects.toMatchObject({
      code: 'IT_CONSUMABLE_COUNTER_ABOVE_NEXT',
      details: [
        { field: 'counterReading', code: 'NEXT_READING', message: '30000' },
        { field: 'counterReading', code: 'NEXT_AT', message: '2026-11-15T09:00:00.000Z' },
      ],
    });
  });

  it('corrects the reading on the device it already names — placed without its own row, the paper untouched', async () => {
    mocks.counterTimeline.mockResolvedValue([
      reading(OLD_DEVICE, '2026-11-01T09:00:00.000Z', 9000),
      own(),
      reading(OLD_DEVICE, '2026-11-20T09:00:00.000Z', 20000),
    ]);
    await change({ assetId: String(OLD_DEVICE), counterReading: 15500 });

    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.setInstalledOn).toHaveBeenCalledWith(
      String(MOVEMENT),
      OLD_DEVICE,
      expect.objectContaining({ counter: { reading: 15500, reset: false } }),
    );
    // The paper carries no reading: its line and its trail are left as they are.
    expect(mocks.setLineDevice).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.audit.mock.calls[0]?.[0]).toMatchObject({
      changes: [
        { field: 'counterReading', old: 15000, new: 15500 },
        { field: 'movementId', old: null, new: String(MOVEMENT) },
      ],
    });
    // The item's screens still read again.
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it('a correction may make it a reset — recorded as such', async () => {
    mocks.counterTimeline.mockResolvedValue([
      reading(OLD_DEVICE, '2026-11-01T09:00:00.000Z', 90000),
      own(),
    ]);
    await change({ assetId: String(OLD_DEVICE), counterReading: 15000, counterReset: true });
    expect(mocks.audit.mock.calls[0]?.[0]).toMatchObject({
      changes: [
        { field: 'counterReset', old: false, new: true },
        { field: 'movementId', old: null, new: String(MOVEMENT) },
      ],
    });
  });

  it('a correction on a device disposed since is still possible — it corrects the past', async () => {
    mocks.findAsset.mockResolvedValue(
      device({ _id: OLD_DEVICE, assetCode: 'AST-00031', status: 'disposed' }),
    );
    await change({ assetId: String(OLD_DEVICE), counterReading: 15500 });
    expect(mocks.setInstalledOn).toHaveBeenCalledTimes(1);
  });

  it('«بدون جهاز» takes the reading off with the device — after checking it may leave', async () => {
    mocks.findMovement.mockResolvedValue(counted({ counterReset: true }));
    mocks.counterTimeline.mockResolvedValue([own({ counterReset: true })]);
    await itConsumableInstalledOnService.setInstalledOn(
      String(MOVEMENT),
      { assetId: null, version: 0 },
      ctx,
      scope,
      null,
    );
    expect(mocks.reserve).toHaveBeenCalledWith(`printerCounter:${String(OLD_DEVICE)}`, 1, SESSION);
    expect(mocks.setInstalledOn).toHaveBeenCalledWith(
      String(MOVEMENT),
      null,
      expect.objectContaining({ counter: { reading: null, reset: false } }),
    );
    expect(mocks.audit.mock.calls[0]?.[0]).toMatchObject({
      changes: [
        { field: 'installedOn', old: String(OLD_DEVICE), new: null },
        { field: 'counterReading', old: 15000, new: null },
        { field: 'counterReset', old: true, new: false },
        { field: 'movementId', old: null, new: String(MOVEMENT) },
      ],
    });
  });

  it('a reset the later readings rest on cannot leave its printer', async () => {
    mocks.findMovement.mockResolvedValue(counted({ counterReading: 10, counterReset: true }));
    mocks.counterTimeline.mockResolvedValue([
      reading(OLD_DEVICE, '2026-11-01T09:00:00.000Z', 90000),
      own({ counterReading: 10, counterReset: true }),
      reading(OLD_DEVICE, '2026-11-20T09:00:00.000Z', 900),
    ]);
    const refusal = itConsumableInstalledOnService.setInstalledOn(
      String(MOVEMENT),
      { assetId: null, version: 0 },
      ctx,
      scope,
      null,
    );
    await expect(refusal).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    await expect(refusal).rejects.toThrow(/starts AST-00031's counter again/u);
    expect(mocks.setInstalledOn).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('the reading rule follows the ROW: a counted row of a type unflagged since still moves with one', async () => {
    // The service never reads the type — the row's own reading decides.
    await expect(change({})).rejects.toMatchObject({ code: 'IT_CONSUMABLE_COUNTER_REQUIRED' });
  });

  // «One memo, one printer, one reading»: the lines of one memo on one printer are one display read
  // once — a write of the reading of one of them is a write of it on all of them.
  describe('one memo, one printer, one reading', () => {
    const CYAN = new Types.ObjectId();
    const MAGENTA = new Types.ObjectId();
    /** Another line of the SAME memo, at the same `at`, on `assetId`. */
    const sibling = (
      item: Types.ObjectId,
      assetId: Types.ObjectId,
      counterReading = 15000,
      over: Record<string, unknown> = {},
    ) => ({
      _id: new Types.ObjectId(),
      consumableId: item,
      assetId,
      at: AT,
      memoId: MEMO,
      counterReading,
      ...over,
    });

    it('a correction on the same printer writes its reading to every other row of the memo there — in the transaction, each audited and signalled', async () => {
      const cyan = sibling(CYAN, OLD_DEVICE);
      const magenta = sibling(MAGENTA, OLD_DEVICE);
      // Another memo's row at the same reading is no sibling: it is a neighbour.
      mocks.counterTimeline.mockResolvedValue([
        reading(OLD_DEVICE, '2026-11-01T09:00:00.000Z', 9000),
        own(),
        cyan,
        magenta,
        reading(OLD_DEVICE, '2026-11-20T09:00:00.000Z', 20000),
      ]);
      await change({ assetId: String(OLD_DEVICE), counterReading: 15500 });

      expect(mocks.reserve).toHaveBeenCalledTimes(1);
      expect(mocks.setMemoCounter).toHaveBeenCalledTimes(1);
      expect(mocks.setMemoCounter).toHaveBeenCalledWith(
        [cyan._id, magenta._id],
        { memoId: MEMO, assetId: OLD_DEVICE },
        { reading: 15500, reset: false },
        { by: USER, session: SESSION },
      );
      // After the row itself, inside the same transaction.
      expect(mocks.setInstalledOn.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.setMemoCounter.mock.invocationCallOrder[0] ?? 0,
      );
      expect(auditedWhileCommitted).toEqual([true, true, true]);
      expect(mocks.audit).toHaveBeenNthCalledWith(2, {
        entityRef: { moduleId: 'it', entityType: 'consumable', entityId: String(CYAN) },
        action: 'update',
        changes: [
          { field: 'counterReading', old: 15000, new: 15500 },
          { field: 'movementId', old: null, new: String(cyan._id) },
        ],
      });
      expect(mocks.audit).toHaveBeenNthCalledWith(3, {
        entityRef: { moduleId: 'it', entityType: 'consumable', entityId: String(MAGENTA) },
        action: 'update',
        changes: [
          { field: 'counterReading', old: 15000, new: 15500 },
          { field: 'movementId', old: null, new: String(magenta._id) },
        ],
      });
      // Each item's screens read again, with the store.
      expect(mocks.publish).toHaveBeenCalledTimes(3);
      for (const item of [ITEM, CYAN, MAGENTA]) {
        expect(mocks.publish).toHaveBeenCalledWith(
          expect.objectContaining({
            entityRef: { moduleId: 'it', entityType: 'consumable', entityId: String(item) },
            branchId: String(STORE),
          }),
        );
      }
    });

    it('a reset corrected in is a reset of the whole memo there — its rows audited for the reset alone', async () => {
      const cyan = sibling(CYAN, OLD_DEVICE);
      mocks.counterTimeline.mockResolvedValue([
        reading(OLD_DEVICE, '2026-11-01T09:00:00.000Z', 90000),
        own(),
        cyan,
      ]);
      await change({ assetId: String(OLD_DEVICE), counterReading: 15000, counterReset: true });
      expect(mocks.setMemoCounter).toHaveBeenCalledWith(
        [cyan._id],
        { memoId: MEMO, assetId: OLD_DEVICE },
        { reading: 15000, reset: true },
        expect.anything(),
      );
      expect(mocks.audit.mock.calls[1]?.[0]).toMatchObject({
        entityRef: { entityId: String(CYAN) },
        changes: [
          { field: 'counterReset', old: false, new: true },
          { field: 'movementId', old: null, new: String(cyan._id) },
        ],
      });
    });

    it('the placement is judged once, for the group — its rows are not its neighbours', async () => {
      // The other lines read 15000 at the same moment: no «equal to the last reading» against them.
      mocks.counterTimeline.mockResolvedValue([
        reading(OLD_DEVICE, '2026-11-01T09:00:00.000Z', 9000),
        own(),
        sibling(CYAN, OLD_DEVICE),
      ]);
      await change({ assetId: String(OLD_DEVICE), counterReading: 9500 });
      expect(mocks.setMemoCounter).toHaveBeenCalledTimes(1);
      // …and a reading the group cannot take is refused for all of them: none is written.
      vi.clearAllMocks();
      mocks.findMovement.mockResolvedValue(counted());
      mocks.counterTimeline.mockResolvedValue([
        reading(OLD_DEVICE, '2026-11-01T09:00:00.000Z', 9000),
        own(),
        sibling(CYAN, OLD_DEVICE),
      ]);
      await expect(
        change({ assetId: String(OLD_DEVICE), counterReading: 9000 }),
      ).rejects.toMatchObject({ code: 'IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS' });
      expect(mocks.setInstalledOn).not.toHaveBeenCalled();
      expect(mocks.setMemoCounter).not.toHaveBeenCalled();
    });

    it('a move onto the printer where a row of its memo sits rewrites that row to the reading typed', async () => {
      // The memo put cyan on the NEW printer at 30000; black moves there from the old one.
      const cyan = sibling(CYAN, NEW_DEVICE, 30000);
      const leftBehind = sibling(MAGENTA, OLD_DEVICE);
      mocks.counterTimeline.mockResolvedValue([own(), leftBehind, cyan]);
      await change({ counterReading: 31000 });

      expect(mocks.setMemoCounter).toHaveBeenCalledTimes(1);
      expect(mocks.setMemoCounter).toHaveBeenCalledWith(
        [cyan._id],
        { memoId: MEMO, assetId: NEW_DEVICE },
        { reading: 31000, reset: false },
        { by: USER, session: SESSION },
      );
      // The row left on the old printer keeps its reading — and is audited for nothing.
      expect(mocks.audit).toHaveBeenCalledTimes(3);
      expect(mocks.audit).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          entityRef: expect.objectContaining({ entityId: String(CYAN) }) as unknown,
          changes: [
            { field: 'counterReading', old: 30000, new: 31000 },
            { field: 'movementId', old: null, new: String(cyan._id) },
          ],
        }),
      );
      // The third is the memo's own row: the paper's line followed the device.
      expect(mocks.audit.mock.calls[2]?.[0]).toMatchObject({
        entityRef: { entityType: 'consumableMemo' },
      });
    });

    it('a move OFF a printer leaves the memo’s rows there as they are', async () => {
      const cyan = sibling(CYAN, OLD_DEVICE);
      mocks.counterTimeline.mockResolvedValue([own(), cyan]);
      await change({ counterReading: 31000 });
      await itConsumableInstalledOnService.setInstalledOn(
        String(MOVEMENT),
        { assetId: null, version: 0 },
        ctx,
        scope,
        null,
      );
      expect(mocks.setInstalledOn).toHaveBeenCalledTimes(2);
      expect(mocks.setMemoCounter).not.toHaveBeenCalled();
    });

    it('a row of the memo already at the reading is not written again', async () => {
      // One moment's rows agree — writing the same reading would only move their version on.
      mocks.counterTimeline.mockResolvedValue([own(), sibling(CYAN, NEW_DEVICE, 31000)]);
      await change({ counterReading: 31000 });
      expect(mocks.setMemoCounter).not.toHaveBeenCalled();
      expect(mocks.audit).toHaveBeenCalledTimes(2);
    });
  });
});
