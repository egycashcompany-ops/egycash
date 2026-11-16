// «تراجع» — one step back (Round 24): «وعاوز تراجع دا يتراجع عن اخر عمليه مش كل العمليات فاهم».
//
// Asserted on the history itself and on the board's own operations: each press takes back the LAST
// operation only — however many rows it touched — and the next press the one before, until nothing
// is left; typing is one operation; another desk's save is rebased under the history as under the
// draft; and the page wires the button, Ctrl+Z and the save the way the owner asked.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { translate } from '../../../platform/localization/i18n';
import {
  UNDO_LIMIT,
  changedRowKeys,
  lastStep,
  mergeKeyOf,
  rebaseHistory,
  record,
  sameCrewDraft,
  sealHistory,
  startHistory,
  undo,
  undoableStep,
  type CrewDraft,
  type UndoHistory,
} from './crew-undo';
import {
  clearStandingFromPlan,
  discardRow,
  loadStandingIntoPlan,
  patchRow,
  placeMember,
  planChanges,
  rebaseDraft,
  vehiclelessRow,
  type PlanRow,
} from './crew-plan';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const van = (code: string, over: Partial<PlanRow> = {}): PlanRow => ({
  key: `van:v-${code}`,
  vehicleId: `v-${code}`,
  vehicleCode: code,
  onRoster: true,
  crewId: null,
  drivers: [],
  slots: { captain: [], specialist1: [], specialist2: [] },
  direction: null,
  plannedTime: null,
  shiftTypeId: null,
  rowColour: null,
  notes: null,
  ...over,
});

const numbers = { same: (a: number, b: number) => a === b };

/** The board's history, and one operation on its rows — as the page's `applyRows` records it. */
const board = (rows: readonly PlanRow[]): UndoHistory<CrewDraft> =>
  startHistory({ rows, standingKeys: null });
const op = (
  history: UndoHistory<CrewDraft>,
  kind: string,
  change: (rows: readonly PlanRow[]) => readonly PlanRow[],
  merge?: string,
): UndoHistory<CrewDraft> =>
  record(
    history,
    { ...history.now, rows: change(history.now.rows) },
    { kind },
    merge === undefined ? { same: sameCrewDraft } : { same: sameCrewDraft, merge },
  );

describe('the history — one press, one operation', () => {
  it('takes back the LAST operation only, then the one before, until nothing is left', () => {
    let history = startHistory(0);
    history = record(history, 1, { kind: 'a' }, numbers);
    history = record(history, 2, { kind: 'b' }, numbers);
    history = record(history, 3, { kind: 'c' }, numbers);
    expect(lastStep(history)?.what.kind).toBe('c');
    history = undo(history);
    expect(history.now).toBe(2);
    expect(lastStep(history)?.what.kind).toBe('b');
    history = undo(undo(history));
    expect(history.now).toBe(0);
    expect(lastStep(history)).toBeNull();
    // Nothing left: a press does nothing — the button is off.
    expect(undo(history)).toBe(history);
  });

  it('records nothing for an operation that changed nothing', () => {
    const history = record(startHistory(5), 5, { kind: 'same' }, numbers);
    expect(history.past).toHaveLength(0);
  });

  it('one typing session is one entry — until it is sealed, or another operation comes on top', () => {
    let history = startHistory('');
    const same = (a: string, b: string): boolean => a === b;
    for (const typed of ['a', 'ab', 'abc']) {
      history = record(history, typed, { kind: 'notes' }, { same, merge: 'notes:1' });
    }
    expect(history.past).toHaveLength(1);
    expect(undo(history).now).toBe('');
    // Sealed (the box lost the focus): the next key is a new operation.
    history = record(sealHistory(history), 'abcd', { kind: 'notes' }, { same, merge: 'notes:1' });
    expect(history.past).toHaveLength(2);
    expect(undo(history).now).toBe('abc');
    // Another box's typing is its own operation.
    history = record(history, 'x', { kind: 'notes' }, { same, merge: 'notes:2' });
    expect(history.past).toHaveLength(3);
    // Typed back to where it began, the session is no operation at all.
    let back = record(startHistory('q'), 'qa', { kind: 'notes' }, { same, merge: 'n' });
    back = record(back, 'q', { kind: 'notes' }, { same, merge: 'n' });
    expect(back.past).toHaveLength(0);
  });

  it('the time panel’s hour and minute are ONE operation — until the panel closes', () => {
    expect(mergeKeyOf('notes', 'van:v-1')).toBe('notes:van:v-1');
    expect(mergeKeyOf('time', 'van:v-1')).toBe('time:van:v-1');
    for (const kind of ['type', 'colour', 'direction', 'place', 'giveVan']) {
      expect(mergeKeyOf(kind, 'van:v-1')).toBeUndefined();
    }
    const at =
      (plannedTime: string) =>
      (rows: readonly PlanRow[]): readonly PlanRow[] =>
        patchRow(rows, 'van:v-259', { plannedTime });
    const merge = mergeKeyOf('time', 'van:v-259');
    // 15:00 → the hour 07 picked (the minute kept: 07:00) → the minute :30 picked, the panel closes.
    let history = op(board([van('259', { plannedTime: '15:00' })]), 'time', at('07:00'), merge);
    history = sealHistory(op(history, 'time', at('07:30'), merge));
    expect(history.past).toHaveLength(1);
    // One press: 15:00 again — never 07:00, a time nobody chose.
    expect(undo(history).now.rows[0]?.plannedTime).toBe('15:00');
    // The same box changed again after the panel closed is an operation of its own.
    history = sealHistory(op(history, 'time', at('08:00'), merge));
    expect(history.past).toHaveLength(2);
    expect(undo(history).now.rows[0]?.plannedTime).toBe('07:30');
  });

  it('takes nothing back while a save is in flight — the read-back would drop the press unsaid', () => {
    // The save's read-back starts the history afresh from what was SENT; a step taken back in that
    // window would vanish and the operation it named would be saved anyway.
    const history = record(startHistory(0), 1, { kind: 'place' }, numbers);
    expect(undoableStep(history, false)).toBe(lastStep(history));
    expect(undoableStep(history, false)?.what.kind).toBe('place');
    expect(undoableStep(history, true)).toBeNull();
    expect(undoableStep(startHistory(0), false)).toBeNull();
  });

  it('keeps the last UNDO_LIMIT operations', () => {
    let history = startHistory(0);
    for (let at = 1; at <= UNDO_LIMIT + 5; at += 1) {
      history = record(history, at, { kind: 'n' }, numbers);
    }
    expect(history.past).toHaveLength(UNDO_LIMIT);
    expect(history.past[0]?.before).toBe(5);
  });
});

describe('the board’s operations — each one entry, however many rows it touched', () => {
  const rows = [
    van('249', { slots: { captain: ['a'], specialist1: ['s'], specialist2: [] } }),
    van('250'),
    van('251'),
  ];

  it('a drag from one van to another changes two rows and is ONE press back', () => {
    let history = board(rows);
    history = op(history, 'place', (current) => placeMember(current, 'van:v-250', 'captain', 'a'));
    expect(changedRowKeys(rows, history.now.rows)).toEqual(['van:v-249', 'van:v-250']);
    history = op(history, 'direction', (current) =>
      patchRow(current, 'van:v-251', { direction: 'المعادي' }),
    );
    // One press: the direction only — the move stays.
    history = undo(history);
    expect(history.now.rows[2]?.direction).toBeNull();
    expect(history.now.rows[1]?.slots.captain).toEqual(['a']);
    // The next press: the move, both rows of it.
    history = undo(history);
    expect(sameCrewDraft(history.now, { rows, standingKeys: null })).toBe(true);
    expect(planChanges(history.now.rows, rows).changed).toEqual([]);
  });

  it('the standing crew loaded on twenty vans is one press back — and its toggle is off again', () => {
    const empty = [van('1'), van('2'), van('3')];
    const load = loadStandingIntoPlan(empty, [
      {
        vehicleId: 'v-1',
        captainEmployeeIds: ['c1'],
        specialist1EmployeeIds: [],
        specialist2EmployeeIds: [],
      },
      {
        vehicleId: 'v-3',
        captainEmployeeIds: ['c3'],
        specialist1EmployeeIds: [],
        specialist2EmployeeIds: [],
      },
    ]);
    let history = startHistory<CrewDraft>({ rows: empty, standingKeys: null });
    history = record(
      history,
      { rows: load.rows, standingKeys: load.filledKeys },
      { kind: 'standingLoad' },
      { same: sameCrewDraft },
    );
    expect(history.now.standingKeys).toEqual(['van:v-1', 'van:v-3']);
    history = record(
      history,
      {
        rows: clearStandingFromPlan(history.now.rows, history.now.standingKeys ?? []),
        standingKeys: null,
      },
      { kind: 'standingClear' },
      { same: sameCrewDraft },
    );
    // Taking back the «off» puts the load back, toggle on; once more, and nothing was loaded.
    history = undo(history);
    expect(history.now.standingKeys).toEqual(['van:v-1', 'van:v-3']);
    expect(history.now.rows[0]?.slots.captain).toEqual(['c1']);
    history = undo(history);
    expect(history.now).toEqual({ rows: empty, standingKeys: null });
  });

  it('a row added, then deleted: each its own press', () => {
    let history = board(rows);
    history = op(history, 'addRow', (current) => [...current, vehiclelessRow(1)]);
    history = op(history, 'removeRow', (current) => discardRow(current, 'new:1'));
    expect(history.now.rows).toHaveLength(3);
    history = undo(history);
    expect(history.now.rows.map((row) => row.key)).toContain('new:1');
    history = undo(history);
    expect(history.now.rows).toHaveLength(3);
  });
});

describe('another desk saves under the history (`rebaseHistory`)', () => {
  const base = [van('249'), van('250')];

  it('rebases every entry as the draft is rebased — undo never brings back the other desk’s old rows', () => {
    let history = board(base);
    history = op(history, 'place', (current) => placeMember(current, 'van:v-249', 'captain', 'me'));
    // Another desk put somebody on 250 and saved.
    const next = [
      van('249'),
      van('250', {
        crewId: 'c250',
        slots: { captain: ['them'], specialist1: [], specialist2: [] },
      }),
    ];
    const rebased = rebaseHistory(
      history,
      (state) => ({ ...state, rows: rebaseDraft(state.rows, base, next) }),
      sameCrewDraft,
    );
    expect(rebased.now.rows[0]?.slots.captain).toEqual(['me']);
    expect(rebased.now.rows[1]?.slots.captain).toEqual(['them']);
    const back = undo(rebased);
    // My move is taken back; the other desk's row stays as it saved it.
    expect(back.now.rows[0]?.slots.captain).toEqual([]);
    expect(back.now.rows[1]?.slots.captain).toEqual(['them']);
    expect(planChanges(back.now.rows, next).changed).toEqual([]);
  });

  it('drops an entry the other desk made true — a press that would undo nothing', () => {
    let history = board(base);
    history = op(history, 'place', (current) => placeMember(current, 'van:v-249', 'captain', 'x'));
    const next = [
      van('249', { slots: { captain: ['x'], specialist1: [], specialist2: [] } }),
      van('250'),
    ];
    const rebased = rebaseHistory(
      history,
      (state) => ({ ...state, rows: rebaseDraft(state.rows, base, next) }),
      sameCrewDraft,
    );
    expect(rebased.past).toHaveLength(0);
  });
});

describe('the page — the owner’s «تراجع»', () => {
  const page = read('../pages/CrewBoardPage.tsx');

  it('the button takes back the last operation, says which, and is off with nothing to take back', () => {
    expect(page).toContain('onClick={undoLast}');
    expect(page).toContain('disabled={lastOperation === null}');
    expect(page).toContain("t('operations.crewPlan.undo.title', { what: undoWords })");
    // No «discard everything» left: the draft is never put back to the server's answer by a press.
    expect(page).not.toContain('setRows(serverRows)');
    expect(page).toContain('setHistory(undo);');
  });

  it('while «حفظ» is in flight the button is off and Ctrl+Z takes nothing back', () => {
    // One source for both: the button's `disabled`, the press and Ctrl+Z all read `lastOperation`.
    expect(page).toContain('const lastOperation = undoableStep(history, plan.isPending);');
    expect(page).toContain('if (!canPlan || lastOperation === null || undoWords === null) return;');
    expect(page).toContain('undoRef.current();');
  });

  it('Ctrl+Z / ⌘Z does the same outside a text box', () => {
    expect(page).toContain("event.code !== 'KeyZ'");
    expect(page).toContain('target.closest(\'input, textarea, select, [contenteditable="true"]\')');
    expect(page).toContain('aria-keyshortcuts="Control+Z Meta+Z"');
  });

  it('a save clears the history; the notes box seals its typing on leaving, the time its panel on closing', () => {
    expect(page).toContain('setHistory((current) => startHistory(current.now));');
    expect(page).toContain('onBlur={() => setHistory(sealHistory)}');
    // The notes' keys and the time panel's hour + minute merge (`mergeKeyOf`) until sealed.
    expect(page).toContain('mergeKeyOf(kind, key),');
    expect(page).toContain('onSettle={() => setHistory(sealHistory)}');
    const controls = read('../components/CrewPlanControls.tsx');
    // The panel closing — a minute, «مسح», Escape, outside — settles; so does a typed time taken.
    expect(controls).toContain('if (wasOpen.current && !open) settle.current?.();');
    expect(controls).toMatch(
      /if \(parsed !== undefined\) set\(parsed\);\s*setTyped\(null\);\s*onSettle\?\.\(\);/,
    );
  });

  it('every operation kind is said, in formal Arabic and in English', () => {
    const kinds = [
      ...page.matchAll(/apply(?:Rows)?\(\s*\{\s*kind: '([a-zA-Z]+)'/g),
      ...page.matchAll(/\? '(direction|time|type|colour|notes)'/g),
    ].map((match) => match[1] as string);
    for (const kind of [
      'place',
      'free',
      'addRow',
      'giveVan',
      'standingLoad',
      'standingClear',
      'restoreRow',
      'direction',
    ]) {
      expect(kinds).toContain(kind);
    }
    for (const kind of [...new Set(kinds), 'removeRow', 'clearRow', 'notes']) {
      for (const locale of ['ar', 'en'] as const) {
        const key = `operations.crewPlan.undo.kind.${kind}`;
        expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
      }
    }
    expect(
      translate('ar', 'operations.crewPlan.undo.title', {
        what: translate('ar', 'operations.crewPlan.undo.kind.place', {
          name: 'أحمد',
          where: '249 · قائد الطاقم',
        }),
      }),
    ).toBe('تراجع عن: نقل أحمد إلى 249 · قائد الطاقم');
    expect(translate('ar', 'operations.crewPlan.discard')).toBe('تراجع');
  });
});
