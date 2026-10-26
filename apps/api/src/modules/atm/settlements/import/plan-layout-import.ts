// What the Full list seed import would do — decided from the read workbook and a read of the
// database, with NO write (docs/12-planning/atm-settlements-phase1.md §5.3, S-1). The preview shows
// this plan; the apply re-reads the file and re-plans against the database as it is then (§5.4).
//
// PURE: the world (the import branch's machines, their open register entries, their layouts and the
// branch × bank's standard loads) is a value, so the spec holds it in memory; the service is the one
// place that reads the database for it.
//
// THE RULES, briefly (each is the spec's table, in its order):
//   · matching is EXACT — `normalizeAtmMachineCode` in the import branch, no fuzzy match (DS-6);
//   · a row gets ONE outcome, the first rule that holds; flags are informational and attached;
//   · labels are cleaned (`cleanLabel`) before any comparison, and a label over its cap makes the
//     row `invalid` (`labelTooLong`) — it is never truncated (DS-5);
//   · slots are the Full list's four positions in their stored order: 0 or blank is an empty slot,
//     anything else a withdrawal cassette in EGP; nothing is reordered (DS-7, GS-9);
//   · HELP is trimmed, capped at 100 characters and split on '-' without a regular expression
//     (the SEC-2 rule); a part counts only when it is all digits.
// Nothing here logs or returns a count or an amount: standard-load rows return their note counts
// for the preview, which is the profile the apply would create (D itself is never kept).
import {
  ATM_LABEL_MAX,
  ATM_LAYOUT_IMPORT_FLAGS,
  ATM_LAYOUT_IMPORT_OUTCOMES,
  ATM_CASSETTE_NOTES_MAX,
  atmRegisterIdFormatOk,
  cleanLabel,
  isEgpDenomination,
  normalizeAtmMachineCode,
  type AtmBankCode,
  type AtmCassetteSlot,
  type AtmDenominationNotes,
  type AtmLayoutImportFlag,
  type AtmLayoutImportOutcome,
  type AtmLayoutImportResultDto,
  type AtmLayoutImportRowDto,
  type AtmLayoutSource,
  type AtmStandardLoadImportOutcome,
} from '@ecms/contracts';
import { numberText, type RawCellValue } from '../../register/import/cell-convert';
import { bankOfEntries, type RegisterBankCassettes } from '../shared/register-bank';
import { type MasterWorkbookRead } from './read-master-workbook';

// ── The world the plan is decided against ───────────────────────────────────────────────────────

export interface LayoutImportMachine {
  id: string;
  machineCode: string;
  name: string;
  area: string;
  /** The Operations label, shown on a `noRegisterBank` row. */
  bankName: string;
  isActive: boolean;
}

export interface LayoutImportLayout {
  revision: number;
  slots: AtmCassetteSlot[];
  typeLabel: string | null;
  featuresLabel: string | null;
  hubLabel: string | null;
  source: AtmLayoutSource;
}

export interface LayoutImportWorld {
  bankCode: AtmBankCode;
  /** The import branch's live machines (`isDeleted: false`), active or not. */
  machines: readonly LayoutImportMachine[];
  /** Machine id → its OPEN register entries (`registerBankRows`): the bank (DS-3) and cassettes. */
  registerRows: ReadonlyMap<
    string,
    readonly { bankCode: AtmBankCode | null; cassettes?: RegisterBankCassettes }[]
  >;
  /** Machine id → its live layout. */
  layouts: ReadonlyMap<string, LayoutImportLayout>;
  /** The branch × bank's live standard loads. */
  standardLoads: readonly { notes: readonly AtmDenominationNotes[] }[];
}

export type LayoutImportPlan = Pick<
  AtmLayoutImportResultDto,
  'counts' | 'flags' | 'rows' | 'missingFromFile' | 'standardLoads'
>;

// ── Cells ───────────────────────────────────────────────────────────────────────────────────────

/** What a cell shows as text; null when blank, or when it is not text or a number. */
const textOf = (value: RawCellValue): string | null => {
  if (value.kind === 'string') return value.value.trim() === '' ? null : value.value;
  if (value.kind === 'number') return numberText(value.value);
  return null;
};

const isDigits = (text: string): boolean => {
  if (text === '') return false;
  for (const c of text) if (c < '0' || c > '9') return false;
  return true;
};

/** A whole number a cell shows (a number, or a text of digits only); 'bad' otherwise; null blank. */
const integerOf = (value: RawCellValue): number | null | 'bad' => {
  if (value.kind === 'empty') return null;
  if (value.kind === 'number') return Number.isSafeInteger(value.value) ? value.value : 'bad';
  if (value.kind === 'string') {
    const text = value.value.trim();
    if (text === '') return null;
    return isDigits(text) ? Number(text) : 'bad';
  }
  return 'bad';
};

/** A number a cell shows (a number, or a text of digits only); null otherwise. */
const numberOf = (value: RawCellValue): number | null => {
  if (value.kind === 'number') return Number.isFinite(value.value) ? value.value : null;
  if (value.kind === 'string') {
    const text = value.value.trim();
    return isDigits(text) ? Number(text) : null;
  }
  return null;
};

/** A denomination cell: 0 or blank = no cassette (DS-7). */
const denominationOf = (value: RawCellValue): number | 'bad' => {
  const n = integerOf(value);
  if (n === null || n === 0) return 0;
  if (n === 'bad' || !isEgpDenomination(n)) return 'bad';
  return n;
};

const slotsOf = (denominations: readonly number[]): AtmCassetteSlot[] =>
  denominations.map((d, i) =>
    d === 0
      ? { slot: i + 1, kind: 'empty', denomination: null, currency: null }
      : { slot: i + 1, kind: 'withdrawal', denomination: d, currency: 'EGP' },
  );

const sameSlots = (a: readonly AtmCassetteSlot[], b: readonly AtmCassetteSlot[]): boolean =>
  a.length === b.length &&
  a.every(
    (s, i) =>
      s.slot === b[i]?.slot &&
      s.kind === b[i]?.kind &&
      s.denomination === b[i]?.denomination &&
      s.currency === b[i]?.currency,
  );

/** The cleaned label, or null when blank; `tooLong` when it is over its cap (never truncated). */
const labelOf = (value: RawCellValue, cap: number): { label: string | null; tooLong: boolean } => {
  const text = textOf(value);
  const cleaned = text === null ? '' : cleanLabel(text);
  if (cleaned === '') return { label: null, tooLong: false };
  return cleaned.length > cap ? { label: null, tooLong: true } : { label: cleaned, tooLong: false };
};

/** HELP's non-zero numbers, in order: trimmed, capped at 100 characters, split on '-'. */
export const helpNumbers = (value: RawCellValue): number[] => {
  const text = (textOf(value) ?? '').trim().slice(0, 100);
  return text
    .split('-')
    .filter(Boolean)
    .filter(isDigits)
    .map(Number)
    .filter((n) => n !== 0);
};

const sortedKey = (values: readonly number[]): string =>
  [...values].sort((a, b) => a - b).join(',');

const sameList = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Slot 1 is empty and the later denominations rise. */
const isReversed = (denominations: readonly number[]): boolean => {
  if (denominations[0] !== 0) return false;
  const later = denominations.slice(1).filter((d) => d !== 0);
  return later.length >= 2 && later.every((d, i) => i === 0 || d > (later[i - 1] ?? 0));
};

/** A register cassette text that is a plain integer, or blank; 'other' otherwise. */
const registerInteger = (text: string | null | undefined): number | null | 'other' => {
  const trimmed = (text ?? '').trim();
  if (trimmed === '') return null;
  return isDigits(trimmed) ? Number(trimmed) : 'other';
};

const zeroRecord = <K extends string>(keys: readonly K[]): Record<K, number> =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

// ── The plan ────────────────────────────────────────────────────────────────────────────────────

interface ParsedRow {
  row: number;
  code: string | null;
  codeWhitespace: boolean;
  denominations: number[] | null;
  typeLabel: { label: string | null; tooLong: boolean };
  featuresLabel: { label: string | null; tooLong: boolean };
  hubLabel: { label: string | null; tooLong: boolean };
  location: string;
  help: number[];
}

const parseRow = (row: MasterWorkbookRead['fullList'][number]): ParsedRow => {
  const raw = textOf(row.code);
  const trimmed = raw?.trim() ?? '';
  const normalised = raw === null ? '' : normalizeAtmMachineCode(raw);
  const denominations = row.denominations.map(denominationOf);
  return {
    row: row.row,
    code: normalised === '' ? null : normalised,
    codeWhitespace: /\s/.test(trimmed),
    denominations: denominations.includes('bad') ? null : (denominations as number[]),
    typeLabel: labelOf(row.typeLabel, ATM_LABEL_MAX.typeLabel),
    featuresLabel: labelOf(row.featuresLabel, ATM_LABEL_MAX.featuresLabel),
    hubLabel: labelOf(row.hubLabel, ATM_LABEL_MAX.hubLabel),
    location: cleanLabel(textOf(row.location) ?? ''),
    help: helpNumbers(row.help),
  };
};

/** A profile's counts as one comparable key, whatever their order. */
const notesKey = (notes: readonly AtmDenominationNotes[]): string =>
  [...notes]
    .sort((a, b) => a.denomination - b.denomination)
    .map((n) => `${String(n.denomination)}:${String(n.notes)}`)
    .join(',');

const standardRowsOf = (
  read: MasterWorkbookRead,
  world: LayoutImportWorld,
): LayoutImportPlan['standardLoads'] => {
  const existing = new Set(world.standardLoads.map((load) => notesKey(load.notes)));
  return read.standardRows.map((standard) => {
    const total = numberOf(standard.total);
    const counts = standard.counts.map((c) => ({
      denomination: c.denomination,
      notes: integerOf(c.cell),
    }));
    const notes: AtmDenominationNotes[] = [];
    for (const c of counts) {
      if (typeof c.notes !== 'number' || c.notes < 0 || c.notes > ATM_CASSETTE_NOTES_MAX) break;
      notes.push({ denomination: c.denomination, notes: c.notes });
    }
    if (total === null || notes.length !== counts.length) {
      return { row: standard.row, notes: [], outcome: 'invalid' };
    }
    const sum = notes.reduce((acc, n) => acc + n.denomination * n.notes, 0);
    const outcome: AtmStandardLoadImportOutcome =
      total !== sum ? 'mismatch' : existing.has(notesKey(notes)) ? 'same' : 'new';
    return { row: standard.row, notes, outcome };
  });
};

/**
 * §5.3: one outcome per Full list row, its flags, the bank's machines the file does not mention,
 * and the standard rows of `REP. TAPE!D1:G2`.
 */
export const planLayoutImport = (
  read: MasterWorkbookRead,
  world: LayoutImportWorld,
): LayoutImportPlan => {
  const machineByCode = new Map(world.machines.map((m) => [m.machineCode, m]));
  const parsed = read.fullList.map(parseRow);
  const codeCount = new Map<string, number>();
  for (const p of parsed) {
    if (p.code !== null) codeCount.set(p.code, (codeCount.get(p.code) ?? 0) + 1);
  }
  const dayLinesByCode = new Map<string, (number | 'bad')[][]>();
  for (const line of read.dayLines) {
    const raw = textOf(line.code);
    const code = raw === null ? '' : normalizeAtmMachineCode(raw);
    if (code === '') continue;
    dayLinesByCode.set(code, [
      ...(dayLinesByCode.get(code) ?? []),
      line.denominations.map(denominationOf),
    ]);
  }

  const counts = zeroRecord(ATM_LAYOUT_IMPORT_OUTCOMES);
  const flagCounts = zeroRecord(ATM_LAYOUT_IMPORT_FLAGS);
  const rows: AtmLayoutImportRowDto[] = parsed.map((p) => {
    const flags = new Set<AtmLayoutImportFlag>();
    const machine = p.code === null ? undefined : machineByCode.get(p.code);
    const layout = machine === undefined ? undefined : world.layouts.get(machine.id);
    const entries = machine === undefined ? [] : (world.registerRows.get(machine.id) ?? []);
    const after = p.denominations === null ? null : slotsOf(p.denominations);
    const nonEmpty = (p.denominations ?? []).filter((d) => d !== 0);

    // ── Flags ──
    if (p.denominations !== null && isReversed(p.denominations)) flags.add('reversedOrder');
    if (p.typeLabel.label?.toLowerCase().includes('recycle') === true) {
      flags.add('typeMentionsRecycle');
    }
    if (p.denominations !== null) {
      if (sortedKey(p.help) !== sortedKey(nonEmpty)) flags.add('helpDisagrees');
      else if (!sameList(p.help, nonEmpty) && sameList(p.help, [...nonEmpty].reverse())) {
        flags.add('helpOrderOpposite');
      }
    }
    if (machine !== undefined) {
      if ((p.hubLabel.label ?? '') !== cleanLabel(machine.area)) flags.add('areaDiffers');
      if (p.location !== cleanLabel(machine.name)) flags.add('nameDiffers');
    }
    if (p.code !== null && p.denominations !== null) {
      const own = p.denominations;
      const lines = dayLinesByCode.get(p.code) ?? [];
      if (lines.some((line) => !sameList(line, own))) flags.add('repTapeDiffers');
    }
    if (p.denominations !== null) {
      for (const entry of entries) {
        const count = registerInteger(entry.cassettes?.withdrawalCount);
        if (typeof count === 'number' && count !== nonEmpty.length) {
          flags.add('registerCountDiffers');
        }
        const listed = [
          entry.cassettes?.withdrawal1,
          entry.cassettes?.withdrawal2,
          entry.cassettes?.withdrawal3,
          entry.cassettes?.withdrawal4,
          entry.cassettes?.withdrawal5,
        ].map(registerInteger);
        // An entry whose five cells are all blank says nothing, so it differs from nothing.
        if (!listed.includes('other') && listed.some((v) => v !== null)) {
          const values = listed.filter((v): v is number => typeof v === 'number' && v !== 0);
          if (!sameList(values, nonEmpty)) flags.add('registerDenominationsDiffer');
        }
      }
    }
    if (p.code !== null && !atmRegisterIdFormatOk(world.bankCode, p.code)) flags.add('idFormat');
    if (p.codeWhitespace) flags.add('codeWhitespace');
    const tooLong = p.typeLabel.tooLong || p.featuresLabel.tooLong || p.hubLabel.tooLong;
    if (tooLong) flags.add('labelTooLong');

    // ── The one outcome ──
    const bank = bankOfEntries(entries);
    const labelsSame =
      layout !== undefined &&
      layout.typeLabel === p.typeLabel.label &&
      layout.featuresLabel === p.featuresLabel.label &&
      layout.hubLabel === p.hubLabel.label;
    let outcome: AtmLayoutImportOutcome;
    if (p.code === null || after === null || nonEmpty.length === 0 || tooLong) outcome = 'invalid';
    else if ((codeCount.get(p.code) ?? 0) > 1) outcome = 'duplicateInFile';
    else if (machine === undefined) outcome = 'notFound';
    else if (!machine.isActive) outcome = 'archived';
    else if (bank.reason === 'noRegisterBank') outcome = 'noRegisterBank';
    else if (bank.bank !== world.bankCode) outcome = 'otherBank';
    else if (layout === undefined) outcome = 'new';
    else if (sameSlots(layout.slots, after) && labelsSame) outcome = 'same';
    else outcome = layout.source === 'manual' ? 'changedManual' : 'changed';

    counts[outcome] += 1;
    for (const flag of flags) flagCounts[flag] += 1;
    const ordered = ATM_LAYOUT_IMPORT_FLAGS.filter((flag) => flags.has(flag));
    return {
      row: p.row,
      code: p.code,
      outcome,
      flags: ordered,
      machineId: machine?.id ?? null,
      machineName: machine?.name ?? null,
      bankName: outcome === 'noRegisterBank' ? (machine?.bankName ?? null) : null,
      revision: layout?.revision ?? null,
      before: layout?.slots ?? null,
      after,
      typeLabel: { before: layout?.typeLabel ?? null, after: p.typeLabel.label },
      featuresLabel: { before: layout?.featuresLabel ?? null, after: p.featuresLabel.label },
      hubLabel: { before: layout?.hubLabel ?? null, after: p.hubLabel.label },
    };
  });

  const inFile = new Set(parsed.map((p) => p.code).filter((c): c is string => c !== null));
  const missingFromFile = world.machines
    .filter(
      (m) =>
        m.isActive &&
        !inFile.has(m.machineCode) &&
        bankOfEntries(world.registerRows.get(m.id) ?? []).bank === world.bankCode,
    )
    .sort((a, b) => a.machineCode.localeCompare(b.machineCode))
    .map((m) => ({ machineId: m.id, machineCode: m.machineCode, machineName: m.name }));

  return {
    counts,
    flags: flagCounts,
    rows,
    missingFromFile,
    standardLoads: standardRowsOf(read, world),
  };
};
