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
  setLineDevice: vi.fn(),
  findAsset: vi.fn(),
}));

const ready = () => vi.fn(async () => undefined);

vi.mock('../../../platform/kernel/unit-of-work', () => ({ unitOfWork: mocks.unitOfWork }));
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
});

const nothingWritten = () => {
  expect(mocks.unitOfWork).not.toHaveBeenCalled();
  expect(mocks.setInstalledOn).not.toHaveBeenCalled();
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
});
