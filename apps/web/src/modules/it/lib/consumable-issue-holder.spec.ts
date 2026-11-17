// «لما أكتب اسم الشخص اللى هسلمه تظهر الأجهزة اللى معاه بس … والعكس بردو .. لو كتبت سيرال فى الجهاز
// … تظهر على طول الشخص اللى مستلم الجهاز» (2026-11-17) — the issue dialog's person and devices,
// rule by rule, through the reducer the dialog runs on.
import { describe, expect, it } from 'vitest';
import { type ItAssetDto, type ItPersonDto } from '@ecms/contracts';
import {
  clearedLineNumbers,
  heldByOther,
  holderAnswer,
  holderName,
  issueHolderReducer,
  issueHolderStart,
  lineNumber,
  personLabel,
  type IssueDeviceLine,
  type IssueHolderEvent,
  type IssueHolderState,
} from './consumable-issue-holder';

interface Line extends IssueDeviceLine {
  qty: string;
}

const WALEED = 'e-waleed';
const SHERIF = 'e-sherif';
/** A third person — whose device is picked through «جهاز آخر». */
const HANY = 'e-hany';

const person = (over: Partial<ItPersonDto> = {}): ItPersonDto => ({
  employeeId: WALEED,
  code: '0100052',
  fullNameAr: 'وليد صفوت جلال',
  status: 'active',
  branchId: 'b-hq',
  departmentId: null,
  jobTitleId: null,
  hiredAt: '2020-01-01',
  exitedAt: null,
  userId: null,
  openCustodyCount: 2,
  ...over,
});

const asset = (id: string, holderId: string | null): ItAssetDto =>
  ({
    id,
    assetCode: `AST-${id}`,
    name: 'Lenovo ThinkCentre',
    status: holderId === null ? 'inStock' : 'assigned',
    serialNumber: `SN-${id}`,
    holder:
      holderId === null
        ? null
        : { employeeId: holderId, employeeCode: null, employeeName: null, assignedAt: '' },
  }) as ItAssetDto;

const line = (key: number, device: ItAssetDto | null = null): Line => ({
  key,
  qty: '1',
  assetId: device?.id ?? '',
  asset: device,
});

const run = (
  state: IssueHolderState<Line>,
  ...events: IssueHolderEvent<Line>[]
): IssueHolderState<Line> => events.reduce(issueHolderReducer<Line>, state);

const start = (...lines: Line[]): IssueHolderState<Line> => issueHolderStart(lines);

/** A device picked on a line, from the row the picker offered. */
const pick = (key: number, device: ItAssetDto | null): IssueHolderEvent<Line> => ({
  type: 'device',
  key,
  assetId: device?.id ?? '',
  asset: device,
});

describe('the person first — their devices, and «جهاز آخر»', () => {
  it('a first person, chosen over nobody, clears nothing — whoever holds the lines’ devices', () => {
    const state = run(
      start(
        line(0, asset('a-1', WALEED)),
        line(1, asset('a-2', SHERIF)),
        line(2, asset('a-3', null)),
      ),
      { type: 'person', employeeId: WALEED, label: 'وليد صفوت جلال (0100052)' },
    );
    expect(state.employeeId).toBe(WALEED);
    expect(state.lines.map((each) => each.assetId)).toEqual(['a-1', 'a-2', 'a-3']);
    expect(clearedLineNumbers(state)).toEqual([]);
  });

  it('changing the person from P to Q clears ONLY what P held — with the message', () => {
    // Waleed chosen; line 1 his device, line 2 Sherif's own, line 3 one in stock, line 4 Hany's
    // picked through «جهاز آخر».
    const chosen = run(
      start(line(0), line(1), line(2), line(3)),
      { type: 'person', employeeId: WALEED, label: 'وليد صفوت جلال (0100052)' },
      pick(0, asset('a-1', WALEED)),
      pick(1, asset('a-2', SHERIF)),
      pick(2, asset('a-3', null)),
      pick(3, asset('a-4', HANY)),
    );
    // Picking through «جهاز آخر» never changes the person.
    expect(chosen.employeeId).toBe(WALEED);
    expect(chosen.asking).toBeNull();
    expect(clearedLineNumbers(chosen)).toEqual([]);

    const changed = run(chosen, {
      type: 'person',
      employeeId: SHERIF,
      label: 'شريف ممدوح فاروق (0100077)',
    });
    expect(changed.lines.map((each) => each.assetId)).toEqual(['', 'a-2', 'a-3', 'a-4']);
    expect(changed.lines[0]?.asset).toBeNull();
    expect(clearedLineNumbers(changed)).toEqual([1]);
    // The message follows the lines as they are numbered now, and forgets a line given a device again.
    expect(clearedLineNumbers(run(changed, pick(0, asset('a-9', SHERIF))))).toEqual([]);
  });

  it('every line P held goes, and the one message lists them all', () => {
    const changed = run(
      start(line(0), line(1), line(2)),
      { type: 'person', employeeId: WALEED, label: 'x' },
      pick(0, asset('a-1', WALEED)),
      pick(1, asset('a-2', HANY)),
      pick(2, asset('a-3', WALEED)),
      { type: 'person', employeeId: SHERIF, label: 'y' },
    );
    expect(changed.lines.map((each) => each.assetId)).toEqual(['', 'a-2', '']);
    expect(clearedLineNumbers(changed)).toEqual([1, 3]);
  });

  it('removing the person with the box’s × and choosing another is a change of person too', () => {
    const state = run(
      start(line(0), line(1)),
      { type: 'person', employeeId: WALEED, label: 'x' },
      pick(0, asset('a-1', WALEED)),
      pick(1, asset('a-2', SHERIF)),
      { type: 'person', employeeId: '', label: '' },
    );
    // Cleared: every device kept, nothing said…
    expect(state.lines.map((each) => each.assetId)).toEqual(['a-1', 'a-2']);
    expect(clearedLineNumbers(state)).toEqual([]);
    expect(state.lastEmployeeId).toBe(WALEED);
    // …and the next person replaces Waleed: his device goes, Sherif's own stays.
    const next = run(state, { type: 'person', employeeId: SHERIF, label: 'y' });
    expect(next.lines.map((each) => each.assetId)).toEqual(['', 'a-2']);
    expect(clearedLineNumbers(next)).toEqual([1]);
    // Choosing the same person again is no change.
    const same = run(state, { type: 'person', employeeId: WALEED, label: 'x' });
    expect(same.lines.map((each) => each.assetId)).toEqual(['a-1', 'a-2']);
    expect(clearedLineNumbers(same)).toEqual([]);
  });

  it('a line removed takes its place in the message with it', () => {
    const state = run(
      start(line(0), line(1), line(2)),
      { type: 'person', employeeId: SHERIF, label: 'y' },
      pick(0, asset('a-1', SHERIF)),
      pick(2, asset('a-3', SHERIF)),
      { type: 'person', employeeId: WALEED, label: 'x' },
    );
    expect(clearedLineNumbers(state)).toEqual([1, 3]);
    expect(clearedLineNumbers(run(state, { type: 'remove', key: 0 }))).toEqual([2]);
  });

  it('clearing the person keeps every line’s device', () => {
    const state = run(
      start(line(0, asset('a-1', WALEED)), line(1)),
      { type: 'person', employeeId: WALEED, label: 'x' },
      pick(1, asset('a-2', WALEED)),
      { type: 'person', employeeId: '', label: '' },
    );
    expect(state.employeeId).toBe('');
    expect(state.employeeLabel).toBe('');
    expect(state.lines.map((each) => each.assetId)).toEqual(['a-1', 'a-2']);
    expect(clearedLineNumbers(state)).toEqual([]);
    expect(state.asking).toBeNull();
  });

  it('never picks a device for the user — not even a person’s only one', () => {
    const state = run(start(line(0), line(1)), { type: 'person', employeeId: WALEED, label: 'x' });
    expect(state.lines.map((each) => each.assetId)).toEqual(['', '']);
  });
});

describe('a device somebody else holds — said under its line', () => {
  it('names the holder of a device that is not the chosen person’s', () => {
    const hanys = asset('a-4', HANY);
    expect(heldByOther(line(0, hanys), WALEED)).toEqual(hanys.holder);
  });

  it('says nothing of the person’s own device, one in stock, an empty line, or with nobody chosen', () => {
    expect(heldByOther(line(0, asset('a-1', WALEED)), WALEED)).toBeNull();
    expect(heldByOther(line(0, asset('a-3', null)), WALEED)).toBeNull();
    expect(heldByOther(line(0), WALEED)).toBeNull();
    // With nobody chosen a held device fills the person instead (or says why under the field).
    expect(heldByOther(line(0, asset('a-4', HANY)), '')).toBeNull();
  });

  it('names them as the employee box does, or with what the register has', () => {
    const holder = { employeeId: HANY, assignedAt: '' };
    expect(holderName({ ...holder, employeeName: 'هاني رأفت سليم', employeeCode: '0100091' })).toBe(
      'هاني رأفت سليم (0100091)',
    );
    expect(holderName({ ...holder, employeeName: 'هاني رأفت سليم', employeeCode: null })).toBe(
      'هاني رأفت سليم',
    );
    expect(holderName({ ...holder, employeeName: null, employeeCode: '0100091' })).toBe('0100091');
    expect(holderName({ ...holder, employeeName: null, employeeCode: null })).toBe(HANY);
  });
});

describe('the device first — its holder fills the person', () => {
  it('a held device asks who holds it, and an employed holder fills the person with the box’s label', () => {
    const asked = run(start(line(0), line(1)), pick(0, asset('a-1', WALEED)));
    expect(asked.asking).toEqual({ lineKey: 0, assetId: 'a-1', employeeId: WALEED });
    expect(asked.employeeId).toBe('');

    const filled = run(asked, {
      type: 'holderRead',
      question: { lineKey: 0, assetId: 'a-1', employeeId: WALEED },
      person: person(),
    });
    expect(filled.employeeId).toBe(WALEED);
    // The employee box's own format, `${fullNameAr} (${code})`.
    expect(filled.employeeLabel).toBe('وليد صفوت جلال (0100052)');
    expect(filled.employeeLabel).toBe(personLabel(person()));
    expect(filled.lines[0]?.assetId).toBe('a-1');
    expect(filled.note).toEqual({ kind: 'filled', lineKey: 0 });
    expect(filled.asking).toBeNull();
  });

  it('a fill over nobody clears nothing: another line’s device stays, whoever holds it', () => {
    const state = run(
      start(line(0, asset('a-7', SHERIF)), line(1, asset('a-8', null)), line(2)),
      pick(2, asset('a-1', WALEED)),
      // The latest pick is the one asked about: line 3's.
      {
        type: 'holderRead',
        question: { lineKey: 2, assetId: 'a-1', employeeId: WALEED },
        person: person(),
      },
    );
    expect(state.employeeId).toBe(WALEED);
    expect(state.lines.map((each) => each.assetId)).toEqual(['a-7', 'a-8', 'a-1']);
    expect(clearedLineNumbers(state)).toEqual([]);
  });

  it('a fill after a person was removed replaces them: their devices go', () => {
    const state = run(
      start(line(0), line(1)),
      { type: 'person', employeeId: SHERIF, label: 'y' },
      pick(0, asset('a-7', SHERIF)),
      { type: 'person', employeeId: '', label: '' },
      pick(1, asset('a-1', WALEED)),
      {
        type: 'holderRead',
        question: { lineKey: 1, assetId: 'a-1', employeeId: WALEED },
        person: person(),
      },
    );
    expect(state.employeeId).toBe(WALEED);
    expect(state.lines.map((each) => each.assetId)).toEqual(['', 'a-1']);
    expect(clearedLineNumbers(state)).toEqual([1]);
  });

  it('a holder who has left fills nothing, and the note says so under the field', () => {
    const state = run(start(line(0)), pick(0, asset('a-1', WALEED)), {
      type: 'holderRead',
      question: { lineKey: 0, assetId: 'a-1', employeeId: WALEED },
      person: person({ status: 'exited', exitedAt: '2026-10-01' }),
    });
    expect(state.employeeId).toBe('');
    expect(state.employeeLabel).toBe('');
    expect(state.lines[0]?.assetId).toBe('a-1');
    expect(state.note).toEqual({ kind: 'exited', lineKey: 0, name: 'وليد صفوت جلال' });
    expect(lineNumber(state, 0)).toBe(1);
  });

  it('a holder who cannot be read fills nothing either', () => {
    const state = run(start(line(0)), pick(0, asset('a-1', WALEED)), {
      type: 'holderRead',
      question: { lineKey: 0, assetId: 'a-1', employeeId: WALEED },
      person: null,
    });
    expect(state.employeeId).toBe('');
    expect(state.note).toEqual({ kind: 'unreadable', lineKey: 0 });
  });

  it('a device in stock fills nothing and asks nothing', () => {
    const state = run(start(line(0)), pick(0, asset('a-2', null)));
    expect(state.asking).toBeNull();
    expect(state.employeeId).toBe('');
    expect(state.note).toBeNull();
    expect(state.lines[0]?.assetId).toBe('a-2');
  });

  it('with a person already chosen, a device picked asks nothing', () => {
    const state = run(
      start(line(0)),
      { type: 'person', employeeId: WALEED, label: 'x' },
      pick(0, asset('a-1', WALEED)),
    );
    expect(state.asking).toBeNull();
    expect(state.employeeId).toBe(WALEED);
  });

  it('an answer nobody waits for any more is dropped', () => {
    const question = { lineKey: 0, assetId: 'a-1', employeeId: WALEED };
    const asked = run(start(line(0)), pick(0, asset('a-1', WALEED)));
    // The user chose somebody by hand meanwhile: the field is theirs.
    const byHand = run(
      asked,
      { type: 'person', employeeId: SHERIF, label: 'شريف ممدوح فاروق (0100077)' },
      { type: 'holderRead', question, person: person() },
    );
    expect(byHand.employeeId).toBe(SHERIF);
    expect(byHand.note).toBeNull();
    // The device was cleared meanwhile.
    const cleared = run(asked, pick(0, null), { type: 'holderRead', question, person: person() });
    expect(cleared.employeeId).toBe('');
    // Another line's device was picked meanwhile: only the latest pick is asked about.
    const other = run(
      { ...asked, lines: [...asked.lines, line(1)] },
      pick(1, asset('a-5', SHERIF)),
      { type: 'holderRead', question, person: person() },
    );
    expect(other.employeeId).toBe('');
    expect(other.asking).toEqual({ lineKey: 1, assetId: 'a-5', employeeId: SHERIF });
  });

  it('the note about a line goes with its device', () => {
    const exited = run(start(line(0)), pick(0, asset('a-1', WALEED)), {
      type: 'holderRead',
      question: { lineKey: 0, assetId: 'a-1', employeeId: WALEED },
      person: person({ status: 'exited' }),
    });
    expect(run(exited, pick(0, null)).note).toBeNull();
    expect(run(exited, { type: 'person', employeeId: SHERIF, label: 'x' }).note).toBeNull();
  });
});

describe('the dialog’s effect — what it hands the reducer once the holder is read', () => {
  const question = { lineKey: 0, assetId: 'a-1', employeeId: WALEED };

  it('nothing while nothing is asked, or while the answer is not in', () => {
    expect(holderAnswer<Line>(null, { data: person(), isError: false })).toBeNull();
    expect(holderAnswer<Line>(null, { data: undefined, isError: true })).toBeNull();
    expect(holderAnswer<Line>(question, { data: undefined, isError: false })).toBeNull();
  });

  it('the person asked about, read: handed over with them', () => {
    expect(holderAnswer<Line>(question, { data: person(), isError: false })).toEqual({
      type: 'holderRead',
      question,
      person: person(),
    });
    // A leaver too — the reducer is the one that refuses to fill them.
    const left = person({ status: 'exited' });
    expect(holderAnswer<Line>(question, { data: left, isError: false })).toEqual({
      type: 'holderRead',
      question,
      person: left,
    });
  });

  it('a failed read: handed over with nobody — «could not confirm», nothing filled', () => {
    const event = holderAnswer<Line>(question, { data: undefined, isError: true });
    expect(event).toEqual({ type: 'holderRead', question, person: null });
    if (event === null) return;
    const state = run(start(line(0)), pick(0, asset('a-1', WALEED)), event);
    expect(state.employeeId).toBe('');
    expect(state.note).toEqual({ kind: 'unreadable', lineKey: 0 });
  });

  it('somebody else’s record is no answer to this question', () => {
    const sherif = person({ employeeId: SHERIF, fullNameAr: 'شريف ممدوح فاروق', code: '0100077' });
    expect(holderAnswer<Line>(question, { data: sherif, isError: false })).toBeNull();
  });
});

describe('the lines themselves', () => {
  it('patches, adds and removes, and never removes the last line', () => {
    const state = run(
      start(line(0)),
      { type: 'patch', key: 0, update: { qty: '3' } },
      { type: 'add', line: line(1) },
    );
    expect(state.lines.map((each) => [each.key, each.qty])).toEqual([
      [0, '3'],
      [1, '1'],
    ]);
    const one = run(state, { type: 'remove', key: 0 });
    expect(one.lines.map((each) => each.key)).toEqual([1]);
    expect(run(one, { type: 'remove', key: 1 }).lines).toHaveLength(1);
  });

  it('a reset starts over: nobody chosen, nothing said', () => {
    const busy = run(start(line(0, asset('a-1', SHERIF))), {
      type: 'person',
      employeeId: WALEED,
      label: 'x',
    });
    const fresh = run(busy, { type: 'reset', lines: [line(0)] });
    expect(fresh).toEqual(issueHolderStart([line(0)]));
  });
});
