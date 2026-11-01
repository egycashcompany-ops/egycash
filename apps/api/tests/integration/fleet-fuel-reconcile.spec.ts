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
