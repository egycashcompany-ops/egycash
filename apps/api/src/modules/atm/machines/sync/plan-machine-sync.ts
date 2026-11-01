// The machine sync's decision, pure: the file's rows against the branch's machines.
//
// A row is the file's word on one machine — its code (identity), its bank, its name and its area.
// Against the branch the top bar points at it is one of:
//   · add         no machine of this code here (a deleted one counts as none);
//   · reactivate  an ARCHIVED machine of this code here — brought back with the file's three;
//   · update      ACTIVE here, and its bank, name or area is not the file's (`changes`);
//   · same        ACTIVE here with the file's three;
//   · elsewhere   not here, but ACTIVE in another branch — never added here (the mail matcher needs
//                 one active machine per code, DEC-9); the branch move re-files it;
//   · invalid     a row that cannot be read (`issue`);
//   · duplicate   a code the file listed further up — the first listing counts.
// And a machine ACTIVE here that the file does not list is `extra`: reported, never deleted.
//
// What counts as the same text: names and areas are compared with their spaces folded — «Omrania /
// ElHaram» typed with two spaces is the area the branch already has, and an apply writes the folded
// text, so a new spelling of an area is never made out of a stray space. Otherwise the file is
// followed exactly. A bank is compared by the CATALOG bank its label stands for («MISR» and a
// former label of Banque Misr are one bank), and an apply writes the catalog's current label.
import {
  normalizeAtmMachineCode,
  type AtmBankCode,
  type AtmMachineSyncField,
  type AtmMachineSyncIssue,
  type AtmMachineSyncRowDto,
  type AtmMachineSyncStatus,
  type AtmMachineSyncValuesDto,
} from '@ecms/contracts';
import { type MachineFileRow } from './read-machine-file';

/** A machine of the branch, as the plan needs it. */
export interface SyncMachine {
  id: string;
  machineCode: string;
  bankName: string;
  name: string;
  area: string;
  isActive: boolean;
}

/** The bank catalog, as the plan needs it. */
export interface SyncBankCatalog {
  /** The catalog bank a label stands for (current or former label), else null. */
  codeOfLabel(label: string): AtmBankCode | null;
  /** The label an apply writes for a catalog bank. */
  labelOf(code: AtmBankCode): string;
  /** Archived banks cannot be written on a new or reactivated machine. */
  isActive(code: AtmBankCode): boolean;
}

export interface SyncPlanRow extends AtmMachineSyncRowDto {
  /** The branch's machine of this code (active or archived), for an update or a reactivation. */
  machineId: string | null;
}

export interface SyncPlan {
  rows: SyncPlanRow[];
  extra: SyncMachine[];
  counts: Record<AtmMachineSyncStatus | 'extra', number>;
}

/** Spaces folded: trimmed, every run of white space one space. */
export const foldSpaces = (text: string): string => text.replace(/\s+/g, ' ').trim();

const valuesOf = (machine: SyncMachine): AtmMachineSyncValuesDto => ({
  bank: foldSpaces(machine.bankName),
  name: foldSpaces(machine.name),
  area: foldSpaces(machine.area),
});

const sameBank = (catalog: SyncBankCatalog, fileCode: AtmBankCode, stored: string): boolean => {
  const storedCode = catalog.codeOfLabel(stored);
  return storedCode === fileCode;
};

/** What differs between the file's values and a machine's, in the fields' order. */
export const changesOf = (
  catalog: SyncBankCatalog,
  file: AtmMachineSyncValuesDto,
  fileBank: AtmBankCode,
  machine: SyncMachine,
): AtmMachineSyncField[] => {
  const current = valuesOf(machine);
  const changes: AtmMachineSyncField[] = [];
  if (!sameBank(catalog, fileBank, machine.bankName)) changes.push('bank');
  if (current.name !== file.name) changes.push('name');
  if (current.area !== file.area) changes.push('area');
  return changes;
};

const issueOf = (
  row: MachineFileRow,
  code: string,
  bankCode: AtmBankCode | null,
): AtmMachineSyncIssue | null => {
  if (code === '') return 'noCode';
  if (foldSpaces(row.bank) === '') return 'noBank';
  if (bankCode === null) return 'unknownBank';
  if (foldSpaces(row.name) === '') return 'noName';
  if (foldSpaces(row.area) === '') return 'noArea';
  return null;
};

export const emptySyncCounts = (): Record<AtmMachineSyncStatus | 'extra', number> => ({
  add: 0,
  reactivate: 0,
  update: 0,
  same: 0,
  elsewhere: 0,
  invalid: 0,
  duplicate: 0,
  extra: 0,
});

/**
 * Pure: the plan. `machines` are the branch's machines of every state but deleted; `elsewhere` the
 * codes ACTIVE in another branch.
 */
export const planMachineSync = (
  fileRows: readonly MachineFileRow[],
  machines: readonly SyncMachine[],
  elsewhere: ReadonlySet<string>,
  catalog: SyncBankCatalog,
): SyncPlan => {
  const byCode = new Map<string, SyncMachine>();
  for (const machine of machines) {
    // An active machine wins over an archived one of the same code (the index allows one live row
    // per code; a stale pair is answered with the one that works).
    const held = byCode.get(machine.machineCode);
    if (held === undefined || (!held.isActive && machine.isActive)) {
      byCode.set(machine.machineCode, machine);
    }
  }
  const firstRowOf = new Map<string, number>();
  /** Every code the file names, readable row or not — a machine it names is not `extra`. */
  const named = new Set<string>();
  const rows: SyncPlanRow[] = [];
  const counts = emptySyncCounts();
  for (const fileRow of fileRows) {
    const code = normalizeAtmMachineCode(fileRow.code);
    if (code !== '') named.add(code);
    const bankCode = foldSpaces(fileRow.bank) === '' ? null : catalog.codeOfLabel(fileRow.bank);
    const file: AtmMachineSyncValuesDto = {
      bank: bankCode === null ? foldSpaces(fileRow.bank) : catalog.labelOf(bankCode),
      name: foldSpaces(fileRow.name),
      area: foldSpaces(fileRow.area),
    };
    const base = {
      row: fileRow.row,
      machineCode: code,
      file,
      current: null,
      changes: [] as AtmMachineSyncField[],
      issue: null,
      firstRow: null,
      machineId: null,
    };
    const issue = issueOf(fileRow, code, bankCode);
    let planned: SyncPlanRow;
    if (issue !== null || bankCode === null) {
      planned = { ...base, status: 'invalid', issue };
    } else if (firstRowOf.has(code)) {
      planned = { ...base, status: 'duplicate', firstRow: firstRowOf.get(code) ?? null };
    } else {
      firstRowOf.set(code, fileRow.row);
      const machine = byCode.get(code);
      if (machine === undefined) {
        planned = elsewhere.has(code)
          ? { ...base, status: 'elsewhere' }
          : catalog.isActive(bankCode)
            ? { ...base, status: 'add' }
            : // A new machine may not carry an archived bank (the bulk add's `INACTIVE`).
              { ...base, status: 'invalid', issue: 'archivedBank' };
      } else if (!machine.isActive && !catalog.isActive(bankCode)) {
        planned = { ...base, status: 'invalid', issue: 'archivedBank', machineId: machine.id };
      } else {
        const changes = changesOf(catalog, file, bankCode, machine);
        const status: AtmMachineSyncStatus = !machine.isActive
          ? 'reactivate'
          : changes.length > 0
            ? 'update'
            : 'same';
        planned = {
          ...base,
          status,
          current: valuesOf(machine),
          changes,
          machineId: machine.id,
        };
      }
    }
    counts[planned.status] += 1;
    rows.push(planned);
  }
  const extra = machines
    .filter((machine) => machine.isActive && !named.has(machine.machineCode))
    .sort((a, b) => a.machineCode.localeCompare(b.machineCode));
  counts.extra = extra.length;
  return { rows, extra, counts };
};
