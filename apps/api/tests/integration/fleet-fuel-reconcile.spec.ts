// «مطابقة أرصدة الكروت» against a real mongo — reading a company's balance sheet:
//
//   1. who may read a sheet and who may decide on it;
//   2. reading writes nothing but the session, and compares by name (differs, equal, sheet-only,
//      system-only, repeats, conflicts, a deleted card never matched);
//   3. refusals of the upload; 4. nothing written to the temp directory.
//
// The decisions (✓ and ✗, the owner's freshness rule, the card log) are in
// `fleet-fuel-reconcile-decide.spec.ts`; both share `helpers/fuel-reconcile-world.ts`.
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ErrorCodes, type FleetFuelReconcileDto } from '@ecms/contracts';
import { FleetFuelCardModel } from '../../src/modules/fleet/fuel-cards/fuel-card.model';
import { FleetFuelReconciliationModel } from '../../src/modules/fleet/fuel-cards/reconcile/fuel-reconcile.model';
import { FUEL_SHEET_HEADER, buildFuelSheet } from './helpers/fuel-sheet-workbook';
import {
  RECONCILE,
  auth,
  card,
  data,
  decide,
  failure,
  mkCard,
  movementCount,
  read,
  readSheet,
  rowOf,
  upload,
  useFuelReconcileWorld,
  world,
} from './helpers/fuel-reconcile-world';

useFuelReconcileWorld('reconcile-read');
const { tokens } = world;

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
    // Rewritten on purpose (6c): two cards sharing a name are now told apart by the number when
    // it fits one of them — these two share their last four as well, so the sheet cannot say.
    const f1 = await mkCard('wataniya', 'EGYCASH-F', 1, { number: '5485640000990077' });
    await mkCard('wataniya', 'egycash-f', 2, { number: '5485640000980077' });
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
      skipped: 0,
      placesDiffer: 0,
    });
  });
});

describe('6c — his company statement, shaped like «4-10-2026»', () => {
  it('216 rows + 3 totals: every card matched by its rebuilt name, the totals skipped and agreeing', async () => {
    // 216 Wataniya cards, named as the go-live sheet names them; some chassis begin with a 0.
    const seed = Array.from({ length: 216 }, (_, i) => {
      const plate = String(1000 + i);
      const chassis =
        i % 3 === 0
          ? `B${String(200000 + i)}`
          : i % 5 === 0
            ? `0${String(40000 + i)}`
            : String(300000 + i);
      return {
        vehicleId: null,
        label: String(100 + i),
        company: 'wataniya' as const,
        name: `EGYCASH-${plate}-${chassis}`,
        number: `5485640${String(100000000 + i).slice(-9)}`,
        expiresAt: null,
        password: null,
        balance: 1000 + i,
        plate,
        chassis,
      };
    });
    await FleetFuelCardModel.insertMany(seed.map(({ plate: _p, chassis: _c, ...doc }) => doc));
    const last4 = (i: number) => (seed[i] as (typeof seed)[number]).number.slice(-4);
    // The statement: masked, the bare prefix, plate and chassis split off (an all-digit chassis
    // typed into a number cell loses its zero), 95 balances that differ, three numbers crossed.
    let sum = 0;
    const rows = seed.map((c, i) => {
      const balance = i < 121 ? c.balance : c.balance + 5;
      sum += Math.round(balance * 100);
      const shown = i === 0 ? last4(1) : i === 1 ? last4(2) : i === 2 ? last4(0) : last4(i);
      return [
        `548**********${shown}`,
        'EGYCASH',
        Number(c.plate),
        /^\d+$/u.test(c.chassis) ? Number(c.chassis) : c.chassis,
        balance,
        c.label,
        5000,
      ];
    });
    const dto = await readSheet('wataniya', [
      ['Card Number', 'Card Name', 'لوحه', 'شاسيه', 'Card Balance', 'كود', 'قيمه الشحن'],
      ...rows,
      [null, null, null, 'رصيد الكروت', sum / 100, null, null],
      [null, null, null, 'قيمه الشحن', 1030000, null, null],
      [null, null, null, 'الرصيد المتوقع', 700000, null, null],
    ]);

    expect(dto).toMatchObject({
      rows: 219,
      cardRows: 216,
      sheetCompany: 'wataniya',
      nameRebuilt: true,
      example: { row: 2, builtName: 'EGYCASH-1000-B200000' },
      totalCheck: { row: 218, text: 'رصيد الكروت', sum: sum / 100, agrees: true },
    });
    expect(dto.conflicts).toEqual([]);
    expect([
      dto.equal.length,
      dto.differs.length,
      dto.sheetOnly.length,
      dto.systemOnly.length,
    ]).toEqual([121, 95, 0, 0]);
    expect(dto.skipped.map((r) => r.row)).toEqual([218, 219, 220]);
    expect(dto.layout.map((c) => `${c.role}:${c.column}`)).toEqual([
      'number:A',
      'name:B',
      'plate:C',
      'chassis:D',
      'balance:E',
      'code:F',
      'ignored:G',
    ]);
    // The crossed three: matched by name, each naming the card that holds its number.
    const crossed = dto.equal.filter((l) => !l.numberMatches);
    expect(crossed.map((l) => [l.card.name, l.numberHolder?.name, l.matchedBy])).toEqual([
      [seed[0]?.name, seed[1]?.name, 'name'],
      [seed[1]?.name, seed[2]?.name, 'name'],
      [seed[2]?.name, seed[0]?.name, 'name'],
    ]);
    expect(dto.equal.every((l) => l.placeMatches === true)).toBe(true);
    // The leading zero: «EGYCASH-1005-40005» from the sheet is the card «…-040005».
    const zero = dto.equal.find((l) => l.card.name === 'EGYCASH-1005-040005');
    expect(zero?.sheet.builtName).toBe('EGYCASH-1005-40005');

    const stored = await FleetFuelReconciliationModel.findById(dto.id).lean().exec();
    expect(stored?.lines).toHaveLength(95);
    expect(stored?.lines[0]?.name).toMatch(/^EGYCASH-\d{4}-/u);
    expect(stored?.lines[0]?.sheetCode).toMatch(/^\d+$/u);
    expect(stored?.counts).toMatchObject({ skipped: 3, numbersDiffer: 3, placesDiffer: 0 });

    // The decision flow is unchanged.
    const target = dto.differs[0];
    const applied = await decide(dto.id, 'apply', [target?.card.id ?? '']);
    expect(applied.status, applied.text).toBe(200);
    expect((await card(target?.card.id ?? '')).balance).toBe(target?.sheet.balance);
  });

  it('«1-11-2026»-shaped Chill Out statement: untitled plate/chassis, 209 matched, 6 new, one number different', async () => {
    // 210 Chill Out cards; 8 chassis begin with a 0 (Excel drops it from a number cell).
    const seed = Array.from({ length: 210 }, (_, i) => {
      const plate = String(2000 + i);
      const chassis = i < 8 ? `0${String(46000 + i)}` : String(250000 + i);
      return {
        vehicleId: null,
        label: `C${String(i)}`,
        company: 'chillout' as const,
        name: `EGYCASHTCS-${plate}-${chassis}`,
        number: `5485641${String(200000000 + i).slice(-9)}`,
        expiresAt: null,
        password: null,
        balance: 500 + i,
        plate,
        chassis,
      };
    });
    await FleetFuelCardModel.insertMany(seed.map(({ plate: _p, chassis: _c, ...doc }) => doc));
    const rows = seed.map((c, i) => [
      // Card 50 was replaced: the sheet prints a number no card of the system holds.
      i === 50 ? '548**********9876' : `548**********${c.number.slice(-4)}`,
      'EGYCASHTCS',
      Number(c.plate),
      Number(c.chassis),
      i === 209 ? -2214.66 : i < 12 ? c.balance : c.balance + 1,
      c.label,
    ]);
    const extra = [
      ['548**********1111', 'EGYCASHTCS', 1781, 312986, 4305.09, '209'],
      ...[305, 306, 307, 308, 309].map((code, k) => [
        `548**********${String(3000 + k)}`,
        'EGYCASHTCS',
        6400 + k,
        818000 + k,
        0,
        String(code),
      ]),
    ];
    const dto = await readSheet('chillout', [
      ['Card Number', 'Card Name', null, null, 'Card Balance', 'code'],
      ...rows,
      ...extra,
    ]);
    expect(dto.layout.filter((c) => c.assumed).map((c) => `${c.role}:${c.column}`)).toEqual([
      'plate:C',
      'chassis:D',
    ]);
    expect([dto.equal.length, dto.differs.length]).toEqual([12, 197]);
    expect([dto.sheetOnly.length, dto.systemOnly.length, dto.newCards.length]).toEqual([6, 0, 6]);
    expect(dto.conflicts.map((c) => [c.reason, c.cardId])).toEqual([
      [
        'badBalance',
        String((await FleetFuelCardModel.findOne({ name: seed[209]?.name }).lean().exec())?._id),
      ],
    ]);
    const different = [...dto.equal, ...dto.differs].filter((l) => !l.numberMatches);
    expect(different.map((l) => [l.card.name, l.numberHolder])).toEqual([[seed[50]?.name, null]]);
    expect(dto.newCards.map((n) => [n.name, n.balance])).toEqual([
      ['EGYCASHTCS-1781-312986', 4305.09],
      ...[0, 1, 2, 3, 4].map((k) => [`EGYCASHTCS-${String(6400 + k)}-${String(818000 + k)}`, 0]),
    ]);
    expect(dto.sheetCompany).toBe('chillout');
  });

  it('a session read before batch 3 — no code, no charges, no new counts — still decides', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-OLD', 100);
    const b = await mkCard('wataniya', 'EGYCASH-OLD2', 50);
    const readAt = new Date();
    const id = new Types.ObjectId();
    await FleetFuelReconciliationModel.collection.insertOne({
      _id: id,
      company: 'wataniya',
      fileName: 'old.xlsx',
      fileSha256: 'f'.repeat(64),
      readAt,
      rowsRead: 2,
      sheetCompany: 'wataniya',
      lines: [a, b].map((c) => ({
        cardId: c._id,
        name: c.name,
        sheetRow: 2,
        sheetNumber: '548**********0001',
        sheetBalance: c.balance + 10,
        systemBalance: c.balance,
        numberMatches: true,
        decision: null,
        decidedAt: null,
        decidedBy: null,
        movementId: null,
      })),
      counts: {
        equal: 0,
        sheetOnly: 0,
        systemOnly: 0,
        duplicates: 0,
        conflicts: 0,
        numbersDiffer: 0,
      },
      schemaVersion: 1,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      createdBy: null,
      updatedBy: null,
      createdAt: readAt,
      updatedAt: readAt,
      __v: 0,
    });
    const applied = await decide(String(id), 'apply', [String(a._id)]);
    expect(applied.status, applied.text).toBe(200);
    expect(
      data<{ cancelledAmount: number; approvedRequest: number | null }[]>(applied)[0],
    ).toMatchObject({
      cancelledAmount: 0,
      approvedRequest: null,
    });
    expect((await card(a._id)).balance).toBe(110);
    const rejected = await decide(String(id), 'reject', [String(b._id)]);
    expect(rejected.status, rejected.text).toBe(200);
    expect((await card(b._id)).balance).toBe(50);
  });
});

describe('upload refusals', () => {
  it('a missing column, bytes that are no workbook, an oversized file, no file, no company', async () => {
    const noBalance = await request(world.app)
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

    const junk = await request(world.app)
      .post(RECONCILE)
      .set(...auth(tokens.clerk))
      .field('company', 'wataniya')
      .attach('file', Buffer.from('not a workbook'), 'x.xlsx');
    expect([junk.status, failure(junk).details?.[0]?.code]).toEqual([422, 'UNREADABLE']);

    const huge = await request(world.app)
      .post(RECONCILE)
      .set(...auth(tokens.clerk))
      .field('company', 'wataniya')
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), 'x.xlsx');
    expect([huge.status, failure(huge).code]).toEqual([422, ErrorCodes.FILE_TOO_LARGE]);

    const noFile = await request(world.app)
      .post(RECONCILE)
      .set(...auth(tokens.clerk))
      .field('company', 'wataniya');
    expect([noFile.status, failure(noFile).details?.[0]?.code]).toEqual([400, 'REQUIRED']);
    const file = await buildFuelSheet({ rows: [FUEL_SHEET_HEADER] });
    for (const company of [null, 'shell']) {
      const req = request(world.app)
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
