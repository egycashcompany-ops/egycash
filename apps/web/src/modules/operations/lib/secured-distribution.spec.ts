// «توزيع المحصنات» / «تسليم المحصنات» (Round 12) — the screens' rules, pure. The owner: «وهشد المحصنة
// احطها على العربيه او المحصنة اللى نفس الاتجاه بتاع العربيه تتحط تلقائى ولما يحفظ … بس لما يدوس تسليم
// المحصنات هتتسلم ساعتها وخلاص مش هتبقى ف الخزنة».
import { describe, expect, it } from 'vitest';
import {
  operationsDirectionAreas,
  operationsDirectionMatchesArea,
  operationsDirectionVanIds,
  type OperationsDayBoardPersonDto,
  type OperationsSecuredDistributionRowDto,
} from '@ecms/contracts';
import {
  EMPTY_DRAFT,
  UNPLACED,
  captainOn,
  distributionChanges,
  distributionColumns,
  distributionSaveBody,
  handoverBlock,
  handoverRequest,
  handoverShipments,
  isProposed,
  isStartedLeg,
  landingCaptain,
  loadFigures,
  moveToVan,
  nextCaptain,
  notYetInVault,
  personName,
  placeShipment,
  placementOf,
  proposeByDirection,
  readDistributionDate,
  refusedShipmentId,
  reschedulesOnSave,
  samePlacement,
  savedPlacement,
  takesShipments,
  withoutShipment,
  type DistributionDraft,
  type DistributionRowFacts,
} from './secured-distribution';

const TODAY = '2026-11-12';

const person = (
  employeeId: string,
  fullNameAr: string | null = employeeId,
): OperationsDayBoardPersonDto => ({
  employeeId,
  code: null,
  fullNameAr,
});

/** A van of the day — the crew row's facts the rules read. */
const van = (id: string, captains: string[], direction: string | null = null) => ({
  crewAssignmentId: id,
  vehicleCode: id.replace('van-', ''),
  captains: captains.map((captain) => person(captain)),
  direction,
});

const V1 = van('van-101', ['c1'], 'المعادي - حلوان');
const V2 = van('van-104', ['c2', 'c3'], 'مدينة نصر');
const V3 = van('van-112', ['c4'], 'الجيزة');
const V4 = van('van-125', ['c6'], '6 أكتوبر – الجيزة');
const EMPTY_VAN = van('van-130', [], 'المعادي');
const VANS = [V1, V2, V3, V4, EMPTY_VAN];

/** A distribution row — only the facts the rules read; `over` sets the rest. */
const row = (id: string, over: Partial<DistributionRowFacts> = {}): DistributionRowFacts => ({
  id,
  status: 'inVault',
  overdue: false,
  delivery: null,
  deliveryLegVersion: null,
  placedCrewAssignmentId: null,
  directionCrewAssignmentIds: [],
  ...over,
});

/** A row on a van of the day — its leg on that van, with that captain, at that version. */
const placed = (
  id: string,
  vanId: string,
  captain: string,
  version: number,
  over: Partial<DistributionRowFacts> = {},
): DistributionRowFacts =>
  row(id, {
    placedCrewAssignmentId: vanId,
    delivery: {
      crewAssignmentId: vanId,
      captainEmployeeId: captain,
      vehicleId: 'v',
      executionStatus: 'pending',
    },
    deliveryLegVersion: version,
    ...over,
  });

describe('the day the screen opens on', () => {
  it('reads a real day from today on, else today (the server’s default)', () => {
    expect(readDistributionDate(null, TODAY)).toBeNull();
    expect(readDistributionDate('', TODAY)).toBeNull();
    expect(readDistributionDate('2026-11-12', TODAY)).toBe('2026-11-12');
    expect(readDistributionDate('2026-11-20', TODAY)).toBe('2026-11-20');
  });

  it('never a past day — the server refuses one (a past day’s vans have left)', () => {
    expect(readDistributionDate('2026-11-11', TODAY)).toBeNull();
    expect(readDistributionDate('2025-12-31', TODAY)).toBeNull();
  });

  it('never a malformed one — an empty or broken `date=` is a 400', () => {
    expect(readDistributionDate('2026-13-01', TODAY)).toBeNull();
    expect(readDistributionDate('2026-02-30', TODAY)).toBeNull();
    expect(readDistributionDate('tomorrow', TODAY)).toBeNull();
  });
});

describe('where a shipment stands', () => {
  it('is on the van of THIS day the read names, with its leg’s captain', () => {
    expect(savedPlacement(placed('s', 'van-101', 'c1', 0))).toEqual({
      crewAssignmentId: 'van-101',
      captainEmployeeId: 'c1',
    });
  });

  it('is unplaced when its leg rides another day’s van (an overdue one), or it has none', () => {
    const overdue = row('s', {
      overdue: true,
      delivery: {
        crewAssignmentId: 'van-yesterday',
        captainEmployeeId: 'c1',
        vehicleId: 'v',
        executionStatus: 'pending',
      },
      deliveryLegVersion: 3,
    });
    expect(savedPlacement(overdue)).toEqual(UNPLACED);
    expect(savedPlacement(row('s'))).toEqual(UNPLACED);
  });

  it('compares places by van and — on a van — by captain', () => {
    expect(samePlacement(UNPLACED, { crewAssignmentId: null, captainEmployeeId: 'x' })).toBe(true);
    expect(
      samePlacement(
        { crewAssignmentId: 'a', captainEmployeeId: 'c1' },
        { crewAssignmentId: 'a', captainEmployeeId: 'c1' },
      ),
    ).toBe(true);
    expect(
      samePlacement(
        { crewAssignmentId: 'a', captainEmployeeId: 'c1' },
        { crewAssignmentId: 'a', captainEmployeeId: 'c2' },
      ),
    ).toBe(false);
    expect(samePlacement({ crewAssignmentId: 'a', captainEmployeeId: 'c1' }, UNPLACED)).toBe(false);
  });

  it('holds a leg the captain has started — anything past `pending`', () => {
    const started = placed('s', 'van-101', 'c1', 2);
    expect(isStartedLeg(started)).toBe(false);
    for (const executionStatus of [
      'active',
      'pickedUp',
      'delivered',
      'completed',
      'cancelled',
    ] as const) {
      expect(isStartedLeg({ delivery: { ...started.delivery!, executionStatus } })).toBe(true);
    }
    expect(isStartedLeg(row('s'))).toBe(false);
  });

  it('a van takes shipments only with a captain', () => {
    expect(takesShipments(V1)).toBe(true);
    expect(takesShipments(EMPTY_VAN)).toBe(false);
  });
});

describe('moving a shipment (the drag, «نقل إلى…», «إزالة»)', () => {
  it('puts it on a van with the van’s FIRST captain, at the leg version the person sees', () => {
    const s = row('s', { deliveryLegVersion: null });
    const draft = moveToVan(EMPTY_DRAFT, s, V2);
    expect(draft.get('s')).toEqual({
      crewAssignmentId: 'van-104',
      captainEmployeeId: 'c2',
      version: null,
      proposed: false,
    });
    expect(placementOf(s, draft)).toEqual({ crewAssignmentId: 'van-104', captainEmployeeId: 'c2' });
  });

  it('keeps the captain it already has when dropped again on its own van', () => {
    const s = placed('s', 'van-104', 'c3', 4);
    expect(landingCaptain(V2, savedPlacement(s))).toBe('c3');
    expect(moveToVan(EMPTY_DRAFT, s, V2).size).toBe(0);
  });

  it('dragged away and back to its two-captain van, it keeps the SECOND captain it was saved with', () => {
    // Saved on van-104 with its second captain: away to another van, then back — no change.
    const s = placed('s', 'van-104', 'c3', 4);
    const away = moveToVan(EMPTY_DRAFT, s, V3);
    expect(placementOf(s, away).crewAssignmentId).toBe('van-112');
    const back = moveToVan(away, s, V2);
    expect(back.size).toBe(0);
    expect(placementOf(s, back)).toEqual({ crewAssignmentId: 'van-104', captainEmployeeId: 'c3' });
    expect(distributionChanges([s], back)).toEqual([]);
    // Taken off, then put back by the menu: the same.
    const off = placeShipment(EMPTY_DRAFT, s, UNPLACED);
    expect(moveToVan(off, s, V2).size).toBe(0);
  });

  it('takes the first captain of a NEW van even when its own captain is not on it', () => {
    const s = placed('s', 'van-101', 'c1', 1);
    expect(landingCaptain(V2, savedPlacement(s))).toBe('c2');
  });

  it('refuses a van with no captain — nothing changes', () => {
    const s = row('s');
    expect(landingCaptain(EMPTY_VAN, UNPLACED)).toBeNull();
    expect(moveToVan(EMPTY_DRAFT, s, EMPTY_VAN)).toBe(EMPTY_DRAFT);
  });

  it('dragged back where the read has it, it leaves the draft — nothing to save', () => {
    const s = placed('s', 'van-101', 'c1', 1);
    const away = moveToVan(EMPTY_DRAFT, s, V3);
    expect(away.size).toBe(1);
    expect(moveToVan(away, s, V1).size).toBe(0);
    const off = placeShipment(EMPTY_DRAFT, s, UNPLACED);
    expect(off.get('s')).toEqual({ ...UNPLACED, version: 1, proposed: false });
    expect(
      placeShipment(off, s, { crewAssignmentId: 'van-101', captainEmployeeId: 'c1' }).size,
    ).toBe(0);
  });

  it('a van without its captain (or a captain without a van) is no place: taken as «off»', () => {
    const s = placed('s', 'van-101', 'c1', 1);
    expect(
      placeShipment(EMPTY_DRAFT, s, { crewAssignmentId: 'van-104', captainEmployeeId: null }).get(
        's',
      ),
    ).toEqual({ ...UNPLACED, version: 1, proposed: false });
  });

  it('never moves a started leg', () => {
    const s = placed('s', 'van-101', 'c1', 1, {
      delivery: {
        crewAssignmentId: 'van-101',
        captainEmployeeId: 'c1',
        vehicleId: 'v',
        executionStatus: 'active',
      },
    });
    expect(moveToVan(EMPTY_DRAFT, s, V3)).toBe(EMPTY_DRAFT);
    expect(placeShipment(EMPTY_DRAFT, s, UNPLACED)).toBe(EMPTY_DRAFT);
  });

  it('a move by hand is not a proposal any more', () => {
    const s = row('s', { directionCrewAssignmentIds: ['van-112'] });
    const proposed = proposeByDirection([s], VANS, EMPTY_DRAFT);
    expect(isProposed(s, proposed)).toBe(true);
    expect(isProposed(s, moveToVan(proposed, s, V1))).toBe(false);
  });

  it('switches the captain of a two-captain van in turn — and a one-captain van has none to switch to', () => {
    expect(nextCaptain(V2, 'c2')?.employeeId).toBe('c3');
    expect(nextCaptain(V2, 'c3')?.employeeId).toBe('c2');
    expect(nextCaptain(V2, null)?.employeeId).toBe('c2');
    expect(nextCaptain(V1, 'c1')).toBeNull();
    expect(nextCaptain(EMPTY_VAN, null)).toBeNull();
  });

  it('names the captain a placement goes with, among the van’s', () => {
    expect(captainOn(V2, 'c3')?.employeeId).toBe('c3');
    expect(captainOn(V2, 'c9')).toBeNull();
    expect(personName(person('x', null))).toBe('…');
  });
});

describe('AUTO BY DIRECTION — «المحصنة اللى نفس الاتجاه بتاع العربيه تتحط تلقائى»', () => {
  it('proposes an unplaced shipment onto the ONE van its area points at, with its first captain', () => {
    const s = row('s', { directionCrewAssignmentIds: ['van-104'], deliveryLegVersion: null });
    const draft = proposeByDirection([s], VANS, EMPTY_DRAFT);
    expect(draft.get('s')).toEqual({
      crewAssignmentId: 'van-104',
      captainEmployeeId: 'c2',
      version: null,
      proposed: true,
    });
  });

  it('leaves it for the person when two vans match, or none', () => {
    const two = row('two', { directionCrewAssignmentIds: ['van-112', 'van-125'] });
    const none = row('none', { directionCrewAssignmentIds: [] });
    expect(proposeByDirection([two, none], VANS, EMPTY_DRAFT).size).toBe(0);
  });

  it('counts only the vans listed that take shipments (a van with no captain, or gone, is no match)', () => {
    const toEmpty = row('a', { directionCrewAssignmentIds: ['van-130', 'van-101'] });
    const gone = row('b', { directionCrewAssignmentIds: ['van-999'] });
    const draft = proposeByDirection([toEmpty, gone], VANS, EMPTY_DRAFT);
    expect(draft.get('a')?.crewAssignmentId).toBe('van-101');
    expect(draft.has('b')).toBe(false);
  });

  it('a repeated id is still one van', () => {
    const s = row('s', { directionCrewAssignmentIds: ['van-101', 'van-101'] });
    expect(proposeByDirection([s], VANS, EMPTY_DRAFT).get('s')?.crewAssignmentId).toBe('van-101');
  });

  it('never moves a shipment already on a van — by the read or by the person', () => {
    const onVan = placed('on', 'van-112', 'c4', 0, { directionCrewAssignmentIds: ['van-101'] });
    const moved = row('moved', { directionCrewAssignmentIds: ['van-101'] });
    const byHand = moveToVan(EMPTY_DRAFT, moved, V3);
    const draft = proposeByDirection([onVan, moved], VANS, byHand);
    expect(draft.has('on')).toBe(false);
    expect(draft.get('moved')).toEqual(byHand.get('moved'));
  });

  it('never a started leg', () => {
    const s = row('s', {
      directionCrewAssignmentIds: ['van-101'],
      delivery: {
        crewAssignmentId: 'van-x',
        captainEmployeeId: 'c1',
        vehicleId: 'v',
        executionStatus: 'pickedUp',
      },
      deliveryLegVersion: 2,
    });
    expect(proposeByDirection([s], VANS, EMPTY_DRAFT).size).toBe(0);
  });

  it('proposes an OVERDUE one too, carrying its old leg’s version (the save re-dates it)', () => {
    const late = row('late', {
      overdue: true,
      directionCrewAssignmentIds: ['van-104'],
      delivery: {
        crewAssignmentId: 'van-yesterday',
        captainEmployeeId: 'c1',
        vehicleId: 'v',
        executionStatus: 'pending',
      },
      deliveryLegVersion: 3,
    });
    const draft = proposeByDirection([late], VANS, EMPTY_DRAFT);
    expect(draft.get('late')).toMatchObject({
      crewAssignmentId: 'van-104',
      version: 3,
      proposed: true,
    });
    expect(reschedulesOnSave(late, draft)).toBe(true);
    expect(reschedulesOnSave(late, EMPTY_DRAFT)).toBe(false);
  });

  it('«توزيع تلقائي» again proposes one the person took off its van', () => {
    const s = placed('s', 'van-101', 'c1', 1, { directionCrewAssignmentIds: ['van-112'] });
    const off = placeShipment(EMPTY_DRAFT, s, UNPLACED);
    expect(proposeByDirection([s], VANS, off).get('s')).toMatchObject({
      crewAssignmentId: 'van-112',
      proposed: true,
    });
  });

  it('rests on the contracts’ ONE direction rule — the server computes the ids with it', () => {
    // Split at «-» «–» «/» «،» and a standalone «و»; «وسط البلد» stays whole.
    expect(operationsDirectionAreas('المعادي - حلوان')).toEqual(['معادي', 'حلوان']);
    expect(operationsDirectionAreas('6 أكتوبر – الجيزة')).toEqual(['6 اكتوبر', 'جيزه']);
    expect(operationsDirectionAreas('المعادي و حلوان')).toEqual(['معادي', 'حلوان']);
    expect(operationsDirectionAreas('وسط البلد')).toEqual(['وسط بلد']);
    // Arabic letter variants fold; equality, never "contains".
    expect(operationsDirectionMatchesArea('المعادي - حلوان', 'معادى')).toBe(true);
    expect(operationsDirectionMatchesArea('مصر الجديدة', 'مصر')).toBe(false);
    expect(operationsDirectionMatchesArea('٦ أكتوبر', '6 اكتوبر')).toBe(true);
    expect(operationsDirectionMatchesArea(null, 'الجيزة')).toBe(false);
    // A van with no captain is never a match.
    expect(
      operationsDirectionVanIds('الجيزة', [V3, V4, { ...EMPTY_VAN, direction: 'الجيزة' }]),
    ).toEqual(['van-112', 'van-125']);
  });
});

describe('«حفظ» — every change in ONE request', () => {
  const a = row('a', { directionCrewAssignmentIds: ['van-101'] });
  const b = placed('b', 'van-104', 'c2', 5);
  const c = placed('c', 'van-112', 'c4', 0);
  const late = row('late', {
    overdue: true,
    delivery: {
      crewAssignmentId: 'van-yesterday',
      captainEmployeeId: 'c1',
      vehicleId: 'v',
      executionStatus: 'pending',
    },
    deliveryLegVersion: 3,
  });
  const rows = [late, a, b, c];

  it('sends exactly the shipments whose place differs from the read, in the read’s order', () => {
    let draft: DistributionDraft = proposeByDirection(rows, VANS, EMPTY_DRAFT); // a → 101
    draft = placeShipment(draft, b, { crewAssignmentId: 'van-104', captainEmployeeId: 'c3' }); // captain switch
    draft = placeShipment(draft, c, UNPLACED); // off its van
    draft = moveToVan(draft, late, V3);
    expect(distributionChanges(rows, draft)).toEqual([
      { shipmentId: 'late', crewAssignmentId: 'van-112', captainEmployeeId: 'c4', version: 3 },
      { shipmentId: 'a', crewAssignmentId: 'van-101', captainEmployeeId: 'c1', version: null },
      { shipmentId: 'b', crewAssignmentId: 'van-104', captainEmployeeId: 'c3', version: 5 },
      { shipmentId: 'c', crewAssignmentId: null, captainEmployeeId: null, version: 0 },
    ]);
  });

  it('the body: the day, and the changes — or nothing to send at all', () => {
    expect(distributionSaveBody(TODAY, rows, EMPTY_DRAFT)).toBeNull();
    const draft = moveToVan(EMPTY_DRAFT, a, V1);
    expect(distributionSaveBody(TODAY, rows, draft)).toEqual({
      date: TODAY,
      changes: [
        { shipmentId: 'a', crewAssignmentId: 'van-101', captainEmployeeId: 'c1', version: null },
      ],
    });
  });

  it('keeps the version the person moved it at — a colleague’s move since makes the save stale', () => {
    const draft = moveToVan(EMPTY_DRAFT, b, V3); // read at version 5
    const reread = { ...b, deliveryLegVersion: 6 }; // a colleague moved it meanwhile
    expect(distributionChanges([reread], draft)).toEqual([
      { shipmentId: 'b', crewAssignmentId: 'van-112', captainEmployeeId: 'c4', version: 5 },
    ]);
  });

  it('leaves out a shipment no longer on the screen, one whose leg has started, and one that is where it was', () => {
    let draft = moveToVan(EMPTY_DRAFT, a, V1);
    draft = moveToVan(draft, b, V3);
    const startedB = {
      ...b,
      delivery: { ...b.delivery!, executionStatus: 'active' as const },
    };
    // `a` dispatched since (no longer read), `b` started since.
    expect(distributionChanges([startedB, c], draft)).toEqual([]);
    // Re-read with `a` already on 101 (a colleague did the same): no change.
    const aOn101 = placed('a', 'van-101', 'c1', 0);
    expect(distributionChanges([aOn101], draft)).toEqual([]);
  });

  it('an unplaced shipment left unplaced is no change, even when its leg rides another day’s van', () => {
    const draft = placeShipment(EMPTY_DRAFT, late, UNPLACED);
    expect(draft.size).toBe(0);
    expect(
      distributionChanges(rows, new Map([['late', { ...UNPLACED, version: 3, proposed: false }]])),
    ).toEqual([]);
  });

  it('a refusal names its shipment; that move leaves the draft, the others stay', () => {
    const error = {
      code: 'STALE_DOCUMENT',
      details: [{ field: 'shipmentId', code: 'SHIPMENT', message: 'b' }],
    };
    expect(refusedShipmentId(error)).toBe('b');
    expect(
      refusedShipmentId({
        code: 'OPERATIONS_DISTRIBUTION_DAY_IN_PAST',
        details: [{ field: 'date', code: 'MIN_DATE', message: TODAY }],
      }),
    ).toBeNull();
    expect(refusedShipmentId(new Error('network'))).toBeNull();
    expect(refusedShipmentId(null)).toBeNull();
    const draft = moveToVan(moveToVan(EMPTY_DRAFT, a, V1), b, V3);
    const after = withoutShipment(draft, 'b');
    expect([...after.keys()]).toEqual(['a']);
    expect(withoutShipment(after, 'b')).toBe(after);
  });
});

describe('the two columns', () => {
  it('puts each shipment under its van (vans in the read’s order) or on the left', () => {
    const rows = [
      row('x'),
      placed('y', 'van-104', 'c2', 0),
      row('z'),
      placed('w', 'van-gone', 'c1', 0),
    ];
    const draft = moveToVan(EMPTY_DRAFT, rows[2]!, V1);
    const { vans, unplaced } = distributionColumns(rows, [V1, V2, EMPTY_VAN], draft);
    expect(vans.map((load) => [load.van.crewAssignmentId, load.rows.map((r) => r.id)])).toEqual([
      ['van-101', ['z']],
      ['van-104', ['y']],
      ['van-130', []],
    ]);
    // A van the read no longer lists: the shipment is shown on the left, never lost.
    expect(unplaced.map((r) => r.id)).toEqual(['x', 'w']);
  });
});

describe('«تسليم» — only what the vault holds, of that van', () => {
  const rows = [
    placed('in-1', 'van-101', 'c1', 0),
    placed('draft-1', 'van-101', 'c1', 0, { status: 'draft' }),
    placed('in-2', 'van-104', 'c2', 0),
    row('loose'),
    placed('in-3', 'van-101', 'c1', 1),
  ];

  it('sends the van’s crew row and ITS in-vault shipments, in order', () => {
    expect(handoverRequest(rows, 'van-101')).toEqual({
      crewAssignmentId: 'van-101',
      shipmentIds: ['in-1', 'in-3'],
    });
    expect(handoverShipments(rows, 'van-104').map((r) => r.id)).toEqual(['in-2']);
  });

  it('lists the van’s shipments the vault has not received — never sent', () => {
    expect(notYetInVault(rows, 'van-101').map((r) => r.id)).toEqual(['draft-1']);
    expect(handoverRequest(rows, 'van-101')!.shipmentIds).not.toContain('draft-1');
  });

  it('nothing to hand over → no request', () => {
    expect(handoverRequest(rows, 'van-112')).toBeNull();
    expect(
      handoverRequest([placed('d', 'van-112', 'c4', 0, { status: 'draft' })], 'van-112'),
    ).toBeNull();
  });
});

describe('«تسليم» — only on the day the van goes out', () => {
  const TODAY = '2026-11-12';

  it('is on today, with something in the vault to hand over', () => {
    expect(handoverBlock(TODAY, TODAY, 3)).toBeNull();
  });

  it('is off on a future day — the plan, to read and print — whatever the van carries', () => {
    expect(handoverBlock('2026-11-13', TODAY, 3)).toBe('notToday');
    expect(handoverBlock('2026-12-01', TODAY, 0)).toBe('notToday');
  });

  it('is off on yesterday’s read left open past midnight — those vans have left', () => {
    expect(handoverBlock('2026-11-11', TODAY, 2)).toBe('notToday');
  });

  it('on today, is off with nothing in the vault on the van', () => {
    expect(handoverBlock(TODAY, TODAY, 0)).toBe('nothing');
  });
});

describe('a van’s figures', () => {
  const currencies = new Map([
    ['egp', { code: 'EGP', name: 'مصري', sortOrder: 0 }],
    ['usd', { code: 'USD', name: 'دولار', sortOrder: 1 }],
    ['eur', { code: 'EUR', name: 'يورو', sortOrder: 2 }],
  ]);
  const shipment = (id: string, lines: [string, number][]) =>
    ({
      id,
      lines: lines.map(([currencyId, amount]) => ({ currencyId, amount })),
    }) as unknown as OperationsSecuredDistributionRowDto;

  it('counts, sums the pound and the dollar, and «عملات أخرى» by the boards’ rule', () => {
    const load = [
      shipment('a', [
        ['egp', 1_000_000],
        ['usd', 5_000],
      ]),
      shipment('b', [
        ['egp', 250_000],
        ['eur', 3_000],
      ]),
    ];
    expect(loadFigures(load, (id) => currencies.get(id))).toEqual({
      count: 2,
      egp: 1_250_000,
      usd: 5_000,
      othersSum: 3_000,
      packages: null,
    });
  });

  it('adds the packages the vault counted — null when it counted none', () => {
    const load = [
      shipment('a', [['egp', 1]]),
      shipment('b', [['egp', 1]]),
      shipment('c', [['egp', 1]]),
    ];
    const counted = new Map([
      ['a', { bags: 3, cartons: 1, boxes: 0 }],
      ['c', { bags: 2, cartons: 0, boxes: 1 }],
    ]);
    expect(
      loadFigures(
        load,
        (id) => currencies.get(id),
        (id) => counted.get(id),
      ).packages,
    ).toEqual({
      bags: 5,
      cartons: 1,
      boxes: 1,
    });
    expect(loadFigures([], (id) => currencies.get(id)).count).toBe(0);
  });
});
