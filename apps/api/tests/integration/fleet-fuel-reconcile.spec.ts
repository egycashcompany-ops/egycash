// «مطابقة أرصدة الكروت» against a real mongo — a company's balance sheet against its cards:
//
//   1. who may read a sheet and who may decide on it;
//   2. reading writes nothing but the session, and compares by name (differs, equal, sheet-only,
//      system-only, repeats, conflicts, a deleted card never matched);
//   3. ✓ sets the balance to the sheet's with its own `sheetAdjust` line — not a charge; ✗ records a
//      `sheetReject` line of 0; each audited on the card; a line is decided once;
//   4. THE OWNER'S RULE: a card that moved after the read refuses ✓ for the whole request, nothing
//      written — a charge, a back-dated line, a +X/−X; read again and it goes through;
//   5. two decisions at once on one card: exactly one line;
//   6. the card log names who made each line and the sheet behind a sheet line, which is never
//      changed or removed; 7. refusals of the upload; 8. nothing written to the temp directory.
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  ErrorCodes,
  type FleetFuelCardCompany,
  type FleetFuelCardMovementDto,
  type FleetFuelCardTotalsDto,
  type FleetFuelReconcileDto,
  type FleetFuelReconcileResultDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { rbacService } from '../../src/platform/rbac';
import { authService } from '../../src/platform/auth';
import { userService } from '../../src/platform/users';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import {
  FleetFuelCardModel,
  FleetFuelCardMovementModel,
  type FleetFuelCardDoc,
} from '../../src/modules/fleet/fuel-cards/fuel-card.model';
import { FleetFuelReconciliationModel } from '../../src/modules/fleet/fuel-cards/reconcile/fuel-reconcile.model';
import {
  FUEL_SHEET_HEADER,
  buildFuelSheet,
  type FuelSheetCell,
} from './helpers/fuel-sheet-workbook';

const CARDS = '/api/v1/fleet/fuel-cards';
const RECONCILE = `${CARDS}/reconcile`;
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let actor = '';
const tokens = { cardsOnly: '', viewer: '', clerk: '' };

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-fleet-fuel-reconcile-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const failure = (res: request.Response) =>
  (
    res.body as {
      error: { code: string; details?: { field: string; code: string; message: string }[] };
    }
  ).error;
const auth = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];

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
const mkCard = async (
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

const masked = (card: FleetFuelCardDoc): string => `548**********${card.number.slice(-4)}`;
const rowOf = (card: FleetFuelCardDoc, balance: number): FuelSheetCell[] => [
  masked(card),
  card.name,
  balance,
];

const upload = (
  token: string,
  company: string,
  rows: (FuelSheetCell[] | null)[],
  fileName = 'أرصدة وطنية.xlsx',
) =>
  buildFuelSheet({ rows: [FUEL_SHEET_HEADER, ...rows] }).then((file) =>
    request(app)
      .post(RECONCILE)
      .set(...auth(token))
      .field('company', company)
      .attach('file', file, fileName),
  );
const read = async (
  company: string,
  rows: (FuelSheetCell[] | null)[],
): Promise<FleetFuelReconcileDto> => {
  const res = await upload(tokens.clerk, company, rows);
  expect(res.status, res.text).toBe(200);
  return data<FleetFuelReconcileDto>(res);
};
const decide = (
  id: string,
  decision: 'apply' | 'reject',
  cardIds: string[],
  token = tokens.clerk,
) =>
  request(app)
    .post(`${RECONCILE}/${id}/decisions`)
    .set(...auth(token))
    .send({ decision, cardIds });
const card = async (id: Types.ObjectId | string) =>
  (await FleetFuelCardModel.findById(id).lean<FleetFuelCardDoc>().exec()) as FleetFuelCardDoc;
const log = async (cardId: Types.ObjectId | string): Promise<FleetFuelCardMovementDto[]> =>
  data(
    await request(app)
      .get(`${CARDS}/movements`)
      .query({ cardId: String(cardId) })
      .set(...auth(tokens.clerk)),
  );
const charge = async (id: Types.ObjectId, amount: number): Promise<void> => {
  const requested = await request(app)
    .patch(`${CARDS}/${String(id)}/request`)
    .set(...auth(tokens.clerk))
    .send({ amount, version: (await card(id)).__v });
  expect(requested.status, requested.text).toBe(200);
  const approved = await request(app)
    .post(`${CARDS}/${String(id)}/approve`)
    .set(...auth(tokens.clerk))
    .send({ version: (await card(id)).__v });
  expect(approved.status, approved.text).toBe(200);
};
const movementCount = (): Promise<number> => FleetFuelCardMovementModel.countDocuments({}).exec();

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();
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
  tokens.cardsOnly = await tokenWith('reconcile-cards@ecms.local', ['fleetFuelCard.view']);
  tokens.viewer = await tokenWith('reconcile-viewer@ecms.local', ['fleetFuelCharge.view']);
  tokens.clerk = await tokenWith(
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
});

describe('who may read a sheet and decide on it', () => {
  it('reading needs the charging screen’s view grant; deciding needs approve', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-1', 10);
    expect((await upload(tokens.cardsOnly, 'wataniya', [rowOf(a, 20)])).status).toBe(403);
    const res = await upload(tokens.viewer, 'wataniya', [rowOf(a, 20)]);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    const decided = await decide(
      data<FleetFuelReconcileDto>(res).id,
      'apply',
      [String(a._id)],
      tokens.viewer,
    );
    expect(decided.status).toBe(403);
    expect((await card(a._id)).balance).toBe(10);
  });
});

describe('reading a sheet', () => {
  it('compares by name, stores the session, and writes no card and no movement', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-A', 100, { requestedAmount: 30 });
    const b = await mkCard('wataniya', 'EGYCASH-B', 200);
    const c = await mkCard('wataniya', 'EGYCASH-C', 300);
    const d = await mkCard('wataniya', 'EGYCASH-D', 5);
    const g = await mkCard('wataniya', 'EGYCASH-G', 10);
    const f1 = await mkCard('wataniya', 'EGYCASH-F', 1);
    await mkCard('wataniya', 'egycash-f', 2);
    const gone = await mkCard('wataniya', 'EGYCASH-E', 0, { isDeleted: true });
    const n = await mkCard('wataniya', 'EGYCASH-N', 40);
    await mkCard('chillout', 'EGYCASH-A2', 1); // another company is never compared
    const before = await FleetFuelCardModel.find({}).sort({ _id: 1 }).lean().exec();
    const movements = await movementCount();

    const rows = [
      rowOf(a, 150),
      rowOf(b, 200),
      ['548**********9999', c.name, 230], // the last four differ
      rowOf(g, 20),
      null,
      rowOf(g, 20), // an identical repeat
      rowOf(f1, 1),
      rowOf(gone, 7),
      ['548**********0000', 'EGYCASH-H', 9],
      rowOf(n, -50),
    ];
    const file = await buildFuelSheet({ rows: [FUEL_SHEET_HEADER, ...rows] });
    const dto = await read('wataniya', rows);

    expect(dto).toMatchObject({
      company: 'wataniya',
      fileName: 'أرصدة وطنية.xlsx',
      rows: 9,
      sheetCompany: 'wataniya',
    });
    expect(dto.fileSha256).toBe(createHash('sha256').update(file).digest('hex'));
    expect(dto.differs.map((l) => [l.card.name, l.difference, l.numberMatches])).toEqual([
      ['EGYCASH-C', -70, false],
      ['EGYCASH-A', 50, true],
      ['EGYCASH-G', 10, true],
    ]);
    expect(dto.equal.map((l) => l.card.id)).toEqual([String(b._id)]);
    expect(dto.sheetOnly.map((r) => r.name)).toEqual(['EGYCASH-E', 'EGYCASH-H']);
    expect(dto.systemOnly.map((x) => x.id)).toEqual([String(d._id)]);
    expect(dto.duplicates).toEqual([expect.objectContaining({ name: 'EGYCASH-G', times: 2 })]);
    expect(dto.conflicts.map((x) => [x.reason, x.name, x.cardId])).toEqual([
      ['systemNameTwice', 'EGYCASH-F', null],
      ['badBalance', 'EGYCASH-N', String(n._id)],
    ]);

    // Nothing but the session was written.
    expect(await FleetFuelCardModel.find({}).sort({ _id: 1 }).lean().exec()).toEqual(before);
    expect(await movementCount()).toBe(movements);
    const stored = await FleetFuelReconciliationModel.findById(dto.id).lean().exec();
    expect(stored).toMatchObject({ isDeleted: false, fileSha256: dto.fileSha256, rowsRead: 9 });
    expect(stored?.readAt.toISOString()).toBe(dto.readAt);
    expect(
      stored?.lines.map((l) => [String(l.cardId), l.sheetBalance, l.systemBalance, l.decision]),
    ).toEqual([
      [String(c._id), 230, 300, null],
      [String(a._id), 150, 100, null],
      [String(g._id), 20, 10, null],
    ]);
    expect(stored?.counts).toEqual({
      equal: 1,
      sheetOnly: 2,
      systemOnly: 1,
      duplicates: 1,
      conflicts: 2,
      numbersDiffer: 1,
    });
  });
});

describe('✓ and ✗', () => {
  it('✓ sets the sheet’s balance with a sheetAdjust line — not a charge; ✗ records a 0 line; each audited', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-A', 100, {
      requestedAmount: 30,
      lastChargedAt: new Date('2026-10-01'),
    });
    const c = await mkCard('wataniya', 'EGYCASH-C', 300);
    const summaryBefore = data<FleetFuelCardTotalsDto>(
      await request(app)
        .get(`${CARDS}/summary`)
        .set(...auth(tokens.clerk)),
    );
    const dto = await read('wataniya', [rowOf(a, 150.25), rowOf(c, 250)]);

    const applied = await decide(dto.id, 'apply', [String(a._id).toUpperCase()]);
    expect(applied.status, applied.text).toBe(200);
    expect(data<FleetFuelReconcileResultDto[]>(applied)).toEqual([
      expect.objectContaining({
        cardId: String(a._id),
        decision: 'apply',
        balance: 150.25,
        byName: 'سامح علي',
      }),
    ]);
    const after = await card(a._id);
    expect(after).toMatchObject({
      balance: 150.25,
      requestedAmount: 30,
      lastChargedAt: new Date('2026-10-01'),
    });
    const summaryAfter = data<FleetFuelCardTotalsDto>(
      await request(app)
        .get(`${CARDS}/summary`)
        .set(...auth(tokens.clerk)),
    );
    expect(summaryAfter.chargedTodayAmount).toBe(summaryBefore.chargedTodayAmount);

    const rejected = await decide(dto.id, 'reject', [String(c._id)]);
    expect(rejected.status, rejected.text).toBe(200);
    expect(data<FleetFuelReconcileResultDto[]>(rejected)[0]).toMatchObject({
      decision: 'reject',
      balance: 300,
    });
    expect((await card(c._id)).balance).toBe(300);

    const [adjust] = await log(a._id);
    expect(adjust).toMatchObject({
      kind: 'sheetAdjust',
      amount: 50.25,
      balanceAfter: 150.25,
      byName: 'سامح علي',
    });
    expect(adjust?.sheet).toEqual({
      reconciliationId: dto.id,
      fileName: 'أرصدة وطنية.xlsx',
      sheetBalance: 150.25,
      systemBalance: 100,
    });
    const [refusal] = await log(c._id);
    expect(refusal).toMatchObject({ kind: 'sheetReject', amount: 0, balanceAfter: 300 });

    const audit = async (id: Types.ObjectId) =>
      AuditLogModel.find({
        'entityRef.moduleId': 'fleet',
        'entityRef.entityType': 'fuelCard',
        'entityRef.entityId': String(id),
      })
        .lean()
        .exec();
    expect((await audit(a._id)).map((row) => [row.action, row.changes])).toEqual([
      [
        'correct',
        [
          { field: 'balance', old: '100', new: '150.25' },
          { field: 'reconciliation', old: null, new: dto.id },
        ],
      ],
    ]);
    expect((await audit(c._id)).map((row) => row.action)).toEqual(['reject']);

    // A line is decided once.
    const again = await decide(dto.id, 'reject', [String(a._id)]);
    expect(again.status).toBe(409);
    expect(failure(again)).toMatchObject({
      code: ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED,
      details: [{ field: 'cardIds', code: 'DECIDED', message: String(a._id) }],
    });
  });

  it('only a card the sheet differs on may be named; an unknown session is 404', async () => {
    const equal = await mkCard('wataniya', 'EGYCASH-EQ', 10);
    const other = await mkCard('chillout', 'EGYCASHTCS-1', 10);
    const twice = await mkCard('wataniya', 'EGYCASH-2X', 10);
    await mkCard('wataniya', 'EGYCASH-2X', 11);
    const dto = await read('wataniya', [rowOf(equal, 10), rowOf(twice, 50)]);
    for (const id of [equal._id, other._id, twice._id]) {
      const res = await decide(dto.id, 'apply', [String(id)]);
      expect(res.status).toBe(400);
      expect(failure(res).details).toEqual([
        { field: 'body.cardIds', code: 'NOT_IN_SHEET', message: String(id) },
      ]);
    }
    expect(
      (await decide(new Types.ObjectId().toString(), 'apply', [String(equal._id)])).status,
    ).toBe(404);
  });
});

describe('the owner’s rule: a card that moved after the read refuses ✓ — all or nothing', () => {
  it('a charge, a back-dated line, a +X/−X: nothing written, the moved cards named; read again and it goes through', async () => {
    const x = await mkCard('chillout', 'EGYCASHTCS-X', 100);
    const y = await mkCard('chillout', 'EGYCASHTCS-Y', 100);
    const z = await mkCard('chillout', 'EGYCASHTCS-Z', 100);
    const ids = [x, y, z].map((c) => String(c._id));
    const rows = [rowOf(x, 110), rowOf(y, 120), rowOf(z, 130)];

    let dto = await read('chillout', rows);
    await charge(y._id, 100);
    const movements = await movementCount();
    const refused = await decide(dto.id, 'apply', ids);
    expect(refused.status).toBe(409);
    expect(failure(refused)).toMatchObject({
      code: ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED,
      details: [{ field: 'cardIds', code: 'CARD_CHANGED', message: String(y._id) }],
    });
    expect([
      (await card(x._id)).balance,
      (await card(y._id)).balance,
      (await card(z._id)).balance,
    ]).toEqual([100, 200, 100]);
    expect(await movementCount()).toBe(movements);

    // A line dated in the past but WRITTEN after the read (a receipt carries its own day).
    dto = await read('chillout', [rowOf(x, 110), rowOf(y, 120), rowOf(z, 130)]);
    await FleetFuelCardMovementModel.create({
      cardId: z._id,
      kind: 'receipt',
      amount: 0,
      balanceAfter: 100,
      counterpartCardId: null,
      receiptId: new Types.ObjectId(),
      at: new Date('2020-01-01'),
    });
    expect(failure(await decide(dto.id, 'apply', ids)).details?.map((d) => d.message)).toEqual([
      String(z._id),
    ]);

    // +100 then the charge removed: the balance is back where it was, and it is still refused.
    dto = await read('chillout', [rowOf(x, 110), rowOf(y, 120), rowOf(z, 130)]);
    await charge(x._id, 100);
    const line = (await log(x._id)).find((m) => m.kind === 'charge');
    expect(
      (
        await request(app)
          .delete(`${CARDS}/movements/${line?.id ?? ''}`)
          .set(...auth(tokens.clerk))
      ).status,
    ).toBe(204);
    expect((await card(x._id)).balance).toBe(100);
    expect(failure(await decide(dto.id, 'apply', [String(x._id)])).code).toBe(
      ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED,
    );

    // ✗ is not refused by a move — it changes no balance and records the card as it is.
    const rejected = await decide(dto.id, 'reject', [String(x._id)]);
    expect(data<FleetFuelReconcileResultDto[]>(rejected)[0]).toMatchObject({ balance: 100 });

    // Read again: the same ✓ goes through.
    dto = await read('chillout', rows);
    const applied = await decide(dto.id, 'apply', ids);
    expect(applied.status, applied.text).toBe(200);
    expect([
      (await card(x._id)).balance,
      (await card(y._id)).balance,
      (await card(z._id)).balance,
    ]).toEqual([110, 120, 130]);
  });

  it('a card deleted after the read refuses ✓ and ✗ alike', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-DEL', 0);
    const dto = await read('wataniya', [rowOf(a, 20)]);
    await FleetFuelCardModel.updateOne({ _id: a._id }, { isDeleted: true }).exec();
    for (const decision of ['apply', 'reject'] as const) {
      expect(failure(await decide(dto.id, decision, [String(a._id)])).code).toBe(
        ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED,
      );
    }
    expect(await movementCount()).toBe(0);
  });

  it('two ✓ at once on one card: one goes through, one line is written', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-RACE', 10);
    const dto = await read('wataniya', [rowOf(a, 99)]);
    const settled = await Promise.allSettled([
      decide(dto.id, 'apply', [String(a._id)]),
      decide(dto.id, 'apply', [String(a._id)]),
    ]);
    const statuses = settled.map((s) => (s.status === 'fulfilled' ? s.value.status : 0)).sort();
    expect(statuses).toEqual([200, 409]);
    expect(
      await FleetFuelCardMovementModel.countDocuments({
        cardId: a._id,
        kind: 'sheetAdjust',
      }).exec(),
    ).toBe(1);
    expect((await card(a._id)).balance).toBe(99);
  });
});

describe('the card log', () => {
  it('names who made each line; a sheet line is never changed or removed', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-LOG', 0);
    await charge(a._id, 40);
    // A line from before «بواسطة» existed — no writer on file.
    await FleetFuelCardMovementModel.create({
      cardId: a._id,
      kind: 'charge',
      amount: 0,
      balanceAfter: 40,
      counterpartCardId: null,
      receiptId: null,
      at: new Date('2020-01-01'),
    });
    const dto = await read('wataniya', [rowOf(a, 45)]);
    await decide(dto.id, 'apply', [String(a._id)]);
    const lines = await log(a._id);
    expect(lines.map((m) => [m.kind, m.byName, m.sheet === null])).toEqual([
      ['sheetAdjust', 'سامح علي', false],
      ['charge', 'سامح علي', true],
      ['charge', null, true],
    ]);
    // No default: an ordinary line is written without the field at all (nothing to backfill).
    const raw = await FleetFuelCardMovementModel.collection
      .find({ cardId: a._id }, { sort: { at: -1 } })
      .toArray();
    expect(raw.map((doc) => 'reconciliation' in doc)).toEqual([true, false, false]);
    const sheetLine = lines[0]?.id ?? '';
    const patched = await request(app)
      .patch(`${CARDS}/movements/${sheetLine}`)
      .set(...auth(tokens.clerk))
      .send({ amount: 1 });
    expect([patched.status, failure(patched).details?.[0]?.message]).toEqual([
      400,
      'a sheet line is not changed here',
    ]);
    expect(
      (
        await request(app)
          .delete(`${CARDS}/movements/${sheetLine}`)
          .set(...auth(tokens.clerk))
      ).status,
    ).toBe(400);
    expect((await card(a._id)).balance).toBe(45);
  });
});

describe('upload refusals', () => {
  it('a missing column, bytes that are no workbook, an oversized file, no file, no company', async () => {
    const noBalance = await request(app)
      .post(RECONCILE)
      .set(...auth(tokens.clerk))
      .field('company', 'wataniya')
      .attach(
        'file',
        await buildFuelSheet({
          rows: [
            ['Card Number', 'Card Name'],
            ['1', 'A'],
          ],
        }),
        'x.xlsx',
      );
    expect([noBalance.status, failure(noBalance).code]).toEqual([
      422,
      ErrorCodes.FLEET_FUEL_SHEET_LAYOUT,
    ]);
    expect(failure(noBalance).details).toEqual([
      { field: 'file', code: 'MISSING_HEADER', message: 'Card Balance' },
    ]);

    const junk = await request(app)
      .post(RECONCILE)
      .set(...auth(tokens.clerk))
      .field('company', 'wataniya')
      .attach('file', Buffer.from('not a workbook'), 'x.xlsx');
    expect([junk.status, failure(junk).details?.[0]?.code]).toEqual([422, 'UNREADABLE']);

    const huge = await request(app)
      .post(RECONCILE)
      .set(...auth(tokens.clerk))
      .field('company', 'wataniya')
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), 'x.xlsx');
    expect([huge.status, failure(huge).code]).toEqual([422, ErrorCodes.FILE_TOO_LARGE]);

    const noFile = await request(app)
      .post(RECONCILE)
      .set(...auth(tokens.clerk))
      .field('company', 'wataniya');
    expect([noFile.status, failure(noFile).details?.[0]?.code]).toEqual([400, 'REQUIRED']);
    const file = await buildFuelSheet({ rows: [FUEL_SHEET_HEADER] });
    for (const company of [null, 'shell']) {
      const req = request(app)
        .post(RECONCILE)
        .set(...auth(tokens.clerk));
      const res = await (company === null ? req : req.field('company', company)).attach(
        'file',
        file,
        'x.xlsx',
      );
      expect(res.status).toBe(400);
    }
    expect(await FleetFuelReconciliationModel.countDocuments({}).exec()).toBe(0);
  });

  it('nothing is written to the temp directory while a sheet is read', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-TMP', 1);
    const original = process.env.TMPDIR;
    const scratch = mkdtempSync(path.join(os.tmpdir(), 'fuel-reconcile-'));
    process.env.TMPDIR = scratch;
    try {
      await read('wataniya', [rowOf(a, 2)]);
      expect(readdirSync(scratch)).toEqual([]);
    } finally {
      if (original === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = original;
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
