// الأدوار — floors, used to group vaults on the visual board (gold `controllers/floor.controller.js`).
// Deleting a floor DETACHES its vaults rather than blocking or cascading: a floor is a grouping,
// and losing the grouping must never risk the vaults. That is the gold behaviour, unchanged.
import { type CreateGoldFloor, type ReorderGoldItems, type UpdateGoldFloor } from '@ecms/contracts';
import { Types } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { diffChanges } from '../../../shared/utils/diff';
import { type AuthContext, type ScopeSelector } from '../../../shared/types';
import { resolveCreateBranchId } from '../shared/ecms-refs';
import { goldVaultRepository } from '../vaults/vault.repository';
import { goldFloorRepository } from './floor.repository';
import { type GoldFloorDoc } from './floor.model';

const entityRef = (id: string) => ({ moduleId: 'gold', entityType: 'floor', entityId: id });

const snapshot = (doc: GoldFloorDoc) => ({
  name: doc.name,
  order: doc.order,
  branchId: doc.branchId === null ? null : String(doc.branchId),
});

class GoldFloorService {
  async list(scope: ScopeSelector): Promise<GoldFloorDoc[]> {
    return goldFloorRepository.listOrdered(scope);
  }

  async create(input: CreateGoldFloor, ctx: AuthContext): Promise<GoldFloorDoc> {
    const count = await goldFloorRepository.count();
    const branchId = await resolveCreateBranchId(ctx);
    const doc = await goldFloorRepository.create(
      {
        name: input.name,
        order: input.order ?? count,
        branchId: branchId === null ? null : new Types.ObjectId(branchId),
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

  async update(
    id: string,
    input: UpdateGoldFloor,
    by: string,
    scope: ScopeSelector,
  ): Promise<GoldFloorDoc> {
    const before = await goldFloorRepository.getById(id, scope);
    const set: Partial<GoldFloorDoc> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.order !== undefined) set.order = input.order;
    const updated = await goldFloorRepository.updateById(id, set, {
      by,
      version: input.version,
      scope,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }

  /** The ▲▼ buttons: a pair of (id, order) swaps, applied as given. */
  async reorder(input: ReorderGoldItems): Promise<void> {
    await Promise.all(
      input.items.map(async (item) => goldFloorRepository.setOrder(item.id, item.order)),
    );
  }

  async remove(id: string, by: string, scope: ScopeSelector): Promise<void> {
    await goldFloorRepository.getById(id, scope);
    await goldFloorRepository.softDeleteById(id, { by, scope });
    // The vaults survive the floor — they simply stop belonging to one.
    await goldVaultRepository.detachFloor(id);
    await auditService.record({ entityRef: entityRef(id), action: 'delete', changes: [] });
  }
}

export const goldFloorService = new GoldFloorService();
