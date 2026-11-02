// «ربط الكروت بالسيارات» and «كروت في الشيت وليست في النظام» against a real mongo:
//
//   1. a swap is ONE decision — both cards or neither; a held slot writes nothing; a card moved
//      since the read is refused (`LINK_CHANGED`); each ✓ leaves one `sheetLink` line and an
//      audit; ✗ leaves no line in the card's log; a balance ✓ after a link is not refused;
//   2. the 0849 pair waits for the repair (`IN_REPAIR`); an unknown code needs a pick, and
//      «تذكّر هذا الكود» teaches it — the next sheet resolves it by the alias;
//   3. «إضافة» writes the card and its opening line; a masked number must be typed and fit; a
//      number already held is refused; each grant is the cards screen's own;
//   4. the go-live spellings are seeded INSERT-ONLY — what the owner taught survives a re-seed.
//
// Shares `helpers/fuel-reconcile-world.ts` with the read, decide and cancel specs.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  ErrorCodes,
  type FleetFuelCardDto,
  type FleetFuelLinkResultDto,
  type FleetFuelReconcileDto,
} from '@ecms/contracts';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import {
  FleetFuelCardModel,
  type FleetFuelCardDoc,
} from '../../src/modules/fleet/fuel-cards/fuel-card.model';
import { FleetFuelReconciliationModel } from '../../src/modules/fleet/fuel-cards/reconcile/fuel-reconcile.model';
import { FleetFuelSheetCodeModel } from '../../src/modules/fleet/fuel-cards/reconcile/fuel-sheet-codes.model';
import {
  FUEL_SHEET_CODE_SEED,
  seedFuelSheetCodes,
} from '../../src/modules/fleet/fuel-cards/reconcile/fuel-sheet-codes';
import {
  CARDS,
  RECONCILE,
  auth,
  card,
  data,
  decide,
  failure,
  log,
  masked,
  mkCard,
  movementCount,
  readSheet,
  useFuelReconcileWorld,
  world,
} from './helpers/fuel-reconcile-world';
import { type FuelSheetCell } from './helpers/fuel-sheet-workbook';

useFuelReconcileWorld('reconcile-links');
const { tokens } = world;

let seq = 0;
/** A registry car of this file — unique code, plate, chassis and motor. */
const mkVehicle = async (code: string, over: Record<string, unknown> = {}) => {
  seq += 1;
  return (
    await FleetVehicleModel.create({
      code,
      typeId: new Types.ObjectId(),
      plateNumber: `L-${String(seq)}-${code}`,
      chassisNumber: `9${String(seq).padStart(5, '0')}`,
      motorNumber: `M-${String(seq)}-${code}`,
      joinedAt: new Date('2025-01-01'),
      licenseExpiresAt: new Date('2027-01-01'),
      branchId: new Types.ObjectId(),
      ...over,
    })
  ).toObject();
};

const HEADER: FuelSheetCell[] = ['Card Number', 'Card Name', 'Card Balance', 'كود'];
const rowAt = (c: FleetFuelCardDoc, code: string | null, balance = c.balance): FuelSheetCell[] => [
  masked(c),
  c.name,
  balance,
  code,
];

const decideLinks = (
  id: string,
  decision: 'apply' | 'reject',
  cardIds: string[],
  extra: {
    pick?: { cardId: string; vehicleId: string | null; label?: string | null }[];
    remember?: boolean;
  } = {},
  token = tokens.linker,
) =>
  request(world.app)
    .post(`${RECONCILE}/${id}/links`)
    .set(...auth(token))
    .send({ decision, cardIds, ...extra });

const addCard = (id: string, body: Record<string, unknown>, token = tokens.linker) =>
  request(world.app)
    .post(`${RECONCILE}/${id}/cards`)
    .set(...auth(token))
    .send(body);

const linkOf = (dto: FleetFuelReconcileDto, cardId: Types.ObjectId) =>
  dto.links.find((link) => link.card.id === String(cardId));

describe('a swap, a held slot, a card moved since the read', () => {
  it('two cards swap cars in ONE decision — one sheetLink line each, audited; ✗ writes no line', async () => {
    const va = await mkVehicle('S-A1');
    const vb = await mkVehicle('S-B1');
    const x = await mkCard('wataniya', 'EGYCASH-SWAP-X', 10, { vehicleId: va._id, label: null });
    const y = await mkCard('wataniya', 'EGYCASH-SWAP-Y', 20, { vehicleId: vb._id, label: null });
    const dto = await readSheet('wataniya', [HEADER, rowAt(x, 'S-B1'), rowAt(y, 's-a1')]);
    expect(dto.carColumn).toBe(true);
    expect(dto.equal.map((l) => l.placeMatches)).toEqual([false, false]);
    expect(
      dto.links.map((l) => [l.card.id, l.kind, l.to?.vehicleCode, l.pairWith, l.decision]),
    ).toEqual([
      [String(x._id), 'move', 'S-B1', String(y._id), null],
      [String(y._id), 'move', 'S-A1', String(x._id), null],
    ]);

    // One half of the swap alone: its target still holds the other — nothing written.
    const movements = await movementCount();
    const half = await decideLinks(dto.id, 'apply', [String(x._id)]);
    expect([half.status, failure(half)]).toEqual([
      409,
      expect.objectContaining({
        code: ErrorCodes.FLEET_FUEL_LINK_SLOT_HELD,
        details: [{ field: 'cardIds', code: 'SLOT_HELD', message: String(x._id) }],
      }),
    ]);
    expect(await movementCount()).toBe(movements);
    expect(String((await card(x._id)).vehicleId)).toBe(String(va._id));

    const both = await decideLinks(dto.id, 'apply', [String(x._id), String(y._id)]);
    expect(both.status, both.text).toBe(200);
    expect(
      data<FleetFuelLinkResultDto[]>(both).map((r) => [
        r.from.vehicleCode,
        r.to.vehicleCode,
        r.byName,
      ]),
    ).toEqual([
      ['S-A1', 'S-B1', 'منى حسن'],
      ['S-B1', 'S-A1', 'منى حسن'],
    ]);
    expect(String((await card(x._id)).vehicleId)).toBe(String(vb._id));
    expect(String((await card(y._id)).vehicleId)).toBe(String(va._id));
    const [line] = await log(x._id);
    expect(line).toMatchObject({
      kind: 'sheetLink',
      amount: 0,
      balanceAfter: 10,
      sheet: null,
      link: {
        from: { vehicleCode: 'S-A1', label: null },
        to: { vehicleCode: 'S-B1', label: null },
        sheetCode: 'S-B1',
        reconciliationId: dto.id,
        fileName: 'أرصدة وطنية.xlsx',
      },
    });
    const audit = await AuditLogModel.findOne({
      'entityRef.entityType': 'fuelCard',
      'entityRef.entityId': String(x._id),
      action: 'update',
    })
      .lean()
      .exec();
    expect(audit?.changes).toEqual([
      { field: 'vehicleId', old: String(va._id), new: String(vb._id) },
      { field: 'reconciliation', old: null, new: dto.id },
    ]);
    // Decided once; and the log line is the sheet's — never changed here.
    expect(failure(await decideLinks(dto.id, 'reject', [String(x._id)])).code).toBe(
      ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED,
    );
    const patched = await request(world.app)
      .patch(`${CARDS}/movements/${line?.id ?? ''}`)
      .set(...auth(tokens.clerk))
      .send({ amount: 1 });
    expect([patched.status, failure(patched).details?.[0]?.message]).toEqual([
      400,
      'a sheet line is not changed here',
    ]);
  });

  it('✗ «إبقاء» records the refusal and audits it — no line in the card’s log', async () => {
    const va = await mkVehicle('K-A1');
    await mkVehicle('K-B1');
    const x = await mkCard('wataniya', 'EGYCASH-KEEP', 10, { vehicleId: va._id, label: null });
    const dto = await readSheet('wataniya', [HEADER, rowAt(x, 'K-B1')]);
    const movements = await movementCount();
    const kept = await decideLinks(dto.id, 'reject', [String(x._id)]);
    expect(kept.status, kept.text).toBe(200);
    expect(data<FleetFuelLinkResultDto[]>(kept)[0]).toMatchObject({
      decision: 'reject',
      from: { vehicleCode: 'K-A1' },
      to: { vehicleCode: 'K-A1' },
    });
    expect(await movementCount()).toBe(movements);
    expect(String((await card(x._id)).vehicleId)).toBe(String(va._id));
    const stored = await FleetFuelReconciliationModel.findById(dto.id).lean().exec();
    expect(stored?.links?.[0]?.decision).toBe('reject');
    expect(
      await AuditLogModel.countDocuments({
        'entityRef.entityId': String(x._id),
        action: 'reject',
      }).exec(),
    ).toBe(1);
  });

  it('a card moved since the read: LINK_CHANGED, nothing written', async () => {
    const va = await mkVehicle('C-A1');
    await mkVehicle('C-B1');
    const vc = await mkVehicle('C-C1');
    const x = await mkCard('wataniya', 'EGYCASH-MOVED', 10, { vehicleId: va._id, label: null });
    const dto = await readSheet('wataniya', [HEADER, rowAt(x, 'C-B1')]);
    // Moved by hand on «بطاقات الوقود» after the read.
    await FleetFuelCardModel.updateOne(
      { _id: x._id },
      { $set: { vehicleId: vc._id }, $inc: { __v: 1 } },
    ).exec();
    const res = await decideLinks(dto.id, 'apply', [String(x._id)]);
    expect([res.status, failure(res)]).toEqual([
      409,
      expect.objectContaining({
        code: ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED,
        details: [{ field: 'cardIds', code: 'LINK_CHANGED', message: String(x._id) }],
      }),
    ]);
    expect(String((await card(x._id)).vehicleId)).toBe(String(vc._id));
  });

  it('a balance ✓ after a link decision is not refused — a link moves no money', async () => {
    const va = await mkVehicle('B-A1');
    const vb = await mkVehicle('B-B1');
    const x = await mkCard('wataniya', 'EGYCASH-BOTH', 100, { vehicleId: va._id, label: null });
    const dto = await readSheet('wataniya', [HEADER, rowAt(x, 'B-B1', 140)]);
    expect((await decideLinks(dto.id, 'apply', [String(x._id)])).status).toBe(200);
    const applied = await decide(dto.id, 'apply', [String(x._id)]);
    expect(applied.status, applied.text).toBe(200);
    expect(await card(x._id)).toMatchObject({ balance: 140, vehicleId: vb._id });
  });

  it('a sheet without a car-code column proposes no link', async () => {
    const va = await mkVehicle('N-A1');
    const x = await mkCard('wataniya', 'EGYCASH-NOCODE', 10, { vehicleId: va._id, label: null });
    const dto = await readSheet('wataniya', [
      ['Card Number', 'Card Name', 'Card Balance'],
      [masked(x), x.name, 10],
    ]);
    expect([dto.carColumn, dto.links, dto.equal[0]?.placeMatches]).toEqual([false, [], null]);
  });
});

describe('the repair pair, an unknown code', () => {
  it('a card of the 0849 pair: ✓ refused until the repair, ✗ allowed', async () => {
    const va = await mkVehicle('R-283');
    await mkVehicle('R-530');
    const p = await mkCard('wataniya', 'EGYCASH-1137-401485', 10, {
      vehicleId: va._id,
      label: null,
      number: '5485640006880849',
    });
    const dto = await readSheet('wataniya', [HEADER, rowAt(p, 'R-530')]);
    expect(linkOf(dto, p._id)).toMatchObject({ kind: 'move', inRepair: true });
    const res = await decideLinks(dto.id, 'apply', [String(p._id)]);
    expect([res.status, failure(res).code, failure(res).details?.[0]?.code]).toEqual([
      409,
      ErrorCodes.FLEET_FUEL_LINK_IN_REPAIR,
      'IN_REPAIR',
    ]);
    expect((await decideLinks(dto.id, 'reject', [String(p._id)])).status).toBe(200);
  });

  it('an unknown code needs a pick; «تذكّر هذا الكود» teaches it to the next sheet', async () => {
    const va = await mkVehicle('U-A1');
    const vb = await mkVehicle('U-B1');
    const x = await mkCard('chillout', 'EGYCASHTCS-UNKNOWN', 10, {
      vehicleId: va._id,
      label: null,
    });
    const spelling = 'جيلي أحمر';
    const dto = await readSheet('chillout', [HEADER, rowAt(x, spelling)]);
    expect(linkOf(dto, x._id)).toMatchObject({ kind: 'unknownCode', to: null, resolvedBy: null });
    const unpicked = await decideLinks(dto.id, 'apply', [String(x._id)]);
    expect([unpicked.status, failure(unpicked).details?.[0]?.code]).toEqual([400, 'REQUIRED']);

    const picked = await decideLinks(dto.id, 'apply', [String(x._id)], {
      pick: [{ cardId: String(x._id), vehicleId: String(vb._id) }],
      remember: true,
    });
    expect(picked.status, picked.text).toBe(200);
    expect(String((await card(x._id)).vehicleId)).toBe(String(vb._id));
    const alias = await FleetFuelSheetCodeModel.findOne({ key: 'جيليأحمر' }).lean().exec();
    expect(alias).toMatchObject({ source: 'owner', sheetCode: spelling, vehicleId: vb._id });
    const audit = await AuditLogModel.findOne({
      'entityRef.entityId': String(x._id),
      action: 'update',
    })
      .lean()
      .exec();
    expect(audit?.changes).toContainEqual({ field: 'sheetCodeAlias', old: null, new: spelling });

    // The next sheet that prints it: resolved by the alias — the card where it says needs no
    // link, another card the sheet puts there is a move, resolved by the alias.
    const y = await mkCard('chillout', 'EGYCASHTCS-UNKNOWN-2', 5, {
      vehicleId: va._id,
      label: null,
    });
    const again = await readSheet('chillout', [HEADER, rowAt(x, spelling), rowAt(y, spelling)]);
    expect(linkOf(again, x._id)).toBeUndefined();
    expect(linkOf(again, y._id)).toMatchObject({
      kind: 'move',
      resolvedBy: 'alias',
      to: { vehicleId: String(vb._id) },
      slotHeldBy: { id: String(x._id) },
    });
  });

  it('a pick naming where the card already is: decided, no line in its log', async () => {
    const va = await mkVehicle('P-A1');
    const x = await mkCard('chillout', 'EGYCASHTCS-STAYS', 10, { vehicleId: va._id, label: null });
    const dto = await readSheet('chillout', [HEADER, rowAt(x, 'كود لا يعرفه أحد')]);
    const movements = await movementCount();
    const res = await decideLinks(dto.id, 'apply', [String(x._id)], {
      pick: [{ cardId: String(x._id), vehicleId: String(va._id) }],
    });
    expect(res.status, res.text).toBe(200);
    expect(data<FleetFuelLinkResultDto[]>(res)[0]).toMatchObject({
      from: { vehicleCode: 'P-A1' },
      to: { vehicleCode: 'P-A1' },
    });
    expect(await movementCount()).toBe(movements);
    const stored = await FleetFuelReconciliationModel.findById(dto.id).lean().exec();
    expect(stored?.links?.[0]).toMatchObject({ decision: 'apply', movementId: null });
  });

  it('«سفر 1» onto a car while that car’s card goes to «سفر 1» — decided together', async () => {
    const v = await mkVehicle('L-285');
    const trip = await mkCard('wataniya', 'EGYCASH-TRIP-1', 260.96, { label: 'سفر 1' });
    const c285 = await mkCard('wataniya', 'EGYCASH-ON-285', 40, { vehicleId: v._id, label: null });
    const dto = await readSheet('wataniya', [HEADER, rowAt(trip, 'L-285'), rowAt(c285, 'سفر 1')]);
    expect(dto.links.map((l) => [l.kind, l.pairWith, l.to])).toEqual([
      ['attach', String(c285._id), { vehicleId: String(v._id), vehicleCode: 'L-285', label: null }],
      ['detach', String(trip._id), { vehicleId: null, vehicleCode: null, label: 'سفر 1' }],
    ]);
    const res = await decideLinks(dto.id, 'apply', [String(trip._id), String(c285._id)]);
    expect(res.status, res.text).toBe(200);
    expect(await card(trip._id)).toMatchObject({ vehicleId: v._id, label: null });
    expect(await card(c285._id)).toMatchObject({ vehicleId: null, label: 'سفر 1' });
    expect((await log(c285._id))[0]?.link).toMatchObject({
      from: { vehicleCode: 'L-285', label: null },
      to: { vehicleId: null, label: 'سفر 1' },
    });
  });
});

describe('«إضافة» a card the sheet lists and the system does not', () => {
  it('writes the card and its opening line; added once', async () => {
    const vc = await mkVehicle('A-C1');
    const dto = await readSheet('wataniya', [
      HEADER,
      ['548**********4242', 'EGYCASH-NEW-1', 4305.09, 'A-C1'],
    ]);
    expect(dto.newCards).toEqual([
      expect.objectContaining({
        name: 'EGYCASH-NEW-1',
        numberIsFull: false,
        balance: 4305.09,
        to: { vehicleId: String(vc._id), vehicleCode: 'A-C1', label: null },
        resolvedBy: 'code',
        slotHeldBy: null,
        cardId: null,
      }),
    ]);
    const sheetRow = dto.newCards[0]?.sheetRow ?? 0;
    const base = {
      sheetRow,
      expiresAt: '2027-05-31',
      password: 'pin-ZQ7x',
      vehicleId: String(vc._id),
    };

    const noNumber = await addCard(dto.id, base);
    expect([noNumber.status, failure(noNumber).code, failure(noNumber).details?.[0]?.code]).toEqual(
      [422, ErrorCodes.FLEET_FUEL_SHEET_CARD_NUMBER, 'REQUIRED'],
    );
    const wrong = await addCard(dto.id, { ...base, number: '5485640000009999' });
    expect([wrong.status, failure(wrong).details?.[0]?.code]).toEqual([422, 'MISMATCH']);

    const added = await addCard(dto.id, { ...base, number: '5485640000004242' });
    expect(added.status, added.text).toBe(201);
    const made = data<FleetFuelCardDto>(added);
    expect(made).toMatchObject({
      company: 'wataniya',
      name: 'EGYCASH-NEW-1',
      number: '5485640000004242',
      balance: 4305.09,
      vehicleCode: 'A-C1',
      hasPassword: true,
    });
    expect(await log(made.id)).toEqual([
      expect.objectContaining({
        kind: 'sheetAdjust',
        amount: 4305.09,
        balanceAfter: 4305.09,
        sheet: expect.objectContaining({ systemBalance: 0, sheetBalance: 4305.09 }),
      }),
    ]);
    const twice = await addCard(dto.id, { ...base, number: '5485640000004242' });
    expect([twice.status, failure(twice).code]).toEqual([
      409,
      ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED,
    ]);
    // The PIN typed is the card's — and never anywhere on the session.
    const stored = await FleetFuelReconciliationModel.collection.findOne({
      _id: new Types.ObjectId(dto.id),
    });
    expect(JSON.stringify(stored)).not.toContain('pin-ZQ7x');
    expect(String(stored?.newCards?.[0]?.cardId)).toBe(made.id);
  });

  it('a number another card holds is refused', async () => {
    const other = await mkCard('wataniya', 'EGYCASH-HOLDER', 1, { number: '5485640000007777' });
    const dto = await readSheet('wataniya', [
      HEADER,
      [masked(other), other.name, 1, null],
      ['548**********7777', 'EGYCASH-NEW-2', 5, null],
    ]);
    const sheetRow = dto.newCards.find((n) => n.name === 'EGYCASH-NEW-2')?.sheetRow ?? 0;
    const res = await addCard(dto.id, {
      sheetRow,
      number: '5485640000007777',
      expiresAt: '2027-05-31',
      password: '1',
      vehicleId: null,
      label: 'سفر 9',
    });
    expect([res.status, failure(res).code]).toEqual([409, ErrorCodes.DUPLICATE]);
  });

  it('each grant is the cards screen’s own: edit for links, create for «إضافة»', async () => {
    const va = await mkVehicle('G-A1');
    await mkVehicle('G-B1');
    const x = await mkCard('wataniya', 'EGYCASH-GRANT', 1, { vehicleId: va._id, label: null });
    const dto = await readSheet('wataniya', [
      HEADER,
      rowAt(x, 'G-B1'),
      ['548**********5151', 'EGYCASH-NEW-3', 5, null],
    ]);
    expect((await decideLinks(dto.id, 'apply', [String(x._id)], {}, tokens.clerk)).status).toBe(
      403,
    );
    expect(
      (
        await addCard(
          dto.id,
          {
            sheetRow: dto.newCards[0]?.sheetRow ?? 0,
            number: '5485640000005151',
            expiresAt: '2027-05-31',
            password: '1',
            vehicleId: null,
            label: 'سفر 8',
          },
          tokens.clerk,
        )
      ).status,
    ).toBe(403);
    expect(String((await card(x._id)).vehicleId)).toBe(String(va._id));
  });

  it('«إضافة» puts the sheet’s balance on a card — so it takes the balance grant too', async () => {
    const dto = await readSheet('wataniya', [
      HEADER,
      ['5485640000006161', 'EGYCASH-X', 50_000, null],
    ]);
    const body = {
      sheetRow: dto.newCards[0]?.sheetRow ?? 0,
      expiresAt: '2027-05-31',
      password: '1',
      vehicleId: null,
      label: 'سفر 6',
    };
    // He keeps the card list (`fleetFuelCard.create`) but releases no money (no approve): refused.
    const movements = await movementCount();
    expect((await addCard(dto.id, body, tokens.creator)).status).toBe(403);
    expect(await movementCount()).toBe(movements);
    expect(await FleetFuelCardModel.countDocuments({ name: 'EGYCASH-X' }).exec()).toBe(0);
    // With both grants it is added, at the sheet's balance.
    const added = await addCard(dto.id, body);
    expect(added.status, added.text).toBe(201);
    expect(data<FleetFuelCardDto>(added)).toMatchObject({ name: 'EGYCASH-X', balance: 50_000 });
  });
});

describe('another company’s sheet — the wrong-company stop held by the server too', () => {
  const stop = [
    422,
    ErrorCodes.FLEET_FUEL_SHEET_LAYOUT,
    [{ field: 'company', code: 'WRONG_COMPANY', message: 'chillout' }],
  ];
  const said = (res: request.Response) => [res.status, failure(res).code, failure(res).details];

  it('a Chill Out sheet read as Wataniya: no ✓ / ✗, no link, no «إضافة» — nothing written', async () => {
    const va = await mkVehicle('W-A1');
    await mkVehicle('W-B1');
    // A Wataniya card that happens to carry an «EGYCASHTCS-» name, so a line differs too.
    const x = await mkCard('wataniya', 'EGYCASHTCS-1001-A', 100, {
      vehicleId: va._id,
      label: null,
    });
    const dto = await readSheet('wataniya', [
      HEADER,
      rowAt(x, 'W-B1', 900),
      ['5485640000004545', 'EGYCASHTCS-NEW-9', 7_000, null],
    ]);
    expect(dto.sheetCompany).toBe('chillout');
    expect(dto.differs.map((l) => l.card.id)).toEqual([String(x._id)]);
    expect(dto.newCards.map((n) => n.name)).toEqual(['EGYCASHTCS-NEW-9']);
    const movements = await movementCount();

    expect(said(await decide(dto.id, 'apply', [String(x._id)], tokens.linker))).toEqual(stop);
    expect(said(await decide(dto.id, 'reject', [String(x._id)], tokens.linker))).toEqual(stop);
    expect(said(await decideLinks(dto.id, 'apply', [String(x._id)]))).toEqual(stop);
    const add = await addCard(dto.id, {
      sheetRow: dto.newCards[0]?.sheetRow ?? 0,
      expiresAt: '2027-05-31',
      password: '1',
      vehicleId: null,
      label: 'سفر 7',
    });
    expect(said(add)).toEqual(stop);

    expect(await movementCount()).toBe(movements);
    expect(await card(x._id)).toMatchObject({ balance: 100 });
    expect(String((await card(x._id)).vehicleId)).toBe(String(va._id));
    expect(await FleetFuelCardModel.countDocuments({ name: 'EGYCASHTCS-NEW-9' }).exec()).toBe(0);
    const stored = await FleetFuelReconciliationModel.findById(dto.id).lean().exec();
    expect(stored?.lines[0]?.decision).toBeNull();
    // And it judged none of these cards: the next sheet's candidates are not moved by it.
    expect(stored?.equalCardIds).toEqual([]);
  });

  it('a mixed sheet: a row named for the other company, or a name too long, is not added', async () => {
    const keep = await mkCard('wataniya', 'EGYCASH-KEEP', 1);
    const long = `EGYCASH-${'7'.repeat(130)}`;
    const dto = await readSheet('wataniya', [
      HEADER,
      rowAt(keep, null),
      ['5485640000002323', 'EGYCASHTCS-STRAY', 10, null],
      ['5485640000003434', long, 20, null],
    ]);
    // Mixed prefixes: no company for the whole sheet — so the screen shows no stop.
    expect(dto.sheetCompany).toBeNull();
    const rowOfName = (name: string) => dto.newCards.find((n) => n.name === name)?.sheetRow ?? 0;
    const body = { expiresAt: '2027-05-31', password: '1', vehicleId: null, label: 'سفر 5' };
    const movements = await movementCount();
    const stray = await addCard(dto.id, { ...body, sheetRow: rowOfName('EGYCASHTCS-STRAY') });
    expect(said(stray)).toEqual([
      422,
      ErrorCodes.FLEET_FUEL_SHEET_LAYOUT,
      [{ field: 'name', code: 'WRONG_COMPANY', message: 'name' }],
    ]);
    const tooLong = await addCard(dto.id, { ...body, sheetRow: rowOfName(long) });
    expect(said(tooLong)).toEqual([
      422,
      ErrorCodes.FLEET_FUEL_SHEET_LAYOUT,
      [{ field: 'name', code: 'TOO_LONG', message: 'name' }],
    ]);
    expect(await movementCount()).toBe(movements);
    expect(await FleetFuelCardModel.countDocuments({ company: 'wataniya' }).exec()).toBe(1);
  });
});

describe('the go-live spellings', () => {
  it('seeded at boot, insert-only: a spelling the owner taught survives a re-seed', async () => {
    const goLive = await FleetFuelSheetCodeModel.countDocuments({
      source: 'goLive',
      isDeleted: false,
    }).exec();
    expect(goLive).toBe(FUEL_SHEET_CODE_SEED.length);
    // The owner re-taught «194»; and one spelling is missing (as on a fresh database).
    const taught = new Types.ObjectId();
    await FleetFuelSheetCodeModel.updateOne(
      { key: '194' },
      { $set: { source: 'owner', vehicleId: taught, vehicleCode: null } },
    ).exec();
    await FleetFuelSheetCodeModel.deleteOne({ key: 'بيجو' }).exec();
    const before = await FleetFuelSheetCodeModel.findOne({ key: 'suz62' }).lean().exec();

    expect(await seedFuelSheetCodes()).toEqual({ inserted: 1 });
    expect(await FleetFuelSheetCodeModel.findOne({ key: '194' }).lean().exec()).toMatchObject({
      source: 'owner',
      vehicleId: taught,
    });
    // An untouched spelling is untouched — not even its write time.
    expect(await FleetFuelSheetCodeModel.findOne({ key: 'suz62' }).lean().exec()).toEqual(before);
    expect(await seedFuelSheetCodes()).toEqual({ inserted: 0 });
  });
});
