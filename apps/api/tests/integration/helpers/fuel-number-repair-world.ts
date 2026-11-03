// The world of «تصحيح أرقام الكروت» (6d) against a real mongo: the definition's 19 cars, its 17
// Wataniya records exactly as the go-live left them («before»), and their neighbours the repair must
// never touch — a Chill Out card on cars 232 and 239, the Chill Out card ending 2516 on car 215, and
// the two Wataniya travel cards whose names differ from two of the 17 only by an «S».
//
// PINs are FAKE and distinctive (`P-239x` …, never four digits), so a leak anywhere is unambiguous;
// photos are go-live-like image sub-documents (`<number>.jpg`, the asset's byte size) with a fake
// file id — no bytes are uploaded. Each test starts from this world (`resetRepairWorld`).
import type request from 'supertest';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { type Express } from 'express';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { bootPlatform } from '../../../src/platform/kernel/bootstrap';
import { buildApp } from '../../../src/app';
import { moduleManifests } from '../../../src/modules';
import { rbacService } from '../../../src/platform/rbac';
import { authService } from '../../../src/platform/auth';
import { userService } from '../../../src/platform/users';
import { getCache } from '../../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../../src/infrastructure/database/mongo';
import { AuditLogModel } from '../../../src/platform/audit/audit.model';
import { FleetVehicleModel } from '../../../src/modules/fleet/vehicles/vehicle.model';
import {
  FleetFuelCardModel,
  FleetFuelCardMovementModel,
  type FleetFuelCardDoc,
} from '../../../src/modules/fleet/fuel-cards/fuel-card.model';
import { FleetFuelReconciliationModel } from '../../../src/modules/fleet/fuel-cards/reconcile/fuel-reconcile.model';
import {
  REPAIR_CARS,
  REPAIR_PAIR,
  REPAIR_RECORDS,
  type RepairCardFacts,
} from '../../../src/modules/fleet/fuel-cards/number-repair/number-repair-definition';

export const CARDS = '/api/v1/fleet/fuel-cards';
export const REPAIR = `${CARDS}/number-repair`;
let replSet: MongoMemoryReplSet | null = null;
let actor = '';

export const world = {
  app: undefined as unknown as Express,
  tokens: {
    /** No `fleetFuelCard.view`. */
    stranger: '',
    viewer: '',
    editor: '',
    approver: '',
    /** view + edit + approve — may execute. */
    executor: '',
    revealer: '',
    /** view + the platform's file grants — the Files endpoints, without the reveal grant. */
    filesViewer: '',
    /** Everything the reconciliation and the photos need, too. */
    boss: '',
  },
  /** Car code → registry id. */
  vehicles: new Map<string, Types.ObjectId>(),
};

export const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
export const failure = (res: request.Response) =>
  (
    res.body as {
      error: { code: string; details?: { field: string; code: string; message: string }[] };
    }
  ).error;
export const auth = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];

/** The fake PIN stored with each go-live number that has one — distinctive, never four digits. */
export const pinOf = (number: string): string => `P-${number.slice(-6)}x`;
/** Every fake PIN of the world — none may appear in any answer, line, audit or log. */
export const ALL_PINS: string[] = [];

/** Each number's go-live facts — its expiry, PIN yes/no and photo size. */
const FACTS = new Map<string, RepairCardFacts>([
  ...REPAIR_RECORDS.map((r) => [r.before.number, r.before] as const),
  ...REPAIR_PAIR.map(
    (p) =>
      [
        p.number,
        { number: p.number, expiresAt: p.expiresAt, hasPin: p.hasPin, photoBytes: p.photoBytes },
      ] as const,
  ),
]);
for (const facts of FACTS.values()) if (facts.hasPin) ALL_PINS.push(pinOf(facts.number));

/** A fake Files id per number — stable across the file, so a moved photo is recognisable. */
export const photoIdOf = new Map(
  [...FACTS.keys()].map((number) => [number, new Types.ObjectId()] as const),
);

/** The card document a number's go-live card is — on `car`, under `name`. */
export const goLiveCard = (number: string, car: string, name: string, balance: number) => {
  const facts = FACTS.get(number) as RepairCardFacts;
  return {
    vehicleId: world.vehicles.get(car) ?? null,
    label: null,
    company: 'wataniya' as const,
    name,
    number,
    expiresAt: new Date(`${facts.expiresAt}T00:00:00.000Z`),
    password: facts.hasPin ? pinOf(number) : null,
    balance,
    requestedAmount: null,
    requestedAt: null,
    lastChargedAt: null,
    image: {
      fileId: photoIdOf.get(number) as Types.ObjectId,
      fileName: `${number}.jpg`,
      mime: 'image/jpeg',
      size: facts.photoBytes,
      uploadedAt: new Date('2026-10-04T08:00:00.000Z'),
    },
  };
};

/** The neighbours — never touched by the repair. */
export const NEIGHBOURS = {
  chill232: '5485640009990232',
  chill239: '5485640009990239',
  chill2516: '5485640009992516',
  travelS778864: '5485640009991185',
  travelS783211: '5485640009997311',
};

let seq = 0;
const mkVehicle = async (code: string) => {
  seq += 1;
  const doc = await FleetVehicleModel.create({
    code,
    typeId: new Types.ObjectId(),
    plateNumber: `R6D-${String(seq)}-${code}`,
    chassisNumber: `6${String(seq).padStart(5, '0')}`,
    motorNumber: `M6D-${String(seq)}-${code}`,
    joinedAt: new Date('2025-01-01'),
    licenseExpiresAt: new Date('2027-01-01'),
    branchId: new Types.ObjectId(),
  });
  world.vehicles.set(code, doc._id);
};

/** The 17 records in «before», their neighbours, and a few charges. */
export const seedRepairWorld = async (): Promise<void> => {
  await FleetFuelCardModel.create([
    ...REPAIR_RECORDS.map((r) => goLiveCard(r.before.number, r.car, r.name, r.goLiveBalance)),
    ...REPAIR_PAIR.map((p) => goLiveCard(p.number, p.car, p.nameBefore, p.openingBefore)),
    ...[
      { number: NEIGHBOURS.chill232, car: '232', name: 'EGYCASHTCS-232' },
      { number: NEIGHBOURS.chill239, car: '239', name: 'EGYCASHTCS-4643-4209073' },
      { number: NEIGHBOURS.chill2516, car: '215', name: 'EGYCASHTCS-215' },
    ].map(({ number, car, name }) => ({
      vehicleId: world.vehicles.get(car),
      label: null,
      company: 'chillout',
      name,
      number,
      expiresAt: new Date('2027-01-31T00:00:00.000Z'),
      password: `P-${number.slice(-6)}c`,
      balance: 50,
    })),
    ...[
      { number: NEIGHBOURS.travelS778864, label: 'سفر 2', name: 'EGYCASH-8618-S778864' },
      { number: NEIGHBOURS.travelS783211, label: 'سفر 5', name: 'EGYCASH-8616-S783211' },
    ].map(({ number, label, name }) => ({
      vehicleId: null,
      label,
      company: 'wataniya',
      name,
      number,
      expiresAt: new Date('2027-01-31T00:00:00.000Z'),
      password: `P-${number.slice(-6)}t`,
      balance: 70,
    })),
  ]);
  // A few charges since go-live — information only on the dry run.
  const cardOn = async (car: string) =>
    (await FleetFuelCardModel.findOne({
      vehicleId: world.vehicles.get(car),
      company: 'wataniya',
    })
      .lean<FleetFuelCardDoc>()
      .exec()) as FleetFuelCardDoc;
  for (const [car, amount, day] of [
    ['239', 500, '2026-10-09'],
    ['239', 750, '2026-10-20'],
    ['283', 1000, '2026-10-12'],
  ] as const) {
    const card = await cardOn(car);
    await FleetFuelCardMovementModel.create({
      cardId: card._id,
      kind: 'charge',
      amount,
      balanceAfter: card.balance,
      counterpartCardId: null,
      receiptId: null,
      at: new Date(`${day}T08:00:00.000Z`),
    });
  }
};

export const cardOnCar = async (car: string, company = 'wataniya') =>
  (await FleetFuelCardModel.findOne({
    vehicleId: world.vehicles.get(car),
    company,
    isDeleted: false,
  })
    .lean<FleetFuelCardDoc>()
    .exec()) as FleetFuelCardDoc;
export const cardByNumber = async (number: string) =>
  (await FleetFuelCardModel.findOne({ number, isDeleted: false })
    .lean<FleetFuelCardDoc>()
    .exec()) as FleetFuelCardDoc;

const tokenWith = async (email: string, keys: string[], name = { ar: 'م', last: 'م' }) => {
  const role = await rbacService.createRole(
    { name: { en: email, ar: email }, permissionKeys: keys },
    actor,
  );
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: name.ar, en: 'T' },
      lastName: { ar: name.last, en: 'T' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  await userService.forceActivate(String(user._id));
  await rbacService.ensureAssignment(String(user._id), String(role._id), 'organization');
  return authService.signAccessToken(String(user._id), new Types.ObjectId().toString(), 0);
};

const resolveMongoUri = async (tag: string): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-fleet-6d-${tag}-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

/** Boots the platform once for the file; each test starts from the seeded world. */
export const useNumberRepairWorld = (tag: string): void => {
  beforeAll(async () => {
    await bootPlatform({ mongoUri: await resolveMongoUri(tag), modules: moduleManifests });
    world.app = buildApp();
    const { user } = await userService.create(
      {
        email: 'r6d-actor@ecms.local',
        firstName: { ar: 'م', en: 'T' },
        lastName: { ar: 'م', en: 'T' },
        locale: 'en',
        organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
      },
      null,
    );
    actor = String(user._id);
    for (const code of [...REPAIR_CARS, '215']) await mkVehicle(code);
    const t = world.tokens;
    t.stranger = await tokenWith('r6d-stranger@ecms.local', ['fleetFuelCharge.view']);
    t.viewer = await tokenWith('r6d-viewer@ecms.local', ['fleetFuelCard.view']);
    t.editor = await tokenWith('r6d-editor@ecms.local', [
      'fleetFuelCard.view',
      'fleetFuelCard.edit',
    ]);
    t.approver = await tokenWith('r6d-approver@ecms.local', [
      'fleetFuelCard.view',
      'fleetFuelCharge.approve',
    ]);
    t.executor = await tokenWith(
      'r6d-executor@ecms.local',
      ['fleetFuelCard.view', 'fleetFuelCard.edit', 'fleetFuelCharge.approve'],
      { ar: 'محمد', last: 'حاتم' },
    );
    t.revealer = await tokenWith('r6d-revealer@ecms.local', [
      'fleetFuelCard.view',
      'fleetFuelCard.reveal',
    ]);
    t.filesViewer = await tokenWith('r6d-files-viewer@ecms.local', [
      'fleetFuelCard.view',
      'file.view',
      'file.download',
    ]);
    t.boss = await tokenWith(
      'r6d-boss@ecms.local',
      [
        'fleetFuelCard.view',
        'fleetFuelCard.edit',
        'fleetFuelCard.reveal',
        'fleetFuelCharge.view',
        'fleetFuelCharge.approve',
        'file.view',
        'file.download',
      ],
      { ar: 'منى', last: 'حسن' },
    );
  }, 240_000);

  beforeEach(async () => {
    await Promise.all([
      FleetFuelCardModel.deleteMany({}).exec(),
      FleetFuelCardMovementModel.deleteMany({}).exec(),
      FleetFuelReconciliationModel.deleteMany({}).exec(),
      AuditLogModel.deleteMany({ 'entityRef.entityType': 'fuelCard' }).exec(),
    ]);
    await seedRepairWorld();
  });

  afterAll(async () => {
    await getCache().close();
    await disconnectMongo();
    if (replSet !== null) await replSet.stop();
    replSet = null;
  });
};
