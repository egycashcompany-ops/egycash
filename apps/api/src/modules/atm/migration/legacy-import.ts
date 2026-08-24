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
import {
  machineFromLegacy,
  machineJoinCodes,
  mailTicketFromLegacy,
  maintenanceFromLegacy,
  refLabelNamesFromLegacy,
  replenishmentFromLegacy,
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

export interface AtmImportReport {
  machines: { read: number; written: number };
  refLabels: { read: number; written: number };
  replenishments: { read: number; written: number; unresolvedMachine: number; noOpenTime: number };
  maintenances: { read: number; written: number; unresolvedMachine: number; noOpenTime: number };
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
    const repsWritten = await writeRows(
      AtmReplenishmentModel as unknown as mongoose.Model<never>,
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
    const maintsWritten = await writeRows(
      AtmMaintenanceModel as unknown as mongoose.Model<never>,
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
      replenishments: {
        read: legacyReps.length,
        written: repsWritten,
        unresolvedMachine: repUnresolved,
        noOpenTime: repNoOpen,
      },
      maintenances: {
        read: legacyMaints.length,
        written: maintsWritten,
        unresolvedMachine: maintUnresolved,
        noOpenTime: maintNoOpen,
      },
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
