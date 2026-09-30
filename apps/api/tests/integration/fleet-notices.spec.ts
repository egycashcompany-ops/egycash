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
