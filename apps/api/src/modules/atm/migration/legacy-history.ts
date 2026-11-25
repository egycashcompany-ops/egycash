// The legacy history import — the PURE part (docs/12-planning/atm-legacy-history-import.md §4):
// which legacy row is imported and why the others are not, how a deployment's time mode is chosen,
// how a machine code resolves, and the cutover the screen suggests. Kept free of the database so
// the rules are asserted by tests rather than proved by running an import against production data.
import { type Types } from 'mongoose';
import { normalizeAtmMachineCode } from '@ecms/contracts';
import { type LegacyOperation, type LegacyTimeMode } from './legacy-transform';

/**
 * Why a legacy row is not imported — the FIRST rule of §4.1 it fails, in that order — or `import`.
 * A row is counted once, under its first reason.
 */
export const LEGACY_ROW_VERDICTS = [
  'deleted',
  'noOpenTime',
  'open',
  'afterCutover',
  'unresolved',
  'import',
] as const;
export type LegacyRowVerdict = (typeof LEGACY_ROW_VERDICTS)[number];

export interface LegacyRowRules {
  /** The moment the branch began working in ECMS (§4.4). Null: no cut. */
  cutoverAt: Date | null;
  resolve: (rawCode: unknown) => Types.ObjectId | null;
}

export type LegacyRowOutcome =
  | { verdict: Exclude<LegacyRowVerdict, 'import' | 'unresolved'> }
  | { verdict: 'unresolved'; code: string }
  | { verdict: 'import'; machineId: Types.ObjectId };

const isDate = (value: unknown): value is Date =>
  value instanceof Date && !Number.isNaN(value.getTime());

/** The legacy delete flag — `deleted: 1` (contad_app.js); anything else is a live row. */
export const legacyRowDeleted = (doc: Pick<LegacyOperation, 'deleted'>): boolean =>
  Number(doc.deleted ?? 0) === 1;

/**
 * «Done» in the legacy system: closed (`end: 1`) WITH a close time. In every legacy deployment the
 * two agree on every row (read 2026-11-25: alex, portsaid, tanta, wsal, both kinds); both are
 * asked, so a row only one of them calls closed stays out rather than being guessed at.
 */
export const legacyRowDone = (doc: Pick<LegacyOperation, 'end' | 'close_time'>): boolean =>
  Number(doc.end ?? 0) === 1 && isDate(doc.close_time);

/**
 * The rules of §4.1, in order. Only a «Done» row is copied — the owner (2026-11-25): «عايز اللى
 * يتنقل بس سجل الصيانة والتغذية اللى اتقفل Done» (§4.5). The cut (§4.4): a closed row is history
 * when it CLOSED before the branch began working in ECMS — a close time was always a true instant
 * (port doc §7).
 */
export const classifyLegacyRow = (
  doc: LegacyOperation,
  rules: LegacyRowRules,
): LegacyRowOutcome => {
  if (legacyRowDeleted(doc)) return { verdict: 'deleted' };
  if (!isDate(doc.open_time)) return { verdict: 'noOpenTime' };
  if (!legacyRowDone(doc)) return { verdict: 'open' };
  if (rules.cutoverAt !== null && (doc.close_time as Date).getTime() >= rules.cutoverAt.getTime()) {
    return { verdict: 'afterCutover' };
  }
  const machineId = rules.resolve(doc.mach_id);
  if (machineId === null) return { verdict: 'unresolved', code: legacyCodeLabel(doc.mach_id) };
  return { verdict: 'import', machineId };
};

/** A legacy code as the report lists it: trimmed, and «—» for a row that has none. */
export const legacyCodeLabel = (raw: unknown): string => {
  const text = typeof raw === 'string' ? raw.trim() : '';
  return text === '' ? '—' : text;
};

/**
 * §4.3: a legacy row's `_id` records the moment it was written — for most rows the moment it was
 * opened. An open time within 15 minutes of it was written as UTC; one two to three hours after it
 * (the Cairo offset, winter or summer) was Cairo wall clock stamped as UTC. Rows that fit neither
 * (opened for a later time, edited since) say nothing. Each mode leaves its own signature, so the
 * larger count names the mode; a tie reads as UTC.
 */
export const LEGACY_AS_WRITTEN_MINUTES = 15;
export const LEGACY_CAIRO_SHIFT_MINUTES = { from: 105, to: 195 } as const;

export const chooseLegacyTimeMode = (evidence: {
  asWritten: number;
  cairoShifted: number;
}): LegacyTimeMode => (evidence.cairoShifted > evidence.asWritten ? 'cairo-labelled' : 'utc');

/**
 * §4.3: whether the evidence decides the mode — the larger count above zero and at least ten times
 * the smaller. On the five deployments read on 2026-11-25 every kind is decided by hundreds to one;
 * a kind that is not (a few rows, or rows that fit neither signature) is refused rather than
 * guessed, since a wrong mode moves a whole history by two or three hours. A kind with no rows to
 * read has nothing to copy and is clear.
 */
export const LEGACY_TIME_MODE_MARGIN = 10;

export const legacyTimeModeClear = (evidence: {
  rows: number;
  asWritten: number;
  cairoShifted: number;
}): boolean => {
  if (evidence.rows === 0) return true;
  const winner = Math.max(evidence.asWritten, evidence.cairoShifted);
  const loser = Math.min(evidence.asWritten, evidence.cairoShifted);
  return winner > 0 && winner >= LEGACY_TIME_MODE_MARGIN * loser;
};

/** A machine of the target branch, as the resolution reads it. */
export interface LegacyResolvableMachine {
  _id: Types.ObjectId;
  machineCode: string;
  isDeleted: boolean;
  updatedAt?: Date;
}

/**
 * §4.2: code → machine. A live machine answers for its code. A deleted one is stored as
 * `<code>-D` (the ECMS delete renames it, machine.service.ts), so it answers for its base code too,
 * when no live machine holds it — a row of a machine since removed from the register still belongs
 * to its history; of several deleted under one code, the one changed last.
 */
export const legacyMachineIndex = (
  machines: readonly LegacyResolvableMachine[],
): Map<string, Types.ObjectId> => {
  const byCode = new Map<string, Types.ObjectId>();
  for (const machine of machines) {
    if (!machine.isDeleted) byCode.set(machine.machineCode, machine._id);
  }
  const deleted = machines
    .filter((machine) => machine.isDeleted)
    .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
  for (const machine of deleted) {
    for (const code of [machine.machineCode, baseCode(machine.machineCode)]) {
      if (!byCode.has(code)) byCode.set(code, machine._id);
    }
  }
  return byCode;
};

const baseCode = (code: string): string => (code.endsWith('-D') ? code.slice(0, -2) : code);

/**
 * §4.2: the legacy code normalized as every live entry point normalizes it. A code the legacy delete
 * renamed (`<code>-D`, contad_app.js:2500) also tries its base code.
 */
export const resolveLegacyMachine = (
  byCode: ReadonlyMap<string, Types.ObjectId>,
  raw: unknown,
): Types.ObjectId | null => {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') return null;
  const code = normalizeAtmMachineCode(text);
  const direct = byCode.get(code);
  if (direct !== undefined) return direct;
  if (!code.endsWith('-D')) return null;
  return byCode.get(normalizeAtmMachineCode(baseCode(code))) ?? null;
};

/** §4.4: rows a branch must have written on one Cairo day before the screen calls it the switch. */
export const LEGACY_CUTOVER_MIN_ROWS = 20;

/**
 * §4.4: the moment the branch began working in ECMS — its first own row (not deleted, not copied)
 * written on the first Cairo day it wrote at least `LEGACY_CUTOVER_MIN_ROWS`; a few test rows
 * before that do not count. Null when no day does. `days` need not be sorted.
 */
export const suggestLegacyCutoverAt = (
  days: readonly { day: string; rows: number; firstAt: Date }[],
): Date | null =>
  [...days]
    .filter((entry) => entry.rows >= LEGACY_CUTOVER_MIN_ROWS)
    .sort((a, b) => a.day.localeCompare(b.day))[0]?.firstAt ?? null;
