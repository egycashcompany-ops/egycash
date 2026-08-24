// ATM-7 — the legacy → ECMS row transforms, kept PURE so the rules that matter (which timestamps
// are repaired, how a deleted machine's code reads, what a mail's status maps to) are asserted by
// tests instead of proved by running an import against production data.
//
// The shapes on the left are the legacy documents verbatim (models/atm.js, atm_rep_log.js,
// atm_maint_log.js, atm_mailss.js, atm_data_lists.js).
import { type Types } from 'mongoose';
import {
  LEGACY_ATM_MAIL_STATUS_BY_CODE,
  normalizeAtmMachineCode,
  type AtmMailTicketStatus,
} from '@ecms/contracts';
import { reinterpretUtcPartsAsCairo } from '../shared/cairo-time';

/**
 * How a legacy deployment wrote its open times.
 *
 *   `cairo-labelled` — local clock parts stamped `+00:00` (the replenishment create path,
 *                      contad_app.js:644-650). Needs the T1 repair.
 *   `utc`            — a true instant (the maintenance path after it moved to moment-tz,
 *                      :1902-1905, and every `close_time`). Imported unchanged.
 *
 * It is a FLAG rather than a detection because the two are indistinguishable in the data: a row
 * reading 10:00Z is either 10:00 Cairo mislabelled or 12:00 Cairo honestly recorded, and only the
 * deployment's history says which. The operator samples known rows and tells the importer.
 */
export type LegacyTimeMode = 'cairo-labelled' | 'utc';

export const repairLegacyInstant = <T extends Date | null | undefined>(
  stored: T,
  mode: LegacyTimeMode,
): Date | null => {
  if (stored === null || stored === undefined) return null;
  return mode === 'cairo-labelled' ? reinterpretUtcPartsAsCairo(stored) : stored;
};

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const strOrNull = (value: unknown): string | null => {
  const text = str(value);
  return text === '' ? null : text;
};
const asDate = (value: unknown): Date | null =>
  value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;

export interface LegacyMachine {
  _id: Types.ObjectId;
  bank?: unknown;
  mach_id?: unknown;
  name?: unknown;
  zone?: unknown;
  area?: unknown;
  status?: unknown;
  deleted?: unknown;
}

export interface ImportedMachine {
  _id: Types.ObjectId;
  branchId: Types.ObjectId;
  bankName: string;
  machineCode: string;
  name: string;
  zone: string;
  area: string;
  isActive: boolean;
  isDeleted: boolean;
  deletedAt: Date | null;
  schemaVersion: number;
}

/**
 * A machine row. The legacy delete renamed the code to `<code>-D` (contad_app.js:2500) — the
 * stored code is carried VERBATIM, suffix included, because that is what the historical operation
 * rows were written against and what makes the code free to be re-registered.
 */
export const machineFromLegacy = (
  doc: LegacyMachine,
  branchId: Types.ObjectId,
  now: Date,
): ImportedMachine => {
  const deleted = Number(doc.deleted ?? 0) === 1;
  return {
    _id: doc._id,
    branchId,
    bankName: str(doc.bank),
    // Normalized on the way in, exactly as every live entry point normalizes: a legacy row stored
    // with leading zeros must answer to the same code the forms and the mail reader produce.
    machineCode: normalizeAtmMachineCode(str(doc.mach_id)),
    name: str(doc.name),
    zone: str(doc.zone),
    area: str(doc.area),
    isActive: Number(doc.status ?? 0) === 1,
    isDeleted: deleted,
    deletedAt: deleted ? now : null,
    schemaVersion: 1,
  };
};

/**
 * The code an operation row joins on, for machine resolution: the machine's own code, and — for a
 * deleted machine — the base code its historical operations were opened under.
 */
export const machineJoinCodes = (machineCode: string): string[] =>
  machineCode.endsWith('-D') ? [machineCode, machineCode.slice(0, -2)] : [machineCode];

export interface LegacyOperation {
  _id: Types.ObjectId;
  bank?: unknown;
  mach_id?: unknown;
  name?: unknown;
  zone?: unknown;
  area?: unknown;
  open_time?: unknown;
  close_time?: unknown;
  schedule_time?: unknown;
  leader?: unknown;
  ops_emp?: unknown;
  ops_emp2?: unknown;
  service_type?: unknown;
  notes?: unknown;
  reference_number?: unknown;
  end?: unknown;
  deleted?: unknown;
}

export interface ImportedOperation {
  _id: Types.ObjectId;
  branchId: Types.ObjectId;
  machineId: Types.ObjectId;
  machineCode: string;
  bankName: string;
  machineName: string;
  zone: string;
  area: string;
  openedAt: Date;
  closedAt: Date | null;
  leaderName: string | null;
  openedByName: string | null;
  closedByName: string | null;
  isDeleted: boolean;
  deletedAt: Date | null;
  schemaVersion: number;
}

export interface ImportedReplenishment extends ImportedOperation {
  scheduleTime: string | null;
}

export interface ImportedMaintenance extends ImportedOperation {
  serviceType: string | null;
  notes: string | null;
  referenceNumber: string | null;
  source: 'manual';
  mailTicketId: null;
  leaderEmployeeId: null;
}

const operationBase = (
  doc: LegacyOperation,
  branchId: Types.ObjectId,
  machineId: Types.ObjectId,
  openMode: LegacyTimeMode,
  now: Date,
): ImportedOperation | null => {
  const openedAtRaw = asDate(doc.open_time);
  // A row with no open time has no lifecycle: the timer, the day grouping and both list queries
  // are all defined by it. Skipped and REPORTED rather than invented.
  if (openedAtRaw === null) return null;
  const deleted = Number(doc.deleted ?? 0) === 1;
  // `end` is not carried: the open state IS `closedAt === null` (port doc G3). A legacy row with
  // end:1 and no close_time — reopened, then re-closed by a crash — imports as OPEN, which is
  // what its own close_time says.
  return {
    _id: doc._id,
    branchId,
    machineId,
    machineCode: normalizeAtmMachineCode(str(doc.mach_id)),
    bankName: str(doc.bank),
    machineName: str(doc.name),
    zone: str(doc.zone),
    area: str(doc.area),
    openedAt: repairLegacyInstant(openedAtRaw, openMode) as Date,
    // Close times were ALWAYS true instants — both paths wrote `new Date()`/moment-tz UTC
    // (contad_app.js:782, :1964) — so they are never repaired.
    closedAt: asDate(doc.close_time),
    leaderName: strOrNull(doc.leader),
    openedByName: strOrNull(doc.ops_emp),
    closedByName: strOrNull(doc.ops_emp2),
    isDeleted: deleted,
    deletedAt: deleted ? now : null,
    schemaVersion: 1,
  };
};

export const replenishmentFromLegacy = (
  doc: LegacyOperation,
  branchId: Types.ObjectId,
  machineId: Types.ObjectId,
  openMode: LegacyTimeMode,
  now: Date,
): ImportedReplenishment | null => {
  const base = operationBase(doc, branchId, machineId, openMode, now);
  if (base === null) return null;
  return { ...base, scheduleTime: strOrNull(doc.schedule_time) };
};

/**
 * Maintenance rows import as `source: 'manual'` WITHOUT exception, including the ones an operator
 * accepted from a mail. That is not a guess: the legacy accept path wrote a plain maintenance row
 * and kept no link back to the ticket (contad_app.js:2806-2823), so the provenance genuinely does
 * not exist in the data. Rows created in ECMS carry it from here on.
 */
export const maintenanceFromLegacy = (
  doc: LegacyOperation,
  branchId: Types.ObjectId,
  machineId: Types.ObjectId,
  openMode: LegacyTimeMode,
  now: Date,
): ImportedMaintenance | null => {
  const base = operationBase(doc, branchId, machineId, openMode, now);
  if (base === null) return null;
  return {
    ...base,
    serviceType: strOrNull(doc.service_type),
    notes: strOrNull(doc.notes),
    referenceNumber: strOrNull(doc.reference_number),
    source: 'manual',
    mailTicketId: null,
    leaderEmployeeId: null,
  };
};

export interface LegacyMail {
  _id: Types.ObjectId;
  bank?: unknown;
  mach_id?: unknown;
  name?: unknown;
  area?: unknown;
  open_time?: unknown;
  status?: unknown;
  status_txt?: unknown;
  action_by?: unknown;
  sender_mail?: unknown;
  duplication?: unknown;
  found?: unknown;
}

export interface ImportedMailTicket {
  _id: Types.ObjectId;
  branchId: Types.ObjectId;
  machineId: Types.ObjectId | null;
  machineCode: string;
  bankName: string;
  machineName: string;
  area: string;
  receivedAt: Date;
  status: AtmMailTicketStatus;
  issueText: string;
  senderEmail: string;
  foundInMaster: boolean;
  duplicationAtIngest: boolean;
  actionByName: string | null;
  actionAt: null;
  providerMessageId: null;
  isDeleted: boolean;
  deletedAt: null;
  schemaVersion: number;
}

/**
 * A mail ticket. Two fields are deliberately null:
 *   · `actionAt` — the legacy recorded WHO decided and never WHEN (port doc GAP G1). Stamping the
 *     import time would put a false fact in the audit column the log page renders.
 *   · `providerMessageId` — these rows predate the idempotency key, and a NULL is exempt from its
 *     partial unique index, so any number of imported rows coexist.
 */
export const mailTicketFromLegacy = (
  doc: LegacyMail,
  branchId: Types.ObjectId,
  machineId: Types.ObjectId | null,
): ImportedMailTicket | null => {
  const receivedAt = asDate(doc.open_time);
  if (receivedAt === null) return null;
  return {
    _id: doc._id,
    branchId,
    machineId,
    machineCode: normalizeAtmMachineCode(str(doc.mach_id)),
    bankName: str(doc.bank),
    machineName: str(doc.name),
    area: str(doc.area),
    receivedAt,
    status: LEGACY_ATM_MAIL_STATUS_BY_CODE[Number(doc.status ?? 0)] ?? 'pending',
    issueText: str(doc.status_txt),
    senderEmail: str(doc.sender_mail),
    foundInMaster: Number(doc.found ?? 0) === 1,
    duplicationAtIngest: Number(doc.duplication ?? 0) === 1,
    actionByName: strOrNull(doc.action_by),
    actionAt: null,
    providerMessageId: null,
    isDeleted: false,
    deletedAt: null,
    schemaVersion: 1,
  };
};

/**
 * The two label lists off the legacy singleton (`atm_data_lists`, contad_app.js:2408). Blank and
 * repeated entries are dropped — the legacy `$push` guarded neither, so real data carries both.
 */
export const refLabelNamesFromLegacy = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const name = str(entry);
    if (name === '' || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
};
