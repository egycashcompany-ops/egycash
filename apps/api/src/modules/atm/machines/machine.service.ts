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
// name or bank edit does not flow back into the register (the register's bank is an enum the
// Operations label cannot be mapped back to). Audit rows are recorded once, after commit.
import {
  ATM_MACHINE_SORT_FIELDS,
  normalizeAtmMachineCode,
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
import { ConflictError, NotFoundError } from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import {
  ensureMachineVersioned,
  machineSnapshot,
  syncMasterAreaToEntries,
  type PendingAudit,
} from '../register/register-coupling';
import { resolveAtmBranchId } from '../shared/atm-context';
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

  async bulkCreate(
    input: BulkCreateAtmMachines,
    ctx: AuthContext,
  ): Promise<{ created: AtmMachineDoc[]; skippedCodes: string[] }> {
    const branchId = await resolveAtmBranchId(ctx);
    const created: AtmMachineDoc[] = [];
    const skippedCodes: string[] = [];
    const seen = new Set<string>();
    for (const row of input.machines) {
      const machineCode = normalizeAtmMachineCode(row.machineCode);
      if (machineCode === '' || seen.has(machineCode)) continue;
      seen.add(machineCode);
      // Existing (active OR deactivated, but not soft-deleted) → skip, as legacy `findOne` did
      // (:2429). The unique index is the racproof backstop; the read keeps the skip a skip
      // rather than a 409.
      const existing = await atmMachineRepository.findOne({
        branchId: new Types.ObjectId(branchId),
        machineCode,
      } as FilterQuery<AtmMachineDoc>);
      if (existing !== null) {
        skippedCodes.push(machineCode);
        continue;
      }
      const doc = await atmMachineRepository.create(
        {
          branchId: new Types.ObjectId(branchId),
          bankName: input.bankName,
          machineCode,
          name: row.name,
          zone: '',
          area: input.area,
          isActive: true,
        },
        { by: ctx.userId },
      );
      await auditService.record({
        entityRef: entityRef(String(doc._id)),
        action: 'create',
        changes: diffChanges({}, snapshot(doc)),
      });
      created.push(doc);
    }
    return { created, skippedCodes };
  }

  /**
   * Add ONE machine — the per-item entry beside the legacy bulk paste. Same skip rule as the
   * bulk form, surfaced as a conflict rather than a silent skip: a single deliberate add of a
   * code that is already taken is a mistake worth telling the operator about, whereas a pasted
   * batch that contains one known code is not (:2429-2451).
   */
  async create(input: CreateAtmMachine, ctx: AuthContext): Promise<AtmMachineDoc> {
    const branchId = await resolveAtmBranchId(ctx);
    const machineCode = normalizeAtmMachineCode(input.machineCode);
    if (machineCode === '') throw new NotFoundError('ATM machine code');
    const existing = await atmMachineRepository.findOne({
      branchId: new Types.ObjectId(branchId),
      machineCode,
    } as FilterQuery<AtmMachineDoc>);
    if (existing !== null) throw new ConflictError('ATM machine code already registered');
    const doc = await atmMachineRepository.create(
      {
        branchId: new Types.ObjectId(branchId),
        bankName: input.bankName,
        machineCode,
        name: input.name,
        zone: '',
        area: input.area,
        isActive: true,
      },
      { by: ctx.userId },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return doc;
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
    await recordAll(audits);
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
    await recordAll(audits);
    return updated;
  }

  /** Legacy delete-by-codes textarea (:2494-2508): soft delete + `-D` rename, unknowns reported. */
  async bulkDelete(
    input: BulkDeleteAtmMachines,
    ctx: AuthContext,
  ): Promise<{ deletedCodes: string[]; unknownCodes: string[] }> {
    const branchId = await resolveAtmBranchId(ctx);
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
      // The rename rides the same optimistic write as the delete used to ride updateOne; doing
      // it first keeps the partial unique index free for a future re-add even mid-operation.
      await atmMachineRepository.updateById(
        existing._id.toString(),
        {
          machineCode: `${machineCode}-D`,
        },
        { by: ctx.userId, version: existing.__v },
      );
      await atmMachineRepository.softDeleteById(existing._id.toString(), { by: ctx.userId });
      await auditService.record({
        entityRef: entityRef(String(existing._id)),
        action: 'delete',
        changes: diffChanges(snapshot(existing), {}),
      });
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
    await recordAll(audits);
    return updated;
  }
}

export const atmMachineService = new AtmMachineService();
