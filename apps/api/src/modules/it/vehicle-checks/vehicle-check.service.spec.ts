// The vehicle checks dashboard's live refresh — «الـ Dashboard … هتبقي عند الـ IT».
//
// With the data layer mocked, what is pinned is the signal each change sends: a report filed (new,
// not a repeat), a photo added (not one already there) and a report deleted each publish ONE
// `update` on the report's topic WITH its branch, after its audit row. The audit row's own
// announcement carries no branch and reaches the organization-wide room only, so without this
// signal a branch-scoped `itVehicleCheck.view` reader is never told; a report with no branch is for
// organization-wide readers alone, and its signal names none.
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IT_VEHICLE_CHECK_ITEMS,
  cairoYmd,
  ymdToUtcDate,
  type CreateItVehicleCheck,
} from '@ecms/contracts';
import { type AuthContext, type ScopeSelector } from '../../../shared/types';
import { type ItVehicleCheckDoc } from './vehicle-check.model';

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  publish: vi.fn(),
  upload: vi.fn(),
  softDeleteFile: vi.fn(),
  findVehicle: vi.fn(),
  findByClientRequestId: vi.fn(),
  create: vi.fn(),
  findOwnLive: vi.fn(),
  pushPhoto: vi.fn(),
  findById: vi.fn(),
  softDeleteById: vi.fn(),
}));

vi.mock('../../../platform/audit', () => ({ auditService: { record: mocks.audit } }));
vi.mock('../../../platform/realtime', () => ({ publishAuditedChange: mocks.publish }));
vi.mock('../../../platform/files', () => ({
  fileService: { upload: mocks.upload, softDelete: mocks.softDeleteFile },
}));
vi.mock('../fleet-boundary', () => ({
  findVehicleForCheck: mocks.findVehicle,
  listActiveVehicleCodes: vi.fn(),
  listActiveVehiclesForCheckBoard: vi.fn(),
}));
vi.mock('../it.mappers', () => ({ toItVehicleCheckLatestDto: vi.fn() }));
vi.mock('./vehicle-check-files', () => ({
  vehicleCheckPhotoCategory: vi.fn(async () => 'category-1'),
}));
vi.mock('./vehicle-check.repository', () => ({
  itVehicleCheckRepository: {
    ensureCollection: vi.fn(async () => undefined),
    findByClientRequestId: mocks.findByClientRequestId,
    create: mocks.create,
    findOwnLive: mocks.findOwnLive,
    pushPhoto: mocks.pushPhoto,
    findById: mocks.findById,
    softDeleteById: mocks.softDeleteById,
  },
}));

const { itVehicleCheckService, signalVehicleCheck } = await import('./vehicle-check.service');

const REPORTER = String(new Types.ObjectId());
const BRANCH = new Types.ObjectId();
const CAR = String(new Types.ObjectId());

const ctx = {
  userId: REPORTER,
  locale: 'ar',
  identity: { displayName: { ar: 'سامح نبيل', en: 'Sameh Nabil' } },
} as unknown as AuthContext;

const ORG: ScopeSelector = {
  scope: 'organization',
  userId: REPORTER,
  branchId: null,
  departmentId: null,
  sectionId: null,
};

const allWorking = () =>
  Object.fromEntries(IT_VEHICLE_CHECK_ITEMS.map((item) => [item, 'works'])) as NonNullable<
    CreateItVehicleCheck['items']
  >;

/** A live report as the repository returns it, on branch B unless said otherwise. */
const report = (over: Partial<ItVehicleCheckDoc> = {}): ItVehicleCheckDoc =>
  ({
    _id: new Types.ObjectId(),
    vehicleId: new Types.ObjectId(CAR),
    vehicleCode: '301',
    branchId: BRANCH,
    checkDate: ymdToUtcDate(cairoYmd(new Date())),
    items: allWorking(),
    photos: [],
    reportedByUserId: new Types.ObjectId(REPORTER),
    reportedByName: 'سامح نبيل',
    clientRequestId: randomUUID(),
    createdBy: new Types.ObjectId(REPORTER),
    createdAt: new Date(),
    isDeleted: false,
    ...over,
  }) as unknown as ItVehicleCheckDoc;

const filing = (): CreateItVehicleCheck => ({
  vehicleId: CAR,
  checkDate: cairoYmd(new Date()),
  items: allWorking(),
  clientRequestId: randomUUID(),
});

/** The one signal the dashboard's topic expects for `doc`. */
const signalOf = (doc: ItVehicleCheckDoc) => ({
  entityRef: { moduleId: 'it', entityType: 'vehicleCheck', entityId: String(doc._id) },
  action: 'update',
  at: expect.any(String) as unknown as string,
  branchId: doc.branchId === null ? null : String(doc.branchId),
});

/** The signal went out once, and after the audit row that records the change. */
const expectSignalledAfterAudit = (doc: ItVehicleCheckDoc): void => {
  expect(mocks.publish).toHaveBeenCalledTimes(1);
  expect(mocks.publish).toHaveBeenCalledWith(signalOf(doc));
  expect(mocks.audit).toHaveBeenCalledTimes(1);
  expect(mocks.publish.mock.invocationCallOrder[0]).toBeGreaterThan(
    mocks.audit.mock.invocationCallOrder[0] ?? Infinity,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.audit.mockResolvedValue(undefined);
  mocks.findVehicle.mockResolvedValue({
    id: CAR,
    code: '301',
    branchId: String(BRANCH),
    status: 'active',
  });
  mocks.findByClientRequestId.mockResolvedValue(null);
});

describe('the dashboard’s signal', () => {
  it('names the report’s branch, so a branch-scoped reader’s room hears it — and none when it has none', () => {
    const onBranch = report();
    signalVehicleCheck(onBranch);
    expect(mocks.publish).toHaveBeenLastCalledWith(signalOf(onBranch));
    expect(mocks.publish.mock.lastCall?.[0]).toMatchObject({ branchId: String(BRANCH) });

    const noBranch = report({ branchId: null });
    signalVehicleCheck(noBranch);
    expect(mocks.publish.mock.lastCall?.[0]).toMatchObject({ branchId: null });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('goes out when a report is filed — once, after its audit row — and not for a repeated send', async () => {
    const filed = report();
    mocks.create.mockResolvedValue(filed);
    const answer = await itVehicleCheckService.file(filing(), ctx);
    expect(answer.created).toBe(true);
    expectSignalledAfterAudit(filed);

    // The same request id again: the report it already filed, nothing new to show.
    vi.clearAllMocks();
    mocks.findByClientRequestId.mockResolvedValue(filed);
    const repeat = await itVehicleCheckService.file(
      { ...filing(), clientRequestId: filed.clientRequestId },
      ctx,
    );
    expect(repeat.created).toBe(false);
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('carries no branch for a report on a car with none', async () => {
    mocks.findVehicle.mockResolvedValue({ id: CAR, code: '301', branchId: null, status: 'active' });
    const filed = report({ branchId: null });
    mocks.create.mockResolvedValue(filed);
    await itVehicleCheckService.file(filing(), ctx);
    expectSignalledAfterAudit(filed);
  });

  it('goes out when a photo is added — and not when that photo is already on the report', async () => {
    const before = report();
    const clientPhotoId = randomUUID();
    const fileId = new Types.ObjectId();
    const after = report({
      _id: before._id,
      photos: [
        {
          clientPhotoId,
          fileId,
          fileName: 'p.jpg',
          mime: 'image/jpeg',
          size: 10,
          uploadedAt: new Date(),
        },
      ],
    } as Partial<ItVehicleCheckDoc>);
    mocks.findOwnLive.mockResolvedValue(before);
    mocks.upload.mockResolvedValue({
      _id: fileId,
      originalName: 'p.jpg',
      mime: 'image/jpeg',
      size: 10,
    });
    mocks.pushPhoto.mockResolvedValue(after);
    const binary = { buffer: Buffer.from('x'), originalName: 'p.jpg', mime: 'image/jpeg' };
    await itVehicleCheckService.addPhoto(ctx, String(before._id), clientPhotoId, binary as never);
    expectSignalledAfterAudit(after);

    // The same photo sent again: already there, nothing stored, nothing announced.
    vi.clearAllMocks();
    mocks.findOwnLive.mockResolvedValue(after);
    await itVehicleCheckService.addPhoto(ctx, String(before._id), clientPhotoId, binary as never);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('goes out when a report is deleted, with the branch it was filed under', async () => {
    const doomed = report();
    mocks.findById.mockResolvedValue(doomed);
    mocks.softDeleteById.mockResolvedValue(true);
    await itVehicleCheckService.remove(String(doomed._id), ctx, ORG);
    expect(mocks.softDeleteById).toHaveBeenCalledTimes(1);
    expectSignalledAfterAudit(doomed);
  });
});
