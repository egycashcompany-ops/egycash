// The owner's fuel-card sheets, against a real mongo — «عاوز اضيف دول عندى فى شاشة البطاقات».
//
//   1. It WAITS for the cars: until both car runs are done it refuses, unclaimed.
//   2. The run puts each card on its car with its balance and password and no expiry, the travel
//      and spare cards on no car under their labels, and a card whose car is gone or whose slot is
//      taken on no car under its code — nothing left out.
//   3. The screen reads them: the label stands where the car code would, the password behind its
//      grant.
//   4. A later boot writes nothing at all.
//   5. The photos go on the cards of their numbers; a number no card has is listed, and a card
//      that already has a photo keeps it.
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { SettingKeys, platformPermissions } from '@ecms/contracts';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { fleetPermissions } from '../../src/modules/fleet/fleet.module';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { FleetFuelCardModel } from '../../src/modules/fleet/fuel-cards/fuel-card.model';
import { FleetGoLiveRunModel } from '../../src/modules/fleet/go-live/go-live-run.model';
import { FUEL_CARDS_FILE } from '../../src/modules/fleet/go-live/fuel-cards-import';
import {
  FUEL_CARDS_GO_LIVE_MARK,
  runFuelCardsGoLive,
} from '../../src/modules/fleet/go-live/fuel-cards';
import {
  FUEL_CARD_PHOTOS_DIR,
  FUEL_CARD_PHOTOS_GO_LIVE_MARK,
  runFuelCardPhotosGoLive,
} from '../../src/modules/fleet/go-live/fuel-card-photos';
import { VEHICLE_GO_LIVE_MARK } from '../../src/modules/fleet/go-live/vehicles';
import { VEHICLE_CHANGES_GO_LIVE_MARK } from '../../src/modules/fleet/go-live/vehicle-changes';
import { env } from '../../src/infrastructure/config/env';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
const HERE = dirname(fileURLToPath(import.meta.url));
/** A real card photo from the build, copied under the test's own numbers. */
const REAL_PHOTO = join(
  HERE,
  '..',
  '..',
  'assets',
  'fleet-go-live',
  FUEL_CARD_PHOTOS_DIR,
  '5485640006880021.jpg',
);
let replset: MongoMemoryReplSet | undefined;
let app: Express;
let adminToken = '';
let dataDir = '';
const car61 = new Types.ObjectId();
const car62 = new Types.ObjectId();

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const card = (over: Record<string, unknown>) => ({
  company: 'wataniya',
  name: 'EGYCASH-1',
  balance: 100,
  expiresAt: null,
  password: '0061',
  sheetCode: '61',
  vehicleCode: '61',
  label: null,
  ...over,
});

const SHEETS = {
  source: 'test',
  cards: [
    card({ number: '5485640000000001', balance: 2031.97, expiresAt: '2027-01-31' }),
    card({ number: '5485640000000002', company: 'chillout', password: null, balance: 0 }),
    card({ number: '5485640000000003', vehicleCode: null, label: 'سفر 1', sheetCode: 'سفر 1' }),
    card({ number: '5485640000000004', vehicleCode: null, label: 'سفر 2', sheetCode: 'سفر 2' }),
    // A car the registry no longer has.
    card({ number: '5485640000000005', vehicleCode: '999', sheetCode: '999' }),
    // Car 62 already holds a Wataniya card the clerk added by hand.
    card({ number: '5485640000000006', vehicleCode: '62', sheetCode: '62' }),
  ],
};

/**
 * A car as the step reads it: its code and id. Every physical identifier is unique among live cars
 * (`ux_plate`, `ux_chassis`, `ux_motor`), so each raw car carries its own — two with none collide.
 */
const rawCar = (code: string) => ({
  code,
  plateNumber: `س ص ${code}`,
  chassisNumber: `CH-FUEL-${code}`,
  motorNumber: `MO-FUEL-${code}`,
  status: 'active',
  isDeleted: false,
});

const run = async () =>
  FleetGoLiveRunModel.findOne({ key: FUEL_CARDS_GO_LIVE_MARK })
    .lean<{ status: string; outcome: Record<string, unknown> | null } | null>()
    .exec();

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions, ...fleetPermissions].map((p) => p.key),
  );
  const { user } = await userService.create(
    {
      email: env.SEED_ADMIN_EMAIL,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  const adminId = String(user._id);
  await userService.setPassword(adminId, PASSWORD, 'passwordReset');
  await userService.forceActivate(adminId);
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');
  const ctx: AuthContext = {
    userId: adminId,
    sessionId: 'seed',
    branchId: null,
    departmentId: null,
    sectionId: null,
    locale: 'en',
    permissions: { 'setting.edit': 'organization' },
    permissionVersion: 1,
    isPrivileged: true,
  };
  await settingsService.set(ctx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: env.SEED_ADMIN_EMAIL, password: PASSWORD });
  expect(login.status).toBe(200);
  adminToken = (login.body as { data: { accessToken: string } }).data.accessToken;

  // The step reads only a car's code and id — the cars are written raw, as the import left them.
  await FleetVehicleModel.collection.insertMany([
    { _id: car61, ...rawCar('61') },
    { _id: car62, ...rawCar('62') },
  ]);
  // Through the model, so it carries the timestamps and version the screen's DTO reads.
  await FleetFuelCardModel.create({
    vehicleId: car62,
    label: null,
    company: 'wataniya',
    name: 'by hand',
    number: '5485649999999999',
    expiresAt: new Date('2027-01-01'),
    password: null,
    balance: 0,
    isDeleted: false,
  });

  dataDir = await mkdtemp(join(tmpdir(), 'fuel-cards-'));
  await writeFile(join(dataDir, FUEL_CARDS_FILE), JSON.stringify(SHEETS));
  const photos = join(dataDir, FUEL_CARD_PHOTOS_DIR);
  await mkdir(photos);
  for (const number of ['5485640000000001', '5485640000000003', '5485640000000999']) {
    await copyFile(REAL_PHOTO, join(photos, `${number}.jpg`));
  }
}, 120_000);

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
  await disconnectMongo();
  await replset?.stop();
});

describe('the fuel-card sheets, as a boot step', () => {
  it('waits for the cars: refuses, unclaimed, while the car runs are not done', async () => {
    await runFuelCardsGoLive(dataDir);
    const refused = await run();
    expect(refused?.status).toBe('running');
    expect(refused?.outcome).toMatchObject({ reason: 'cars-not-imported', refused: true });
    expect(await FleetFuelCardModel.countDocuments({ number: /^548564000000000/u })).toBe(0);
  });

  it('puts every card in — on its car, or on no car under its label or code', async () => {
    const now = new Date();
    await FleetGoLiveRunModel.insertMany(
      [VEHICLE_GO_LIVE_MARK, VEHICLE_CHANGES_GO_LIVE_MARK].map((key) => ({
        key,
        status: 'done',
        leaseUntil: now,
        startedAt: now,
        finishedAt: now,
        outcome: null,
      })),
    );
    await runFuelCardsGoLive(dataDir);
    const done = await run();
    expect(done?.status).toBe('done');
    expect(done?.outcome).toMatchObject({
      rows: 6,
      created: 6,
      onNoCar: 4,
      alreadyThere: 0,
      unknownCodes: ['5485640000000005 — 999'],
      carTaken: ['5485640000000006 — 62'],
    });

    const list = await request(app)
      .get('/api/v1/fleet/fuel-cards')
      .query({ pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    type Row = {
      id: string;
      number: string;
      vehicleId: string | null;
      vehicleCode: string | null;
      label: string | null;
      company: string;
      balance: number;
      expiresAt: string | null;
      hasPassword: boolean;
    };
    const rows = (list.body as { data: Row[] }).data;
    const by = (number: string) => rows.find((row) => row.number === number) as Row;
    expect(by('5485640000000001')).toMatchObject({
      vehicleId: String(car61),
      vehicleCode: '61',
      label: null,
      company: 'wataniya',
      balance: 2031.97,
      expiresAt: '2027-01-31T00:00:00.000Z',
      hasPassword: true,
      image: null,
    });
    expect(by('5485640000000002')).toMatchObject({
      expiresAt: null,
      vehicleCode: '61',
      company: 'chillout',
      hasPassword: false,
    });
    for (const [number, label] of [
      ['5485640000000003', 'سفر 1'],
      ['5485640000000004', 'سفر 2'],
      ['5485640000000005', '999'],
      ['5485640000000006', '62'],
    ] as const) {
      expect(by(number), number).toMatchObject({ vehicleId: null, vehicleCode: null, label });
    }

    const secret = await request(app)
      .get(`/api/v1/fleet/fuel-cards/${by('5485640000000001').id}/password`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((secret.body as { data: { password: string } }).data.password).toBe('0061');
  });

  it('a later boot writes nothing', async () => {
    const before = await FleetFuelCardModel.countDocuments({});
    await runFuelCardsGoLive(dataDir);
    expect(await FleetFuelCardModel.countDocuments({})).toBe(before);
  });
});

describe('the card photos, as a boot step', () => {
  const imageOf = async (number: string) =>
    await FleetFuelCardModel.findOne({ number, isDeleted: false })
      .lean<{ _id: Types.ObjectId; image: { fileName: string } | null }>()
      .exec();

  it('puts each photo on the card of its number, lists a stranger, and serves the bytes', async () => {
    await runFuelCardPhotosGoLive(dataDir);
    const done = await FleetGoLiveRunModel.findOne({ key: FUEL_CARD_PHOTOS_GO_LIVE_MARK })
      .lean<{ status: string; outcome: Record<string, unknown> | null }>()
      .exec();
    expect(done?.status).toBe('done');
    expect(done?.outcome).toMatchObject({
      attached: 2,
      kept: 0,
      unmatched: ['5485640000000999.jpg'],
    });
    const first = await imageOf('5485640000000001');
    expect(first?.image?.fileName).toBe('5485640000000001.jpg');
    expect((await imageOf('5485640000000002'))?.image ?? null).toBeNull();

    const bytes = await request(app)
      .get(`/api/v1/fleet/fuel-cards/${String(first?._id)}/image`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(bytes.status).toBe(200);
    expect(bytes.headers['content-type']).toContain('image/jpeg');

    const listed = await request(app)
      .get(`/api/v1/fleet/fuel-cards/${String(first?._id)}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((listed.body as { data: { image: { fileName: string } } }).data.image.fileName).toBe(
      '5485640000000001.jpg',
    );
  });

  it('the clerk replaces and deletes it from the card', async () => {
    const card = await imageOf('5485640000000003');
    const id = String(card?._id);
    const replaced = await request(app)
      .post(`/api/v1/fleet/fuel-cards/${id}/image`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', REAL_PHOTO, { filename: 'new.jpg', contentType: 'image/jpeg' });
    expect(replaced.status).toBe(200);
    expect((replaced.body as { data: { image: { fileName: string } } }).data.image.fileName).toBe(
      'new.jpg',
    );
    const removed = await request(app)
      .delete(`/api/v1/fleet/fuel-cards/${id}/image`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(removed.status).toBe(200);
    expect((removed.body as { data: { image: null } }).data.image).toBeNull();
  });
});

describe('a card on no car, through the API', () => {
  const post = (body: Record<string, unknown>) =>
    request(app)
      .post('/api/v1/fleet/fuel-cards')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ company: 'wataniya', name: 'EGYCASH', expiresAt: null, ...body });

  it('needs a label; several of one company may sit on no car; the expiry may wait', async () => {
    expect((await post({ vehicleId: null, number: '5485641111111111' })).status).toBe(400);
    const one = await post({ vehicleId: null, label: 'سفر 9', number: '5485641111111112' });
    expect(one.status).toBe(201);
    expect((one.body as { data: { label: string; expiresAt: null } }).data).toMatchObject({
      label: 'سفر 9',
      expiresAt: null,
    });
    const two = await post({ vehicleId: null, label: 'سفر 10', number: '5485641111111113' });
    expect(two.status).toBe(201);
  });

  it('moved onto a car it drops its label; moved off one it must be given a label', async () => {
    const res = await post({ vehicleId: null, label: 'اسبير 2', number: '5485641111111114' });
    const created = (res.body as { data: { id: string; version: number } }).data;
    const third = new Types.ObjectId();
    await FleetVehicleModel.collection.insertOne({
      _id: third,
      ...rawCar('63'),
    });
    const onCar = await request(app)
      .patch(`/api/v1/fleet/fuel-cards/${created.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleId: String(third), version: created.version });
    expect(onCar.status).toBe(200);
    const moved = (onCar.body as { data: { label: null; vehicleCode: string; version: number } })
      .data;
    expect(moved).toMatchObject({ label: null, vehicleCode: '63' });
    const offWithout = await request(app)
      .patch(`/api/v1/fleet/fuel-cards/${created.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleId: null, version: moved.version });
    expect(offWithout.status).toBe(400);
  });
});
