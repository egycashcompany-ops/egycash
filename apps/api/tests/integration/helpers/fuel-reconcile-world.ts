// The world of «مطابقة أرصدة الكروت» against a real mongo, shared by `fleet-fuel-reconcile.spec.ts`
// (who may, reading a sheet, the upload's refusals) and `fleet-fuel-reconcile-decide.spec.ts` (✓ and
// ✗, the owner's freshness rule, the card log): a clerk, a viewer and a cards-only user, cards
// written directly, the sheet's upload, read and decisions. `useFuelReconcileWorld()` registers the
// file's hooks; each test starts from no cards, movements or sessions (a test database).
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { type Express } from 'express';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import {
  type FleetFuelCardCompany,
  type FleetFuelCardMovementDto,
  type FleetFuelReconcileDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../../src/platform/kernel/bootstrap';
import { buildApp } from '../../../src/app';
import { moduleManifests } from '../../../src/modules';
import { rbacService } from '../../../src/platform/rbac';
import { authService } from '../../../src/platform/auth';
import { userService } from '../../../src/platform/users';
import { getCache } from '../../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../../src/infrastructure/database/mongo';
import {
  FleetFuelCardModel,
  FleetFuelCardMovementModel,
  type FleetFuelCardDoc,
} from '../../../src/modules/fleet/fuel-cards/fuel-card.model';
import { FleetFuelReconciliationModel } from '../../../src/modules/fleet/fuel-cards/reconcile/fuel-reconcile.model';
import { FUEL_SHEET_HEADER, buildFuelSheet, type FuelSheetCell } from './fuel-sheet-workbook';

export const CARDS = '/api/v1/fleet/fuel-cards';
export const RECONCILE = `${CARDS}/reconcile`;
let replSet: MongoMemoryReplSet | null = null;
let actor = '';
/** The app and the tokens, filled by `useFuelReconcileWorld()`'s beforeAll. */
export const world = {
  app: undefined as unknown as Express,
  tokens: { cardsOnly: '', viewer: '', clerk: '', linker: '', creator: '' },
};

const resolveMongoUri = async (tag: string): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-fleet-fuel-${tag}-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

export const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
export const failure = (res: request.Response) =>
  (
    res.body as {
      error: { code: string; details?: { field: string; code: string; message: string }[] };
    }
  ).error;
export const auth = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];

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

let seq = 100_000;
/** A card written directly — the registry is not what this file is about. */
export const mkCard = async (
  company: FleetFuelCardCompany,
  name: string,
  balance: number,
  over: Partial<FleetFuelCardDoc> = {},
): Promise<FleetFuelCardDoc> =>
  (
    await FleetFuelCardModel.create({
      vehicleId: null,
      label: name,
      company,
      name,
      number: `5485640000${String(seq++)}`,
      expiresAt: null,
      password: null,
      balance,
      ...over,
    })
  ).toObject() as FleetFuelCardDoc;

export const masked = (card: FleetFuelCardDoc): string => `548**********${card.number.slice(-4)}`;
export const rowOf = (card: FleetFuelCardDoc, balance: number): FuelSheetCell[] => [
  masked(card),
  card.name,
  balance,
];

export const upload = (
  token: string,
  company: string,
  rows: (FuelSheetCell[] | null)[],
  fileName = 'أرصدة وطنية.xlsx',
) => uploadSheet(token, company, [FUEL_SHEET_HEADER, ...rows], { fileName });

/** Any layout — the header row is the caller's — with an optional «تاريخ الشيت». */
export const uploadSheet = (
  token: string,
  company: string,
  rows: (FuelSheetCell[] | null)[],
  options: { fileName?: string; sheetDate?: string } = {},
) =>
  buildFuelSheet({ rows }).then((file) => {
    const req = request(world.app)
      .post(RECONCILE)
      .set(...auth(token))
      .field('company', company);
    return (
      options.sheetDate === undefined ? req : req.field('sheetDate', options.sheetDate)
    ).attach('file', file, options.fileName ?? 'أرصدة وطنية.xlsx');
  });
export const readSheet = async (
  company: string,
  rows: (FuelSheetCell[] | null)[],
  options: { fileName?: string; sheetDate?: string } = {},
): Promise<FleetFuelReconcileDto> => {
  const res = await uploadSheet(world.tokens.clerk, company, rows, options);
  expect(res.status, res.text).toBe(200);
  return data<FleetFuelReconcileDto>(res);
};
export const read = async (
  company: string,
  rows: (FuelSheetCell[] | null)[],
): Promise<FleetFuelReconcileDto> => {
  const res = await upload(world.tokens.clerk, company, rows);
  expect(res.status, res.text).toBe(200);
  return data<FleetFuelReconcileDto>(res);
};
export const decide = (
  id: string,
  decision: 'apply' | 'reject',
  cardIds: string[],
  token = world.tokens.clerk,
  extra: { cancelCharges?: string[]; approveRequests?: string[] } = {},
) =>
  request(world.app)
    .post(`${RECONCILE}/${id}/decisions`)
    .set(...auth(token))
    .send({ decision, cardIds, ...extra });
export const card = async (id: Types.ObjectId | string) =>
  (await FleetFuelCardModel.findById(id).lean<FleetFuelCardDoc>().exec()) as FleetFuelCardDoc;
export const log = async (cardId: Types.ObjectId | string): Promise<FleetFuelCardMovementDto[]> =>
  data(
    await request(world.app)
      .get(`${CARDS}/movements`)
      .query({ cardId: String(cardId) })
      .set(...auth(world.tokens.clerk)),
  );
export const charge = async (id: Types.ObjectId, amount: number): Promise<void> => {
  const requested = await request(world.app)
    .patch(`${CARDS}/${String(id)}/request`)
    .set(...auth(world.tokens.clerk))
    .send({ amount, version: (await card(id)).__v });
  expect(requested.status, requested.text).toBe(200);
  const approved = await request(world.app)
    .post(`${CARDS}/${String(id)}/approve`)
    .set(...auth(world.tokens.clerk))
    .send({ version: (await card(id)).__v });
  expect(approved.status, approved.text).toBe(200);
};
export const movementCount = (): Promise<number> =>
  FleetFuelCardMovementModel.countDocuments({}).exec();

/** Boots the platform once for the file, and empties the cards, lines and sessions before each test. */
export const useFuelReconcileWorld = (tag: string): void => {
  beforeAll(async () => {
    await bootPlatform({ mongoUri: await resolveMongoUri(tag), modules: moduleManifests });
    world.app = buildApp();
    const { user } = await userService.create(
      {
        email: 'reconcile-actor@ecms.local',
        firstName: { ar: 'م', en: 'T' },
        lastName: { ar: 'م', en: 'T' },
        locale: 'en',
        organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
      },
      null,
    );
    actor = String(user._id);
    world.tokens.cardsOnly = await tokenWith('reconcile-cards@ecms.local', ['fleetFuelCard.view']);
    world.tokens.viewer = await tokenWith('reconcile-viewer@ecms.local', ['fleetFuelCharge.view']);
    world.tokens.clerk = await tokenWith(
      'reconcile-clerk@ecms.local',
      [
        'fleetFuelCard.view',
        'fleetFuelCharge.view',
        'fleetFuelCharge.request',
        'fleetFuelCharge.approve',
        'fleetFuelCharge.transfer',
      ],
      { ar: 'سامح', last: 'علي' },
    );
    // «ربط الكروت بالسيارات» and «إضافة»: the cards screen's own edit and create grants.
    world.tokens.linker = await tokenWith(
      'reconcile-linker@ecms.local',
      [
        'fleetFuelCard.view',
        'fleetFuelCard.edit',
        'fleetFuelCard.create',
        'fleetFuelCharge.view',
        'fleetFuelCharge.approve',
      ],
      { ar: 'منى', last: 'حسن' },
    );
    // Keeps the card list (adds cards) but does not release money onto one.
    world.tokens.creator = await tokenWith('reconcile-creator@ecms.local', [
      'fleetFuelCard.view',
      'fleetFuelCard.create',
      'fleetFuelCharge.view',
    ]);
  }, 240_000);

  beforeEach(async () => {
    // Each test compares a sheet with ALL of a company's cards — so each starts from none.
    await Promise.all([
      FleetFuelCardModel.deleteMany({}).exec(),
      FleetFuelCardMovementModel.deleteMany({}).exec(),
      FleetFuelReconciliationModel.deleteMany({}).exec(),
    ]);
  });

  afterAll(async () => {
    await getCache().close();
    await disconnectMongo();
    if (replSet !== null) await replSet.stop();
    replSet = null;
  });
};
