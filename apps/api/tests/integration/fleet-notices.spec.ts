// The insurance notices (الإخطارات) against a real mongo — «ومش عاوز اى داتا اجبارى»: an empty
// notice saves, a filled one round-trips box for box, an edit is versioned, a delete is soft.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { CreateFleetNoticeSchema } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { FleetNoticeModel } from '../../src/modules/fleet/notices/notice.model';
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
