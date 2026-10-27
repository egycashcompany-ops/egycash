// ATM-7 — the legacy importer. One legacy DEPLOYMENT (one server + one database, which is what a
// branch was — contad_app.js:221-224) into one ECMS branch, per run.
//
// Three properties make it safe to run more than once, which matters because a real migration is
// rehearsed before it is trusted:
//
//   1. **Legacy `_id`s are preserved.** Every row keeps the ObjectId it had, so a re-run REPLACES
//      the row it wrote last time instead of duplicating it, and a spot-check in the legacy
//      database finds the same id here.
//   2. **Nothing is deleted.** The importer only upserts; a row removed from the legacy side after
//      an import stays here, and is reported rather than silently reconciled.
//   3. **Dry-run counts without writing**, so an operator sees the shape of a deployment — and its
//      unresolved rows — before committing to it.
//
// One thing it cannot write: a SECOND open operation for one machine on one day. The owner's rule
// (port doc OD-1) put a partial unique index on each operation log, and legacy history predates it. The
// importer is exempt from the rule's service check (history is written as it was), and a row the
// index refuses is reported as `openDuplicate` with its legacy `_id` — never a crashed run. Where
// the index is ABSENT (the boot skipped it over duplicates already stored) nothing can refuse
// that row: the report says so (`openIndexMissing`) and still names the deployment's duplicates,
// which then land.
//
// It writes through the MODELS rather than the repositories, deliberately: a migration is system
// work with no actor, no per-row audit and no optimistic-concurrency story, and forcing it through
// a seam built for request-time writes would mean inventing all three.
import mongoose, { Types, type Connection } from 'mongoose';
import { logger } from '../../../infrastructure/logging/logger';
import { AtmMachineModel } from '../machines/machine.model';
import { AtmRefLabelModel, type AtmRefLabelKind } from '../catalogs/ref-label.model';
import { AtmReplenishmentModel } from '../replenishments/replenishment.model';
import { AtmMaintenanceModel } from '../maintenances/maintenance.model';
import { AtmMailTicketModel } from '../mail-tickets/mail-ticket.model';
import { OPEN_OPERATION_INDEX_NAMES, type AtmOperationKind } from '../shared/open-operation';
import {
  duplicateKeyWriteIndexes,
  machineFromLegacy,
  machineJoinCodes,
  mailTicketFromLegacy,
  maintenanceFromLegacy,
  openDuplicateRowIds,
  refLabelNamesFromLegacy,
  replenishmentFromLegacy,
  type ImportedOperation,
  type LegacyMachine,
  type LegacyMail,
  type LegacyOperation,
  type LegacyTimeMode,
} from './legacy-transform';

export interface AtmImportOptions {
  /** Read-only connection string of ONE legacy deployment's database. */
  legacyUri: string;
  /** The ECMS branch this deployment's data belongs to. */
  branchId: string;
  /** How that deployment wrote replenishment open times (default: the legacy bug — repaired). */
  replenishmentTime: LegacyTimeMode;
  /** How it wrote maintenance open times (default: honest, since moment-tz landed). */
  maintenanceTime: LegacyTimeMode;
  /** Count and report without writing anything. */
  dryRun: boolean;
}

/**
 * One operation log's line of the report. `openDuplicate` counts the rows the open-operation index
 * refused (the owner's rule, OD-1 — predicted within the deployment on a dry run), and
 * `openDuplicateIds` names the first of them by their preserved legacy `_id`, findable in both
 * databases: close the stale row in the legacy system and re-run.
 *
 * `openIndexMissing: true` changes that meaning: the index does not exist (the boot skipped it
 * because the collection already holds two open rows for one code), so NOTHING was refused —
 * `openDuplicate` / `openDuplicateIds` then name the deployment's open duplicates that were
 * WRITTEN anyway (the same rows a dry run names), and `written` counts them. A dry run reports the
 * same flag, so it still predicts the real run.
 */
export interface AtmImportOperationReport {
  read: number;
  written: number;
  unresolvedMachine: number;
  noOpenTime: number;
  openDuplicate: number;
  openDuplicateIds: string[];
  openIndexMissing: boolean;
}

export interface AtmImportReport {
  machines: { read: number; written: number };
  refLabels: { read: number; written: number };
  replenishments: AtmImportOperationReport;
  maintenances: AtmImportOperationReport;
  mailTickets: { read: number; written: number; unresolvedMachine: number; noReceivedAt: number };
  dryRun: boolean;
}

/** Upsert by `_id`, preserving it — the idempotency this whole importer rests on. */
const writeRows = async <T extends { _id: Types.ObjectId }>(
  model: mongoose.Model<never>,
  rows: readonly T[],
  dryRun: boolean,
): Promise<number> => {
  if (dryRun || rows.length === 0) return rows.length;
  const collection = model.collection;
  await collection.bulkWrite(
    rows.map((row) => ({
      replaceOne: { filter: { _id: row._id }, replacement: row as never, upsert: true },
    })),
    { ordered: false },
  );
  return rows.length;
};

/** How many refused ids the report names; the count is always whole. */
const OPEN_DUPLICATE_IDS_SHOWN = 100;

interface OperationWrite {
  written: number;
  openDuplicateIds: string[];
  openIndexMissing: boolean;
}

/** Does this log carry the open-operation index? A collection that does not exist yet has none. */
const hasOpenOperationIndex = async (
  model: mongoose.Model<never>,
  kind: AtmOperationKind,
): Promise<boolean> => {
  const indexes = await model.collection
    .listIndexes()
    .toArray()
    .catch(() => [] as { name?: string }[]);
  return indexes.some((index) => index.name === OPEN_OPERATION_INDEX_NAMES[kind]);
};

/**
 * The operation logs' write — `writeRows`, plus the owner's rule (OD-1). The importer is EXEMPT
 * from the rule's service check: it is history, written as it was, and it neither refuses, closes
 * nor merges a legacy row. But the partial unique index admits one OPEN row per machine code and
 * day, and the legacy had no such guard, so a second open row is refused by the database. That refusal is
 * REPORTED — never a crash of the whole run (the bulk write is unordered, so every other row still
 * lands).
 *
 * If the index is ABSENT (the boot skipped it over duplicates already stored), nothing can refuse:
 * every row lands, and the report says so — `openIndexMissing`, with the deployment's duplicates
 * still named — and a warning names the collection, the index and the count. A dry run checks the
 * same thing, so its prediction matches the real run in both states.
 */
const writeOperationRows = async (
  model: mongoose.Model<never>,
  kind: AtmOperationKind,
  rows: readonly ImportedOperation[],
  dryRun: boolean,
): Promise<OperationWrite> => {
  const predicted = openDuplicateRowIds(rows);
  if (!(await hasOpenOperationIndex(model, kind))) {
    if (predicted.length > 0) {
      logger.warn(
        {
          collection: model.collection.name,
          index: OPEN_OPERATION_INDEX_NAMES[kind],
          openDuplicate: predicted.length,
        },
        'atm import: open-operation index absent — open duplicates are NOT refused and land',
      );
    }
    return {
      written: await writeRows(model, rows, dryRun),
      openDuplicateIds: predicted,
      openIndexMissing: true,
    };
  }
  if (dryRun) {
    return {
      written: rows.length - predicted.length,
      openDuplicateIds: predicted,
      openIndexMissing: false,
    };
  }
  try {
    return {
      written: await writeRows(model, rows, false),
      openDuplicateIds: [],
      openIndexMissing: false,
    };
  } catch (error) {
    const refused = duplicateKeyWriteIndexes(error);
    if (refused === null) throw error;
    return {
      written: rows.length - refused.length,
      openDuplicateIds: refused.map((index) => String(rows[index]?._id)),
      openIndexMissing: false,
    };
  }
};

const operationReport = (
  read: number,
  write: OperationWrite,
  unresolvedMachine: number,
  noOpenTime: number,
): AtmImportOperationReport => ({
  read,
  written: write.written,
  unresolvedMachine,
  noOpenTime,
  openDuplicate: write.openDuplicateIds.length,
  openDuplicateIds: write.openDuplicateIds.slice(0, OPEN_DUPLICATE_IDS_SHOWN),
  openIndexMissing: write.openIndexMissing,
});

export const importLegacyAtmDeployment = async (
  options: AtmImportOptions,
): Promise<AtmImportReport> => {
  const branchId = new Types.ObjectId(options.branchId);
  const now = new Date();
  const legacy: Connection = mongoose.createConnection(options.legacyUri);
  await legacy.asPromise();

  try {
    // ── Machines ────────────────────────────────────────────────────────────
    const legacyMachines = (await legacy
      .collection('atm')
      .find({})
      .toArray()) as unknown as LegacyMachine[];
    const machines = legacyMachines.map((doc) => machineFromLegacy(doc, branchId, now));
    const machinesWritten = await writeRows(
      AtmMachineModel as unknown as mongoose.Model<never>,
      machines,
      options.dryRun,
    );

    // Code → machine id, including the base code a `-D` row's history was opened under, so a
    // deleted machine's operations still resolve. First writer wins: a live machine that reclaimed
    // a code keeps it, and the deleted one only answers for codes nobody else claims.
    const byCode = new Map<string, Types.ObjectId>();
    for (const machine of machines) {
      if (!machine.machineCode.endsWith('-D')) byCode.set(machine.machineCode, machine._id);
    }
    for (const machine of machines) {
      for (const code of machineJoinCodes(machine.machineCode)) {
        if (!byCode.has(code)) byCode.set(code, machine._id);
      }
    }

    // ── Reference label lists ───────────────────────────────────────────────
    const dataLists = await legacy.collection('atm_data_lists').findOne({});
    const labelRows: {
      _id: Types.ObjectId;
      branchId: Types.ObjectId;
      kind: AtmRefLabelKind;
      name: string;
      isActive: boolean;
      isDeleted: boolean;
      schemaVersion: number;
    }[] = [];
    for (const kind of ['bank', 'area'] as const) {
      for (const name of refLabelNamesFromLegacy(dataLists?.[kind])) {
        labelRows.push({
          // Labels had no id of their own (they were array entries), so the import mints one and
          // the unique (branch, kind, name) index is what makes a re-run idempotent instead.
          _id: new Types.ObjectId(),
          branchId,
          kind,
          name,
          isActive: true,
          isDeleted: false,
          schemaVersion: 1,
        });
      }
    }
    let labelsWritten = 0;
    if (!options.dryRun) {
      for (const row of labelRows) {
        const result = await AtmRefLabelModel.collection.updateOne(
          { branchId: row.branchId, kind: row.kind, name: row.name, isDeleted: false },
          { $setOnInsert: row },
          { upsert: true },
        );
        if (result.upsertedCount > 0) labelsWritten += 1;
      }
    } else {
      labelsWritten = labelRows.length;
    }

    // ── Operations ──────────────────────────────────────────────────────────
    const resolveMachine = (doc: LegacyOperation | LegacyMail): Types.ObjectId | null => {
      const raw = typeof doc.mach_id === 'string' ? doc.mach_id.trim().replace(/^0+/, '') : '';
      return byCode.get(raw) ?? null;
    };

    const legacyReps = (await legacy
      .collection('atm_rep_log')
      .find({})
      .toArray()) as unknown as LegacyOperation[];
    const reps = [];
    let repUnresolved = 0;
    let repNoOpen = 0;
    for (const doc of legacyReps) {
      const machineId = resolveMachine(doc);
      if (machineId === null) {
        repUnresolved += 1;
        continue;
      }
      const row = replenishmentFromLegacy(doc, branchId, machineId, options.replenishmentTime, now);
      if (row === null) repNoOpen += 1;
      else reps.push(row);
    }
    const repsWrite = await writeOperationRows(
      AtmReplenishmentModel as unknown as mongoose.Model<never>,
      'replenishment',
      reps,
      options.dryRun,
    );

    const legacyMaints = (await legacy
      .collection('atm_maint_log')
      .find({})
      .toArray()) as unknown as LegacyOperation[];
    const maints = [];
    let maintUnresolved = 0;
    let maintNoOpen = 0;
    for (const doc of legacyMaints) {
      const machineId = resolveMachine(doc);
      if (machineId === null) {
        maintUnresolved += 1;
        continue;
      }
      const row = maintenanceFromLegacy(doc, branchId, machineId, options.maintenanceTime, now);
      if (row === null) maintNoOpen += 1;
      else maints.push(row);
    }
    const maintsWrite = await writeOperationRows(
      AtmMaintenanceModel as unknown as mongoose.Model<never>,
      'maintenance',
      maints,
      options.dryRun,
    );

    // ── Mail tickets ────────────────────────────────────────────────────────
    // A ticket whose machine cannot be resolved is still IMPORTED, with a null machineId: the log
    // page is a record of decisions people made, and dropping the row would erase one. Operations
    // cannot be, because an operation without its machine has no branch-scoped identity.
    const legacyMails = (await legacy
      .collection('atm_mails')
      .find({})
      .toArray()) as unknown as LegacyMail[];
    const mails = [];
    let mailUnresolved = 0;
    let mailNoReceived = 0;
    for (const doc of legacyMails) {
      const machineId = resolveMachine(doc);
      if (machineId === null) mailUnresolved += 1;
      const row = mailTicketFromLegacy(doc, branchId, machineId);
      if (row === null) mailNoReceived += 1;
      else mails.push(row);
    }
    const mailsWritten = await writeRows(
      AtmMailTicketModel as unknown as mongoose.Model<never>,
      mails,
      options.dryRun,
    );

    return {
      machines: { read: legacyMachines.length, written: machinesWritten },
      refLabels: { read: labelRows.length, written: labelsWritten },
      replenishments: operationReport(legacyReps.length, repsWrite, repUnresolved, repNoOpen),
      maintenances: operationReport(legacyMaints.length, maintsWrite, maintUnresolved, maintNoOpen),
      mailTickets: {
        read: legacyMails.length,
        written: mailsWritten,
        unresolvedMachine: mailUnresolved,
        noReceivedAt: mailNoReceived,
      },
      dryRun: options.dryRun,
    };
  } finally {
    await legacy.close();
    logger.info('atm import: legacy connection closed');
  }
};
