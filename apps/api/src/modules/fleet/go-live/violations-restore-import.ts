// What people DID on the violations screen from the 24th on, put back onto the book's rows.
//
// The reload (`violations-reload.ts`) swept every fine recorded here before 24 September and wrote
// the old book again in its place — «امسح من ecms كل المخالفات لحد يوم 23 يعنى من يوم 24 البدايه».
// The rows were recorded before the 24th, but some of the WORK on them was done after it: its own
// report listed 204 swept fines somebody had changed from the 24th on — «تم التحصيل» ticked on a
// car's whole year, mostly — and the book's copy came back without those ticks. The owner's rule
// makes the 24th the start of this system's own record, and a tick given on the 25th is that
// record. «حل كل المشاكل دى كلها»: so it is put back.
//
// THE AUDIT TRAIL SAYS WHAT WAS DONE, AND WHEN. Every change on the screen is audited with the
// field, its value before and its value after — the tick on one fine (`setCollected`), the tick on
// a car's year (`setCollectedForYear`, audited as «vehicle:year»), a correction, a carry, a delete.
// Only what a PERSON did (an actor on the entry) between the cutoff and the end of the reload is
// read: a change before the 24th belongs to the record the owner asked to wipe, and a change after
// the reload was made on the new rows already.
//
// ONE FINE'S CHANGES LAND ON ITS TWIN. The swept fine is still in the database (the sweep is
// soft), so its state AT THE CUTOFF is its current state with the post-cutoff changes undone — and
// that state is what the book says, so it names its twin among the book's rows by the import's own
// key (`violationKey`) on the same car. Each field is then set to what the person last set it to —
// ONLY where the twin still holds the cutoff value: a twin somebody has already corrected since the
// reload keeps that correction, and is listed.
//
// A CAR'S YEAR is ticked (or unticked) on the book's rows of that block exactly as the person did
// it — unless somebody has ticked that block again since the reload, in which case their latest
// word stands and the block is listed.
import { Types } from 'mongoose';
import { AuditLogModel } from '../../../platform/audit/audit.model';
import { FleetViolationModel, type FleetViolationDoc } from '../violations/violation.model';
import { violationYearBranches } from '../violations/violation.repository';
import { violationKey } from './violations-import';

/** The fields a person can change on a fine — the audit snapshot's own keys. */
export const RESTORABLE_FIELDS = [
  'vehicleId',
  'violationTypeId',
  'amount',
  'year',
  'count',
  'unitValue',
  'date',
  'filedYear',
  'homeVehicleId',
  'driverEmployeeId',
  'collected',
] as const;
export type RestorableField = (typeof RESTORABLE_FIELDS)[number];

const ID_FIELDS = new Set<string>([
  'vehicleId',
  'violationTypeId',
  'homeVehicleId',
  'driverEmployeeId',
]);

/** One audit entry, as this step reads it. */
export interface AuditTrailEntry {
  entityId: string;
  action: string;
  at: Date;
  userId: string | null;
  changes: readonly { field: string; old: unknown; new: unknown }[];
}

/** An audited value, back in the shape the document stores it in. */
export const docValue = (field: string, value: unknown): unknown => {
  if (value === null || value === undefined || value === '') return null;
  if (ID_FIELDS.has(field)) {
    // An id the trail did not write as one (the first run failed on exactly this) is not a value
    // this step can put back: `undefined` drops the field rather than the whole run.
    const text = String(value);
    return /^[0-9a-f]{24}$/i.test(text) ? new Types.ObjectId(text) : undefined;
  }
  if (field === 'date') return value instanceof Date ? value : new Date(String(value));
  return value;
};

/** Equal as stored — ids and dates compared by what they are, not by object identity. */
export const sameStored = (a: unknown, b: unknown): boolean => {
  if (a == null || b == null) return a == null && b == null;
  if (a instanceof Date || b instanceof Date) {
    return new Date(a as Date).getTime() === new Date(b as Date).getTime();
  }
  return String(a) === String(b);
};

/** What people did to ONE fine after the cutoff: its value then, its value last, and a delete. */
export interface FineEdits {
  before: Partial<Record<RestorableField, unknown>>;
  after: Partial<Record<RestorableField, unknown>>;
  deleted: { at: Date; by: string } | null;
  /** Fields whose audited value is not one this step can write back. */
  unreadable: string[];
}

/**
 * Fold one fine's audit entries, oldest first, into the value each field had at the cutoff (the
 * FIRST «old») and the value it was left at (the LAST «new»). A field set and set back nets out.
 */
export const foldFineEdits = (entries: readonly AuditTrailEntry[]): FineEdits => {
  const edits: FineEdits = { before: {}, after: {}, deleted: null, unreadable: [] };
  for (const entry of [...entries].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (entry.action === 'delete') {
      edits.deleted = { at: entry.at, by: entry.userId ?? '' };
      continue;
    }
    for (const change of entry.changes) {
      const field = change.field as RestorableField;
      if (!(RESTORABLE_FIELDS as readonly string[]).includes(field)) continue;
      const before = docValue(field, change.old);
      const after = docValue(field, change.new);
      if (before === undefined || after === undefined) {
        edits.unreadable.push(field);
        continue;
      }
      if (!(field in edits.before)) edits.before[field] = before;
      edits.after[field] = after;
    }
  }
  for (const field of Object.keys(edits.after) as RestorableField[]) {
    if (sameStored(edits.before[field], edits.after[field])) {
      delete edits.before[field];
      delete edits.after[field];
    }
  }
  return edits;
};

/** «vehicleId:year» — how the year tick is audited. */
const YEAR_TICK = /^([0-9a-f]{24}):(\d{4})$/;
const ROW_ID = /^[0-9a-f]{24}$/;

/** The car a fine sits on, as the book wrote it — its home, if it was being carried. */
const refOf = (
  doc: Pick<FleetViolationDoc, 'vehicleId' | 'vehicleCode' | 'homeVehicleId'>,
): string =>
  doc.homeVehicleId != null
    ? `id:${String(doc.homeVehicleId)}`
    : doc.vehicleId != null
      ? `id:${String(doc.vehicleId)}`
      : `code:${doc.vehicleCode ?? ''}`;

export const twinKey = (doc: FleetViolationDoc): string => `${refOf(doc)}#${violationKey(doc)}`;

/** A swept fine as it stood at the cutoff: its current state with the later changes undone. */
export const atCutoff = (swept: FleetViolationDoc, edits: FineEdits): FleetViolationDoc => ({
  ...swept,
  ...(edits.before as Partial<FleetViolationDoc>),
});

export interface RestoreOutcome {
  /** Fields put back on the book's rows, per field. */
  restored: Partial<Record<RestorableField, number>>;
  /** Book rows deleted again because a person had deleted them from the 24th on. */
  deletedAgain: number;
  /** Book rows whose collected state was set again from a year's tick. */
  yearTicksRestored: number;
  /** Swept fines with no twin among the book's rows — «code when: amount». */
  noTwin: string[];
  /** Twins changed since the reload — their current value was kept. «id: field». */
  keptSinceReload: string[];
  /** Year blocks ticked again after the reload — the later tick stands. «code year». */
  laterTicks: string[];
  /** Audit entries read in the window, by kind. */
  entries: { fines: number; yearTicks: number };
  /** Audited values that are not an id this step can write — «id: field». */
  unreadable: string[];
  /** Fines or blocks that could not be written, with why. The rest were still restored. */
  failures: string[];
}

/**
 * Read the audit trail between `from` (the cutoff) and `to` (the end of the reload) and put the
 * people's changes back. A year block somebody has ticked again after `to` is left to that tick.
 */
export const applyViolationsRestore = async (
  from: Date,
  to: Date,
  codeOfId: ReadonlyMap<string, string>,
): Promise<RestoreOutcome> => {
  const outcome: RestoreOutcome = {
    restored: {},
    deletedAgain: 0,
    yearTicksRestored: 0,
    noTwin: [],
    keptSinceReload: [],
    laterTicks: [],
    entries: { fines: 0, yearTicks: 0 },
    unreadable: [],
    failures: [],
  };

  const trail = (
    await AuditLogModel.find(
      {
        'entityRef.moduleId': 'fleet',
        'entityRef.entityType': 'violation',
        at: { $gte: from },
        'actor.userId': { $ne: null },
      },
      { entityRef: 1, action: 1, at: 1, changes: 1, actor: 1 },
    )
      .sort({ at: 1 })
      .lean<
        {
          entityRef: { entityId: string };
          action: string;
          at: Date;
          changes: { field: string; old: unknown; new: unknown }[];
          actor: { userId: Types.ObjectId | null };
        }[]
      >()
      .exec()
  ).map((row): AuditTrailEntry => ({
    entityId: row.entityRef.entityId,
    action: row.action,
    at: row.at,
    userId: row.actor.userId === null ? null : String(row.actor.userId),
    changes: row.changes ?? [],
  }));
  const inWindow = trail.filter((entry) => entry.at < to);

  // ── One fine at a time ──
  const byFine = new Map<string, AuditTrailEntry[]>();
  for (const entry of inWindow) {
    if (!ROW_ID.test(entry.entityId)) continue;
    byFine.set(entry.entityId, [...(byFine.get(entry.entityId) ?? []), entry]);
  }
  outcome.entries.fines = byFine.size;
  const swept =
    byFine.size === 0
      ? []
      : await FleetViolationModel.find({
          _id: { $in: [...byFine.keys()].map((id) => new Types.ObjectId(id)) },
          isDeleted: true,
          deletedBy: null,
          createdAt: { $lt: from },
          deletedAt: { $gte: from },
          fromOldBook: { $ne: true },
        })
          .lean<FleetViolationDoc[]>()
          .exec();
  if (swept.length > 0) {
    const twins = new Map<string, FleetViolationDoc[]>();
    for (const doc of await FleetViolationModel.find({ fromOldBook: true, isDeleted: false })
      .lean<FleetViolationDoc[]>()
      .exec()) {
      const key = twinKey(doc);
      twins.set(key, [...(twins.get(key) ?? []), doc]);
    }
    // ONE FINE AT A TIME, each on its own: a fine this step cannot read (the first run failed the
    // whole restore on one) is listed, and the next fine is still restored.
    const restoreOne = async (row: FleetViolationDoc): Promise<void> => {
      const edits = foldFineEdits(byFine.get(String(row._id)) ?? []);
      for (const field of edits.unreadable) outcome.unreadable.push(`${String(row._id)}: ${field}`);
      if (Object.keys(edits.after).length === 0 && edits.deleted === null) return;
      const then = atCutoff(row, edits);
      const twin = twins.get(twinKey(then))?.shift();
      if (twin === undefined) {
        const code =
          then.vehicleCode ??
          (then.vehicleId == null ? '—' : (codeOfId.get(String(then.vehicleId)) ?? '—'));
        const when =
          then.kind === 'vehicle'
            ? String(then.year ?? '—')
            : (then.date?.toISOString().slice(0, 10) ?? '—');
        outcome.noTwin.push(`${code} ${when}: ${then.amount}`);
        return;
      }
      if (edits.deleted !== null) {
        const written = await FleetViolationModel.updateOne(
          { _id: twin._id, isDeleted: false },
          {
            $set: {
              isDeleted: true,
              deletedAt: edits.deleted.at,
              deletedBy: edits.deleted.by === '' ? null : new Types.ObjectId(edits.deleted.by),
            },
            $inc: { __v: 1 },
          },
        ).exec();
        if (written.modifiedCount === 1) outcome.deletedAgain += 1;
        return;
      }
      const set: Record<string, unknown> = {};
      for (const field of Object.keys(edits.after) as RestorableField[]) {
        if (!sameStored((twin as unknown as Record<string, unknown>)[field], edits.before[field])) {
          outcome.keptSinceReload.push(`${String(twin._id)}: ${field}`);
          return;
        }
        set[field] = edits.after[field];
      }
      if (Object.keys(set).length === 0) return;
      // The twin as it was read, field by field, rides inside the write: a person correcting it in
      // the meantime keeps their correction.
      const guard: Record<string, unknown> = { _id: twin._id, isDeleted: false, __v: twin.__v };
      const written = await FleetViolationModel.updateOne(guard, {
        $set: set,
        $inc: { __v: 1 },
      }).exec();
      if (written.modifiedCount === 1) {
        for (const field of Object.keys(set) as RestorableField[]) {
          outcome.restored[field] = (outcome.restored[field] ?? 0) + 1;
        }
      } else {
        for (const field of Object.keys(set))
          outcome.keptSinceReload.push(`${String(twin._id)}: ${field}`);
      }
    };
    for (const row of swept) {
      try {
        await restoreOne(row);
      } catch (error) {
        outcome.failures.push(
          `${String(row._id)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  // ── A car's whole year ──
  const lastTick = new Map<string, boolean>();
  for (const entry of inWindow) {
    if (!YEAR_TICK.test(entry.entityId)) continue;
    const collected = entry.changes.find((change) => change.field === 'collected');
    if (collected === undefined) continue;
    lastTick.set(entry.entityId, collected.new === true);
  }
  outcome.entries.yearTicks = lastTick.size;
  const tickedSince = new Set(
    trail
      .filter((entry) => entry.at >= to && YEAR_TICK.test(entry.entityId))
      .map((entry) => entry.entityId),
  );
  for (const [block, collected] of lastTick) {
    const [, vehicleId, year] = YEAR_TICK.exec(block) as RegExpExecArray;
    const label = `${codeOfId.get(vehicleId as string) ?? '—'} ${year}`;
    if (tickedSince.has(block)) {
      outcome.laterTicks.push(label);
      continue;
    }
    try {
      const written = await FleetViolationModel.updateMany(
        {
          isDeleted: false,
          fromOldBook: true,
          vehicleId: new Types.ObjectId(vehicleId),
          collected: { $ne: collected },
          $or: violationYearBranches([Number(year)]),
        },
        { $set: { collected }, $inc: { __v: 1 } },
      ).exec();
      outcome.yearTicksRestored += written.modifiedCount;
    } catch (error) {
      outcome.failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return outcome;
};
