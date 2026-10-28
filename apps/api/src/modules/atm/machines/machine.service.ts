// Machine master behaviour — the legacy /data_edit_atm machine forms (contad_app.js:2404-2544)
// plus the /all_atm read (:2552-2594), ported by parity:
//
//   · bulk add skips codes already registered instead of erroring (:2429-2451) — the result now
//     NAMES the skipped codes instead of skipping silently;
//   · delete is soft AND renames the code to `<code>-D` (:2500), which is what lets the code be
//     registered again later;
//   · area reassignment rewrites the machine's area string (:2529-2541). Open operations keep
//     the area they were opened with — legacy operations snapshot the machine at open and are
//     never rewritten by a master edit.
//
// The Efficiency register controls which machines exist (D2, docs/12-planning/
// atm-efficiency-register.md §7.1): add, bulk add, delete-by-codes, archive and reassign stay the
// administrator's (`atmMachine.manage`); Operations keep the legacy «نقل ماكينة لمنطقة» as its own
// area-only write, `moveArea` (DEC-3). Every AREA write — `update`, `reassignArea`, `moveArea` —
// carries the area onto the machine's OPEN register entries in the same transaction (DEC-4); a
// name or bank edit does not flow back into the register (DEC-4 is unchanged: an edit is a
// correction of the master, not a receipt). Audit rows are recorded once, after commit.
//
// An ADD is recorded in the register (DEC-36, the owner's call): an OPEN receipt dated the add day,
// linked and flagged «بيانات ناقصة» — `register/operations-intake.ts`, one unit per machine. Since
// the add now writes the company-wide register, `manage` must reach the acting branch
// (`manageActsInBranch`), a code active or open in another branch is refused (the mail matcher
// needs one active machine per code, DEC-9; one open period per code, D6), and an ARCHIVED code
// here is brought back to work instead of answering 409 (critic gap 1 — a machine handed back and
// returned could not be re-added by Operations). Every area a machine write leaves on an active
// machine gets a data-edit label after commit (DEC-38, `ensureAreaLabels`).
import {
  ATM_MACHINE_SORT_FIELDS,
  normalizeAtmMachineCode,
  type AtmMachineBulkRefusal,
  type AtmMachineRegisterReason,
  type AtmMachinesSummaryDto,
  type BulkCreateAtmMachines,
  type BulkDeleteAtmMachines,
  type CreateAtmMachine,
  type UpdateAtmMachine,
  type UpdateAtmMachineArea,
  type ListAtmMachinesQuery,
  type Paginated,
  type ReassignAtmMachineArea,
} from '@ecms/contracts';
import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { type AuthContext, type ScopeSelector } from '../../../shared/types';
import { hasPermission, keyReachesBranch, scopeSelector } from '../../../shared/types';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import {
  ensureMachineVersioned,
  machineSnapshot,
  syncMasterAreaToEntries,
  type PendingAudit,
} from '../register/register-coupling';
import { ensureAreaLabels } from '../catalogs/area-labels';
import {
  IntakeRefusal,
  recordOperationsIntake,
  removeUntouchedIntakeStubs,
  resolveIntakeBank,
  type OperationsIntakeResult,
} from '../register/operations-intake';
import { resolveRegisterSettings } from '../register/register-settings';
import { manageActsInBranch, resolveAtmBranchId } from '../shared/atm-context';
import { boardNames, storedSpellingsOf } from '../shared/board-filter';
import {
  allOf,
  machineFilterClauses,
  type AtmMachineFacet,
  type AtmMachineFilterQuery,
  type AtmMachineSpellings,
} from './machine-filter';
import { atmMachineRepository } from './machine.repository';
import { type AtmMachineDoc } from './machine.model';

const entityRef = (id: string) => ({ moduleId: 'atm', entityType: 'machine', entityId: id });

/**
 * The machine's audit snapshot. ONE definition, shared with the register coupling, so a
 * register-driven change reads in the machine's history exactly like an Operations one.
 */
export const snapshot = machineSnapshot;

/**
 * One versioned master write plus, when it moved the area, the open register entries following it
 * (DEC-4) — all in the caller's transaction. A legacy row without `__v`/timestamps is backfilled
 * first (DEC-23), so the version the client read (`__v ?? 0`) matches. Returns the audits owed.
 */
const writeMaster = async (
  before: AtmMachineDoc,
  set: Record<string, unknown>,
  meta: {
    by: string;
    version: number;
    scope?: ScopeSelector;
    session: ClientSession;
  },
): Promise<{ updated: AtmMachineDoc; audits: PendingAudit[] }> => {
  await ensureMachineVersioned(before._id, meta.session);
  const updated = await atmMachineRepository.updateById(String(before._id), set, meta);
  const audits: PendingAudit[] = [
    {
      entityRef: entityRef(String(before._id)),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    },
  ];
  if (updated.area !== before.area) {
    audits.push(
      ...(await syncMasterAreaToEntries(before._id, updated.area, meta.by, meta.session)),
    );
  }
  return { updated, audits };
};

const recordAll = async (audits: readonly PendingAudit[]): Promise<void> => {
  for (const audit of audits) await auditService.record(audit);
};

/**
 * After a master write COMMITTED: its audits, then — when it left an active machine on an area it
 * did not carry before (moved, or brought back from the archive) — that area's data-edit label
 * (DEC-38; best effort, never fails the write).
 */
const settleMasterWrite = async (
  before: AtmMachineDoc,
  updated: AtmMachineDoc,
  audits: readonly PendingAudit[],
  actorId: string,
): Promise<void> => {
  await recordAll(audits);
  if (updated.isActive && (updated.area !== before.area || !before.isActive)) {
    await ensureAreaLabels([{ branchId: updated.branchId, area: updated.area }], {
      actorId,
      origin: 'machine',
    });
  }
};

/** The data-edit add's branch: the acting one, and `manage` must reach it (DEC-39). */
const addBranchOf = async (ctx: AuthContext): Promise<string> => {
  const branchId = await resolveAtmBranchId(ctx);
  if (!manageActsInBranch(ctx, branchId)) {
    throw new ForbiddenError('atmMachine.manage does not reach this branch');
  }
  return branchId;
};

export interface AtmMachineBulkCreateResult {
  created: AtmMachineDoc[];
  skippedCodes: string[];
  reactivatedCodes: string[];
  refused: { machineCode: string; reason: AtmMachineBulkRefusal }[];
  register: {
    created: string[];
    received: string[];
    linked: string[];
    existing: string[];
    notRecorded: { machineCode: string; reason: AtmMachineRegisterReason }[];
  };
}

/**
 * The stored spellings the chosen bank and area names stand for, over every machine in the
 * caller's scope (`storedSpellingsOf`): «NBE» and «NBE » are one bank on screen, so one filter.
 */
const spellingsFor = async (
  query: AtmMachineFilterQuery,
  scope: ScopeSelector,
): Promise<AtmMachineSpellings> => {
  const resolve = async (
    field: 'bankName' | 'area',
    requested: readonly string[] | undefined,
  ): Promise<string[] | undefined> =>
    requested === undefined || requested.length === 0
      ? undefined
      : storedSpellingsOf(await atmMachineRepository.distinctIn(field, {}, scope), requested);
  const [bankName, area] = await Promise.all([
    resolve('bankName', query.banks),
    resolve('area', query.areas),
  ]);
  return { bankName, area };
};

class AtmMachineService {
  /**
   * The machine list — /all_atm's every ACTIVE machine of the branch when the screen asks
   * `isActive=true` — narrowed by the column filters (`machine-filter.ts`) and sorted by any of the
   * table's columns, in the caller's `atmMachine.view` scope.
   */
  async list(query: ListAtmMachinesQuery, ctx: AuthContext): Promise<Paginated<AtmMachineDoc>> {
    const scope = scopeSelector(ctx, 'atmMachine.view');
    const filter = allOf(machineFilterClauses(query, await spellingsFor(query, scope)));
    return atmMachineRepository.list({
      filter: filter as FilterQuery<AtmMachineDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: [...ATM_MACHINE_SORT_FIELDS, 'createdAt'],
      scope,
    });
  }

  /**
   * What the list's filter matched, counted over the WHOLE filtered set in the caller's scope —
   * how many machines, how many distinct banks and areas among them — and what each dropdown
   * offers: the names of the machines matching every OTHER filter (`AtmMachinesSummaryDto`).
   */
  async summary(query: AtmMachineFilterQuery, ctx: AuthContext): Promise<AtmMachinesSummaryDto> {
    const scope = scopeSelector(ctx, 'atmMachine.view');
    const spellings = await spellingsFor(query, scope);
    const where = (leave?: AtmMachineFacet): FilterQuery<AtmMachineDoc> =>
      allOf(machineFilterClauses(query, spellings, leave)) as FilterQuery<AtmMachineDoc>;
    const [machines, banks, areas, bankOptions, areaOptions] = await Promise.all([
      atmMachineRepository.count(where(), scope),
      atmMachineRepository.distinctIn('bankName', where(), scope),
      atmMachineRepository.distinctIn('area', where(), scope),
      atmMachineRepository.distinctIn('bankName', where('banks'), scope),
      atmMachineRepository.distinctIn('area', where('areas'), scope),
    ]);
    return {
      counts: { machines, banks: boardNames(banks).length, areas: boardNames(areas).length },
      options: { banks: boardNames(bankOptions), areas: boardNames(areaOptions) },
    };
  }

  /**
   * The legacy bulk paste (:2412-2466): one bank and one area for the batch. A code already ACTIVE
   * in the branch is skipped and named (`skippedCodes`), as the legacy skipped it; an archived one is
   * brought back with the batch's data (`reactivatedCodes`); one active or open in another branch is
   * refused (`refused`). Each row is its own unit, so one refusal does not undo the rest; the
   * settings, the catalog and the bank are read once for the batch.
   */
  async bulkCreate(
    input: BulkCreateAtmMachines,
    ctx: AuthContext,
  ): Promise<AtmMachineBulkCreateResult> {
    const branchId = await addBranchOf(ctx);
    const settings = await resolveRegisterSettings();
    const bank = await resolveIntakeBank(branchId, input.bankName, settings.catalog);
    const result: AtmMachineBulkCreateResult = {
      created: [],
      skippedCodes: [],
      reactivatedCodes: [],
      refused: [],
      register: { created: [], received: [], linked: [], existing: [], notRecorded: [] },
    };
    const seen = new Set<string>();
    for (const row of input.machines) {
      const machineCode = normalizeAtmMachineCode(row.machineCode);
      if (machineCode === '' || seen.has(machineCode)) continue;
      seen.add(machineCode);
      // ACTIVE here → skip, as legacy `findOne` did (:2429). The read keeps the skip a skip; a
      // concurrent add of the same code is caught below as the same skip.
      if ((await atmMachineRepository.findActiveByCode(branchId, machineCode)) !== null) {
        result.skippedCodes.push(machineCode);
        continue;
      }
      let added: OperationsIntakeResult;
      try {
        added = await recordOperationsIntake(
          {
            branchId,
            machineCode,
            name: row.name,
            area: input.area,
            bankName: input.bankName,
            bank,
          },
          ctx,
          settings,
        );
      } catch (error) {
        if (error instanceof IntakeRefusal && error.reason !== 'activeHere') {
          result.refused.push({ machineCode, reason: error.reason });
          continue;
        }
        if (error instanceof ConflictError) {
          result.skippedCodes.push(machineCode);
          continue;
        }
        throw error;
      }
      if (added.reactivated) result.reactivatedCodes.push(machineCode);
      else result.created.push(added.machine);
      const { action, reason } = added.register;
      if (action === 'none') {
        result.register.notRecorded.push({ machineCode, reason: reason ?? 'noBank' });
      } else {
        result.register[action].push(machineCode);
      }
    }
    if (result.created.length > 0 || result.reactivatedCodes.length > 0) {
      await ensureAreaLabels([{ branchId, area: input.area }], {
        actorId: ctx.userId,
        origin: 'machine',
      });
    }
    return result;
  }

  /**
   * Add ONE machine — the per-item entry beside the legacy bulk paste. A code already ACTIVE in the
   * branch is a 409 rather than a silent skip: a single deliberate add of a taken code is a mistake
   * worth telling the operator about, whereas a pasted batch that contains one known code is not
   * (:2429-2451). An archived code is brought back (`reactivated`), and the answer says what the
   * register recorded (DEC-36).
   */
  async create(input: CreateAtmMachine, ctx: AuthContext): Promise<OperationsIntakeResult> {
    const branchId = await addBranchOf(ctx);
    const machineCode = normalizeAtmMachineCode(input.machineCode);
    if (machineCode === '') throw new NotFoundError('ATM machine code');
    const settings = await resolveRegisterSettings();
    const bank = await resolveIntakeBank(branchId, input.bankName, settings.catalog);
    if ((await atmMachineRepository.findActiveByCode(branchId, machineCode)) !== null) {
      throw new ConflictError('ATM machine code already registered');
    }
    const added = await recordOperationsIntake(
      {
        branchId,
        machineCode,
        name: input.name,
        area: input.area,
        bankName: input.bankName,
        bank,
      },
      ctx,
      settings,
    );
    await ensureAreaLabels([{ branchId, area: input.area }], {
      actorId: ctx.userId,
      origin: 'machine',
    });
    return added;
  }

  /**
   * Edit one machine. `machineCode` is identity and is NOT editable: every replenishment,
   * maintenance and mail ticket snapshots it, and the mail matcher joins on it, so a rename
   * would orphan history silently. `isActive: false` archives instead of deleting — the machine
   * leaves the open forms and the mail matcher (both read active only) while its code stays
   * taken and its rows stay readable, which is exactly what delete does NOT do.
   */
  async update(id: string, input: UpdateAtmMachine, ctx: AuthContext): Promise<AtmMachineDoc> {
    const scope = scopeSelector(ctx, 'atmMachine.manage');
    const before = await atmMachineRepository.getById(id, scope);
    const set: Record<string, unknown> = {};
    if (input.bankName !== undefined) set.bankName = input.bankName;
    if (input.name !== undefined) set.name = input.name;
    if (input.area !== undefined) set.area = input.area;
    if (input.isActive !== undefined) set.isActive = input.isActive;
    // An administrator may archive or rename a master that has an open register entry (DEC-24 —
    // nothing removed); only the AREA follows onto the entry (DEC-4).
    const { updated, audits } = await unitOfWork((session) =>
      writeMaster(before, set, { by: ctx.userId, version: input.version, scope, session }),
    );
    await settleMasterWrite(before, updated, audits, ctx.userId);
    return updated;
  }

  /**
   * Operations' «نقل ماكينة لمنطقة» (contad_app.js:2529-2541), by id — the area and nothing else
   * (DEC-3). The key that authorizes it must reach the machine's branch (DEC-29): a
   * `moveArea` holder over that whole branch, or a `manage` holder who finds the machine in
   * today's `manage` scope (nothing a manage holder could do is removed). The machine repository
   * is branch-only, so a department or section scope alone would widen to the company — which is
   * why reach is asked of the key, not of a scoped read. Anything else is a 404: the machine is
   * not in the caller's world. Like `reassignArea`, the area is not checked against the label
   * list; the dialog offers active labels only.
   */
  async moveArea(
    id: string,
    input: UpdateAtmMachineArea,
    ctx: AuthContext,
  ): Promise<AtmMachineDoc> {
    const before = await atmMachineRepository.findById(id);
    if (before === null) throw new NotFoundError('ATM machine');
    const allowed =
      keyReachesBranch(ctx, 'atmMachine.moveArea', String(before.branchId)) ||
      (hasPermission(ctx, 'atmMachine.manage') &&
        (await atmMachineRepository.findById(id, scopeSelector(ctx, 'atmMachine.manage'))) !==
          null);
    if (!allowed) throw new NotFoundError('ATM machine');
    const { updated, audits } = await unitOfWork((session) =>
      writeMaster(
        before,
        { area: input.area },
        { by: ctx.userId, version: input.version, session },
      ),
    );
    await settleMasterWrite(before, updated, audits, ctx.userId);
    return updated;
  }

  /**
   * Legacy delete-by-codes textarea (:2494-2508): soft delete + `-D` rename, unknowns reported.
   *
   * Deleting is also how a mistyped code is fixed (delete, add again), and since DEC-36 every add
   * wrote an open register entry. So each code is ONE unit: the master's rename and delete plus the
   * removal of the untouched intake stub that add left (`removeUntouchedIntakeStubs`) — otherwise
   * the stub would keep counting in the Data Report and hold the code's company-wide open period.
   * Any other open entry stays and the delete is never refused (DEC-24). Because the delete now
   * writes the register, `manage` must reach the acting branch, exactly as for the add (DEC-39).
   */
  async bulkDelete(
    input: BulkDeleteAtmMachines,
    ctx: AuthContext,
  ): Promise<{ deletedCodes: string[]; unknownCodes: string[] }> {
    const branchId = await addBranchOf(ctx);
    const deletedCodes: string[] = [];
    const unknownCodes: string[] = [];
    for (const raw of input.machineCodes) {
      const machineCode = normalizeAtmMachineCode(raw);
      if (machineCode === '') continue;
      const existing = await atmMachineRepository.findOne({
        branchId: new Types.ObjectId(branchId),
        machineCode,
      } as FilterQuery<AtmMachineDoc>);
      if (existing === null) {
        unknownCodes.push(machineCode);
        continue;
      }
      const stubAudits = await unitOfWork(async (session) => {
        // A legacy row read before its backfill carries no `__v`; the backfill sets 0 (DEC-23).
        await ensureMachineVersioned(existing._id, session);
        // The rename rides the same optimistic write as the delete used to ride updateOne; doing
        // it first keeps the partial unique index free for a future re-add even mid-operation.
        await atmMachineRepository.updateById(
          existing._id.toString(),
          { machineCode: `${machineCode}-D` },
          {
            by: ctx.userId,
            version: (existing as Partial<AtmMachineDoc>).__v ?? 0,
            session,
          },
        );
        await atmMachineRepository.softDeleteById(existing._id.toString(), {
          by: ctx.userId,
          session,
        });
        return removeUntouchedIntakeStubs(existing, ctx.userId, session);
      });
      // After commit, once (`withTransaction` may run the callback twice). The entries' `delete`
      // also refreshes open register screens through the existing topic.
      await recordAll([
        {
          entityRef: entityRef(String(existing._id)),
          action: 'delete',
          changes: diffChanges(snapshot(existing), {}),
        },
        ...stubAudits,
      ]);
      deletedCodes.push(machineCode);
    }
    return { deletedCodes, unknownCodes };
  }

  async reassignArea(input: ReassignAtmMachineArea, ctx: AuthContext): Promise<AtmMachineDoc> {
    const branchId = await resolveAtmBranchId(ctx);
    const machineCode = normalizeAtmMachineCode(input.machineCode);
    const existing = await atmMachineRepository.findActiveByCode(branchId, machineCode);
    if (existing === null) throw new NotFoundError('ATM machine');
    const { updated, audits } = await unitOfWork((session) =>
      writeMaster(
        existing,
        { area: input.area },
        // A legacy row read before its backfill carries no `__v`; the backfill sets 0.
        { by: ctx.userId, version: (existing as Partial<AtmMachineDoc>).__v ?? 0, session },
      ),
    );
    await settleMasterWrite(existing, updated, audits, ctx.userId);
    return updated;
  }
}

export const atmMachineService = new AtmMachineService();
