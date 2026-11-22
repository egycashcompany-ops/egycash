// Round 32 C — «تبديل بين سيارتين»: «انا عاوز بقى اقدر اعمل اسوابنج بين عربيتين واقدر احدد هنقل ايه
// بالظبط للعربيه التانيه».
//
// The pure step (`lib/crew-swap.ts`): what each ticked item does in each of the three modes, per
// person and per field; the board's rules (slot role, away that day, capacity after the move, an
// archived type) keeping an item where it is, named; and the whole operation as ONE step of «تراجع»,
// counted as the two rows «حفظ» will send.
import { describe, expect, it } from 'vitest';
import {
  changeCount,
  clearStandingFromPlan,
  planChanges,
  vehiclelessRow,
  type PlanRow,
} from './crew-plan';
import { translate } from '../../../platform/localization/i18n';
import {
  NO_PICKS,
  QUICK_PICKS,
  SLOT_PATH,
  applySwap,
  applySwapToDraft,
  fieldItem,
  livePicks,
  modeStepOf,
  personItem,
  planSwap,
  quickPick,
  sendsFrom,
  shipmentsLeftBehind,
  swapItems,
  swapOperation,
  type SwapPicks,
  type SwapRules,
} from './crew-swap';
import {
  record,
  sameCrewDraft,
  startHistory,
  undo,
  type CrewDraft,
  type UndoHistory,
} from './crew-undo';

const van = (code: string, over: Partial<PlanRow> = {}): PlanRow => ({
  key: `van:v-${code}`,
  vehicleId: `v-${code}`,
  vehicleCode: code,
  onRoster: true,
  crewId: `crew-${code}`,
  drivers: [{ employeeId: `d-${code}`, fullNameAr: `سائق ${code}` }] as PlanRow['drivers'],
  slots: { captain: [], specialist1: [], specialist2: [] },
  direction: null,
  plannedTime: null,
  shiftTypeId: null,
  rowColour: null,
  notes: null,
  ...over,
});

/** Who is what: c* captains, s* specialists, d* captain-specialists; `away` and `archived` sets. */
const rulesWith = (
  over: {
    away?: Record<string, 'absent' | 'onLeave'>;
    unknown?: readonly string[];
    archived?: readonly string[];
    heldBy?: Record<string, string>;
  } = {},
): SwapRules => ({
  roleOf: (id) =>
    over.unknown?.includes(id) === true
      ? null
      : id.startsWith('c')
        ? 'captain'
        : id.startsWith('d')
          ? 'dual'
          : 'specialist',
  awayOf: (id) => over.away?.[id] ?? null,
  typeMayGo: (typeId, toKey) =>
    over.archived?.includes(typeId) !== true || over.heldBy?.[typeId] === toKey,
});
const RULES = rulesWith();

// The owner's case: van 150 was given 213's whole crew and fields by mistake.
const V150 = van('150', {
  slots: { captain: ['c1'], specialist1: ['s1'], specialist2: ['s2'] },
  direction: 'المعادي',
  plannedTime: '07:30',
  shiftTypeId: 't-daily',
  rowColour: 'navy',
  notes: 'تسليم البنك الأهلي',
});
const V213 = van('213', {
  slots: { captain: ['c2'], specialist1: ['s3'], specialist2: [] },
  direction: 'حلوان',
  plannedTime: '09:00',
  shiftTypeId: 't-reserve',
  rowColour: null,
  notes: null,
});

const all = (row: PlanRow): string[] => quickPick(row, 'all');
const picks = (a: readonly string[], b: readonly string[] = []): SwapPicks => ({ a, b });

describe('what a card offers — every person in his slot, then every filled field', () => {
  it('lists the people slot by slot, then the fields in the cards’ order; an empty field is no item', () => {
    expect(swapItems(V213).map((item) => item.id)).toEqual([
      'person:c2',
      'person:s3',
      'field:direction',
      'field:plannedTime',
      'field:shiftTypeId',
    ]);
    expect(swapItems(vehiclelessRow(1))).toEqual([]);
  });

  it('the quick picks: «الكل» everything, «الطاقم فقط» the people, «لا شيء» nothing', () => {
    expect(QUICK_PICKS).toEqual(['all', 'crew', 'none']);
    expect(quickPick(V150, 'all')).toHaveLength(8);
    expect(quickPick(V150, 'crew')).toEqual(['person:c1', 'person:s1', 'person:s2']);
    expect(quickPick(V150, 'none')).toEqual([]);
  });

  it('which ticks cross in each mode', () => {
    expect([sendsFrom('swap', 'a'), sendsFrom('swap', 'b')]).toEqual([true, true]);
    expect([sendsFrom('aToB', 'a'), sendsFrom('aToB', 'b')]).toEqual([true, false]);
    expect([sendsFrom('bToA', 'a'), sendsFrom('bToA', 'b')]).toEqual([false, true]);
  });
});

describe('«تبديل المحدد ⇄» — the ticked items of both cards cross at once', () => {
  it('everything ticked on both: the two rows exchange their crews and their fields — the vans stay', () => {
    const result = planSwap(V150, V213, picks(all(V150), all(V213)), 'swap', RULES);
    expect(result.refused).toEqual([]);
    expect(result.replaced).toEqual([]);
    expect(result.a).toMatchObject({
      key: 'van:v-150',
      vehicleId: 'v-150',
      vehicleCode: '150',
      crewId: 'crew-150',
      slots: { captain: ['c2'], specialist1: ['s3'], specialist2: [] },
      direction: 'حلوان',
      plannedTime: '09:00',
      shiftTypeId: 't-reserve',
      rowColour: null,
      notes: null,
    });
    expect(result.a.drivers).toBe(V150.drivers);
    expect(result.b).toMatchObject({
      key: 'van:v-213',
      vehicleCode: '213',
      crewId: 'crew-213',
      slots: { captain: ['c1'], specialist1: ['s1'], specialist2: ['s2'] },
      direction: 'المعادي',
      plannedTime: '07:30',
      shiftTypeId: 't-daily',
      rowColour: 'navy',
      notes: 'تسليم البنك الأهلي',
    });
  });

  // Round 32 critic — REWRITTEN. It pinned that a field ticked on ONE card «moves and the other
  // value is named as replaced» even in «تبديل المحدد ⇄»: 213's own 09:00 — never ticked — was
  // thrown away by a SWAP. A field is now one exchange the two cards share (the window ticks the pair).
  it('a field is ONE exchange: ticked on either card or on both, the two values cross — nothing thrown away', () => {
    const result = planSwap(
      V150,
      V213,
      picks([fieldItem('direction'), fieldItem('plannedTime')], [fieldItem('direction')]),
      'swap',
      RULES,
    );
    expect(result.a.direction).toBe('حلوان');
    expect(result.b.direction).toBe('المعادي');
    // The time ticked on 150 alone is exchanged too: 213 takes 07:30, and 150 takes 213's 09:00.
    expect(result.b.plannedTime).toBe('07:30');
    expect(result.a.plannedTime).toBe('09:00');
    expect(result.replaced).toEqual([]);
    expect(result.moved).toEqual(
      expect.arrayContaining([
        { from: 'a', item: 'field:plannedTime' },
        { from: 'b', item: 'field:plannedTime' },
      ]),
    );
    // Ticked on 213's card alone, the same exchange.
    const fromB = planSwap(V150, V213, picks([], [fieldItem('plannedTime')]), 'swap', RULES);
    expect([fromB.a.plannedTime, fromB.b.plannedTime]).toEqual(['09:00', '07:30']);
    // Nothing else moved.
    expect(result.a.slots).toEqual(V150.slots);
    expect(result.b.notes).toBeNull();
  });

  it('one way, a field still MOVES and the value it lands on is named as replaced', () => {
    const result = planSwap(V150, V213, picks([fieldItem('plannedTime')]), 'aToB', RULES);
    expect([result.a.plannedTime, result.b.plannedTime]).toEqual([null, '07:30']);
    expect(result.replaced).toEqual([{ on: 'b', field: 'plannedTime', was: '09:00' }]);
  });

  it('a field moved onto an empty one replaces nothing', () => {
    const result = planSwap(V150, V213, picks([fieldItem('notes')]), 'swap', RULES);
    expect(result.b.notes).toBe('تسليم البنك الأهلي');
    expect(result.a.notes).toBeNull();
    expect(result.replaced).toEqual([]);
  });

  it('half the people: the captain and one specialist cross, the rest stay', () => {
    const result = planSwap(
      V150,
      V213,
      picks([personItem('c1'), personItem('s2')], [personItem('c2')]),
      'swap',
      RULES,
    );
    expect(result.a.slots).toEqual({ captain: ['c2'], specialist1: ['s1'], specialist2: [] });
    expect(result.b.slots).toEqual({ captain: ['c1'], specialist1: ['s3'], specialist2: ['s2'] });
    expect(result.moved).toEqual(
      expect.arrayContaining([
        { from: 'a', item: 'person:c1', slot: 'captain' },
        { from: 'a', item: 'person:s2', slot: 'specialist2' },
        { from: 'b', item: 'person:c2', slot: 'captain' },
      ]),
    );
  });
});

describe('«نقل المحدد» one way — only the sending card’s ticks cross', () => {
  it('a → b: 150’s ticked items go to 213; 213’s ticks are not read', () => {
    const result = planSwap(
      V150,
      V213,
      picks([personItem('s1'), fieldItem('direction')], [personItem('c2'), fieldItem('notes')]),
      'aToB',
      RULES,
    );
    expect(result.a.slots).toEqual({ captain: ['c1'], specialist1: [], specialist2: ['s2'] });
    expect(result.b.slots).toEqual({ captain: ['c2'], specialist1: ['s3', 's1'], specialist2: [] });
    expect(result.b.direction).toBe('المعادي');
    expect(result.a.direction).toBeNull();
    expect(result.replaced).toEqual([{ on: 'b', field: 'direction', was: 'حلوان' }]);
    expect(result.moved.every((move) => move.from === 'a')).toBe(true);
  });

  it('b → a: the other way', () => {
    const result = planSwap(V150, V213, picks([personItem('c1')], all(V213)), 'bToA', RULES);
    // 150's captain slot had c1 (not sent) and takes c2: two captains.
    expect(result.a.slots.captain).toEqual(['c1', 'c2']);
    expect(result.b.slots).toEqual({ captain: [], specialist1: [], specialist2: [] });
    expect(result.a.shiftTypeId).toBe('t-reserve');
    expect(result.b.shiftTypeId).toBeNull();
    expect(result.replaced).toEqual(
      expect.arrayContaining([
        { on: 'a', field: 'direction', was: 'المعادي' },
        { on: 'a', field: 'plannedTime', was: '07:30' },
        { on: 'a', field: 'shiftTypeId', was: 't-daily' },
      ]),
    );
  });

  it('nothing ticked on the sending card: nothing crosses, the same rows', () => {
    const result = planSwap(V150, V213, picks([], all(V213)), 'aToB', RULES);
    expect(result.moved).toEqual([]);
    expect(result.a).toBe(V150);
    expect(result.b).toBe(V213);
  });
});

describe('a person keeps his slot role — the same slot, or the first free one of its kind', () => {
  it('the paths: a captain to «قائد الطاقم» only; a specialist to his own «أخصائي» slot, then the other', () => {
    expect(SLOT_PATH).toEqual({
      captain: ['captain'],
      specialist1: ['specialist1', 'specialist2'],
      specialist2: ['specialist2', 'specialist1'],
    });
  });

  it('a specialist whose «أخصائي 1» is full on the other row lands in «أخصائي 2»', () => {
    const full = van('61', { slots: { captain: [], specialist1: ['s8', 's9'], specialist2: [] } });
    const result = planSwap(V150, full, picks([personItem('s1')]), 'aToB', RULES);
    expect(result.b.slots.specialist2).toEqual(['s1']);
    expect(result.moved).toEqual([{ from: 'a', item: 'person:s1', slot: 'specialist2' }]);
  });

  it('a captain-specialist moves as his seat: from a specialist slot to a specialist slot', () => {
    const a = van('101', { slots: { captain: [], specialist1: ['d1'], specialist2: [] } });
    const result = planSwap(a, V213, picks([personItem('d1')]), 'aToB', RULES);
    expect(result.b.slots.specialist1).toEqual(['s3', 'd1']);
    expect(result.b.slots.captain).toEqual(['c2']);
  });
});

describe('the board’s rules keep an item where it is — named, never applied', () => {
  it('Round 23 — a seat held outside one’s role stays: the other row would be a new seat the save refuses', () => {
    // A specialist sitting in 150's captain slot since before the rule.
    const held = van('150', { slots: { captain: ['s7'], specialist1: [], specialist2: [] } });
    const result = planSwap(held, V213, picks([personItem('s7')]), 'aToB', RULES);
    expect(result.refused).toEqual([{ from: 'a', item: 'person:s7', reason: 'notCaptain' }]);
    expect(result.a).toBe(held);
    expect(result.b).toBe(V213);
    // And a captain-only held in a specialist's slot.
    const heldCaptain = van('150', {
      slots: { captain: [], specialist1: ['c9'], specialist2: [] },
    });
    expect(planSwap(heldCaptain, V213, picks([personItem('c9')]), 'aToB', RULES).refused).toEqual([
      { from: 'a', item: 'person:c9', reason: 'notSpecialist' },
    ]);
  });

  it('Round 22 — somebody HR has away that day goes on no other row: he stays, the rest crosses', () => {
    const rules = rulesWith({ away: { s1: 'absent', c1: 'onLeave' } });
    const result = planSwap(V150, V213, picks(quickPick(V150, 'crew')), 'aToB', rules);
    expect(result.refused).toEqual([
      { from: 'a', item: 'person:c1', reason: 'onLeave' },
      { from: 'a', item: 'person:s1', reason: 'absent' },
    ]);
    expect(result.a.slots).toEqual({ captain: ['c1'], specialist1: ['s1'], specialist2: [] });
    expect(result.b.slots.specialist2).toEqual(['s2']);
  });

  it('somebody the roster no longer names is not judged here (the save reads his requirements)', () => {
    const odd = van('150', { slots: { captain: ['x1'], specialist1: [], specialist2: [] } });
    const result = planSwap(
      odd,
      V213,
      picks([personItem('x1')]),
      'aToB',
      rulesWith({ unknown: ['x1'] }),
    );
    expect(result.refused).toEqual([]);
    expect(result.b.slots.captain).toEqual(['c2', 'x1']);
  });

  it('capacity — a full slot on the other row keeps the person back, named', () => {
    const full = van('61', { slots: { captain: ['c5', 'c6'], specialist1: [], specialist2: [] } });
    const result = planSwap(V150, full, picks([personItem('c1'), personItem('s1')]), 'aToB', RULES);
    expect(result.refused).toEqual([{ from: 'a', item: 'person:c1', reason: 'captainFull' }]);
    expect(result.a.slots.captain).toEqual(['c1']);
    expect(result.b.slots).toEqual({ captain: ['c5', 'c6'], specialist1: ['s1'], specialist2: [] });
    // Both specialists' slots full.
    const crowded = van('62', {
      slots: { captain: [], specialist1: ['s5', 's6'], specialist2: ['s8', 's9'] },
    });
    expect(planSwap(V150, crowded, picks([personItem('s2')]), 'aToB', RULES).refused).toEqual([
      { from: 'a', item: 'person:s2', reason: 'specialistsFull' },
    ]);
  });

  it('capacity is counted AFTER the operation — the ones leaving make room for the ones arriving', () => {
    const full = van('61', { slots: { captain: ['c5', 'c6'], specialist1: [], specialist2: [] } });
    const result = planSwap(
      V150,
      full,
      picks([personItem('c1')], [personItem('c5')]),
      'swap',
      RULES,
    );
    expect(result.refused).toEqual([]);
    expect(result.a.slots.captain).toEqual(['c5']);
    expect(result.b.slots.captain).toEqual(['c6', 'c1']);
  });

  it('one kept back takes his seat back — and may leave no room for one coming the other way', () => {
    // 150: two captains, both ticked; 61: one captain, ticked, and absent — he stays.
    const a = van('150', { slots: { captain: ['c1', 'c2'], specialist1: [], specialist2: [] } });
    const b = van('61', { slots: { captain: ['c5'], specialist1: [], specialist2: [] } });
    const rules = rulesWith({ away: { c5: 'absent' } });
    const result = planSwap(a, b, picks(quickPick(a, 'crew'), quickPick(b, 'crew')), 'swap', rules);
    expect(result.refused).toEqual([
      { from: 'b', item: 'person:c5', reason: 'absent' },
      { from: 'a', item: 'person:c2', reason: 'captainFull' },
    ]);
    expect(result.a.slots.captain).toEqual(['c2']);
    expect(result.b.slots.captain).toEqual(['c5', 'c1']);
    // Nobody is on two rows, nobody is lost (Q11).
    const everyone = [...result.a.slots.captain, ...result.b.slots.captain].sort();
    expect(everyone).toEqual(['c1', 'c2', 'c5']);
  });

  // Round 32 critic — REWRITTEN. It pinned 213's active type crossing onto 150 «replacing the archived
  // one it held» in an exchange the card said kept the archived one: it ended on NEITHER row, and the
  // archived type cannot be picked again. The archived type stays — and so does the other.
  it('a type archived since the row took it stays on its row — in an exchange the other row keeps its own too', () => {
    const rules = rulesWith({ archived: ['t-daily'] });
    for (const ticks of [
      picks([fieldItem('shiftTypeId')], [fieldItem('shiftTypeId')]),
      picks([], [fieldItem('shiftTypeId')]),
      picks([fieldItem('shiftTypeId')], []),
    ]) {
      const result = planSwap(V150, V213, ticks, 'swap', rules);
      expect(result.a.shiftTypeId).toBe('t-daily');
      expect(result.b.shiftTypeId).toBe('t-reserve');
      expect(result.refused).toEqual([
        { from: 'a', item: 'field:shiftTypeId', reason: 'archivedType' },
        { from: 'b', item: 'field:shiftTypeId', reason: 'archivedPair' },
      ]);
      expect(result.replaced).toEqual([]);
      expect(result.moved).toEqual([]);
      // Nothing crossed at all: the same rows.
      expect(result.a).toBe(V150);
    }
    // The rest of an exchange still crosses around it.
    const withDirection = planSwap(
      V150,
      V213,
      picks([fieldItem('shiftTypeId'), fieldItem('direction')]),
      'swap',
      rules,
    );
    expect(withDirection.a).toMatchObject({ shiftTypeId: 't-daily', direction: 'حلوان' });
    expect(withDirection.b).toMatchObject({ shiftTypeId: 't-reserve', direction: 'المعادي' });
    // One way, the archived type is refused; an ACTIVE type sent onto its row replaces it — as a
    // type picked by hand there would, named in the preview.
    const sent = planSwap(V150, V213, picks([fieldItem('shiftTypeId')]), 'aToB', rules);
    expect(sent.refused).toEqual([
      { from: 'a', item: 'field:shiftTypeId', reason: 'archivedType' },
    ]);
    expect(sent.b.shiftTypeId).toBe('t-reserve');
    const back = planSwap(V150, V213, picks([], [fieldItem('shiftTypeId')]), 'bToA', rules);
    expect(back.a.shiftTypeId).toBe('t-reserve');
    expect(back.replaced).toEqual([{ on: 'a', field: 'shiftTypeId', was: 't-daily' }]);
    // Unless the row it goes to already holds it on the server.
    const held = rulesWith({ archived: ['t-daily'], heldBy: { 't-daily': 'van:v-213' } });
    expect(
      planSwap(V150, V213, picks([fieldItem('shiftTypeId')]), 'aToB', held).b.shiftTypeId,
    ).toBe('t-daily');
  });
});

describe('a row without a van takes part like any row', () => {
  it('the whole of 150 moved onto a row without a van leaves 150 blank, its van kept', () => {
    const loose: PlanRow = { ...vehiclelessRow(3), key: 'loose:c-9', crewId: 'c-9' };
    const result = planSwap(V150, loose, picks(all(V150)), 'aToB', RULES);
    expect(result.b).toMatchObject({
      key: 'loose:c-9',
      vehicleId: null,
      slots: V150.slots,
      direction: 'المعادي',
      rowColour: 'navy',
    });
    expect(result.a).toMatchObject({
      vehicleId: 'v-150',
      slots: { captain: [], specialist1: [], specialist2: [] },
      direction: null,
      plannedTime: null,
      shiftTypeId: null,
      rowColour: null,
      notes: null,
    });
  });
});

describe('«تطبيق» on the draft — one step of «تراجع», two rows for «حفظ»', () => {
  const OTHER = van('9', { slots: { captain: ['c8'], specialist1: [], specialist2: [] } });
  const ROWS: readonly PlanRow[] = [V150, OTHER, V213];
  const swapAll = (rows: readonly PlanRow[]): readonly PlanRow[] =>
    applySwap(rows, V150.key, V213.key, picks(all(V150), all(V213)), 'swap', RULES);

  it('replaces the two rows in place; every other row is the same object', () => {
    const next = swapAll(ROWS);
    expect(next.map((row) => row.key)).toEqual(['van:v-150', 'van:v-9', 'van:v-213']);
    expect(next[1]).toBe(OTHER);
    expect(next[0]?.slots.captain).toEqual(['c2']);
    expect(next[2]?.slots.captain).toEqual(['c1']);
  });

  it('nothing crossing, a row gone, or the same row twice: the same array (no operation recorded)', () => {
    expect(applySwap(ROWS, V150.key, V213.key, NO_PICKS, 'swap', RULES)).toBe(ROWS);
    expect(applySwap(ROWS, V150.key, 'van:v-404', picks(all(V150)), 'aToB', RULES)).toBe(ROWS);
    expect(applySwap(ROWS, V150.key, V150.key, picks(all(V150)), 'aToB', RULES)).toBe(ROWS);
    // Only refusals — nothing to apply.
    const held = rulesWith({ away: { c1: 'absent' } });
    expect(applySwap(ROWS, V150.key, V213.key, picks([personItem('c1')]), 'aToB', held)).toBe(ROWS);
  });

  it('is ONE operation: one press of «تراجع» puts both rows back, whatever crossed', () => {
    const history: UndoHistory<CrewDraft> = startHistory({ rows: ROWS, standingKeys: null });
    const after = record(
      history,
      { rows: swapAll(history.now.rows), standingKeys: null },
      { kind: 'swap', vars: { a: '150', b: '213' } },
      { same: sameCrewDraft },
    );
    expect(after.past).toHaveLength(1);
    expect(after.past[0]?.what).toEqual({ kind: 'swap', vars: { a: '150', b: '213' } });
    const back = undo(after);
    expect(back.now.rows).toBe(ROWS);
    expect(back.past).toEqual([]);
    // A swap that crosses nothing records nothing.
    const none = record(
      history,
      { rows: applySwap(ROWS, V150.key, V213.key, NO_PICKS, 'swap', RULES), standingKeys: null },
      { kind: 'swap' },
      { same: sameCrewDraft },
    );
    expect(none).toBe(history);
  });

  it('«حفظ (n)» counts the two rows the operation changed', () => {
    expect(changeCount(planChanges(swapAll(ROWS), ROWS))).toBe(2);
    // Swapped back by hand: nothing to save.
    const twice = applySwap(
      swapAll(ROWS),
      V150.key,
      V213.key,
      picks(all(V213), all(V150)),
      'swap',
      RULES,
    );
    expect(changeCount(planChanges(twice, ROWS))).toBe(0);
  });
});

describe('the ticks follow the rows as they are', () => {
  it('an item a row no longer holds is no longer ticked; unchanged ticks are the same object', () => {
    const ticks = picks([personItem('c1'), fieldItem('notes')], [personItem('c2')]);
    expect(livePicks(V150, V213, ticks)).toBe(ticks);
    const moved = { ...V150, slots: { ...V150.slots, captain: [] }, notes: null };
    expect(livePicks(moved, V213, ticks)).toEqual({ a: [], b: ['person:c2'] });
  });
});

describe('Round 32 critic — the board around the operation', () => {
  const OTHER = van('9', { slots: { captain: ['c8'], specialist1: [], specialist2: [] } });

  it('the standing crew’s toggle lets go of the two rows — its «off» no longer empties the wrong one', () => {
    // «الطاقم الثابت» filled 150 (and 9); 213's crew is hand-placed. Swapped, then the toggle off.
    const draft: CrewDraft = {
      rows: [V150, OTHER, V213],
      standingKeys: [V150.key, OTHER.key],
      standingDirections: { [V150.key]: 'المعادي' },
    };
    const after = applySwapToDraft(
      draft,
      V150.key,
      V213.key,
      picks(quickPick(V150, 'crew'), quickPick(V213, 'crew')),
      'swap',
      RULES,
    );
    expect(after.standingKeys).toEqual([OTHER.key]);
    expect(after.standingDirections).toEqual({});
    const off = clearStandingFromPlan(
      after.rows,
      after.standingKeys ?? [],
      after.standingDirections ?? {},
    );
    // 213's hand-placed people, now on 150, stay where the planner put them — and so does the
    // standing crew, now on 213; only the load's other van is emptied.
    expect(off.find((row) => row.key === V150.key)?.slots.captain).toEqual(['c2']);
    expect(off.find((row) => row.key === V213.key)?.slots.captain).toEqual(['c1']);
    expect(off.find((row) => row.key === OTHER.key)?.slots.captain).toEqual([]);
    // Before the fix the «off» emptied 150 — 213's people back to the pools — and left the loaded
    // crew on 213.
    const unfixed = clearStandingFromPlan(after.rows, draft.standingKeys ?? [], {});
    expect(unfixed.find((row) => row.key === V150.key)?.slots.captain).toEqual([]);
  });

  it('nothing crossed: the same draft; no standing load: only the rows change', () => {
    const draft: CrewDraft = { rows: [V150, V213], standingKeys: null };
    expect(applySwapToDraft(draft, V150.key, V213.key, NO_PICKS, 'swap', RULES)).toBe(draft);
    const after = applySwapToDraft(draft, V150.key, V213.key, picks(all(V150)), 'aToB', RULES);
    expect(after.standingKeys).toBeNull();
    expect(after.rows).not.toBe(draft.rows);
  });

  it('a one-way move is called a move, from the sending row — never «التبديل بين …»', () => {
    const names = { a: '213', b: '255' };
    expect(swapOperation('swap', names)).toEqual({ kind: 'swap', vars: { a: '213', b: '255' } });
    expect(swapOperation('aToB', names)).toEqual({
      kind: 'move',
      vars: { from: '213', to: '255' },
    });
    expect(swapOperation('bToA', names)).toEqual({
      kind: 'move',
      vars: { from: '255', to: '213' },
    });
    expect(translate('ar', 'operations.crewPlan.undo.kind.move', { from: '213', to: '255' })).toBe(
      'نقل المحدد من 213 إلى 255',
    );
    expect(translate('en', 'operations.crewPlan.swap.moved', { from: '213', to: '255' })).toBe(
      'Moved the selected from 213 to 255',
    );
  });

  it('the arrow keys follow the reading direction — the next way to the left in Arabic, to the right in English', () => {
    // The three ways in a row: «نقل ←» «تبديل ⇄» «نقل →» from the start side.
    expect(modeStepOf('ArrowLeft', true)).toBe(1);
    expect(modeStepOf('ArrowRight', true)).toBe(-1);
    expect(modeStepOf('ArrowRight', false)).toBe(1);
    expect(modeStepOf('ArrowLeft', false)).toBe(-1);
    // In a column (at lg), down is next in both languages.
    expect(modeStepOf('ArrowDown', true)).toBe(1);
    expect(modeStepOf('ArrowDown', false)).toBe(1);
    expect(modeStepOf('ArrowUp', false)).toBe(-1);
    expect(modeStepOf('Tab', false)).toBe(0);
  });

  it('the محصنات a row holds stay on it — said when its captains or its direction change', () => {
    const holding = { ...V150, shipments: 6 };
    const crossed = planSwap(holding, V213, picks([personItem('c1')]), 'aToB', RULES);
    expect(shipmentsLeftBehind(holding, crossed.a)).toBe(6);
    const direction = planSwap(holding, V213, picks([fieldItem('direction')]), 'swap', RULES);
    expect(shipmentsLeftBehind(holding, direction.a)).toBe(6);
    // A specialist or the notes leaving does not change what they were placed for.
    const notes = planSwap(
      holding,
      V213,
      picks([personItem('s1'), fieldItem('notes')]),
      'aToB',
      RULES,
    );
    expect(shipmentsLeftBehind(holding, notes.a)).toBe(0);
    // A row holding none says nothing.
    expect(shipmentsLeftBehind(V150, crossed.a)).toBe(0);
  });
});
