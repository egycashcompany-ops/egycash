// The go-live ACCIDENTS import: the legacy `fleet_accident` collection, turned into accident
// files. Importable and side-effect free until `applyAccidentsImport`; `accidents.ts` runs it.
//
// WHAT THE LEGACY SHAPE IS, and what each field becomes:
//
//   car_code           → the vehicle, by code     company_account  → companyCost
//   date_accident      → occurredAt               amount_collected → amountCollected
//   culprit            → culprit, verbatim, AND   paid             → paidAmount
//                        culpritEmployeeId by     finsh_status_color → status: 1 closed, 0 open
//                        NAME through the         notes            → notes
//                        directory                statement        → statement
//
// `added_by`, `added_date`, `edited_by`, `edited_date`, `deleted_user` and `__v` are legacy
// bookkeeping and do not travel. `deleted` and `deleted_date` DO — a file the old system had
// deleted arrives already deleted, carrying the day of it, and EVERY file in the book lands:
// «المهم تضيف كل الداتا ومتسبش داتا فاضيه», «عاوزها موجوده والdeleted 1 زى ما هى». See
// `legacy-row.ts`.
//
// THE CULPRIT IS BOTH A NAME AND A PERSON. The model keeps the name the book wrote — «who was at
// fault» is sometimes «سائق تاكسي» and not an employee at all — and beside it the employee it
// resolves to when it does. So the name travels as written, and the id is filled in where HR
// knows the spelling; nothing is skipped or reported for a name that is nobody's.
//
// WHAT IS KEPT WITHOUT A FACT THE SCREEN NORMALLY HAS, and listed: a file with NO DATE (the book
// recorded no other date for it) is written with none — a date invented here would put the
// accident in a month it did not happen in, and leaving the file out would lose it. A file on a
// car the registry never had is written by the book's code (`book-ref.ts`).
//
// WHAT IS FILLED IN, and counted: a blank statement is written as «غير مذكور» — the model
// requires one, and «not stated» is the truth of it — and so is a blank CULPRIT and a car the
// book named with no code; a blank amount is 0, and so is an amount that is not a number, with
// the file written deleted so the figure is nobody's total until it is corrected. An amount with
// words after the number («4650 من عب…») is read for its number and the words are listed, so
// whoever keeps the book can put them where they belong.
import { Types } from 'mongoose';
import { fleetAccidentRepository } from '../accidents/accident.repository';
import { type FleetAccidentDoc } from '../accidents/accident.model';
import { day, NO_CODE } from './odometer-import';
import { bookRefFields, bookRefOf, type BookRef } from './book-ref';
import {
  deletedFields,
  deletionOf,
  liveFields,
  noteWith,
  asWritten,
  type LegacyBookkeeping,
  type LegacyDeletion,
} from './legacy-row';
import { failureReason } from './vehicles-import';

/** One legacy row, exactly as the export writes it. Everything is optional; nothing is trusted. */
interface LegacyAccident extends LegacyBookkeeping {
  _id?: { $oid?: string } | string;
  car_code?: string;
  date_accident?: { $date?: string } | string | null;
  culprit?: string;
  statement?: string;
  company_account?: string | number | null;
  amount_collected?: string | number | null;
  paid?: string | number | null;
  finsh_status_color?: string | number;
  notes?: string | null;
}

export interface ParsedAccident {
  id: string;
  code: string;
  occurredAt: Date | null;
  culprit: string;
  statement: string | null;
  companyCost: number | null;
  amountCollected: number | null;
  paidAmount: number | null;
  status: 'open' | 'closed';
  notes: string | null;
  /** Words the book wrote after an amount's number — «field: text». */
  amountNotes: string[];
  /** The old system's own deletion, carried through untouched. */
  deletion: LegacyDeletion;
  /** The book says something the model cannot hold — the file is kept, and written deleted. */
  unreadable: boolean;
}

export interface ParseAccidentsResult {
  accidents: ParsedAccident[];
  /** Files the old system had deleted — kept, deleted, and counted. */
  keptDeleted: number;
  /** Files kept but unreadable — «id · what could not be read». */
  unreadable: { id: string; reason: string }[];
  /** Only a file that is not a list of rows at all. */
  rejected: { id: string; reason: string }[];
}

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * Money as the book wrote it: a number, or digits with an optional fraction, possibly followed
 * by words. The number is the amount; the words are handed back to be listed.
 */
const money = (value: unknown): { amount: number | null; rest: string | null } | 'invalid' => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? { amount: value, rest: null } : 'invalid';
  }
  const raw = text(value);
  if (raw === null) return { amount: null, rest: null };
  const match = /^(\d+(?:\.\d+)?)(.*)$/s.exec(raw);
  if (match === null) return 'invalid';
  const rest = (match[2] as string).trim();
  return { amount: Number(match[1]), rest: rest === '' ? null : rest };
};

const legacyDate = (value: LegacyAccident['date_accident']): Date | null => {
  const raw = typeof value === 'string' ? value : value?.$date;
  if (typeof raw !== 'string') return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  return year < 2000 || year > 2100 ? null : date;
};

const legacyId = (value: LegacyAccident['_id'], index: number): string => {
  if (typeof value === 'string') return value;
  if (value !== undefined && typeof value.$oid === 'string') return value.$oid;
  return `row ${index}`;
};

/**
 * What a blank statement — or a blank culprit — is written as. The model requires both, and
 * «not stated» is the truth of it: the accident happened, and nobody wrote down who.
 */
export const NOT_STATED = 'غير مذكور';

/** How each money column is named on the file when the book's own figure could not be read. */
const AMOUNT_LABELS: Readonly<Record<string, string>> = {
  companyCost: 'تكلفة الشركة',
  amountCollected: 'المبلغ المحصَّل',
  paidAmount: 'المبلغ المدفوع',
};

/**
 * Read the export. NOTHING IS DROPPED: a file the book wrote badly is kept, marked, and carries
 * the book's own words for whatever could not be read, so the file still says what it said.
 */
export const parseAccidents = (raw: unknown): ParseAccidentsResult => {
  const result: ParseAccidentsResult = { accidents: [], keptDeleted: 0, unreadable: [], rejected: [] };
  if (!Array.isArray(raw)) {
    result.rejected.push({ id: 'file', reason: 'the export is not a JSON array' });
    return result;
  }
  raw.forEach((entry: LegacyAccident, index) => {
    const id = legacyId(entry._id, index);
    const deletion = deletionOf(entry);
    if (deletion.isDeleted) result.keptDeleted += 1;
    let unreadable = false;
    let notes = text(entry.notes);
    const cannotRead = (reason: string): void => {
      unreadable = true;
      result.unreadable.push({ id, reason });
    };

    const code = text(entry.car_code);
    if (code === null) cannotRead('no car code');
    const culprit = text(entry.culprit);
    if (culprit === null) cannotRead(`${code ?? NO_CODE}: no culprit`);

    const amounts = {
      companyCost: money(entry.company_account),
      amountCollected: money(entry.amount_collected),
      paidAmount: money(entry.paid),
    };
    const raws: Record<string, unknown> = {
      companyCost: entry.company_account,
      amountCollected: entry.amount_collected,
      paidAmount: entry.paid,
    };
    for (const [field, value] of Object.entries(amounts)) {
      if (value !== 'invalid') continue;
      cannotRead(`${code ?? NO_CODE}: ${field} is not a number`);
      notes = noteWith(notes, asWritten(AMOUNT_LABELS[field] ?? field, raws[field]));
      amounts[field as keyof typeof amounts] = { amount: null, rest: null };
    }
    const amountNotes: string[] = [];
    for (const [field, value] of Object.entries(amounts)) {
      const parsed = value as Exclude<ReturnType<typeof money>, 'invalid'>;
      if (parsed.rest !== null) amountNotes.push(`${field}: ${parsed.rest}`);
    }
    const status = String(entry.finsh_status_color ?? '0').trim() === '1' ? 'closed' : 'open';
    result.accidents.push({
      id,
      code: code ?? NO_CODE,
      occurredAt: legacyDate(entry.date_accident),
      culprit: culprit ?? NOT_STATED,
      statement: text(entry.statement),
      companyCost: (amounts.companyCost as { amount: number | null }).amount,
      amountCollected: (amounts.amountCollected as { amount: number | null }).amount,
      paidAmount: (amounts.paidAmount as { amount: number | null }).amount,
      status,
      notes,
      amountNotes,
      deletion,
      unreadable,
    });
  });
  return result;
};

const ARABIC_LETTER = /[؀-ۿ]/;

/** A culprit that is not even a name — a dash, dots, digits — is not asked of the directory. */
export const isNobodyCulprit = (name: string): boolean => !ARABIC_LETTER.test(name);

export interface PlannedAccident {
  doc: Partial<FleetAccidentDoc>;
  key: string;
}

export interface AccidentsPlan {
  vehicles: { code: string; ref: BookRef; rows: PlannedAccident[] }[];
  /** Codes the registry does not have — their files are KEPT by code — with how many rows each. */
  unknownCars: string[];
  /** Files with no date — «code: culprit» — kept, with none. */
  noDate: string[];
  /** Files written with «غير مذكور» for a statement the book left blank. */
  statementFilled: number;
  /** Files written deleted: the book's own deletions, and the ones it could not say readably. */
  deleted: number;
  /** Amounts the book left blank, written as 0. */
  blankAmounts: number;
  /** Words the book wrote after an amount — «code date: field: text». */
  amountNotes: string[];
}

/** How a file is told from another: when, who, and the three figures — never the status, which a person may change. */
export const accidentKey = (
  doc: Pick<FleetAccidentDoc, 'occurredAt' | 'culprit' | 'companyCost' | 'amountCollected' | 'paidAmount'>,
): string =>
  `${doc.occurredAt == null ? '' : doc.occurredAt.toISOString()}|${doc.culprit}|${doc.companyCost}|${doc.amountCollected}|${doc.paidAmount}`;

/** Turn the ledger into files per car. Pure. */
export const planAccidentsImport = (
  accidents: readonly ParsedAccident[],
  vehicleIdByCode: ReadonlyMap<string, string>,
  culpritIdByName: ReadonlyMap<string, string>,
): AccidentsPlan => {
  const plan: AccidentsPlan = {
    vehicles: [],
    unknownCars: [],
    noDate: [],
    statementFilled: 0,
    deleted: 0,
    blankAmounts: 0,
    amountNotes: [],
  };
  const byCode = new Map<string, PlannedAccident[]>();
  const unknown = new Map<string, number>();
  for (const row of accidents) {
    if (!vehicleIdByCode.has(row.code)) unknown.set(row.code, (unknown.get(row.code) ?? 0) + 1);
    if (row.occurredAt === null) plan.noDate.push(`${row.code}: ${row.culprit}`);
    if (row.statement === null) plan.statementFilled += 1;
    for (const amount of [row.companyCost, row.amountCollected, row.paidAmount]) {
      if (amount === null) plan.blankAmounts += 1;
    }
    const when = row.occurredAt === null ? '—' : day(row.occurredAt);
    for (const note of row.amountNotes) plan.amountNotes.push(`${row.code} ${when}: ${note}`);
    const culpritId = culpritIdByName.get(row.culprit) ?? null;
    const deleted = row.deletion.isDeleted || row.unreadable;
    if (deleted) plan.deleted += 1;
    const doc: Partial<FleetAccidentDoc> = {
      ...bookRefFields(bookRefOf(row.code, vehicleIdByCode)),
      occurredAt: row.occurredAt,
      culprit: row.culprit,
      culpritEmployeeId: culpritId === null ? null : new Types.ObjectId(culpritId),
      statement: row.statement ?? NOT_STATED,
      companyCost: row.companyCost ?? 0,
      amountCollected: row.amountCollected ?? 0,
      paidAmount: row.paidAmount ?? 0,
      status: row.status,
      notes: row.notes,
      ...(deleted ? deletedFields(row.deletion) : liveFields()),
    };
    const list = byCode.get(row.code) ?? [];
    list.push({ doc, key: accidentKey(doc as FleetAccidentDoc) });
    byCode.set(row.code, list);
  }
  plan.unknownCars = [...unknown].sort().map(([code, count]) => `${code} (${count})`);
  for (const [code, rows] of [...byCode].sort(([a], [b]) => a.localeCompare(b))) {
    plan.vehicles.push({
      code,
      ref: bookRefOf(code, vehicleIdByCode),
      // Dated files in order; the undated ones first, as the oldest — nothing is known to be before them.
      rows: [...rows].sort(
        (a, b) => (a.doc.occurredAt?.getTime() ?? 0) - (b.doc.occurredAt?.getTime() ?? 0),
      ),
    });
  }
  return plan;
};

export interface AccidentsImportOutcome {
  imported: number;
  alreadyThere: number;
  failures: { code: string; reason: string }[];
}

/**
 * Write every car's files. Idempotent per file as a multiset, as the violations are: a car that
 * already holds N files of a shape gets only the files beyond N.
 */
export const applyAccidentsImport = async (
  plan: AccidentsPlan,
  by: string,
): Promise<AccidentsImportOutcome> => {
  const outcome: AccidentsImportOutcome = { imported: 0, alreadyThere: 0, failures: [] };
  for (const vehicle of plan.vehicles) {
    try {
      const existing = await fleetAccidentRepository.existingByKey(vehicle.ref, accidentKey);
      const docs: Partial<FleetAccidentDoc>[] = [];
      for (const row of vehicle.rows) {
        if (existing.get(row.key)?.shift() !== undefined) {
          outcome.alreadyThere += 1;
          continue;
        }
        docs.push(row.doc);
      }
      if (docs.length > 0) await fleetAccidentRepository.createMany(docs, { by });
      outcome.imported += docs.length;
    } catch (error) {
      outcome.failures.push({ code: vehicle.code, reason: failureReason(error) });
    }
  }
  return outcome;
};
