// «صرف لموظف»: the person and the device find each other (2026-11-17) — «لما أكتب اسم الشخص اللى
// هسلمه تظهر الأجهزة اللى معاه بس.. لأن الطبيعي اسلمله مستهلك لجهاز .. والعكس بردو .. لو كتبت سيرال
// فى الجهاز اللى هيتركب عليه المستهلك .. تظهر على طول الشخص اللى مستلم الجهاز دا انه بردو هو اللى
// هيستلم المستهلك».
//
// The issue dialog's state, and every rule that ties its person to its lines' devices, as one pure
// reducer — so each rule is proven here without a browser, and the dialog only wires it:
//   · PERSON FIRST. Once a person is chosen, every line's «مركّب على» lists what they hold now
//     (the picker's `holderEmployeeId`), with «جهاز آخر» under it for any other device of the
//     register — a shared printer's toner, a device in stock (the owner's choice, «أجهزته أولاً +
//     «جهاز آخر»»). A device somebody else holds, picked that way, never changes the person; the
//     line says whose it is (`heldByOther`).
//   · CHANGING THE PERSON from P to Q clears a line's device ONLY if P held it — it was P's device,
//     and P no longer receives. Q's own device, a device in stock, a third person's device picked
//     through «جهاز آخر» all stay. The dialog says which lines lost one, once. P is the last person
//     chosen or filled (`lastEmployeeId`), kept through a clear of the field: removing Waleed with
//     the box's × and then choosing Sherif is changing Waleed for Sherif, as choosing Sherif over
//     him is. A first person, chosen over nobody, clears nothing.
//   · DEVICE FIRST. With nobody chosen, a device somebody holds asks who that is (`/it/people/:id`)
//     before it fills the person — the same label the employee box writes — and fills it only if
//     they still work here. A leaver, or a holder who cannot be read, fills nothing and is said
//     under the field. A device in stock fills nothing. The fill then filters the other lines, and
//     is a change of person like any other: it clears what the previous person held, if there was
//     one.
//   · CLEARING THE PERSON keeps every line's device; the boxes go back to the whole register.
//   · NOTHING IS PICKED FOR THE USER — not even a person's one and only device.
//
// Who holds a line's device is read off the asset AS IT WAS PICKED (`holder`): the picker hands
// its row over with the id. The server stays the judge of the issue itself; nothing here changes
// what it accepts.
//
// «صرف لإدارة» (2026-11-19 — department custody): the memo may go to a DEPARTMENT at a place,
// signed by its responsible person, instead of to an employee. The CUSTODIAN is then the
// department at its place (`mode: 'department'`), and every rule above reads the custodian, not
// the person: a line's devices are the department's at that place; changing the department or the
// place — or switching «جهة الاستلام» — clears the devices of the custodian before, as changing the
// person does; and a device a department holds, picked with nobody chosen, fills the department and
// the place (switching to «إدارة») and leaves the responsible person to be chosen. The responsible
// person is NOT the custodian: he is never fed through `person`, or «مركّب على» would list his own
// devices.
import {
  type ItAssetDto,
  type ItAssetHolderDto,
  type ItCustodianDepartmentInput,
  type ItPersonDto,
  type Locale,
} from '@ecms/contracts';
import { holderName as custodyHolderName, holderOfAsset } from './custody-holder';
import { type Translate } from './register-export';

/** «جهة الاستلام»: an employee, or a department at a place. */
export type IssueCustodianMode = 'employee' | 'department';

/** «وليد صفوت جلال (0100052)» — the employee box's own label, so a filled field reads as a picked one. */
export const personLabel = (person: Pick<ItPersonDto, 'fullNameAr' | 'code'>): string =>
  `${person.fullNameAr} (${person.code})`;

/** What these rules read of a line: its key, and the device named on it. */
export interface IssueDeviceLine {
  /** Stable across removals — what a message about a line holds on to. */
  key: number;
  /** The device it was installed on, '' when none is named. */
  assetId: string;
  /** That device as the picker offered it, its holder with it; null when none is named. */
  asset: ItAssetDto | null;
}

/** A device picked with nobody chosen, waiting for its holder to be read. */
export interface HolderQuestion {
  lineKey: number;
  assetId: string;
  employeeId: string;
}

/** What is said under the person field about a device's holder. */
export type HolderNote =
  /** The person was filled from the device on this line. */
  | { kind: 'filled'; lineKey: number }
  /** The department and its place were filled from the device on this line. */
  | { kind: 'filledDepartment'; lineKey: number }
  /** The device's holder has left: nothing was filled. */
  | { kind: 'exited'; lineKey: number; name: string }
  /** The holder could not be read (out of the reader's reach, or gone): nothing was filled. */
  | { kind: 'unreadable'; lineKey: number };

export interface IssueHolderState<L extends IssueDeviceLine> {
  /** «جهة الاستلام» — an employee (the default), or a department at a place. */
  mode: IssueCustodianMode;
  employeeId: string;
  /** The person field's label — the employee box's, or `personLabel` of a filled holder. */
  employeeLabel: string;
  /**
   * The last person chosen or filled, '' before the first — kept when the field is cleared, so the
   * next person chosen takes that one's devices off the lines.
   */
  lastEmployeeId: string;
  /** The department custodian: the department, its place and who signs — '' until chosen. */
  departmentId: string;
  locationId: string;
  responsibleEmployeeId: string;
  responsibleLabel: string;
  /**
   * The last department at a place chosen or filled (`departmentKey`), kept like `lastEmployeeId`:
   * the next one chosen takes that one's devices off the lines.
   */
  lastDepartmentKey: string;
  /**
   * The department a device on a line filled in ('' when none did): the fields' IT preselection
   * leaves it alone while it is still the one chosen — it was the device's custodian, not a default.
   */
  filledDepartmentId: string;
  lines: L[];
  /** The keys of the lines whose device the last change of person took away. */
  cleared: number[];
  /** Whose devices those were — the person before, or the department before — for the words. */
  clearedFrom: IssueCustodianMode;
  note: HolderNote | null;
  asking: HolderQuestion | null;
}

export type IssueHolderEvent<L extends IssueDeviceLine> =
  /** The dialog opened: nobody chosen, these lines. */
  | { type: 'reset'; lines: L[] }
  /** The employee box: a person chosen by hand, or '' when the choice is cleared. */
  | { type: 'person'; employeeId: string; label: string }
  /** A line's «مركّب على»: a device picked (with the row it came from), or '' when cleared. */
  | { type: 'device'; key: number; assetId: string; asset: ItAssetDto | null }
  /** The holder a question asked about, as read — null when the read failed. */
  | { type: 'holderRead'; question: HolderQuestion; person: ItPersonDto | null }
  /**
   * «جهة الاستلام» switched — the previous custodian's devices leave the lines. Into «إدارة», with
   * the department to start from (the IT department, preselected).
   */
  | { type: 'mode'; mode: IssueCustodianMode; departmentId?: string }
  /** The department and its place, as the fields now hold them ('' for one not chosen). */
  | { type: 'department'; departmentId: string; locationId: string }
  /** Who signs the memo for the department — never the custodian. */
  | { type: 'responsible'; employeeId: string; label: string }
  /** Anything else a line holds (its item, quantity, reason). */
  | { type: 'patch'; key: number; update: Partial<Omit<L, 'key' | 'assetId' | 'asset'>> }
  | { type: 'add'; line: L }
  | { type: 'remove'; key: number };

export const issueHolderStart = <L extends IssueDeviceLine>(lines: L[]): IssueHolderState<L> => ({
  mode: 'employee',
  employeeId: '',
  employeeLabel: '',
  lastEmployeeId: '',
  departmentId: '',
  locationId: '',
  responsibleEmployeeId: '',
  responsibleLabel: '',
  lastDepartmentKey: '',
  filledDepartmentId: '',
  lines,
  cleared: [],
  clearedFrom: 'employee',
  note: null,
  asking: null,
});

/** A department at a place as one key — '' until both are chosen. */
export const departmentKey = (departmentId: string, locationId: string): string =>
  departmentId === '' || locationId === '' ? '' : `${departmentId}@${locationId}`;

/**
 * Who holds a device, as the custodian key the rules compare: the employee's id, or the department
 * at its place. '' for a device nobody holds. A holder written before department custody has no
 * `kind`, and is an employee.
 */
export const assetHolderKey = (holder: ItAssetHolderDto | null | undefined): string => {
  if (holder === null || holder === undefined) return '';
  return holder.kind === 'department'
    ? departmentKey(holder.departmentId ?? '', holder.locationId ?? '')
    : (holder.employeeId ?? '');
};

/** The custodian chosen, as the same key: the person, or the department at its place. */
export const custodianKey = (
  state: Pick<
    IssueHolderState<IssueDeviceLine>,
    'mode' | 'employeeId' | 'departmentId' | 'locationId'
  >,
): string =>
  state.mode === 'department'
    ? departmentKey(state.departmentId, state.locationId)
    : state.employeeId;

/** The memo can name who it is for: the person, or the department, its place and its signer. */
export const custodianReady = (
  state: Pick<
    IssueHolderState<IssueDeviceLine>,
    'mode' | 'employeeId' | 'departmentId' | 'locationId' | 'responsibleEmployeeId'
  >,
): boolean =>
  state.mode === 'department'
    ? custodianKey(state) !== '' && state.responsibleEmployeeId !== ''
    : state.employeeId !== '';

/** Who the memo is for, as the request names it — exactly one of the two. */
export const issueCustodianBody = (
  state: Pick<
    IssueHolderState<IssueDeviceLine>,
    'mode' | 'employeeId' | 'departmentId' | 'locationId' | 'responsibleEmployeeId'
  >,
): { employeeId: string } | { department: ItCustodianDepartmentInput } =>
  state.mode === 'department'
    ? {
        department: {
          departmentId: state.departmentId,
          locationId: state.locationId,
          responsibleEmployeeId: state.responsibleEmployeeId,
        },
      }
    : { employeeId: state.employeeId };

/**
 * The custodian changes from `previous` to `next`: the lines' devices `previous` held are cleared —
 * theirs, and they no longer receive — and which lines lost one. Every other device stays: the new
 * custodian's own, one in stock, a third holder's picked through «جهاز آخر». Over nobody, or over
 * the same custodian, nothing is cleared.
 */
const dropDevicesOf = <L extends IssueDeviceLine>(
  lines: readonly L[],
  previous: string,
  next: string,
): { lines: L[]; cleared: number[] } => {
  if (previous === '' || previous === next) return { lines: [...lines], cleared: [] };
  const cleared = lines
    .filter((line) => line.assetId !== '' && assetHolderKey(line.asset?.holder) === previous)
    .map((line) => line.key);
  return {
    lines: lines.map((line) =>
      cleared.includes(line.key) ? { ...line, assetId: '', asset: null } : line,
    ),
    cleared,
  };
};

const sameQuestion = (a: HolderQuestion, b: HolderQuestion): boolean =>
  a.lineKey === b.lineKey && a.assetId === b.assetId && a.employeeId === b.employeeId;

export const issueHolderReducer = <L extends IssueDeviceLine>(
  state: IssueHolderState<L>,
  event: IssueHolderEvent<L>,
): IssueHolderState<L> => {
  switch (event.type) {
    case 'reset':
      return issueHolderStart(event.lines);

    case 'person': {
      // Cleared: the lines keep their devices, and the boxes search the whole register again. A
      // question still waiting is dropped — the user has taken the field over. Who it was is kept
      // (`lastEmployeeId`): the next person chosen replaces them.
      if (event.employeeId === '') {
        return {
          ...state,
          employeeId: '',
          employeeLabel: '',
          cleared: [],
          note: null,
          asking: null,
        };
      }
      const kept = dropDevicesOf(state.lines, state.lastEmployeeId, event.employeeId);
      return {
        ...state,
        employeeId: event.employeeId,
        employeeLabel: event.label,
        lastEmployeeId: event.employeeId,
        lines: kept.lines,
        cleared: kept.cleared,
        clearedFrom: 'employee',
        note: null,
        asking: null,
      };
    }

    case 'device': {
      const asset = event.assetId === '' ? null : event.asset;
      const lines = state.lines.map((line) =>
        line.key === event.key ? { ...line, assetId: event.assetId, asset } : line,
      );
      // A line given a device again is no longer one that lost it; a note about its old device
      // no longer holds.
      const cleared = state.cleared.filter((key) => key !== event.key);
      const note = state.note?.lineKey === event.key ? null : state.note;
      const holder = asset?.holder ?? null;
      const nobody = custodianKey(state) === '';
      const heldAt =
        holder?.kind === 'department'
          ? departmentKey(holder.departmentId ?? '', holder.locationId ?? '')
          : '';
      if (nobody && holder !== null && heldAt !== '') {
        // Nobody chosen and a DEPARTMENT holds it: the department and its place are filled (a
        // department is no person to ask about), «جهة الاستلام» becomes «إدارة», and the signer is
        // left to be chosen. A change of custodian like any other: what the one before held goes.
        const previous =
          state.mode === 'department' ? state.lastDepartmentKey : state.lastEmployeeId;
        const kept = dropDevicesOf(lines, previous, heldAt);
        const sameMode = state.mode === 'department';
        return {
          ...state,
          mode: 'department',
          employeeId: '',
          employeeLabel: '',
          lastEmployeeId: sameMode ? state.lastEmployeeId : '',
          departmentId: holder.departmentId ?? '',
          locationId: holder.locationId ?? '',
          responsibleEmployeeId: sameMode ? state.responsibleEmployeeId : '',
          responsibleLabel: sameMode ? state.responsibleLabel : '',
          lastDepartmentKey: heldAt,
          filledDepartmentId: holder.departmentId ?? '',
          lines: kept.lines,
          cleared: kept.cleared,
          clearedFrom: state.mode,
          note: { kind: 'filledDepartment', lineKey: event.key },
          asking: null,
        };
      }
      if (state.mode === 'employee' && nobody && holder !== null && heldAt === '') {
        // Nobody chosen and somebody holds it: ask who before filling — the latest pick asks.
        const holderId = holder.employeeId ?? '';
        if (holderId === '') return { ...state, lines, cleared, note, asking: null };
        return {
          ...state,
          lines,
          cleared,
          note,
          asking: { lineKey: event.key, assetId: event.assetId, employeeId: holderId },
        };
      }
      const asking = state.asking?.lineKey === event.key ? null : state.asking;
      return { ...state, lines, cleared, note, asking };
    }

    case 'holderRead': {
      const { question, person } = event;
      // Answers a question nobody is asking any more: the device changed, another was picked, or
      // the person was chosen by hand meanwhile.
      if (state.asking === null || !sameQuestion(state.asking, question)) return state;
      const line = state.lines.find((each) => each.key === question.lineKey);
      if (
        state.mode !== 'employee' ||
        state.employeeId !== '' ||
        line === undefined ||
        line.assetId !== question.assetId
      ) {
        return { ...state, asking: null };
      }
      if (person === null || person.employeeId !== question.employeeId) {
        return { ...state, asking: null, note: { kind: 'unreadable', lineKey: question.lineKey } };
      }
      // A hand-over goes to somebody who works here today — the employee box's own population.
      if (person.status === 'exited') {
        return {
          ...state,
          asking: null,
          note: { kind: 'exited', lineKey: question.lineKey, name: person.fullNameAr },
        };
      }
      const kept = dropDevicesOf(state.lines, state.lastEmployeeId, person.employeeId);
      return {
        ...state,
        employeeId: person.employeeId,
        employeeLabel: personLabel(person),
        lastEmployeeId: person.employeeId,
        lines: kept.lines,
        cleared: kept.cleared,
        clearedFrom: 'employee',
        note: { kind: 'filled', lineKey: question.lineKey },
        asking: null,
      };
    }

    case 'mode': {
      if (event.mode === state.mode) return state;
      // The custodian before leaves with its devices — the person, or the department at its place.
      const previous = state.mode === 'department' ? state.lastDepartmentKey : state.lastEmployeeId;
      const kept = dropDevicesOf(state.lines, previous, '');
      return {
        ...state,
        mode: event.mode,
        employeeId: '',
        employeeLabel: '',
        lastEmployeeId: '',
        departmentId: event.mode === 'department' ? (event.departmentId ?? '') : '',
        locationId: '',
        responsibleEmployeeId: '',
        responsibleLabel: '',
        lastDepartmentKey: '',
        filledDepartmentId: '',
        lines: kept.lines,
        cleared: kept.cleared,
        clearedFrom: state.mode,
        note: null,
        asking: null,
      };
    }

    case 'department': {
      // The department or its place changed: as a change of person — the department at the place
      // before leaves with its devices once both are chosen again; a field emptied clears nothing.
      const next = departmentKey(event.departmentId, event.locationId);
      const kept =
        next === ''
          ? { lines: [...state.lines], cleared: [] }
          : dropDevicesOf(state.lines, state.lastDepartmentKey, next);
      return {
        ...state,
        departmentId: event.departmentId,
        locationId: event.locationId,
        lastDepartmentKey: next === '' ? state.lastDepartmentKey : next,
        lines: kept.lines,
        cleared: kept.cleared,
        clearedFrom: 'department',
        note: null,
        asking: null,
      };
    }

    case 'responsible':
      // Who signs — never the custodian: no line's device follows him.
      return { ...state, responsibleEmployeeId: event.employeeId, responsibleLabel: event.label };

    case 'patch':
      return {
        ...state,
        lines: state.lines.map((line) =>
          line.key === event.key ? { ...line, ...event.update } : line,
        ),
      };

    case 'add':
      return { ...state, lines: [...state.lines, event.line] };

    case 'remove': {
      if (state.lines.length === 1) return state;
      return {
        ...state,
        lines: state.lines.filter((line) => line.key !== event.key),
        cleared: state.cleared.filter((key) => key !== event.key),
        note: state.note?.lineKey === event.key ? null : state.note,
        asking: state.asking?.lineKey === event.key ? null : state.asking,
      };
    }
  }
};

/**
 * What the dialog's effect hands the reducer once the holder it asked about is read — the effect's
 * whole decision, so it is proven here:
 *   · nothing asked, or the answer not in yet → nothing;
 *   · the person asked about, read → `holderRead` with them (the reducer decides fill or leaver);
 *   · the read failed → `holderRead` with nobody: the holder could not be confirmed, nothing is
 *     filled, and the note under the field says so;
 *   · somebody else's record (a read still answering for an earlier question) → nothing yet.
 */
export const holderAnswer = <L extends IssueDeviceLine>(
  asking: HolderQuestion | null,
  read: { data: ItPersonDto | undefined; isError: boolean },
): IssueHolderEvent<L> | null => {
  if (asking === null) return null;
  if (read.data !== undefined && read.data.employeeId === asking.employeeId) {
    return { type: 'holderRead', question: asking, person: read.data };
  }
  if (read.isError) return { type: 'holderRead', question: asking, person: null };
  return null;
};

/**
 * Who holds a line's device when that is not the custodian chosen — a device picked through «جهاز
 * آخر» — said under the line («هذا الجهاز في عهدة …»); null when the custodian is theirs, the device
 * is in stock, nobody is chosen yet (then the device fills the custodian instead), or no device is
 * named. `custodian` is `custodianKey` — for an employee custodian, their id.
 */
export const heldByOther = (
  line: IssueDeviceLine,
  custodian: string,
): NonNullable<ItAssetDto['holder']> | null => {
  const holder = line.asset?.holder ?? null;
  if (custodian === '' || line.assetId === '' || holder === null) return null;
  return assetHolderKey(holder) === custodian ? null : holder;
};

/**
 * A device's holder as the note names them: «name (code)», like the employee box, or what there is
 * — and a department as «إدارة … — …».
 */
export const holderName = (
  holder: NonNullable<ItAssetDto['holder']>,
  t: Translate,
  locale: Locale,
): string => {
  if (holder.kind === 'department') return custodyHolderName(holderOfAsset(holder), locale, t);
  const id = holder.employeeId ?? '';
  return holder.employeeName === null
    ? (holder.employeeCode ?? id)
    : holder.employeeCode === null
      ? holder.employeeName
      : `${holder.employeeName} (${holder.employeeCode})`;
};

/** The lines (numbered from one, as shown) that the last change of person emptied. */
export const clearedLineNumbers = <L extends IssueDeviceLine>(
  state: IssueHolderState<L>,
): number[] =>
  state.lines.flatMap((line, index) => (state.cleared.includes(line.key) ? [index + 1] : []));

/** The number (from one, as shown) of the line a note is about; null when it is gone. */
export const lineNumber = <L extends IssueDeviceLine>(
  state: IssueHolderState<L>,
  key: number,
): number | null => {
  const index = state.lines.findIndex((line) => line.key === key);
  return index === -1 ? null : index + 1;
};
