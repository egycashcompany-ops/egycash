// «لما أكتب اسم الشخص اللى هسلمه تظهر الأجهزة اللى معاه بس … والعكس بردو .. لو كتبت سيرال فى الجهاز
// … تظهر على طول الشخص اللى مستلم الجهاز» (2026-11-17) — the issue dialog's person and devices,
// rule by rule, through the reducer the dialog runs on.
import { describe, expect, it } from 'vitest';
import { type ItAssetDto, type ItPersonDto } from '@ecms/contracts';
import {
  clearedLineNumbers,
  custodianKey,
  custodianReady,
  heldByOther,
  holderAnswer,
  holderName,
  issueCustodianBody,
  issueHolderReducer,
  issueHolderStart,
  lineNumber,
  personLabel,
  type IssueDeviceLine,
  type IssueHolderEvent,
  type IssueHolderState,
} from './consumable-issue-holder';
import { translate } from '../../../platform/localization/i18n';
import { departmentHolder, employeeHolder } from '../custody-holder-fixtures';

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

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
    const holder = employeeHolder({ employeeId: HANY, assignedAt: '' });
    const name = (over: Partial<typeof holder>): string =>
      holderName({ ...holder, ...over }, t, 'ar');
    expect(name({ employeeName: 'هاني رأفت سليم', employeeCode: '0100091' })).toBe(
      'هاني رأفت سليم (0100091)',
    );
    expect(name({ employeeName: 'هاني رأفت سليم', employeeCode: null })).toBe('هاني رأفت سليم');
    expect(name({ employeeName: null, employeeCode: '0100091' })).toBe('0100091');
    expect(name({ employeeName: null, employeeCode: null })).toBe(HANY);
    // A department, as «إدارة … — …».
    expect(holderName(departmentHolder(), t, 'ar')).toBe('إدارة تقنية المعلومات — غرفة السيرفرات');
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

// «صرف لإدارة» (2026-11-19): the custodian is a department at a place, signed for by its
// responsible person. Every rule above reads the custodian, never the signer.
describe('a memo to a department', () => {
  const IT = 'd-it';
  const SERVERS = 'l-servers';
  const CAMERAS = 'l-cameras';
  /** A device the IT department holds at a place. */
  const held = (id: string, locationId: string): ItAssetDto =>
    ({
      id,
      assetCode: `AST-${id}`,
      name: 'HP LaserJet',
      status: 'assigned',
      serialNumber: `SN-${id}`,
      holder: departmentHolder({ departmentId: IT, locationId }),
    }) as ItAssetDto;
  const toDepartment = (state: IssueHolderState<Line>, locationId = SERVERS) =>
    run(
      state,
      { type: 'mode', mode: 'department' },
      { type: 'department', departmentId: IT, locationId },
      { type: 'responsible', employeeId: SHERIF, label: 'شريف ممدوح فاروق (0100077)' },
    );

  it('names the department, its place and its signer — and is ready only with all three', () => {
    const state = toDepartment(start(line(0)));
    expect(custodianKey(state)).toBe(`${IT}@${SERVERS}`);
    expect(custodianReady(state)).toBe(true);
    expect(issueCustodianBody(state)).toEqual({
      department: { departmentId: IT, locationId: SERVERS, responsibleEmployeeId: SHERIF },
    });
    expect(custodianReady(run(state, { type: 'responsible', employeeId: '', label: '' }))).toBe(
      false,
    );
    expect(
      custodianReady(run(state, { type: 'department', departmentId: IT, locationId: '' })),
    ).toBe(false);
    // The signer is never the custodian: his own devices are not what the lines list.
    expect(state.employeeId).toBe('');
    expect(
      issueCustodianBody(run(start(line(0)), { type: 'person', employeeId: WALEED, label: 'x' })),
    ).toEqual({ employeeId: WALEED });
  });

  it('switching «جهة الاستلام» takes the custodian before’s devices off the lines', () => {
    const own = run(start(line(0, asset('a-1', WALEED)), line(1, asset('a-2', HANY))), {
      type: 'person',
      employeeId: WALEED,
      label: 'x',
    });
    const switched = run(own, { type: 'mode', mode: 'department', departmentId: IT });
    expect(switched.mode).toBe('department');
    expect(switched.departmentId).toBe(IT);
    expect(switched.employeeId).toBe('');
    expect(switched.lines.map((each) => each.assetId)).toEqual(['', 'a-2']);
    expect(clearedLineNumbers(switched)).toEqual([1]);
    expect(switched.clearedFrom).toBe('employee');
    // And back: the department's devices go.
    const there = run(start(line(0, held('p-1', SERVERS))), {
      type: 'mode',
      mode: 'department',
    });
    const placed = run(there, { type: 'department', departmentId: IT, locationId: SERVERS });
    const back = run(placed, { type: 'mode', mode: 'employee' });
    expect(back.lines[0]?.assetId).toBe('');
    expect(back.clearedFrom).toBe('department');
    // The same mode again changes nothing.
    expect(run(back, { type: 'mode', mode: 'employee' })).toBe(back);
  });

  it('another place is another custodian: the room before’s devices go, another room’s stay', () => {
    const state = toDepartment(
      start(
        line(0, held('p-1', SERVERS)),
        line(1, held('p-2', CAMERAS)),
        line(2, asset('a-3', null)),
      ),
    );
    const moved = run(state, { type: 'department', departmentId: IT, locationId: CAMERAS });
    expect(moved.lines.map((each) => each.assetId)).toEqual(['', 'p-2', 'a-3']);
    expect(clearedLineNumbers(moved)).toEqual([1]);
    expect(moved.clearedFrom).toBe('department');
  });

  it('lists the department’s own device as its own, and another holder’s as somebody else’s', () => {
    const state = toDepartment(
      start(
        line(0, held('p-1', SERVERS)),
        line(1, held('p-2', CAMERAS)),
        line(2, asset('a-3', HANY)),
      ),
    );
    const key = custodianKey(state);
    expect(heldByOther(state.lines[0] as Line, key)).toBeNull();
    expect(heldByOther(state.lines[1] as Line, key)?.locationId).toBe(CAMERAS);
    expect(heldByOther(state.lines[2] as Line, key)?.employeeId).toBe(HANY);
  });

  it('a device a department holds, picked with nobody chosen, fills the department and its place', () => {
    const filled = run(start(line(0)), pick(0, held('p-1', SERVERS)));
    expect(filled.mode).toBe('department');
    expect([filled.departmentId, filled.locationId]).toEqual([IT, SERVERS]);
    // …and leaves the signer to be chosen: nothing is asked of HR, nothing is ready yet.
    expect(filled.responsibleEmployeeId).toBe('');
    expect(filled.asking).toBeNull();
    expect(filled.note).toEqual({ kind: 'filledDepartment', lineKey: 0 });
    expect(custodianReady(filled)).toBe(false);
  });

  it('fills the place too when «إدارة» is chosen and only the department is (IT, preselected)', () => {
    const preselected = run(start(line(0)), { type: 'mode', mode: 'department', departmentId: IT });
    const filled = run(preselected, pick(0, held('p-1', CAMERAS)));
    expect([filled.departmentId, filled.locationId]).toEqual([IT, CAMERAS]);
  });

  it('the department a device filled in is remembered — even when it is the IT row preselected', () => {
    // «إدارة» first: the IT department preselected; then a device that same department holds.
    const preselected = run(start(line(0)), { type: 'mode', mode: 'department', departmentId: IT });
    expect(preselected.filledDepartmentId).toBe('');
    const filled = run(preselected, pick(0, held('p-1', SERVERS)));
    // The fields are told it came from the device, so the IT row of the store's branch, once an
    // item names it, does not replace it (and take the device off its line).
    expect(filled.filledDepartmentId).toBe(IT);
    expect(filled.lines[0]?.assetId).toBe('p-1');
    // A switch of «جهة الاستلام» forgets it; a department picked by hand is no longer the one filled.
    expect(run(filled, { type: 'mode', mode: 'employee' }).filledDepartmentId).toBe('');
    const handPicked = run(filled, { type: 'department', departmentId: 'd-other', locationId: '' });
    expect(handPicked.departmentId === handPicked.filledDepartmentId).toBe(false);
    expect(run(start(line(0)), { type: 'reset', lines: [line(0)] }).filledDepartmentId).toBe('');
  });

  it('a person’s device picked in «إدارة» asks nothing and changes nothing', () => {
    const state = toDepartment(start(line(0)));
    const picked = run(state, pick(0, asset('a-1', WALEED)));
    expect(picked.asking).toBeNull();
    expect(picked.mode).toBe('department');
    expect(custodianKey(picked)).toBe(`${IT}@${SERVERS}`);
  });
});
