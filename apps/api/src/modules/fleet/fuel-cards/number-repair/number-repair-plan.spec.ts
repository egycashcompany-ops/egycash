// The planner's rules, without Mongo: what each record reads, what each unit may do, and what a
// ready unit writes. The world is the definition's 17 records as the go-live left them.
import { describe, expect, it } from 'vitest';
import {
  REPAIR_PAIR,
  REPAIR_RECORDS,
  type RepairCardFacts,
  type RepairCycleRecord,
} from './number-repair-definition';
import {
  goLivePhotoNumber,
  planCycle,
  planPair,
  planRepair,
  type RepairLine,
  type RepairLiveCard,
  type RepairWorld,
} from './number-repair-plan';

const idOf = (car: string): string => `card-${car}`;

const cardFrom = (car: string, name: string, facts: RepairCardFacts): RepairLiveCard => ({
  id: idOf(car),
  company: 'wataniya',
  vehicleCode: car,
  label: null,
  name,
  number: facts.number,
  expiresAt: facts.expiresAt,
  hasPin: facts.hasPin,
  image: { fileName: `${facts.number}.jpg`, size: facts.photoBytes },
  balance: 100,
  version: 3,
});

const beforeCard = (record: RepairCycleRecord): RepairLiveCard =>
  cardFrom(record.car, record.name, record.before);
const afterCard = (record: RepairCycleRecord): RepairLiveCard =>
  cardFrom(record.car, record.name, record.after);

const worldOf = (
  cards: RepairLiveCard[],
  lines: RepairLine[] = [],
): RepairWorld & { byCar: Map<string, RepairLiveCard>; byNumber: Map<string, RepairLiveCard> } => ({
  byCar: new Map(cards.map((card) => [card.vehicleCode as string, card])),
  byNumber: new Map(cards.map((card) => [card.number, card])),
  lines,
});

const pairCards = (swapped = false): RepairLiveCard[] =>
  REPAIR_PAIR.map((p) =>
    cardFrom(p.car, swapped ? p.nameAfter : p.nameBefore, {
      number: p.number,
      expiresAt: p.expiresAt,
      hasPin: p.hasPin,
      photoBytes: p.photoBytes,
    }),
  );

const clean = () => worldOf([...REPAIR_RECORDS.map(beforeCard), ...pairCards()]);
const record = (car: string): RepairCycleRecord =>
  REPAIR_RECORDS.find((r) => r.car === car) as RepairCycleRecord;
const edit = (world: ReturnType<typeof clean>, car: string, over: Partial<RepairLiveCard>) => {
  world.byCar.set(car, { ...(world.byCar.get(car) as RepairLiveCard), ...over });
  return world;
};
/** The `dataFix` line the repair writes on car `car`'s record — it names what it gave the record. */
const lineFor = (car: string, unit: RepairLine['unit']): RepairLine => ({
  movementId: `line-${car}`,
  cardId: idOf(car),
  unit,
  numberAfter: unit === 'pair' ? null : record(car).after.number,
  nameAfter: unit === 'pair' ? (REPAIR_PAIR.find((p) => p.car === car)?.nameAfter ?? null) : null,
  at: new Date('2026-11-02T10:00:00Z'),
  by: null,
});
/** The world once the whole repair ran: every record «after», the pair swapped, 17 lines. */
const repaired = () => {
  const world = worldOf([...REPAIR_RECORDS.map(afterCard), ...pairCards(true)]);
  return {
    ...world,
    lines: [
      ...REPAIR_RECORDS.map((r) => lineFor(r.car, r.unit)),
      ...REPAIR_PAIR.map((p) => lineFor(p.car, 'pair')),
    ],
  };
};

describe('the clean go-live world', () => {
  it('three ready cycles and a ready pair; every row `ok`, no change', () => {
    const plan = planRepair(clean());
    expect(plan.cycles.map((c) => [c.unit, c.state])).toEqual([
      ['C4', 'ready'],
      ['C5', 'ready'],
      ['C6', 'ready'],
    ]);
    expect(plan.pair.state).toBe('ready');
    const rows = [...plan.cycles.flatMap((c) => c.rows), ...plan.pair.rows];
    expect(rows).toHaveLength(17);
    expect(new Set(rows.map((r) => r.state))).toEqual(new Set(['ok']));
    expect(rows.every((r) => r.changes.length === 0)).toBe(true);
  });

  it('a ready cycle writes the right number and takes PIN, photo, expiry from the record before it', () => {
    const c4 = planCycle('C4', clean());
    expect(c4.writes.map((w) => [w.car, w.takeFrom, w.numberAfter.slice(-4)])).toEqual([
      ['239', idOf('209'), '0935'],
      ['241', idOf('239'), '2813'],
      ['243', idOf('241'), '3375'],
      ['209', idOf('243'), '4116'],
    ]);
    const c6 = planCycle('C6', clean());
    for (const [i, write] of c6.writes.entries()) {
      const donor = c6.writes[(i - 1 + c6.writes.length) % c6.writes.length];
      expect(write.takeFrom).toBe(donor?.cardId);
      expect(write.numberAfter).toBe(donor?.numberBefore);
      expect(write.version).toBe(3);
    }
  });

  it('the ready pair swaps the names and carries each opening difference', () => {
    const pair = planPair(clean());
    expect(pair.writes.map((w) => [w.car, w.nameAfter, w.delta])).toEqual([
      ['530', 'EGYCASH-1137-401485', -11_872.62],
      ['283', 'EGYCASH-8616-783211', 11_872.62],
    ]);
  });
});

describe('a record changed by hand holds its whole unit — and only it', () => {
  it('a name edited on 269 → C5 held (269 changed «name», the other four held); the rest ready', () => {
    const world = edit(clean(), '269', { name: 'EGYCASH-CHANGED' });
    const plan = planRepair(world);
    expect(plan.cycles.map((c) => c.state)).toEqual(['ready', 'held', 'ready']);
    expect(plan.pair.state).toBe('ready');
    const c5 = plan.cycles[1];
    expect(c5?.rows.map((r) => [r.car, r.state])).toEqual([
      ['233', 'held'],
      ['525', 'held'],
      ['284', 'held'],
      ['269', 'changed'],
      ['230', 'held'],
    ]);
    expect(c5?.rows[3]?.changes).toEqual([
      { field: 'name', expected: record('269').name, now: 'EGYCASH-CHANGED' },
    ]);
    expect(c5?.writes).toEqual([]);
  });

  it('a name with an «S» is another name — compared exactly', () => {
    const world = edit(clean(), '284', { name: 'EGYCASH-8618-S778864' });
    const c5 = planCycle('C5', world);
    expect(c5.state).toBe('held');
    expect(c5.rows.find((r) => r.car === '284')?.changes).toEqual([
      { field: 'name', expected: record('284').name, now: 'EGYCASH-8618-S778864' },
    ]);
  });

  it('a number edited, a card moved away or gone', () => {
    const number = planCycle('C4', edit(clean(), '243', { number: '5485640000009999' }));
    expect(number.state).toBe('held');
    expect(number.rows.find((r) => r.car === '243')?.changes).toEqual([
      { field: 'number', expected: '4116', now: '9999' },
    ]);

    const movedWorld = clean();
    const moved = movedWorld.byCar.get('246') as RepairLiveCard;
    movedWorld.byCar.delete('246');
    movedWorld.byNumber.set(moved.number, { ...moved, vehicleCode: '999' });
    expect(planCycle('C6', movedWorld).rows.find((r) => r.car === '246')?.changes).toEqual([
      { field: 'vehicle', expected: '246', now: '999' },
    ]);

    const goneWorld = clean();
    goneWorld.byNumber.delete((goneWorld.byCar.get('246') as RepairLiveCard).number);
    goneWorld.byCar.delete('246');
    const gone = planCycle('C6', goneWorld);
    expect([gone.state, gone.rows.find((r) => r.car === '246')?.changes]).toEqual([
      'held',
      [{ field: 'missing', expected: '246', now: null }],
    ]);
  });

  it('another company’s card on the car is not the record', () => {
    const world = edit(clean(), '232', { company: 'chillout' });
    expect(planCycle('C6', world).state).toBe('held');
  });

  it('half the cycle in the «after» state, half «before» → held', () => {
    const world = clean();
    for (const car of ['233', '525']) world.byCar.set(car, afterCard(record(car)));
    const c5 = planCycle('C5', world);
    expect(c5.state).toBe('held');
    expect(c5.rows.map((r) => r.state)).toEqual(['changed', 'changed', 'held', 'held', 'held']);
  });
});

describe('the physical card’s own data — expiry, photo, PIN — never holds a unit', () => {
  // The owner's rule: the PIN, the photo and the expiry belong with the NUMBER. A renewed expiry,
  // a clearer photo, a PIN typed from the card screen — before «تنفيذ التصحيح» — travel with it.
  it('a renewed expiry, a new photo and a PIN typed → C5 still ready; each moves with its number', () => {
    const world = clean();
    edit(world, '269', { expiresAt: '2028-11-30' });
    edit(world, '233', { image: { fileName: 'IMG_2201.jpg', size: 4000 }, hasPin: true });
    edit(world, '230', { image: null });
    const c5 = planCycle('C5', world);
    expect(c5.state).toBe('ready');
    expect(c5.rows.every((r) => r.state === 'ok' && r.changes.length === 0)).toBe(true);
    // 269's number goes to 230 (the record after it) with 269's live expiry.
    const to230 = c5.writes.find((w) => w.car === '230');
    expect([to230?.takeFrom, to230?.numberAfter, to230?.expiryAfter]).toEqual([
      idOf('269'),
      record('269').before.number,
      '2028-11-30',
    ]);
    // 269 itself keeps its own record and receives its right number with that card's expiry.
    const to269 = c5.writes.find((w) => w.car === '269');
    expect([to269?.expiryBefore, to269?.expiryAfter]).toEqual([
      '2028-11-30',
      record('284').before.expiresAt,
    ]);
  });

  it('a whole cycle at its «after» numbers and names reads done by hand whatever its PINs and photos', () => {
    const world = clean();
    for (const r of REPAIR_RECORDS.filter((x) => x.unit === 'C4')) {
      world.byCar.set(r.car, { ...afterCard(r), hasPin: !r.after.hasPin, image: null });
    }
    expect(planCycle('C4', world).state).toBe('done');
  });
});

describe('done', () => {
  it('a whole cycle in the «after» state without lines was fixed by hand → done, nothing to write', () => {
    const world = clean();
    for (const r of REPAIR_RECORDS.filter((x) => x.unit === 'C4')) {
      world.byCar.set(r.car, afterCard(r));
    }
    const c4 = planCycle('C4', world);
    expect([c4.state, c4.writes, new Set(c4.rows.map((r) => r.state))]).toEqual([
      'done',
      [],
      new Set(['done']),
    ]);
  });

  it('the repair’s lines keep a unit done whatever is edited after — a PIN typed on a receiver', () => {
    const world = clean();
    const c5 = REPAIR_RECORDS.filter((x) => x.unit === 'C5');
    for (const r of c5) world.byCar.set(r.car, afterCard(r));
    const lines = c5.map((r) => lineFor(r.car, 'C5'));
    edit(world, '284', { hasPin: true, image: { fileName: 'new.jpg', size: 10 } });
    const done = planCycle('C5', { ...world, lines });
    expect([done.state, done.rows.map((r) => r.line?.movementId)]).toEqual([
      'done',
      c5.map((r) => `line-${r.car}`),
    ]);
  });

  it('a repaired unit stays done when its cards are later moved, replaced or deleted', () => {
    // Moved: car 283's card to car 215; deleted: car 530's; a new card on car 239; 241's moved off.
    const world = repaired();
    const c283 = world.byCar.get('283') as RepairLiveCard;
    world.byCar.delete('283');
    world.byNumber.set(c283.number, { ...c283, vehicleCode: '215' });
    const c530 = world.byCar.get('530') as RepairLiveCard;
    world.byCar.delete('530');
    world.byNumber.delete(c530.number);
    world.byCar.set('239', {
      ...(world.byCar.get('239') as RepairLiveCard),
      id: 'card-new-239',
      number: '5485640000001234',
    });
    world.byCar.delete('241');
    const plan = planRepair(world);
    expect([plan.cycles.map((c) => c.state), plan.pair.state]).toEqual([
      ['done', 'done', 'done'],
      'done',
    ]);
    const rows = [...plan.cycles.flatMap((c) => c.rows), ...plan.pair.rows];
    expect(rows.every((r) => r.state === 'done' && r.changes.length === 0)).toBe(true);
    expect(rows.every((r) => r.line !== null)).toBe(true);
    // A done row shows the card its line is on — car 283's moved card, not nothing.
    expect(plan.pair.rows[1]?.card?.id).toBe(idOf('283'));
    expect(plan.cycles[0]?.rows[0]?.card?.id).toBe(idOf('239'));
  });

  it('a cycle with a line but not all of them is never ready — it is never applied twice', () => {
    const c4 = planCycle('C4', { ...clean(), lines: [lineFor('239', 'C4')] });
    expect([c4.state, c4.writes]).toEqual(['held', []]);
  });

  it('the pair is done only by its two lines; swapped by hand without them → held «repairLine»', () => {
    const world = worldOf([...REPAIR_RECORDS.map(beforeCard), ...pairCards(true)]);
    const byHand = planPair(world);
    expect(byHand.state).toBe('held');
    expect(byHand.rows.map((r) => [r.state, r.changes.map((c) => c.field)])).toEqual([
      ['changed', ['name', 'repairLine']],
      ['changed', ['name', 'repairLine']],
    ]);
    const repaired = planPair({
      ...world,
      lines: [lineFor('530', 'pair'), lineFor('283', 'pair')],
    });
    expect([repaired.state, repaired.writes]).toEqual(['done', []]);
    // A line without the swap (the names put back by hand): never applied twice.
    const back = planPair({ ...clean(), lines: [lineFor('530', 'pair')] });
    expect(back.state).toBe('held');
    expect(back.rows[0]?.changes).toEqual([{ field: 'repairLine', expected: 'no', now: 'yes' }]);
  });
});

describe('helpers', () => {
  it('a go-live photo is recognised by its name AND its byte size', () => {
    const r = record('239');
    expect(
      goLivePhotoNumber({ fileName: `${r.before.number}.jpg`, size: r.before.photoBytes }),
    ).toBe(r.before.number);
    expect(goLivePhotoNumber({ fileName: `${r.before.number}.jpg`, size: 1 })).toBeNull();
    expect(goLivePhotoNumber({ fileName: 'scan.jpg', size: r.before.photoBytes })).toBeNull();
    expect(goLivePhotoNumber(null)).toBeNull();
  });

  it('is deterministic — the same world plans the same', () => {
    expect(planRepair(clean())).toEqual(planRepair(clean()));
  });
});
