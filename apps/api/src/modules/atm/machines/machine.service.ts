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
import {
  normalizeAtmMachineCode,
  type BulkCreateAtmMachines,
  type BulkDeleteAtmMachines,
  type ListAtmMachinesQuery,
  type Paginated,
  type ReassignAtmMachineArea,
} from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { type AuthContext } from '../../../shared/types';
import { scopeSelector } from '../../../shared/types';
import { NotFoundError } from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import { resolveAtmBranchId } from '../shared/atm-context';
import { atmMachineRepository } from './machine.repository';
import { type AtmMachineDoc } from './machine.model';

const entityRef = (id: string) => ({ moduleId: 'atm', entityType: 'machine', entityId: id });

const snapshot = (doc: AtmMachineDoc) => ({
  branchId: String(doc.branchId),
  bankName: doc.bankName,
  machineCode: doc.machineCode,
  name: doc.name,
  area: doc.area,
  isActive: doc.isActive,
});

class AtmMachineService {
  async list(query: ListAtmMachinesQuery, ctx: AuthContext): Promise<Paginated<AtmMachineDoc>> {
    const filter: FilterQuery<AtmMachineDoc> = {};
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.bankName !== undefined) filter.bankName = query.bankName;
    if (query.area !== undefined) filter.area = query.area;
    if (query.search !== undefined && query.search !== '') {
      filter.$or = [
        { machineCode: { $regex: query.search, $options: 'i' } },
        { name: { $regex: query.search, $options: 'i' } },
      ];
    }
    return atmMachineRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['machineCode', 'bankName', 'area', 'name', 'createdAt'],
      scope: scopeSelector(ctx, 'atmMachine.view'),
    });
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
    const updated = await atmMachineRepository.updateById(
      existing._id.toString(),
      { area: input.area },
      { by: ctx.userId, version: existing.__v },
    );
    await auditService.record({
      entityRef: entityRef(String(existing._id)),
      action: 'update',
      changes: diffChanges(snapshot(existing), snapshot(updated)),
    });
    return updated;
  }
}

export const atmMachineService = new AtmMachineService();
