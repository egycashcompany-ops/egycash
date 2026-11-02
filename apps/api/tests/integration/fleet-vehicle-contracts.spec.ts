// «عقود توريد السيارات» against a real mongo: only a date and one line are required; numbers are
// never reused; an edit cannot drop below what arrived; a delivery cannot go past what is owed —
// not even two at once; «إنذار التوريد» counts from the server's day and its filter, its sort and
// the DTO agree; «المستلم حتى الآن» typed on a new contract is its first delivery, read by every
// figure as one; and every delete is soft. The attachments and the grants are
// `fleet-vehicle-contract-files.spec.ts`.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  CreateFleetVehicleContractSchema,
  FleetVehicleContractSummaryQuerySchema,
  ListFleetVehicleContractsQuerySchema,
  type FleetVehicleContractDto,
} from '@ecms/contracts';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { type AuthContext } from '../../src/shared/types';
import { cairoDayOf } from '../../src/modules/fleet/fleet-cairo-day';
import { FleetVehicleTypeModel } from '../../src/modules/fleet/vehicle-types/vehicle-type.model';
import { FleetVehicleContractModel } from '../../src/modules/fleet/vehicle-contracts/vehicle-contract.model';
import { fleetVehicleContractService as service } from '../../src/modules/fleet/vehicle-contracts/vehicle-contract.service';
import {
  URL_,
  auth,
  bootVehicleContracts,
  create,
  created,
  data,
  makeType,
  receive,
  stopVehicleContracts,
} from './helpers/vehicle-contract-fixture';

let app: Express;
let admin = '';
let adminId = '';
let viewer = '';
let typeA = '';
let typeB = '';
let typeOff = '';

beforeAll(async () => {
  ({ app, admin, adminId, viewer, typeA, typeB, typeOff } = await bootVehicleContracts());
}, 240_000);

afterAll(stopVehicleContracts);

describe('a contract — only a date and one line are required', () => {
  it('saves {date, lines:[{typeId,count}]} as «عقد رقم 1», then 2', async () => {
    const first = await created({ date: '2026-10-01', lines: [{ typeId: typeA, count: 3 }] });
    const second = await created({ date: '2026-10-02', lines: [{ typeId: typeB, count: 1 }] });
    expect(first).toMatchObject({ no: 1, name: '', supplier: '', deadline: null, total: 0 });
    expect(first.lines[0]).toMatchObject({
      typeName: { ar: 'غزالة' },
      unitPrice: null,
      total: null,
    });
    expect(second.no).toBe(2);
  });

  it('refuses an inactive or unknown make with 422, naming the line', async () => {
    for (const typeId of [typeOff, new Types.ObjectId().toString()]) {
      const res = await create({ date: '2026-10-01', lines: [{ typeId, count: 1 }] });
      expect(res.status).toBe(422);
      expect(res.body.error.details).toEqual([
        expect.objectContaining({ field: 'lines.0.typeId', code: 'INACTIVE_TYPE' }),
      ]);
    }
  });

  it('still names a make that was retired after the contract named it', async () => {
    const retiring = await makeType('ستُوقف');
    const dto = await created({ date: '2026-10-01', lines: [{ typeId: retiring, count: 2 }] });
    await FleetVehicleTypeModel.updateOne({ _id: retiring }, { $set: { isActive: false } });
    const read = data<FleetVehicleContractDto>(
      await request(app).get(`${URL_}/${dto.id}`).set(auth(viewer)),
    );
    expect(read.lines[0]?.typeName?.ar).toBe('ستُوقف');
    // …and an edit that keeps that line keeps its retired make.
    const kept = await request(app)
      .patch(`${URL_}/${dto.id}`)
      .set(auth(admin))
      .send({
        date: '2026-10-01',
        name: 'x',
        version: read.version,
        lines: [{ id: read.lines[0]?.id, typeId: retiring, count: 3 }],
      });
    expect(kept.status).toBe(200);
  });
});

describe('editing the lines', () => {
  it('is versioned, and cannot go below what arrived nor drop a line cars arrived on', async () => {
    const dto = await created({
      date: '2026-10-03',
      lines: [
        { typeId: typeA, count: 10, unitPrice: 100 },
        { typeId: typeB, count: 5 },
      ],
    });
    const [a, b] = dto.lines;
    const got = await receive(dto.id, {
      date: '2026-10-04',
      version: dto.version,
      counts: [{ lineId: a?.id, count: 6 }],
    });
    expect(got.status).toBe(201);
    const v = data<FleetVehicleContractDto>(got).version;
    const patch = (lines: unknown[], version = v) =>
      request(app)
        .patch(`${URL_}/${dto.id}`)
        .set(auth(admin))
        .send({ date: '2026-10-03', version, lines });

    expect(
      (
        await patch(
          [
            { id: a?.id, typeId: typeA, count: 10 },
            { id: b?.id, typeId: typeB, count: 5 },
          ],
          dto.version,
        )
      ).status,
    ).toBe(409);
    const below = await patch([
      { id: a?.id, typeId: typeA, count: 5 },
      { id: b?.id, typeId: typeB, count: 5 },
    ]);
    expect(below.status).toBe(422);
    expect(below.body.error.details[0]).toMatchObject({
      field: 'lines.0.count',
      code: 'BELOW_RECEIVED',
    });
    const dropped = await patch([{ id: b?.id, typeId: typeB, count: 5 }]);
    expect(dropped.status).toBe(422);
    expect(dropped.body.error.details[0]).toMatchObject({ code: 'LINE_RECEIVED' });

    // Down to exactly what arrived, a new line, and a line dropped that nothing arrived on.
    const ok = await patch([
      { id: a?.id?.toUpperCase(), typeId: typeA, count: 6, unitPrice: 100 },
      { id: null, typeId: typeB, count: 2, unitPrice: 0.5 },
    ]);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const after = data<FleetVehicleContractDto>(ok);
    expect(after.lines.map((l) => [l.id === a?.id, l.count, l.received])).toEqual([
      [true, 6, 6],
      [false, 2, 0],
    ]);
    expect(after.total).toBe(601);
    expect(after.deliveries).toHaveLength(1); // an edit never touches the deliveries

    // A line's make changes — to an active make only.
    const fresh = after.lines[1];
    const remake = (typeId: string) =>
      patch(
        [
          { id: a?.id, typeId: typeA, count: 6, unitPrice: 100 },
          { id: fresh?.id, typeId, count: 2, unitPrice: 0.5 },
        ],
        after.version,
      );
    expect((await remake(typeOff)).body.error.details[0]).toMatchObject({
      field: 'lines.1.typeId',
      code: 'INACTIVE_TYPE',
    });
    const remade = await remake(typeA);
    expect(remade.status).toBe(200);
    expect(data<FleetVehicleContractDto>(remade).lines[1]).toMatchObject({
      id: fresh?.id,
      typeId: typeA,
    });
  });
});

describe('«تسجيل استلام»', () => {
  it('adds, refuses over-delivery and an unknown line, edits, and deletes softly', async () => {
    const dto = await created({
      date: '2026-10-05',
      lines: [
        { typeId: typeA, count: 10 },
        { typeId: typeB, count: 4 },
      ],
    });
    const [a, b] = dto.lines;
    const first = await receive(dto.id, {
      date: '2026-10-06',
      version: 0,
      counts: [{ lineId: a?.id, count: 8 }],
    });
    expect(data<FleetVehicleContractDto>(first)).toMatchObject({ received: 8, remaining: 6 });

    const over = await receive(dto.id, {
      date: '2026-10-07',
      version: 1,
      counts: [
        { lineId: b?.id, count: 1 },
        { lineId: a?.id, count: 3 },
      ],
    });
    expect(over.status).toBe(422);
    expect(over.body.error.details).toEqual([
      expect.objectContaining({ field: 'counts.1.count', code: 'OVER_REMAINING' }),
    ]);
    const unknown = await receive(dto.id, {
      date: '2026-10-07',
      version: 1,
      counts: [{ lineId: new Types.ObjectId().toString(), count: 1 }],
    });
    expect(unknown.body.error.details[0]).toMatchObject({
      field: 'counts.0.lineId',
      code: 'UNKNOWN_LINE',
    });
    expect(
      (
        await receive(dto.id, {
          date: '2026-10-07',
          version: 0,
          counts: [{ lineId: b?.id, count: 1 }],
        })
      ).status,
    ).toBe(409);
    expect((await FleetVehicleContractModel.findById(dto.id).lean())?.deliveries).toHaveLength(1);

    const second = data<FleetVehicleContractDto>(
      await receive(dto.id, {
        date: '2026-10-05',
        version: 1,
        counts: [{ lineId: b?.id, count: 4 }],
      }),
    );
    // Dated before the first, so it is «الاستلام الأول» now.
    expect(second.deliveries.map((d) => [d.no, d.total, d.receivedAfter])).toEqual([
      [1, 4, 4],
      [2, 8, 12],
    ]);
    const eight = second.deliveries[1];
    // Edit: its own 8 are given back, so 10 fits; 11 does not.
    const edit = (count: number) =>
      request(app)
        .patch(`${URL_}/${dto.id}/deliveries/${eight?.id}`)
        .set(auth(admin))
        .send({ date: '2026-10-06', version: second.version, counts: [{ lineId: a?.id, count }] });
    expect((await edit(11)).status).toBe(422);
    const edited = await edit(10);
    expect(edited.status).toBe(200);
    expect(data<FleetVehicleContractDto>(edited).remaining).toBe(0);

    const removed = await request(app)
      .delete(`${URL_}/${dto.id}/deliveries/${second.deliveries[0]?.id}`)
      .set(auth(admin));
    expect(removed.status).toBe(200);
    const left = data<FleetVehicleContractDto>(removed);
    expect(left.deliveries.map((d) => [d.no, d.total])).toEqual([[1, 10]]);
    expect(left.remaining).toBe(4);
    const raw = await FleetVehicleContractModel.findById(dto.id).lean();
    expect(raw?.deliveries.filter((d) => d.isDeleted)).toHaveLength(1);
  });

  it('lets exactly one of two deliveries on the same version through', async () => {
    const dto = await created({ date: '2026-10-05', lines: [{ typeId: typeA, count: 5 }] });
    const input = {
      date: new Date('2026-10-06'),
      version: 0,
      counts: [{ lineId: dto.lines[0]?.id ?? '', count: 5 }],
    };
    const results = await Promise.allSettled([
      service.addDelivery(dto.id, input, adminId),
      service.addDelivery(dto.id, input, adminId),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { httpStatus: 409 },
    });
    expect((await service.get(dto.id, new Date())).received).toBe(5);
  });
});

describe('«المستلم حتى الآن» on a new contract — its first delivery, in the same insert', () => {
  /** A direct caller's context: the admin, holding `receive` or not. */
  const ctxOf = (receive: boolean): AuthContext => ({
    userId: adminId,
    sessionId: 'vc-received',
    branchId: null,
    departmentId: null,
    sectionId: null,
    locale: 'ar',
    permissions: {
      'fleetVehicleContract.create': 'organization',
      ...(receive ? { 'fleetVehicleContract.receive': 'organization' } : {}),
    },
    permissionVersion: 0,
    isPrivileged: false,
  });
  const patchContract = (id: string, body: Record<string, unknown>) =>
    request(app).patch(`${URL_}/${id}`).set(auth(admin)).send(body);

  it('records 15 of 22 and 11 of 11 as «الاستلام الأول» on the day given', async () => {
    // His sample: Sprinter 516 ×22 with 15 received, Axor 915 ×11 with all 11, on 2026/11/01.
    const dto = await created({
      date: '2026-01-10',
      supplier: 'مورد الاستلام الأول',
      lines: [
        { typeId: typeA, count: 22, unitPrice: 4_700_000, received: 15 },
        { typeId: typeB, count: 11, unitPrice: 5_400_000, received: 11 },
      ],
      receivedDate: '2026-11-01',
    });
    expect(dto).toMatchObject({ contracted: 33, received: 26, remaining: 7, version: 0 });
    expect(dto.lines.map((l) => [l.count, l.received, l.remaining])).toEqual([
      [22, 15, 7],
      [11, 11, 0],
    ]);
    expect(dto.deliveries).toHaveLength(1);
    expect(dto.deliveries[0]).toMatchObject({
      no: 1,
      date: '2026-11-01',
      total: 26,
      receivedAfter: 26,
      remainingAfter: 7,
    });
    expect(dto.deliveries[0]?.counts).toEqual([
      { lineId: dto.lines[0]?.id, count: 15 },
      { lineId: dto.lines[1]?.id, count: 11 },
    ]);
    // Stored as «تسجيل استلام» stores one: the UTC midnight of the day, live, by the caller.
    const raw = await FleetVehicleContractModel.findById(dto.id).lean();
    expect(raw?.deliveries).toHaveLength(1);
    expect(raw?.deliveries[0]).toMatchObject({
      date: new Date('2026-11-01T00:00:00.000Z'),
      isDeleted: false,
      deletedAt: null,
    });
    expect(String(raw?.deliveries[0]?.createdBy)).toBe(adminId);
    expect(String(raw?.deliveries[0]?.updatedBy)).toBe(adminId);
    // …and read back the same way.
    const read = data<FleetVehicleContractDto>(
      await request(app).get(`${URL_}/${dto.id}`).set(auth(viewer)),
    );
    expect(read).toMatchObject({ received: 26, remaining: 7 });
    expect(read.deliveries).toEqual(dto.deliveries);
  });

  it('leaves a line with nothing received out of the delivery, and «تسجيل استلام» adds after it', async () => {
    const dto = await created({
      date: '2026-10-01',
      lines: [
        { typeId: typeA, count: 5, received: 0 },
        { typeId: typeB, count: 3, received: 2 },
      ],
      receivedDate: '2026-10-02',
    });
    const [a, b] = dto.lines;
    expect(dto.deliveries[0]?.counts).toEqual([{ lineId: b?.id, count: 2 }]);
    // Only 1 is still owed on that line — the opening delivery counts in «أكثر من المتبقي».
    const over = await receive(dto.id, {
      date: '2026-10-05',
      version: 0,
      counts: [{ lineId: b?.id, count: 2 }],
    });
    expect(over.status).toBe(422);
    expect(over.body.error.details[0]).toMatchObject({ code: 'OVER_REMAINING' });
    const next = await receive(dto.id, {
      date: '2026-10-05',
      version: 0,
      counts: [
        { lineId: a?.id, count: 5 },
        { lineId: b?.id, count: 1 },
      ],
    });
    expect(next.status, JSON.stringify(next.body)).toBe(201);
    const after = data<FleetVehicleContractDto>(next);
    expect(after.deliveries.map((d) => [d.no, d.date, d.total, d.remainingAfter])).toEqual([
      [1, '2026-10-02', 2, 6],
      [2, '2026-10-05', 6, 0],
    ]);
    expect(after.remaining).toBe(0);
  });

  it('writes `deliveries: []` exactly as before when nothing is received — untyped or all 0', async () => {
    const untyped = await created({ date: '2026-10-01', lines: [{ typeId: typeA, count: 2 }] });
    const zeros = await created({
      date: '2026-10-01',
      lines: [
        { typeId: typeA, count: 2, received: 0 },
        { typeId: typeB, count: 1, received: 0 },
      ],
      receivedDate: '2026-10-05', // ignored: nothing was received
    });
    for (const dto of [untyped, zeros]) {
      expect(dto).toMatchObject({ received: 0, remaining: dto.contracted, deliveries: [] });
      expect((await FleetVehicleContractModel.findById(dto.id).lean())?.deliveries).toEqual([]);
    }
  });

  it('has no alarm once all is received, even three days before the deadline', async () => {
    const NOW = new Date('2026-10-19T10:00:00.000Z');
    const S = 'مورد الإنذار والمستلم';
    const body = (received: number) => ({
      date: '2026-09-01',
      deadline: '2026-10-22',
      supplier: S,
      lines: [{ typeId: typeA, count: 4, received }],
      receivedDate: '2026-10-01',
    });
    const full = await created(body(4));
    const part = await created(body(1));
    expect((await service.get(full.id, NOW)).alarm).toBeNull();
    expect((await service.get(part.id, NOW)).alarm).toMatchObject({
      level: 'red',
      days: 3,
      left: 3,
    });
    // The filter agrees with the DTO.
    const red = await service.list(
      ListFleetVehicleContractsQuerySchema.parse({ suppliers: S, alarm: 'red,yellow' }),
      NOW,
    );
    expect(red.items.map((c) => c.id)).toEqual([part.id]);
  });

  it('counts in the list’s received share and remaining, and in «الإحصائيات»', async () => {
    const S = 'مورد المستلم عند التسجيل';
    const half = await created({
      date: '2026-07-01',
      supplier: S,
      lines: [{ typeId: typeA, count: 10, received: 5 }],
      receivedDate: '2026-07-02',
    });
    const most = await created({
      date: '2026-07-02',
      supplier: S,
      lines: [{ typeId: typeA, count: 4, unitPrice: 1_000, received: 3 }],
      receivedDate: '2026-07-02',
    });
    const none = await created({
      date: '2026-07-03',
      supplier: S,
      lines: [{ typeId: typeB, count: 4 }],
    });
    const order = async (sort: string) =>
      data<FleetVehicleContractDto[]>(
        await request(app).get(URL_).query({ suppliers: S, sort }).set(auth(viewer)),
      ).map((c) => c.id);
    expect(await order('receivedShare:desc')).toEqual([most.id, half.id, none.id]);
    expect(await order('remaining:asc')).toEqual([most.id, none.id, half.id]);
    const totals = await service.summary(
      FleetVehicleContractSummaryQuerySchema.parse({ suppliers: S }),
      new Date(),
    );
    expect(totals).toEqual({ count: 3, value: 4_000, contracted: 18, received: 8 });
  });

  it('takes Cairo’s day when no day is given — at 23:30 UTC that is already tomorrow', async () => {
    const input = (receivedDate?: string | null) =>
      CreateFleetVehicleContractSchema.parse({
        date: '2026-10-31',
        lines: [{ typeId: typeA, count: 3, received: 2 }],
        ...(receivedDate === undefined ? {} : { receivedDate }),
      });
    const dayOf = async (body: ReturnType<typeof input>, now: string) =>
      (await service.create(ctxOf(true), body, new Date(now))).deliveries[0]?.date;
    // Winter (+2): 23:30Z on 10/31 is 01:30 on 11/01 in Cairo; 21:59Z is still 23:59 on 10/31.
    expect(await dayOf(input(), '2026-10-31T23:30:00.000Z')).toBe('2026-11-01');
    expect(await dayOf(input(null), '2026-10-31T21:59:00.000Z')).toBe('2026-10-31');
    expect(await dayOf(input(null), '2026-10-31T22:00:00.000Z')).toBe('2026-11-01');
    // Summer (+3): 21:30Z on 07/15 is 00:30 on 07/16.
    expect(await dayOf(input(), '2026-07-15T21:30:00.000Z')).toBe('2026-07-16');
    // A day the form gives is kept as given, whatever the hour.
    expect(await dayOf(input('2026-10-31'), '2026-10-31T23:30:00.000Z')).toBe('2026-10-31');
    // Over HTTP, with no day and with `null`: today, in Cairo.
    for (const extra of [{}, { receivedDate: null }]) {
      const before = cairoDayOf(new Date());
      const dto = await created({
        date: '2026-10-31',
        lines: [{ typeId: typeA, count: 3, received: 1 }],
        ...extra,
      });
      const after = cairoDayOf(new Date());
      expect([before, after]).toContain(dto.deliveries[0]?.date);
    }
  });

  it('is refused (403) without `receive` — before a number is spent — and saved without received cars', async () => {
    const contract = (received: number) =>
      CreateFleetVehicleContractSchema.parse({
        date: '2026-10-20',
        lines: [{ typeId: typeA, count: 3, received }],
      });
    const previous = await service.create(ctxOf(false), contract(0));
    const contracts = await FleetVehicleContractModel.countDocuments();
    await expect(service.create(ctxOf(false), contract(1))).rejects.toMatchObject({
      httpStatus: 403,
    });
    expect(await FleetVehicleContractModel.countDocuments()).toBe(contracts);
    const next = await service.create(ctxOf(false), contract(0));
    expect(next.no).toBe(previous.no + 1); // the refused one took no number
    expect(next.deliveries).toEqual([]);
    // With the grant, the same body is a contract and its first delivery.
    expect((await service.create(ctxOf(true), contract(1))).received).toBe(1);
  });

  it('refuses over the count, a negative or a fraction, and an unknown key on a line (400)', async () => {
    const base = { date: '2026-10-20', receivedDate: '2026-10-20' };
    const over = await create({ ...base, lines: [{ typeId: typeA, count: 22, received: 25 }] });
    expect(over.status).toBe(400);
    expect(over.body.error.details).toEqual([
      expect.objectContaining({ field: 'body.lines.0.received' }),
    ]);
    for (const received of [-1, 1.5]) {
      const res = await create({ ...base, lines: [{ typeId: typeA, count: 3, received }] });
      expect(res.status).toBe(400);
    }
    const stranger = await create({
      ...base,
      lines: [{ typeId: typeA, count: 3, received: 1, delivered: 1 }],
    });
    expect(stranger.status).toBe(400);
    expect(
      (await create({ ...base, lines: [{ typeId: typeA, count: 3 }], receivedDate: 'x' })).status,
    ).toBe(400);
  });

  it('locks what arrived; the opening delivery edits and deletes with the existing pen and bin', async () => {
    const dto = await created({
      date: '2026-10-03',
      lines: [
        { typeId: typeA, count: 10, received: 6 },
        { typeId: typeB, count: 5 },
      ],
      receivedDate: '2026-10-04',
    });
    const [a, b] = dto.lines;
    const opening = dto.deliveries[0];
    const lines = (count: number) => [
      { id: a?.id, typeId: typeA, count },
      { id: b?.id, typeId: typeB, count: 5 },
    ];

    const below = await patchContract(dto.id, { date: '2026-10-03', version: 0, lines: lines(5) });
    expect(below.status).toBe(422);
    expect(below.body.error.details[0]).toMatchObject({
      field: 'lines.0.count',
      code: 'BELOW_RECEIVED',
    });
    const dropped = await patchContract(dto.id, {
      date: '2026-10-03',
      version: 0,
      lines: [{ id: b?.id, typeId: typeB, count: 5 }],
    });
    expect(dropped.status).toBe(422);
    expect(dropped.body.error.details[0]).toMatchObject({ code: 'LINE_RECEIVED' });

    // The pen: its own 6 are given back, so 10 fits on its line and 11 does not.
    const pen = (count: number, version: number) =>
      request(app)
        .patch(`${URL_}/${dto.id}/deliveries/${opening?.id}`)
        .set(auth(admin))
        .send({ date: '2026-10-02', version, counts: [{ lineId: a?.id, count }] });
    expect((await pen(11, 0)).status).toBe(422);
    const edited = await pen(4, 0);
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const penned = data<FleetVehicleContractDto>(edited);
    expect(penned.deliveries.map((d) => [d.id, d.no, d.date, d.total])).toEqual([
      [opening?.id, 1, '2026-10-02', 4],
    ]);
    expect(penned.received).toBe(4);

    // The bin: soft — the cars go back to «المتبقي», the delivery stays in the document.
    const binned = await request(app)
      .delete(`${URL_}/${dto.id}/deliveries/${opening?.id}`)
      .set(auth(admin));
    expect(binned.status).toBe(200);
    const left = data<FleetVehicleContractDto>(binned);
    expect(left).toMatchObject({ received: 0, remaining: 15, deliveries: [] });
    const raw = await FleetVehicleContractModel.findById(dto.id).lean();
    expect(raw?.deliveries.map((d) => d.isDeleted)).toEqual([true]);
    // Nothing arrived now, so the line may go below 6.
    const freed = await patchContract(dto.id, {
      date: '2026-10-03',
      version: left.version,
      lines: lines(1),
    });
    expect(freed.status, JSON.stringify(freed.body)).toBe(200);
  });

  it('is never typed on an edit — `received` or `receivedDate` on PATCH is a 400', async () => {
    const dto = await created({
      date: '2026-10-07',
      lines: [{ typeId: typeA, count: 3, received: 1 }],
      receivedDate: '2026-10-07',
    });
    const id = dto.lines[0]?.id;
    const withReceived = await patchContract(dto.id, {
      date: '2026-10-07',
      version: 0,
      lines: [{ id, typeId: typeA, count: 3, received: 3 }],
    });
    expect(withReceived.status).toBe(400);
    const withDay = await patchContract(dto.id, {
      date: '2026-10-07',
      version: 0,
      receivedDate: '2026-10-08',
      lines: [{ id, typeId: typeA, count: 3 }],
    });
    expect(withDay.status).toBe(400);
    const read = await service.get(dto.id, new Date());
    expect(read).toMatchObject({ version: 0, received: 1 });
  });

  it('logs the opening delivery in the create record, as «تسجيل استلام» logs one', async () => {
    const auditOf = async (id: string) =>
      (
        await AuditLogModel.find({
          'entityRef.entityType': 'vehicleContract',
          'entityRef.entityId': id,
        })
          .lean()
          .exec()
      ).map((row) => ({ action: row.action, changes: row.changes }));
    const dto = await created({
      date: '2026-10-06',
      lines: [
        { typeId: typeA, count: 3 },
        { typeId: typeB, count: 2, received: 2 },
      ],
      receivedDate: '2026-10-06',
    });
    const rows = await auditOf(dto.id);
    expect(rows.map((row) => row.action)).toEqual(['create']);
    const changes = rows[0]?.changes ?? [];
    expect(changes.map((c) => c.field)).toEqual(
      expect.arrayContaining(['no', 'date', 'lines', `deliveries.${dto.deliveries[0]?.id}`]),
    );
    expect(changes.find((c) => c.field.startsWith('deliveries.'))).toEqual({
      field: `deliveries.${dto.deliveries[0]?.id}`,
      old: null,
      new: { date: '2026-10-06', counts: [{ lineId: dto.lines[1]?.id, count: 2 }] },
    });
    // Nothing received: no delivery in the log either.
    const plain = await created({ date: '2026-10-06', lines: [{ typeId: typeA, count: 1 }] });
    const plainChanges = (await auditOf(plain.id))[0]?.changes ?? [];
    expect(plainChanges.some((c) => c.field.startsWith('deliveries.'))).toBe(false);
  });
});

describe('«إنذار التوريد» — from the server’s day, pinned to 2026-10-19', () => {
  const NOW = new Date('2026-10-19T10:00:00.000Z');
  const ids = new Map<string, string>();
  const query = (extra: Record<string, unknown>) =>
    ListFleetVehicleContractsQuerySchema.parse({
      suppliers: 'مورد الإنذار',
      pageSize: 50,
      ...extra,
    });

  beforeAll(async () => {
    const plan: [string, string, boolean][] = [
      ['red5', '2026-10-24', false],
      ['yellow22', '2026-11-10', false],
      ['overdue', '2026-10-10', false],
      ['far73', '2026-12-31', false],
      ['done', '2026-10-22', true],
      ['d30', '2026-11-18', false],
      ['d31', '2026-11-19', false],
      ['d7', '2026-10-26', false],
      ['d8', '2026-10-27', false],
    ];
    for (const [key, deadline, full] of plan) {
      const dto = await created({
        date: '2026-09-01',
        deadline,
        supplier: 'مورد الإنذار',
        lines: [{ typeId: typeA, count: 2 }],
      });
      if (full)
        await receive(dto.id, {
          date: '2026-10-01',
          version: 0,
          counts: [{ lineId: dto.lines[0]?.id, count: 2 }],
        });
      ids.set(dto.id, key);
    }
  });

  it('gives each its level and days in the DTO', async () => {
    const page = await service.list(query({}), NOW);
    const seen = Object.fromEntries(
      page.items.map((c) => [ids.get(c.id), c.alarm && [c.alarm.level, c.alarm.days]]),
    );
    expect(seen).toEqual({
      red5: ['red', 5],
      yellow22: ['yellow', 22],
      overdue: ['red', -9],
      far73: null,
      done: null,
      d30: ['yellow', 30],
      d31: null,
      d7: ['red', 7],
      d8: ['yellow', 8],
    });
  });

  it('filters exactly the contracts the DTO marks', async () => {
    const keys = async (alarm: string) =>
      (await service.list(query({ alarm }), NOW)).items.map((c) => ids.get(c.id)).sort();
    expect(await keys('red')).toEqual(['d7', 'overdue', 'red5']);
    expect(await keys('yellow')).toEqual(['d30', 'd8', 'yellow22']);
    expect(await keys('red,yellow')).toHaveLength(6);
  });

  it('sorts by urgency — overdue first, then the nearest — and no alarm last either way', async () => {
    const order = async (sort: string) =>
      (await service.list(query({ sort }), NOW)).items.map((c) => ids.get(c.id));
    const desc = await order('alarmRank:desc');
    expect(desc.slice(0, 6)).toEqual(['overdue', 'red5', 'd7', 'd8', 'yellow22', 'd30']);
    expect(new Set(desc.slice(6))).toEqual(new Set(['far73', 'done', 'd31']));
    const asc = await order('alarmRank:asc');
    expect(asc.slice(0, 6)).toEqual(['d30', 'yellow22', 'd8', 'd7', 'red5', 'overdue']);
  });
});

describe('the list, its figures and its filters', () => {
  const S = 'شركة النصر للسيارات';
  let big: FleetVehicleContractDto;
  let small: FleetVehicleContractDto;

  beforeAll(async () => {
    big = await created({
      date: '2026-08-10',
      supplier: S,
      lines: [
        { typeId: typeA, count: 22, unitPrice: 4_700_000 },
        { typeId: typeB, count: 11, unitPrice: 5_400_000 },
      ],
    });
    small = await created({
      date: '2026-08-20',
      supplier: S,
      lines: [{ typeId: typeB, count: 4, unitPrice: 1_000_000.25 }],
    });
    await receive(small.id, {
      date: '2026-08-21',
      version: 0,
      counts: [{ lineId: small.lines[0]?.id, count: 3 }],
    });
    const gone = await created({
      date: '2026-08-15',
      supplier: 'مورد محذوف',
      lines: [{ typeId: typeA, count: 1 }],
    });
    expect((await request(app).delete(`${URL_}/${gone.id}`).set(auth(admin))).status).toBe(204);
  });

  const list = async (params: Record<string, unknown>) =>
    data<FleetVehicleContractDto[]>(
      await request(app)
        .get(URL_)
        .query({ suppliers: S, ...params })
        .set(auth(viewer)),
    ).map((c) => c.id);

  it('filters by period, make and supplier, and sorts by total and received share', async () => {
    expect(await list({ from: '2026-08-15', to: '2026-08-20' })).toEqual([small.id]);
    expect(await list({ typeIds: typeA })).toEqual([big.id]);
    expect(await list({ sort: 'total:asc' })).toEqual([small.id, big.id]);
    expect(await list({ sort: 'receivedShare:desc' })).toEqual([small.id, big.id]);
    expect(await list({})).toEqual([small.id, big.id]); // newest contract first
  });

  it('sums the whole filtered set in «الإحصائيات»', async () => {
    const totals = await service.summary(
      FleetVehicleContractSummaryQuerySchema.parse({ suppliers: S }),
      new Date(),
    );
    expect(totals).toEqual({ count: 2, value: 166_800_001, contracted: 37, received: 3 });
  });

  it('offers the live, named suppliers once each', async () => {
    const names = data<string[]>(await request(app).get(`${URL_}/suppliers`).set(auth(viewer)));
    expect(names.filter((n) => n === S)).toHaveLength(1);
    expect(names).not.toContain('مورد محذوف');
    expect(names).not.toContain('');
  });
});

describe('a deleted contract', () => {
  it('is a 404, stays in the collection, and its number is never reused', async () => {
    const dto = await created({ date: '2026-10-09', lines: [{ typeId: typeA, count: 1 }] });
    expect((await request(app).delete(`${URL_}/${dto.id}`).set(auth(admin))).status).toBe(204);
    expect((await request(app).get(`${URL_}/${dto.id}`).set(auth(admin))).status).toBe(404);
    expect(await FleetVehicleContractModel.countDocuments({ _id: dto.id, isDeleted: true })).toBe(
      1,
    );
    const next = await created({ date: '2026-10-09', lines: [{ typeId: typeA, count: 1 }] });
    expect(next.no).toBe(dto.no + 1);
  });
});
