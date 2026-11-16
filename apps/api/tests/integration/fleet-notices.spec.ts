// The insurance notices (الإخطارات) against a real mongo — «ومش عاوز اى داتا اجبارى»: an empty
// notice saves, a filled one round-trips box for box, an edit is versioned, a delete is soft.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { CreateFleetNoticeSchema, ListFleetNoticesQuerySchema } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { FleetNoticeModel } from '../../src/modules/fleet/notices/notice.model';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { fleetNoticeService, toNoticeDto } from '../../src/modules/fleet/notices/notice.service';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const ACTOR = new Types.ObjectId().toString();

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

describe('an insurance notice', () => {
  it('saves with nothing filled in — no box is required', async () => {
    const input = CreateFleetNoticeSchema.parse({ template: 'misrInsurance' });
    const dto = toNoticeDto(await fleetNoticeService.create(input, ACTOR));
    expect(dto).toMatchObject({
      template: 'misrInsurance',
      values: {},
      checks: {},
      vehicleId: null,
    });
  });

  it('keeps every box it was given, drops the empty ones, and edits under a version', async () => {
    const vehicleId = new Types.ObjectId().toString();
    const created = await fleetNoticeService.create(
      CreateFleetNoticeSchema.parse({
        template: 'deltaInsurance',
        values: { driverName: 'حسين فهمى', plateNo: 'ن ص ط 3842', claimNo: '   ' },
        checks: { cause: ['تصادم'], police: [] },
        vehicleId,
      }),
      ACTOR,
    );
    expect(toNoticeDto(created)).toMatchObject({
      values: { driverName: 'حسين فهمى', plateNo: 'ن ص ط 3842' },
      checks: { cause: ['تصادم'] },
      vehicleId,
    });

    const id = String(created._id);
    const edited = await fleetNoticeService.update(
      id,
      { values: { driverName: 'منير على' }, version: created.__v },
      ACTOR,
    );
    expect(toNoticeDto(edited).values).toEqual({ driverName: 'منير على' });
    await expect(
      fleetNoticeService.update(id, { values: {}, version: created.__v }, ACTOR),
    ).rejects.toThrow();

    const listed = await fleetNoticeService.list({
      template: 'deltaInsurance',
      page: 1,
      pageSize: 50,
    } as never);
    expect(listed.items.map((doc) => String(doc._id))).toContain(id);

    await fleetNoticeService.remove(id, ACTOR);
    const after = await fleetNoticeService.list({
      template: 'deltaInsurance',
      page: 1,
      pageSize: 50,
    } as never);
    expect(after.items.map((doc) => String(doc._id))).not.toContain(id);
    // Soft: the row stays in the database.
    expect(await FleetNoticeModel.countDocuments({ _id: id, isDeleted: true }).exec()).toBe(1);
  });

  it('refuses a box name Mongo would read as an operator', () => {
    expect(
      CreateFleetNoticeSchema.safeParse({ template: 'misrInsurance', values: { $where: 'x' } })
        .success,
    ).toBe(false);
    expect(
      CreateFleetNoticeSchema.safeParse({ template: 'misrInsurance', values: { 'a.b': 'x' } })
        .success,
    ).toBe(false);
  });
});

describe('the notices table — number, date, «✓»', () => {
  it('keeps «رقم الإخطار» and its date, and an emptied number is no number', async () => {
    const created = await fleetNoticeService.create(
      CreateFleetNoticeSchema.parse({
        template: 'misrInsurance',
        noticeNumber: ' 4471 ',
        noticeDate: '2026-10-05',
      }),
      ACTOR,
    );
    const dto = toNoticeDto(await fleetNoticeService.get(String(created._id)));
    expect(dto).toMatchObject({
      noticeNumber: '4471',
      noticeImage: null,
      checkImage: null,
      completedAt: null,
      vehicleCode: null,
    });
    expect(dto.noticeDate?.slice(0, 10)).toBe('2026-10-05');

    const cleared = await fleetNoticeService.update(
      String(created._id),
      { noticeNumber: '  ', version: created.__v },
      ACTOR,
    );
    expect(cleared.noticeNumber).toBeNull();
  });

  it('refuses «✓» without the cheque scan, closes with it, and opens again', async () => {
    const created = await fleetNoticeService.create(
      CreateFleetNoticeSchema.parse({ template: 'misrInsurance' }),
      ACTOR,
    );
    const id = String(created._id);
    await expect(
      fleetNoticeService.setDone(id, { done: true, version: created.__v }, ACTOR),
    ).rejects.toMatchObject({ details: [{ code: 'CHECK_IMAGE_REQUIRED' }] });

    // The scan's link, as an upload would leave it.
    await FleetNoticeModel.updateOne(
      { _id: created._id },
      {
        $set: {
          checkImage: {
            fileId: new Types.ObjectId(),
            fileName: 'cheque.jpg',
            mime: 'image/jpeg',
            size: 1200,
            uploadedAt: new Date(),
          },
        },
      },
    );
    const closed = await fleetNoticeService.setDone(
      id,
      { done: true, version: created.__v },
      ACTOR,
    );
    expect(closed.completedAt).not.toBeNull();
    expect(toNoticeDto(closed).checkImage?.fileName).toBe('cheque.jpg');

    const reopened = await fleetNoticeService.setDone(
      id,
      { done: false, version: closed.__v },
      ACTOR,
    );
    expect(reopened.completedAt).toBeNull();
  });
});

describe('a form’s set-up («إعداد النماذج»)', () => {
  it('reads as empty before anyone set it up', async () => {
    const settings = await fleetNoticeService.getSettings('deltaInsurance');
    expect(settings).toEqual({
      template: 'deltaInsurance',
      defaults: {},
      links: [],
      numberField: null,
      dateField: null,
      version: null,
      updatedAt: null,
    });
  });

  it('keeps the defaults and the shared boxes, and drops a fixed default with no words', async () => {
    const first = await fleetNoticeService.saveSettings(
      'misrInsurance',
      {
        defaults: {
          insuredName: { mode: 'fixed', value: 'شركة إيجي كاش' },
          reportDate: { mode: 'today', value: '' },
          place: { mode: 'empty', value: '' },
          policyNo: { mode: 'fixed', value: '   ' },
        },
        links: [{ name: 'تاريخ الحادث', keys: ['accidentDate', 'date', 'date'] }],
      },
      ACTOR,
    );
    expect(first.defaults).toEqual({
      insuredName: { mode: 'fixed', value: 'شركة إيجي كاش' },
      reportDate: { mode: 'today', value: '' },
      place: { mode: 'empty', value: '' },
    });
    expect(first.links).toEqual([{ name: 'تاريخ الحادث', keys: ['accidentDate', 'date'] }]);
    expect(first.version).toBe(0);

    const second = await fleetNoticeService.saveSettings(
      'misrInsurance',
      { defaults: {}, links: [], version: first.version ?? 0 },
      ACTOR,
    );
    expect(second.defaults).toEqual({});
    await expect(
      fleetNoticeService.saveSettings(
        'misrInsurance',
        { defaults: {}, links: [], version: first.version ?? 0 },
        ACTOR,
      ),
    ).rejects.toThrow();
    expect((await fleetNoticeService.getSettings('misrInsurance')).version).toBe(second.version);
  });
});

describe('the notices table’s filters and figures', () => {
  it('narrows by number, date window, form, state and cheque, and counts what it leaves', async () => {
    const make = async (
      template: 'misrInsurance' | 'deltaInsurance',
      noticeNumber: string,
      noticeDate: string,
    ) =>
      fleetNoticeService.create(
        CreateFleetNoticeSchema.parse({ template, noticeNumber, noticeDate }),
        ACTOR,
      );
    const a = await make('misrInsurance', 'F-7101', '2026-08-30');
    const b = await make('deltaInsurance', 'F-7102', '2026-09-01');
    const c = await make('misrInsurance', 'F-7203', '2026-09-30');
    // Closed by hand — the filters read the stored state, not how it got there.
    await FleetNoticeModel.updateOne(
      { _id: c._id },
      {
        completedAt: new Date(),
        checkImage: {
          fileId: new Types.ObjectId(),
          fileName: 'c.jpg',
          mime: 'image/jpeg',
          size: 1,
          uploadedAt: new Date(),
        },
      },
    ).exec();
    const ids = async (query: Record<string, unknown>): Promise<string[]> =>
      (await fleetNoticeService.list({ page: 1, pageSize: 100, ...query } as never)).items.map(
        (doc) => String(doc._id),
      );

    expect(await ids({ noticeNumber: 'f-71' })).toEqual(
      expect.arrayContaining([String(a._id), String(b._id)]),
    );
    expect(await ids({ noticeNumber: 'f-71' })).not.toContain(String(c._id));
    // «من … إلى»: both days whole.
    const september = await ids({ from: new Date('2026-09-01'), to: new Date('2026-09-30') });
    expect(september).toEqual(expect.arrayContaining([String(b._id), String(c._id)]));
    expect(september).not.toContain(String(a._id));
    expect(await ids({ templates: ['deltaInsurance'], noticeNumber: 'F-7' })).toEqual([
      String(b._id),
    ]);
    expect(await ids({ status: 'done', noticeNumber: 'F-7' })).toEqual([String(c._id)]);
    expect(await ids({ checkImage: 'missing', noticeNumber: 'F-7' })).not.toContain(String(c._id));

    const figures = await fleetNoticeService.summary({ noticeNumber: 'F-7' } as never);
    expect(figures).toMatchObject({ total: 3, done: 1, open: 2, missingCheckImage: 2 });
    expect(figures.months).toEqual([
      { month: '2026-08', count: 1 },
      { month: '2026-09', count: 2 },
    ]);
    expect(figures.byTemplate).toEqual(
      expect.arrayContaining([
        { template: 'misrInsurance', count: 2 },
        { template: 'deltaInsurance', count: 1 },
      ]),
    );
    // No car and no driver on these: neither licence is on file.
    expect(figures.missingLicences).toBe(3);
    expect(toNoticeDto((await fleetNoticeService.get(String(a._id))) as never)).toMatchObject({
      vehicleLicense: null,
      driverLicense: null,
    });
  });

  it('keeps the boxes a form reads its number and date from', async () => {
    const saved = await fleetNoticeService.saveSettings(
      'deltaInsurance',
      { defaults: {}, links: [], numberField: 'claimNo', dateField: 'reportDate' },
      ACTOR,
    );
    expect(saved).toMatchObject({ numberField: 'claimNo', dateField: 'reportDate' });
    const cleared = await fleetNoticeService.saveSettings(
      'deltaInsurance',
      { defaults: {}, links: [], numberField: null, version: saved.version ?? 0 },
      ACTOR,
    );
    expect(cleared).toMatchObject({ numberField: null, dateField: null });
  });
});

describe('the notices table’s vehicle set — «النوع / التشغيل / الفرع» by the car’s CURRENT facts', () => {
  it('narrows the list and the figures alike; a notice with no car is in the plain list only', async () => {
    const B1 = new Types.ObjectId();
    const B2 = new Types.ObjectId();
    const T_ARMOURED = new Types.ObjectId();
    const T_VAN = new Types.ObjectId();
    const O_CASH = new Types.ObjectId();
    let n = 0;
    const car = async (
      branchId: Types.ObjectId,
      typeId: Types.ObjectId,
      operationId: Types.ObjectId | null,
      isDeleted = false,
    ) => {
      n += 1;
      const [doc] = await FleetVehicleModel.create([
        {
          code: `NS-${n}`,
          typeId,
          plateNumber: `ن س ${n}`,
          chassisNumber: `NSCH-${n}`,
          motorNumber: `NSMO-${n}`,
          joinedAt: new Date('2025-01-01T00:00:00.000Z'),
          licenseExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
          operationId,
          branchId,
          isDeleted,
          schemaVersion: 1,
          createdBy: null,
          updatedBy: null,
        },
      ]);
      return String(doc?._id);
    };
    const inB1 = await car(B1, T_ARMOURED, O_CASH);
    const inB2 = await car(B2, T_VAN, null);
    // Deleted from the registry since: its notice is still its history, in its branch's set.
    const goneB1 = await car(B1, T_VAN, O_CASH, true);

    const mark = 'VS-';
    const notice = async (vehicleId: string | null, i: number) =>
      fleetNoticeService.create(
        CreateFleetNoticeSchema.parse({
          template: 'misrInsurance',
          vehicleId,
          noticeNumber: `${mark}${i}`,
        }),
        ACTOR,
      );
    const onB1 = await notice(inB1, 1);
    const onB2 = await notice(inB2, 2);
    const onGone = await notice(goneB1, 3);
    const carless = await notice(null, 4);

    const ids = async (query: Record<string, unknown>): Promise<string[]> =>
      (
        await fleetNoticeService.list({
          page: 1,
          pageSize: 100,
          noticeNumber: mark,
          ...query,
        } as never)
      ).items
        .map((doc) => String(doc._id))
        .sort();
    const sorted = (...docs: { _id: unknown }[]) => docs.map((d) => String(d._id)).sort();
    const total = async (query: Record<string, unknown>) =>
      (await fleetNoticeService.summary({ noticeNumber: mark, ...query } as never)).total;

    // No set: every notice, the carless one included.
    expect(await ids({})).toEqual(sorted(onB1, onB2, onGone, carless));
    // The branch: its cars (the deleted one's history too); never the notice with no car.
    expect(await ids({ branchIds: [String(B1)] })).toEqual(sorted(onB1, onGone));
    expect(await total({ branchIds: [String(B1)] })).toBe(2);
    expect(await ids({ branchIds: [String(B1), String(B2)] })).toEqual(sorted(onB1, onB2, onGone));
    // A reach with no branch narrows to nothing.
    expect(await ids({ branchIds: [] })).toEqual([]);
    expect(await total({ branchIds: [] })).toBe(0);
    // The type, the operation, and all of them together (an intersection).
    expect(await ids({ typeIds: [String(T_VAN)] })).toEqual(sorted(onB2, onGone));
    expect(await total({ typeIds: [String(T_VAN)] })).toBe(2);
    expect(await ids({ operationIds: [String(O_CASH)] })).toEqual(sorted(onB1, onGone));
    expect(
      await ids({
        typeIds: [String(T_VAN)],
        operationIds: [String(O_CASH)],
        branchIds: [String(B1)],
      }),
    ).toEqual(sorted(onGone));
    // The codes and the set intersect: a code outside the branch narrows to nothing.
    expect(await ids({ vehicleCodes: ['NS-2'], branchIds: [String(B1)] })).toEqual([]);
    expect(await ids({ vehicleCodes: ['NS-2'] })).toEqual(sorted(onB2));
    // The dashboard's digest reads the same filter.
    const digest = await fleetNoticeService.dashboardDigest({
      noticeNumber: mark,
      branchIds: [String(B1)],
    } as never);
    expect(digest.open).toBe(2);
    expect(digest.rows.map((r) => r.noticeId).sort()).toEqual(sorted(onB1, onGone));
    // The schema the screen parses takes the three lists.
    expect(
      ListFleetNoticesQuerySchema.parse({ branchIds: `${String(B1)},${String(B2)}` }),
    ).toMatchObject({ branchIds: [String(B1), String(B2)] });
  });
});
