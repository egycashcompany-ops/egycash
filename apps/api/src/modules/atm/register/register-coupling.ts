// The register controls machine existence (D2, spec §5.5): a receipt creates, reactivates or links
// the Operations master; a handover archives it; an edit of an open entry carries its name, area
// and bank label onto it; and an Operations area move carries the area back onto the open entries.
//
// Pure orchestration over `atm_machines` and the register. Every function takes the caller's
// `ClientSession` — it runs inside the caller's ONE `unitOfWork` — and RETURNS the audit rows it
// owes instead of recording them: an audit row is a queue write outside the session, and
// `withTransaction` may run the callback twice, so the caller records them once, after commit.
//
// LINK never writes the master (DEC-8): it adopts the master's bank label for the entry (D5) and
// lists where the name or area differ, so 2,607 Operations names are not rewritten at cut-over.
import { type AuditAction, type AuditChange, type EntityRef } from '@ecms/contracts';
import { Types, type ClientSession } from 'mongoose';
import { diffChanges } from '../../../shared/utils/diff';
import { AtmMachineModel, type AtmMachineDoc } from '../machines/machine.model';
import { atmMachineRepository } from '../machines/machine.repository';
import { type AtmRegisterEntryDoc } from './register.model';
import { atmRegisterEntryRepository } from './register.repository';

export interface PendingAudit {
  entityRef: EntityRef;
  action: AuditAction;
  changes: AuditChange[];
}

export interface CouplingOutcome {
  action: 'link' | 'reactivate' | 'create';
  machineId: Types.ObjectId;
  /** link only (D5): the master's `bankName`, which the entry adopts as its label. */
  adoptedBankLabel: string | null;
  /** link only (DEC-8): where the master and the entry disagree. Nothing is rewritten. */
  differences: ('name' | 'area')[];
  audits: PendingAudit[];
}

export interface CouplingRefusal {
  refused: 'activeElsewhere' | 'blankArea' | 'noName';
  /** activeElsewhere: the branch whose ACTIVE master holds the code (DEC-9). */
  otherBranchId?: string;
}

export const isCouplingRefusal = (
  result: CouplingOutcome | CouplingRefusal,
): result is CouplingRefusal => 'refused' in result;

/** `#`, `********` — the workbook's "no real code" markers (§6.3). Never coupled. */
export const isPlaceholderMachineCode = (code: string): boolean => /^[#*]+$/.test(code);

const machineRef = (id: string): EntityRef => ({
  moduleId: 'atm',
  entityType: 'machine',
  entityId: id,
});

/**
 * The machine audit snapshot — the same fields the machine service diffs
 * (machines/machine.service.ts `snapshot`), so a register-driven change reads in the machine's
 * history exactly like an Operations one.
 */
export const machineSnapshot = (doc: AtmMachineDoc) => ({
  branchId: String(doc.branchId),
  bankName: doc.bankName,
  machineCode: doc.machineCode,
  name: doc.name,
  area: doc.area,
  isActive: doc.isActive,
});

const liveMachine = async (
  filter: Record<string, unknown>,
  session: ClientSession,
): Promise<AtmMachineDoc | null> =>
  AtmMachineModel.findOne({ isDeleted: false, ...filter })
    .session(session)
    .lean<AtmMachineDoc>()
    .exec();

/**
 * DEC-23: a master written by `npm run atm:import` bypassed Mongoose and has no `__v` /
 * `createdAt` / `updatedAt` — every versioned write would miss it (409) and the mapper would throw.
 * Backfilled in place (raw driver, so Mongoose adds nothing), inside the caller's transaction.
 */
export const ensureMachineVersioned = async (
  machineId: Types.ObjectId,
  session: ClientSession,
): Promise<void> => {
  await AtmMachineModel.collection.updateOne(
    {
      _id: machineId,
      $or: [
        { __v: { $exists: false } },
        { createdAt: { $exists: false } },
        { updatedAt: { $exists: false } },
      ],
    },
    [
      {
        $set: {
          __v: { $ifNull: ['$__v', 0] },
          createdAt: { $ifNull: ['$createdAt', { $toDate: '$_id' }] },
          updatedAt: { $ifNull: ['$updatedAt', { $toDate: '$_id' }] },
        },
      },
    ],
    { session },
  );
};

/** The master re-read after `ensureMachineVersioned`, so its `__v` is the one a write must name. */
const versionedMaster = async (
  master: AtmMachineDoc,
  session: ClientSession,
): Promise<AtmMachineDoc> => {
  // A lean read of a raw-inserted row simply lacks the fields the type promises.
  const raw = master as Partial<AtmMachineDoc>;
  if (raw.__v !== undefined && raw.createdAt !== undefined && raw.updatedAt !== undefined) {
    return master;
  }
  await ensureMachineVersioned(master._id, session);
  return (await liveMachine({ _id: master._id }, session)) ?? master;
};

/**
 * RECEIVE (manual, pending → open, import): find or make the master this open period belongs to.
 * The order is the spec's, and it matters: an ACTIVE master with the code in ANOTHER branch refuses
 * first (DEC-9 — the mail matcher needs exactly one active machine per code), whatever this branch
 * holds.
 */
export const coupleReceipt = async (
  input: {
    branchId: string;
    machineCode: string;
    name: string | null;
    area: string | null;
    opsLabel: string;
  },
  actorId: string | null,
  session: ClientSession,
): Promise<CouplingOutcome | CouplingRefusal> => {
  const branchId = new Types.ObjectId(input.branchId);
  const elsewhere = await liveMachine(
    { isActive: true, machineCode: input.machineCode, branchId: { $ne: branchId } },
    session,
  );
  if (elsewhere !== null) {
    return { refused: 'activeElsewhere', otherBranchId: String(elsewhere.branchId) };
  }

  const found = await liveMachine({ branchId, machineCode: input.machineCode }, session);
  const master = found === null ? null : await versionedMaster(found, session);

  if (master !== null && master.isActive) {
    const differences: ('name' | 'area')[] = [];
    if (master.name !== input.name) differences.push('name');
    if (master.area !== input.area) differences.push('area');
    return {
      action: 'link',
      machineId: master._id,
      adoptedBankLabel: master.bankName,
      differences,
      audits: [],
    };
  }

  if (input.area === null) return { refused: 'blankArea' };
  if (input.name === null) return { refused: 'noName' };

  if (master !== null) {
    const updated = await atmMachineRepository.updateById(
      String(master._id),
      { isActive: true, name: input.name, area: input.area, bankName: input.opsLabel },
      { by: actorId, version: master.__v, session },
    );
    return {
      action: 'reactivate',
      machineId: master._id,
      adoptedBankLabel: null,
      differences: [],
      audits: [
        {
          entityRef: machineRef(String(master._id)),
          action: 'update',
          changes: diffChanges(machineSnapshot(master), machineSnapshot(updated)),
        },
      ],
    };
  }

  const created = await atmMachineRepository.create(
    {
      branchId,
      bankName: input.opsLabel,
      machineCode: input.machineCode,
      name: input.name,
      zone: '',
      area: input.area,
      isActive: true,
    },
    { by: actorId, session },
  );
  return {
    action: 'create',
    machineId: created._id,
    adoptedBankLabel: null,
    differences: [],
    audits: [
      {
        entityRef: machineRef(String(created._id)),
        action: 'create',
        changes: diffChanges({}, machineSnapshot(created)),
      },
    ],
  };
};

/**
 * HANDOVER / DELETE: archive the master when no OTHER open entry still holds it (D2). The code stays
 * reserved (`isActive:false`, not deleted), so a later receipt of the same machine reactivates the
 * same row.
 */
export const archiveIfLastOpen = async (
  entry: Pick<AtmRegisterEntryDoc, '_id' | 'machineId'>,
  actorId: string | null,
  session: ClientSession,
): Promise<PendingAudit[]> => {
  if (entry.machineId === null) return [];
  const others = await atmRegisterEntryRepository.countOtherOpenForMachine(
    entry.machineId,
    entry._id,
    session,
  );
  if (others > 0) return [];
  const found = await liveMachine({ _id: entry.machineId }, session);
  if (found === null || !found.isActive) return [];
  const master = await versionedMaster(found, session);
  const updated = await atmMachineRepository.updateById(
    String(master._id),
    { isActive: false },
    { by: actorId, version: master.__v, session },
  );
  return [
    {
      entityRef: machineRef(String(master._id)),
      action: 'update',
      changes: diffChanges(machineSnapshot(master), machineSnapshot(updated)),
    },
  ];
};

/**
 * EDIT of an OPEN, linked entry: copy what THIS edit changed — name, area, effective bank label —
 * onto the master (D2). Never touches `isActive`: a master an administrator archived stays
 * archived, and the drift shows as `masterState` (DEC-24). An empty value is never copied.
 */
export const syncEntryToMaster = async (
  before: Pick<AtmRegisterEntryDoc, 'name' | 'area'>,
  after: Pick<AtmRegisterEntryDoc, 'status' | 'machineId' | 'name' | 'area'>,
  opsLabelBefore: string | null,
  opsLabelAfter: string | null,
  actorId: string | null,
  session: ClientSession,
): Promise<PendingAudit[]> => {
  if (after.status !== 'open' || after.machineId === null) return [];
  const set: Record<string, unknown> = {};
  if (after.name !== before.name && after.name !== null) set.name = after.name;
  if (after.area !== before.area && after.area !== null) set.area = after.area;
  if (opsLabelAfter !== opsLabelBefore && opsLabelAfter !== null) set.bankName = opsLabelAfter;
  if (Object.keys(set).length === 0) return [];
  const found = await liveMachine({ _id: after.machineId }, session);
  if (found === null) return [];
  const master = await versionedMaster(found, session);
  const updated = await atmMachineRepository.updateById(String(master._id), set, {
    by: actorId,
    version: master.__v,
    session,
  });
  const changes = diffChanges(machineSnapshot(master), machineSnapshot(updated));
  return changes.length === 0
    ? []
    : [{ entityRef: machineRef(String(master._id)), action: 'update', changes }];
};

/** Why an entry cannot even be offered to `coupleReceipt` (DEC-30) — the request is wrong, not the data. */
export type UncoupledPrecondition = 'notOpen' | 'alreadyLinked' | 'noBranch' | 'noCode' | 'noBank';

export const uncoupledPrecondition = (
  entry: Pick<
    AtmRegisterEntryDoc,
    'status' | 'machineId' | 'branchId' | 'machineCode' | 'bankCode'
  >,
): UncoupledPrecondition | null => {
  if (entry.status !== 'open') return 'notOpen';
  if (entry.machineId !== null) return 'alreadyLinked';
  if (entry.branchId === null) return 'noBranch';
  if (entry.machineCode === null || isPlaceholderMachineCode(entry.machineCode)) return 'noCode';
  if (entry.bankCode === null) return 'noBank';
  return null;
};

/**
 * DEFERRED COUPLING (DEC-30): an OPEN entry with no master — an imported `blankArea` /
 * `activeElsewhere` / `noName` row, or one whose category was not approved — goes through the
 * receipt path with the same refusals. The CALLER checks `uncoupledPrecondition` first and, on
 * success, sets `machineId` (plus the adopted label on a link) in its own update.
 */
export const linkUncoupled = async (
  entry: Pick<AtmRegisterEntryDoc, 'branchId' | 'machineCode' | 'name' | 'area'>,
  opsLabel: string,
  actorId: string | null,
  session: ClientSession,
): Promise<CouplingOutcome | CouplingRefusal> =>
  coupleReceipt(
    {
      branchId: String(entry.branchId),
      machineCode: String(entry.machineCode),
      name: entry.name,
      area: entry.area,
      opsLabel,
    },
    actorId,
    session,
  );

/**
 * OPERATIONS AREA CHANGE (DEC-4): the master's open entries follow its area, whichever key moved
 * it. Each entry is written with its own version; the audit is the entry's own `update`.
 */
export const syncMasterAreaToEntries = async (
  machineId: Types.ObjectId | string,
  area: string,
  actorId: string | null,
  session: ClientSession,
): Promise<PendingAudit[]> => {
  const open = await atmRegisterEntryRepository.findOpenForMachine(machineId, session);
  const audits: PendingAudit[] = [];
  for (const entry of open) {
    if (entry.area === area) continue;
    await atmRegisterEntryRepository.updateById(
      String(entry._id),
      { area },
      { by: actorId, version: entry.__v, session },
    );
    audits.push({
      entityRef: { moduleId: 'atm', entityType: 'registerEntry', entityId: String(entry._id) },
      action: 'update',
      changes: [{ field: 'area', old: entry.area, new: area }],
    });
  }
  return audits;
};
