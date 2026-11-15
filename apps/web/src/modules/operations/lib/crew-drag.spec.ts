// Round 22 — «مش راضى يخلينى احط ولا قادة ولا اخصائيين على العربيه … بسحب الاسم بالماوس وبيرجع تانى
// اكنى متحطش». The drop could not be reproduced as refused, so every gate a real browser could trip
// is pinned shut here, one per candidate the investigation ranked:
//   1. the drag's `types` without the board's MIME type (a hook or an extension on Windows): the
//      drop is still accepted — acceptance never reads `types`;
//   2. aimed «على العربيه», at the vehicle's cell or between the boxes: the row routes the person;
//   3. a slow PC: `dragstart` writes the drag's data and sets no state;
//   4. a stale closure: who is dragged is a ref, read at the moment of each event;
//   5. another desk's save under an unsaved drop: the draft is rebased, not replaced.
// And Round 23 — «ممنوع ان اعين قائد مكان اخصائى والعكس الا فى حالة انه قائد اخصائى»: a slot the
// role does not fit refuses, in its own words, and a drop on the row never routes into one.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CREW_SLOT_CAPACITY } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import {
  CREW_DRAG_TYPE,
  acceptsDragOver,
  beginDrag,
  droppedMember,
  parseTargetKey,
  refusedAsAway,
  refusedAsWrongSlot,
  resolveDrop,
  rowDropSlots,
  targetFromMarks,
  targetKey,
  type DragSourceData,
  type DropTarget,
} from './crew-drag';
import {
  CREW_SLOTS,
  changeCount,
  fitsCrewSlot,
  planChanges,
  placeMember,
  rebaseDraft,
  type CrewRole,
  type PlanRow,
} from './crew-plan';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const row = (key: string, over: Partial<PlanRow> = {}): PlanRow => ({
  key,
  vehicleId: key.startsWith('van:') ? key.slice(4) : null,
  vehicleCode: key.startsWith('van:') ? key.slice(4) : null,
  crewId: key.startsWith('loose:') ? key.slice(6) : null,
  drivers: [],
  slots: { captain: [], specialist1: [], specialist2: [] },
  direction: null,
  plannedTime: null,
  shiftTypeId: null,
  rowColour: null,
  notes: null,
  ...over,
});
const slots = (captain: string[], specialist1: string[] = [], specialist2: string[] = []) => ({
  captain,
  specialist1,
  specialist2,
});

/** The owner's day: no vans planned, one saved row without a van («محصنة», 05:10, yellow). */
const LOOSE = row('loose:c1', {
  plannedTime: '05:10',
  shiftTypeId: 't-secured',
  rowColour: 'yellow',
});
const VAN = row('van:249');

describe('the drag source writes data only (candidate 3: a slow PC)', () => {
  it('carries the id under the board type AND as text/plain, and allows copy or move', () => {
    const written: [string, string][] = [];
    const data: DragSourceData = {
      setData: (format, value) => written.push([format, value]),
      effectAllowed: 'uninitialized',
    };
    beginDrag(data, 'e-7');
    expect(written).toEqual([
      [CREW_DRAG_TYPE, 'e-7'],
      ['text/plain', 'e-7'],
    ]);
    // `move` alone left a drag with no allowed effect at all once a hook took MOVE away.
    expect(data.effectAllowed).toBe('copyMove');
  });

  it('the page sets no state in dragstart, and draws the drag only after the first answer', () => {
    const page = read('../pages/CrewBoardPage.tsx');
    const start = page.slice(page.indexOf('const startDrag = '), page.indexOf('const drawDrag = '));
    expect(start).toContain('beginDrag(event.dataTransfer, employeeId);');
    expect(start).not.toMatch(/\bset[A-Z]\w*\(/u);
    const draw = page.slice(page.indexOf('const drawDrag = '), page.indexOf('const endDrag = '));
    expect(draw).toContain('window.setTimeout(');
    expect(draw).toContain('setDragging(employeeId);');
    // Called from a dragover, after the event is cancelled — the browser has its «yes» first.
    expect(page).toContain('event.preventDefault();\n    drawDrag(employeeId);');
  });
});

describe('a dragover is answered from our own drag, never from `types` (candidates 1 and 4)', () => {
  it('takes our drag anywhere — the DataTransfer is not even an input', () => {
    // A Windows hook that forwards only text/plain, or nothing at all, cannot change the answer.
    expect(acceptsDragOver('e-7')).toBe(true);
  });

  it('leaves a drag that is not ours — a file, a link, text from another window — to the browser', () => {
    expect(acceptsDragOver(null)).toBe(false);
  });

  it('the page accepts every dragover of ours, names no dropEffect, and decides at the drop', () => {
    const page = read('../pages/CrewBoardPage.tsx');
    const over = page.slice(page.indexOf('const overDrag = '), page.indexOf('const boardDrop'));
    expect(over).toContain(
      'if (!acceptsDragOver(employeeId)) return;\n    event.preventDefault();',
    );
    // Nothing under the pointer — a full slot, the toolbar — may make it refuse: the browser applies
    // a dragover's answer late, and a late «no» refused a hand that let go on a row.
    expect(over).not.toContain('resolveDrop');
    expect(over).not.toContain('decide(');
    // Blink refuses a dropEffect the drag's source does not allow; none is named anywhere.
    expect(page).not.toMatch(/dropEffect\s*=/u);
    const drop = page.slice(page.indexOf('onDrop: (event) => {'), page.indexOf(': {};'));
    expect(drop).toContain('decide(targetAt(event.target), employeeId)');
    expect(drop).toContain('sayRefusal(decision, employeeId)');
  });

  it('the page reads no `types`, and keeps who is dragged in a ref', () => {
    const page = read('../pages/CrewBoardPage.tsx');
    expect(page).not.toMatch(/dataTransfer\.types/u);
    expect(page).not.toContain('carriesCrewMember');
    expect(page).toContain('const dragRef = useRef<string | null>(null);');
    expect(page).toContain('const employeeId = dragRef.current;');
    expect(read('../components/CrewPlanChip.tsx')).not.toContain('dataTransfer.types');
  });
});

describe('who a drop carries', () => {
  const known = (id: string): boolean => ['e-1', 'e-2', 'e-3'].includes(id);

  it('our own drag first, then the board type, then text/plain', () => {
    expect(droppedMember({ own: 'e-1', custom: 'e-2', text: 'e-3' }, known)).toBe('e-1');
    expect(droppedMember({ own: null, custom: 'e-2', text: 'e-3' }, known)).toBe('e-2');
    // The board type stripped on the way: text/plain still says who.
    expect(droppedMember({ own: null, custom: '', text: ' e-3 ' }, known)).toBe('e-3');
  });

  it('only somebody the board knows — a text from elsewhere drops nobody', () => {
    expect(droppedMember({ own: null, custom: '', text: 'hello' }, known)).toBeNull();
    expect(droppedMember({ own: 'x', custom: '', text: 'e-2' }, known)).toBe('e-2');
    expect(droppedMember({ own: null, custom: '', text: '' }, known)).toBeNull();
  });
});

describe('what is under the pointer', () => {
  it('a slot by its zone, a row anywhere else on it, a pool', () => {
    expect(
      targetFromMarks({ slotZone: 'van:249|specialist2', rowKey: 'van:249', pool: null }),
    ).toEqual({ kind: 'slot', key: 'van:249', slot: 'specialist2' });
    // The vehicle's cell, a box, the gap between the slots: the row.
    expect(targetFromMarks({ slotZone: null, rowKey: 'loose:c1', pool: null })).toEqual({
      kind: 'row',
      key: 'loose:c1',
    });
    expect(targetFromMarks({ slotZone: null, rowKey: null, pool: 'captains' })).toEqual({
      kind: 'pool',
      pool: 'captains',
    });
    expect(targetFromMarks({ slotZone: null, rowKey: null, pool: null })).toBeNull();
    // A zone naming no slot falls back to its row.
    expect(targetFromMarks({ slotZone: 'van:249|driver', rowKey: 'van:249', pool: null })).toEqual({
      kind: 'row',
      key: 'van:249',
    });
  });

  it('round-trips as the one string the page keeps', () => {
    const targets: DropTarget[] = [
      { kind: 'slot', key: 'new:3', slot: 'captain' },
      { kind: 'row', key: 'van:665f1c2e9b0a4d0012345678' },
      { kind: 'pool', pool: 'specialists' },
    ];
    for (const target of targets) expect(parseTargetKey(targetKey(target))).toEqual(target);
    expect(parseTargetKey('nonsense')).toBeNull();
  });
});

describe('a drop on the row goes where the role sits (candidate 2: «على العربيه»)', () => {
  it('routes like legacy: captain → captain; blue → captain, then specialists; red → specialists', () => {
    expect(rowDropSlots('captain')).toEqual(['captain']);
    expect(rowDropSlots('dual')).toEqual(['captain', 'specialist1', 'specialist2']);
    expect(rowDropSlots('specialist')).toEqual(['specialist1', 'specialist2']);
  });

  it('a captain and a specialist dropped on the vehicle-less row land in their slots', () => {
    const rows = [VAN, LOOSE];
    const target: DropTarget = { kind: 'row', key: LOOSE.key };
    expect(resolveDrop(rows, target, 'cap', 'captain')).toEqual({
      kind: 'place',
      key: LOOSE.key,
      slot: 'captain',
    });
    expect(resolveDrop(rows, target, 'sp', 'specialist')).toEqual({
      kind: 'place',
      key: LOOSE.key,
      slot: 'specialist1',
    });
  });

  it('fills «أخصائي 1» then «أخصائي 2»; the blue one takes a specialist slot once captains are full', () => {
    const full = Array.from({ length: CREW_SLOT_CAPACITY }, (_, i) => `x${i}`);
    const rows = [row('van:249', { slots: slots(full, full) })];
    const target: DropTarget = { kind: 'row', key: 'van:249' };
    expect(resolveDrop(rows, target, 'sp', 'specialist')).toMatchObject({ slot: 'specialist2' });
    expect(resolveDrop(rows, target, 'blue', 'dual')).toMatchObject({ slot: 'specialist2' });
  });

  it('a full row refuses with its reason, and names the slots to draw red', () => {
    const full = Array.from({ length: CREW_SLOT_CAPACITY }, (_, i) => `x${i}`);
    const rows = [row('van:249', { slots: slots(full, full, full) })];
    const target: DropTarget = { kind: 'row', key: 'van:249' };
    expect(resolveDrop(rows, target, 'cap', 'captain')).toEqual({
      kind: 'refuse',
      key: 'van:249',
      slots: ['captain'],
      reason: 'captainFull',
    });
    expect(resolveDrop(rows, target, 'sp', 'specialist')).toMatchObject({
      reason: 'specialistsFull',
      slots: ['specialist1', 'specialist2'],
    });
    expect(resolveDrop(rows, target, 'blue', 'dual')).toMatchObject({ reason: 'rowFull' });
    // Every reason is said in both languages — what is full, on which row; then what to do.
    for (const locale of ['ar', 'en'] as const) {
      const say = (key: string): string =>
        translate(locale, `operations.crewPlan.drop.${key}`, { slot: 'S', row: '249', name: 'N' });
      for (const reason of ['full', 'captainFull', 'specialistsFull', 'rowFull']) {
        expect(say(reason)).not.toContain('operations.');
        expect(say(reason)).toContain('249');
      }
      expect(say('takeOff')).not.toContain('operations.');
    }
  });

  it('somebody already on the row stays put; from another row he moves', () => {
    const rows = [row('van:249', { slots: slots(['cap']) }), LOOSE];
    expect(resolveDrop(rows, { kind: 'row', key: 'van:249' }, 'cap', 'captain')).toEqual({
      kind: 'stay',
    });
    const moved = resolveDrop(rows, { kind: 'row', key: LOOSE.key }, 'cap', 'captain');
    expect(moved).toEqual({ kind: 'place', key: LOOSE.key, slot: 'captain' });
  });

  it('a drop aimed at a slot means that slot — the role’s own, full refused', () => {
    const full = Array.from({ length: CREW_SLOT_CAPACITY }, (_, i) => `x${i}`);
    const rows = [row('van:249', { slots: slots([], [], full) }), LOOSE];
    expect(
      resolveDrop(rows, { kind: 'slot', key: 'van:249', slot: 'specialist1' }, 'sp', 'specialist'),
    ).toEqual({ kind: 'place', key: 'van:249', slot: 'specialist1' });
    expect(
      resolveDrop(rows, { kind: 'slot', key: 'van:249', slot: 'specialist1' }, 'blue', 'dual'),
    ).toEqual({ kind: 'place', key: 'van:249', slot: 'specialist1' });
    expect(
      resolveDrop(rows, { kind: 'slot', key: 'van:249', slot: 'specialist2' }, 'sp', 'specialist'),
    ).toEqual({ kind: 'refuse', key: 'van:249', slots: ['specialist2'], reason: 'full' });
    expect(
      resolveDrop(rows, { kind: 'slot', key: 'van:249', slot: 'specialist2' }, 'x0', 'specialist'),
    ).toEqual({ kind: 'stay' });
  });

  it('a pool frees somebody seated, and leaves a free name where it is', () => {
    const rows = [row('van:249', { slots: slots(['cap']) })];
    expect(resolveDrop(rows, { kind: 'pool', pool: 'captains' }, 'cap', 'captain')).toEqual({
      kind: 'free',
    });
    expect(resolveDrop(rows, { kind: 'pool', pool: 'specialists' }, 'sp', 'specialist')).toEqual({
      kind: 'stay',
    });
  });

  // Round 22 F — «لو القائد غايب … مقدرش احطه على العربيه و كذلك الاخصائيين».
  it('refuses somebody AWAY that day on every slot and row, naming why — and draws red where he aims', () => {
    const rows = [row('van:249', { slots: slots([], ['sp']) }), row('van:250'), LOOSE];
    // Aimed at a slot: that slot refuses, in his reason's words.
    expect(
      resolveDrop(
        rows,
        { kind: 'slot', key: LOOSE.key, slot: 'captain' },
        'cap',
        'captain',
        'absent',
      ),
    ).toEqual({ kind: 'refuse', key: LOOSE.key, slots: ['captain'], reason: 'absent' });
    // On the row: every slot his role would take is drawn red.
    expect(resolveDrop(rows, { kind: 'row', key: 'van:250' }, 'du', 'dual', 'onLeave')).toEqual({
      kind: 'refuse',
      key: 'van:250',
      slots: ['captain', 'specialist1', 'specialist2'],
      reason: 'onLeave',
    });
    // Seated before HR recorded it: moved to another van, refused …
    expect(
      resolveDrop(
        rows,
        { kind: 'slot', key: 'van:250', slot: 'specialist1' },
        'sp',
        'specialist',
        'absent',
      ),
    ).toMatchObject({ kind: 'refuse', reason: 'absent' });
    // … but slot to slot on the row he already sits on, and off the board, as the server allows.
    expect(
      resolveDrop(
        rows,
        { kind: 'slot', key: 'van:249', slot: 'specialist2' },
        'sp',
        'specialist',
        'absent',
      ),
    ).toEqual({ kind: 'place', key: 'van:249', slot: 'specialist2' });
    expect(
      resolveDrop(rows, { kind: 'pool', pool: 'specialists' }, 'sp', 'specialist', 'absent'),
    ).toEqual({ kind: 'free' });
    // Nobody away: the rule is the one before — an unknown is not an absence.
    expect(
      resolveDrop(rows, { kind: 'slot', key: 'van:250', slot: 'captain' }, 'cap', 'captain', null),
    ).toEqual({ kind: 'place', key: 'van:250', slot: 'captain' });
    expect(refusedAsAway('absent')).toBe(true);
    expect(refusedAsAway('onLeave')).toBe(true);
    expect(refusedAsAway('full')).toBe(false);
  });

  it('the page decides every drop and pick with his day, and says the reason on the slot and in the toast', () => {
    const page = read('../pages/CrewBoardPage.tsx');
    expect(page).toContain(
      'resolveDrop(rows, target, employeeId, roleOf(employeeId), awayOf(memberOf(employeeId)))',
    );
    // A slot is armed by the same decision — nothing lights up that would then refuse.
    expect(page).toContain(
      "decide({ kind: 'slot', key: row.key, slot }, moving)?.kind === 'place'",
    );
    expect(page).toContain('t(`operations.crewPlan.away.day.${overDecision.reason}`)');
    expect(page).toContain("'operations.crewPlan.drop.awayWhy'");
    for (const locale of ['ar', 'en'] as const) {
      expect(translate(locale, 'operations.crewPlan.drop.absent', { name: 'X' })).toContain('X');
      expect(translate(locale, 'operations.crewPlan.drop.onLeave', { name: 'X' })).toContain('X');
    }
    expect(translate('ar', 'operations.crewPlan.away.day.absent')).toBe('غائب في هذا اليوم');
  });

  it('the page makes the whole board one target, with no handler left on a slot', () => {
    const page = read('../pages/CrewBoardPage.tsx');
    expect(page).toContain('data-crew-plan="true" {...boardDrop}');
    expect(page).not.toContain('dropZone(');
    expect(read('../components/CrewPlanPools.tsx')).not.toContain('drop.handlers');
  });

  it('draws where the drop lands OVER the slot — a row that grew slid the next van away', () => {
    const page = read('../pages/CrewBoardPage.tsx');
    const landing = page.slice(page.indexOf('data-drop-landing="true"'));
    expect(landing.slice(0, landing.indexOf('>'))).toMatch(
      /className="pointer-events-none absolute inset-0 /u,
    );
  });
});

describe('another desk saves under an unsaved drop (candidate 5)', () => {
  const base = [VAN, LOOSE];

  it('a name just dropped survives another desk’s save of another row', () => {
    const draft = placeMember(base, LOOSE.key, 'captain', 'cap');
    const next = [row('van:249', { crewId: 'c9', notes: 'desk 2' }), LOOSE];
    const rebased = rebaseDraft(draft, base, next);
    expect(rebased.find((r) => r.key === LOOSE.key)?.slots.captain).toEqual(['cap']);
    // The other desk's change shows, and only the planner's own change is left to save.
    expect(rebased.find((r) => r.key === 'van:249')?.notes).toBe('desk 2');
    const changes = planChanges(rebased, next);
    expect(changeCount(changes)).toBe(1);
    expect(changes.changed.map((r) => r.key)).toEqual([LOOSE.key]);
  });

  it('nothing changed here → the new answer itself', () => {
    const next = [row('van:249', { notes: 'desk 2' }), LOOSE];
    expect(rebaseDraft(base, base, next)).toBe(next);
  });

  it('keeps a row added here and a row taken off here; adds a row new on the server', () => {
    const added = row('new:1', { slots: slots(['cap']) });
    const draft = [VAN, added];
    const next = [VAN, LOOSE, row('loose:c2', { notes: 'desk 2' })];
    const rebased = rebaseDraft(draft, base, next);
    expect(rebased.map((r) => r.key)).toEqual(['van:249', 'loose:c2', 'new:1']);
    expect(planChanges(rebased, next).removedCrewIds).toEqual(['c1']);
  });

  it('refreshes the server’s facts on a row changed here', () => {
    const draft = placeMember(base, VAN.key, 'captain', 'cap');
    const next = [row('van:249', { crewId: 'c9', vehicleCode: '249-B' }), LOOSE];
    const mine = rebaseDraft(draft, base, next).find((r) => r.key === VAN.key);
    expect(mine).toMatchObject({ crewId: 'c9', vehicleCode: '249-B' });
    expect(mine?.slots.captain).toEqual(['cap']);
  });

  it('the page rebases on a same-day answer and starts again on a new day or its own save', () => {
    const page = read('../pages/CrewBoardPage.tsx');
    expect(page).toContain(
      'if (seen !== null && seen.day !== null && seen.day === answeredDay && !plan.isPending) {',
    );
    expect(page).toContain('setRows(rebaseDraft(rows, seen.rows, serverRows));');
  });
});

// ── Round 23 — who may take which slot ─────────────────────────────────────────────────────────────

describe('Round 23 — «ممنوع ان اعين قائد مكان اخصائى والعكس الا فى حالة انه قائد اخصائى»', () => {
  const ROLES: readonly CrewRole[] = ['captain', 'dual', 'specialist'];

  it('refuses a captain-only aimed at a specialist’s slot, and a specialist aimed at the captain’s — with its own reason', () => {
    const rows = [row('van:249'), LOOSE];
    for (const slot of ['specialist1', 'specialist2'] as const) {
      expect(resolveDrop(rows, { kind: 'slot', key: 'van:249', slot }, 'cap', 'captain')).toEqual({
        kind: 'refuse',
        key: 'van:249',
        slots: [slot],
        reason: 'notSpecialist',
      });
    }
    expect(
      resolveDrop(rows, { kind: 'slot', key: LOOSE.key, slot: 'captain' }, 'sp', 'specialist'),
    ).toEqual({ kind: 'refuse', key: LOOSE.key, slots: ['captain'], reason: 'notCaptain' });
    expect(refusedAsWrongSlot('notCaptain')).toBe(true);
    expect(refusedAsWrongSlot('notSpecialist')).toBe(true);
    expect(refusedAsWrongSlot('full')).toBe(false);
    expect(refusedAsAway('notCaptain')).toBe(false);
  });

  it('lets a captain-specialist land in every slot, aimed at or routed to', () => {
    const rows = [row('van:249')];
    for (const slot of CREW_SLOTS) {
      expect(resolveDrop(rows, { kind: 'slot', key: 'van:249', slot }, 'blue', 'dual')).toEqual({
        kind: 'place',
        key: 'van:249',
        slot,
      });
    }
  });

  it('says the role, not the room, when a full slot is not his anyway', () => {
    const full = Array.from({ length: CREW_SLOT_CAPACITY }, (_, i) => `x${i}`);
    const rows = [row('van:249', { slots: slots(full) })];
    expect(
      resolveDrop(rows, { kind: 'slot', key: 'van:249', slot: 'captain' }, 'sp', 'specialist'),
    ).toMatchObject({ kind: 'refuse', reason: 'notCaptain' });
  });

  it('routes a drop on the ROW only into slots the role fits — never the other role’s, full or not', () => {
    for (const role of ROLES) {
      expect(
        rowDropSlots(role).every((slot) => fitsCrewSlot(role, slot)),
        role,
      ).toBe(true);
    }
    // A captain whose slot is full is refused — never seated as a specialist instead.
    const full = Array.from({ length: CREW_SLOT_CAPACITY }, (_, i) => `x${i}`);
    const captainsFull = [row('van:249', { slots: slots(full) })];
    expect(resolveDrop(captainsFull, { kind: 'row', key: 'van:249' }, 'cap', 'captain')).toEqual({
      kind: 'refuse',
      key: 'van:249',
      slots: ['captain'],
      reason: 'captainFull',
    });
    // A specialist on an empty row goes to «أخصائي 1» — never the empty captain's slot.
    expect(
      resolveDrop([row('van:249')], { kind: 'row', key: 'van:249' }, 'sp', 'specialist'),
    ).toEqual({
      kind: 'place',
      key: 'van:249',
      slot: 'specialist1',
    });
    // A captain-specialist: the captain's slot first, then the specialists'.
    expect(resolveDrop(captainsFull, { kind: 'row', key: 'van:249' }, 'blue', 'dual')).toEqual({
      kind: 'place',
      key: 'van:249',
      slot: 'specialist1',
    });
  });

  it('keeps a seat held before the rule where it is, and refuses moving it to another slot not his', () => {
    // A captain-only seated in «أخصائي 1» before the rule.
    const rows = [row('van:249', { slots: slots([], ['cap']) })];
    expect(
      resolveDrop(rows, { kind: 'slot', key: 'van:249', slot: 'specialist1' }, 'cap', 'captain'),
    ).toEqual({ kind: 'stay' });
    expect(
      resolveDrop(rows, { kind: 'slot', key: 'van:249', slot: 'specialist2' }, 'cap', 'captain'),
    ).toMatchObject({ kind: 'refuse', reason: 'notSpecialist' });
    // Into the slot he fits — the move that answers the mark — and off the board, both open.
    expect(
      resolveDrop(rows, { kind: 'slot', key: 'van:249', slot: 'captain' }, 'cap', 'captain'),
    ).toEqual({ kind: 'place', key: 'van:249', slot: 'captain' });
    expect(resolveDrop(rows, { kind: 'pool', pool: 'captains' }, 'cap', 'captain')).toEqual({
      kind: 'free',
    });
  });

  it('says each refusal in both languages — the owner’s own words in Arabic, and whom the slot takes', () => {
    expect(translate('ar', 'operations.crewPlan.drop.notSpecialist')).toBe(
      'لا يُعيَّن قائد في خانة أخصائي',
    );
    expect(translate('ar', 'operations.crewPlan.drop.notCaptain')).toBe(
      'لا يُعيَّن أخصائي في خانة القائد',
    );
    for (const locale of ['ar', 'en'] as const) {
      for (const why of ['notCaptain', 'notSpecialist']) {
        const said = translate(locale, `operations.crewPlan.drop.${why}Why`, { name: 'N' });
        expect(said).toContain('N');
        expect(said).not.toContain('operations.');
        expect(translate(locale, `operations.crewPlan.wrongSlot.over.${why}`)).not.toContain(
          'operations.',
        );
      }
    }
    expect(translate('ar', 'operations.crewPlan.wrongSlot.over.notCaptain')).toBe('للقادة فقط');
    expect(translate('ar', 'operations.crewPlan.wrongSlot.over.notSpecialist')).toBe(
      'للأخصائيين فقط',
    );
  });

  it('the page says it: red over the slot with «للقادة فقط» / «للأخصائيين فقط», and the toast with why', () => {
    const page = read('../pages/CrewBoardPage.tsx');
    expect(page).toContain('t(`operations.crewPlan.wrongSlot.over.${overDecision.reason}`)');
    expect(page).toContain('`operations.crewPlan.drop.${decision.reason}Why`');
    // «اختر ثم ضع هنا» arms only what the drop would place — so only the slots he fits.
    expect(page).toContain(
      "decide({ kind: 'slot', key: row.key, slot }, moving)?.kind === 'place'",
    );
    // The old «a captain may go in a specialist's slot» advice is gone with the rule it described.
    expect(page).not.toContain('captainElsewhere');
    expect(page).not.toContain('outOfRole');
  });
});
