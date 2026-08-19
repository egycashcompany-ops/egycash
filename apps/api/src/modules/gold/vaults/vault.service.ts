// الخزائن — vaults and their drawer grids (gold `controllers/vault.controller.js`).
//
// Three rules in this file are the ones that keep stored metal safe, and all three are the gold
// system's own:
//
//   · A vault holding bars cannot be deleted, and its layout cannot be REGENERATED — regeneration
//     deletes every drawer, which would orphan the inventory sitting in them.
//   · RESHAPE exists precisely so a layout can be corrected without that: it moves drawers in
//     place, keeps their numbers, and is therefore allowed only when the drawer count and the
//     numbering start are unchanged. Bars stay exactly where they are.
//   · The two-phase reshape (park every drawer in negative coordinates, then place them from the
//     LAST number down) is not a flourish — {vault, row, col} is unique, so without the parking
//     phase a shuffle would collide with itself mid-flight.
import {
  type CreateGoldVault,
  type GenerateGoldLayout,
  type ListGoldVaultsQuery,
  type Paginated,
  type PreviewGoldLayout,
  type ReorderGoldItems,
  type UpdateGoldVault,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { goldBarRepository } from '../bars/bar.repository';
import { drawerLabeller, generateDrawers, type GeneratedDrawer } from '../shared/drawer-numbering';
import { resolveCreateBranchId } from '../shared/ecms-refs';
import { goldDrawerRepository } from './drawer.repository';
import { type GoldDrawerDoc } from './drawer.model';
import { goldVaultRepository } from './vault.repository';
import { type GoldVaultDoc, type GoldVaultLayoutSub } from './vault.model';

const entityRef = (id: string) => ({ moduleId: 'gold', entityType: 'vault', entityId: id });

const snapshot = (doc: GoldVaultDoc) => ({
  name: doc.name,
  code: doc.code,
  description: doc.description,
  status: doc.status,
  floorId: doc.floorId === null ? null : String(doc.floorId),
  order: doc.order,
  layout: doc.layout,
});

const toLayout = (input: GenerateGoldLayout, limit: number): GoldVaultLayoutSub => ({
  rows: input.rows,
  cols: input.cols,
  orientation: input.orientation,
  horizontalDirection: input.horizontalDirection,
  verticalDirection: input.verticalDirection,
  startNumber: input.startNumber,
  drawerWeightLimit: limit,
});

class GoldVaultService {
  async list(query: ListGoldVaultsQuery, scope: ScopeSelector): Promise<Paginated<GoldVaultDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.status !== undefined) filter.status = query.status;
    if (query.search !== undefined && query.search !== '') {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: pattern }, { code: pattern }];
    }
    // Default listing keeps gold's own sequence, ties included; an explicit ?sortBy goes through
    // the platform seam like every other list.
    if (query.sortBy === undefined) {
      return goldVaultRepository.listInGoldOrder({
        filter,
        page: query.page,
        pageSize: query.pageSize,
        scope,
      });
    }
    return goldVaultRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['order', 'createdAt', 'name'],
      scope,
    });
  }

  async getById(id: string, scope: ScopeSelector): Promise<GoldVaultDoc> {
    return goldVaultRepository.getById(id, scope);
  }

  async drawerCount(vaultId: string): Promise<number> {
    return goldDrawerRepository.countForVault(vaultId);
  }

  /**
   * The vault NAME doubles as its code, uniquified server-side by appending a counter — so an
   * operator never has to manage a separate code field, and drawer labels stay unambiguous.
   */
  async create(input: CreateGoldVault, ctx: AuthContext): Promise<GoldVaultDoc> {
    const base = (input.code ?? input.name).trim();
    let finalCode = base;
    let n = 2;
    while (await goldVaultRepository.codeTaken(finalCode)) {
      finalCode = `${base} ${String(n)}`;
      n += 1;
    }
    const branchId = await resolveCreateBranchId(ctx);
    const order = input.order ?? (await goldVaultRepository.count());
    const doc = await goldVaultRepository.create(
      {
        name: input.name,
        code: finalCode,
        description: input.description ?? null,
        status: input.status ?? 'active',
        floorId:
          input.floorId === undefined || input.floorId === null
            ? null
            : new Types.ObjectId(input.floorId),
        order,
        branchId: branchId === null ? null : new Types.ObjectId(branchId),
        layout: null,
        drawersGenerated: false,
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

  /** Metadata only — the layout is changed through generate / reshape, never here. */
  async update(
    id: string,
    input: UpdateGoldVault,
    by: string,
    scope: ScopeSelector,
  ): Promise<GoldVaultDoc> {
    const before = await goldVaultRepository.getById(id, scope);
    const set: Partial<GoldVaultDoc> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.description !== undefined) set.description = input.description ?? null;
    if (input.status !== undefined) set.status = input.status;
    if (input.order !== undefined) set.order = input.order;
    if (input.floorId !== undefined) {
      set.floorId = input.floorId === null ? null : new Types.ObjectId(input.floorId);
    }
    const updated = await goldVaultRepository.updateById(id, set, {
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

  private async storedBars(vaultId: string): Promise<number> {
    return goldBarRepository.count({
      currentVaultId: new Types.ObjectId(vaultId),
      status: 'in_vault',
    } as never);
  }

  async remove(id: string, by: string, scope: ScopeSelector): Promise<void> {
    await goldVaultRepository.getById(id, scope);
    const stored = await this.storedBars(id);
    if (stored > 0) {
      throw new ConflictError(`Vault still stores ${String(stored)} bar(s); empty it first`);
    }
    await goldVaultRepository.softDeleteById(id, { by, scope });
    await goldDrawerRepository.deleteForVault(id);
    await auditService.record({ entityRef: entityRef(id), action: 'delete', changes: [] });
  }

  /**
   * Stateless: shows what the numbering WOULD be, so nobody regenerates a layout to find out.
   * Async only so every service method reads the same at the call site — it touches no database.
   */
  async previewLayout(input: PreviewGoldLayout): Promise<GeneratedDrawer[]> {
    return generateDrawers({ ...input, labelFn: drawerLabeller(input.code ?? 'V') });
  }

  async generateLayout(
    id: string,
    input: GenerateGoldLayout,
    by: string,
    scope: ScopeSelector,
  ): Promise<{ vault: GoldVaultDoc; drawerCount: number }> {
    const vault = await goldVaultRepository.getById(id, scope);
    const stored = await this.storedBars(id);
    if (stored > 0) {
      throw new ConflictError(
        `Cannot regenerate layout: ${String(stored)} bar(s) are stored in this vault`,
      );
    }
    const limit = input.drawerWeightLimit;
    const plan = generateDrawers({ ...input, labelFn: drawerLabeller(vault.code) });

    // The versioned vault write comes FIRST, and it is the concurrency gate. Regeneration deletes
    // every drawer, so taking the lock afterwards would mean a stale-version conflict had already
    // destroyed them — the one ordering that turns a harmless 409 into data loss.
    const updated = await goldVaultRepository.updateById(
      id,
      { layout: toLayout(input, limit), drawersGenerated: true },
      { by, version: vault.__v, scope },
    );

    // Clean regeneration: drop the existing drawers, then insert the freshly numbered plan.
    // Sequential and transaction-free so it behaves identically on a standalone mongod and a
    // replica set, and so it can never leave stale drawers colliding on {vault, number}.
    await goldDrawerRepository.deleteForVault(id);
    await goldDrawerRepository.insertPlan(
      plan.map((d) => ({
        vaultId: vault._id,
        branchId: vault.branchId,
        row: d.row,
        col: d.col,
        number: d.number,
        label: d.label,
        weightLimit: limit,
        status: 'empty' as const,
        barsCount: 0,
        totalWeight: 0,
      })),
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(
        { layout: vault.layout, drawers: null },
        { layout: updated.layout, drawers: plan.length },
      ),
    });
    return { vault: updated, drawerCount: plan.length };
  }

  /**
   * Reshape the EXISTING drawers in place — no delete, so the bars inside them are untouched.
   * Allowed only when the total count and the numbering start are unchanged, because the drawer
   * NUMBER is what a bar's location means and renumbering would silently move stored metal.
   */
  async reshapeLayout(
    id: string,
    input: GenerateGoldLayout,
    by: string,
    scope: ScopeSelector,
  ): Promise<{ vault: GoldVaultDoc; drawerCount: number }> {
    const vault = await goldVaultRepository.getById(id, scope);
    const existing = await goldDrawerRepository.findForVault(id);
    if (existing.length === 0) {
      throw new BusinessRuleError('لا توجد أدراج لإعادة تشكيلها — استخدم توليد الأدراج');
    }
    const limit = input.drawerWeightLimit;
    const plan = generateDrawers({ ...input, labelFn: drawerLabeller(vault.code) });

    if (plan.length !== existing.length) {
      throw new ConflictError(
        `إعادة التشكيل تتطلب نفس عدد الأدراج (الحالي ${String(existing.length)}، الجديد ${String(plan.length)})`,
      );
    }
    const oldStart = vault.layout?.startNumber ?? 1;
    if (input.startNumber !== oldStart) {
      throw new ConflictError(
        `إعادة التشكيل تتطلب نفس بداية الترقيم (الحالية ${String(oldStart)})`,
      );
    }
    const byNumber = new Map(existing.map((d) => [d.number, d]));
    for (const p of plan) {
      if (byNumber.get(p.number) === undefined) {
        throw new ConflictError('عدم تطابق في ترقيم الأدراج — تأكّد من نفس العدد وبداية الترقيم');
      }
    }

    // The versioned vault write comes first here too, for the same reason as regeneration: the
    // reshape below rewrites every drawer's position, and discovering a conflict afterwards would
    // leave the shuffle applied and the layout unsaved.
    const updated = await goldVaultRepository.updateById(
      id,
      { layout: toLayout(input, limit), drawersGenerated: true },
      { by, version: vault.__v, scope },
    );

    // Phase 1 — park every drawer in a disjoint NEGATIVE coordinate space, so no two drawers ever
    // transiently share a {vault, row, col} while they are being shuffled. `number` never changes,
    // so the bars stay put throughout.
    await goldDrawerRepository.bulk(
      existing.map((d) => ({
        updateOne: {
          filter: { _id: d._id },
          update: { $set: { row: -(d.number + 1), col: -(d.number + 1) } },
        },
      })),
      false,
    );
    // Phase 2 — place each drawer into its new cell, from the LAST number down to the first. Every
    // target cell is free, because all drawers are parked in the negatives.
    await goldDrawerRepository.bulk(
      plan
        .slice()
        .sort((a, b) => b.number - a.number)
        .map((p) => {
          const drawer = byNumber.get(p.number) as GoldDrawerDoc;
          return {
            updateOne: {
              filter: { _id: drawer._id },
              update: { $set: { row: p.row, col: p.col, label: p.label, weightLimit: limit } },
            },
          };
        }),
      true,
    );

    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(
        { layout: vault.layout, reshaped: null },
        { layout: updated.layout, reshaped: existing.length },
      ),
    });
    return { vault: updated, drawerCount: existing.length };
  }

  async reorder(input: ReorderGoldItems): Promise<void> {
    await Promise.all(
      input.items.map(async (item) => goldVaultRepository.setOrder(item.id, item.order)),
    );
  }

  /**
   * A vault's drawers, each carrying the owners of the bars inside it — the coloured strip on the
   * visual board. One aggregation for the whole vault, never one query per drawer.
   */
  async listDrawers(
    vaultId: string,
    scope: ScopeSelector,
  ): Promise<{ drawers: GoldDrawerDoc[]; byDrawer: Map<string, { id: string; count: number }[]> }> {
    await goldVaultRepository.getById(vaultId, scope);
    const drawers = await goldDrawerRepository.findForVault(vaultId);
    const rows = await goldBarRepository.aggregateRaw<{
      _id: { drawer: Types.ObjectId; company: Types.ObjectId };
      count: number;
    }>([
      {
        $match: {
          currentVaultId: new Types.ObjectId(vaultId),
          status: 'in_vault',
          isDeleted: false,
          currentDrawerId: { $ne: null },
          companyId: { $ne: null },
        },
      },
      {
        $group: {
          _id: { drawer: '$currentDrawerId', company: '$companyId' },
          count: { $sum: 1 },
        },
      },
    ]);
    const byDrawer = new Map<string, { id: string; count: number }[]>();
    for (const row of rows) {
      const key = String(row._id.drawer);
      byDrawer.set(key, [
        ...(byDrawer.get(key) ?? []),
        { id: String(row._id.company), count: row.count },
      ]);
    }
    for (const [key, list] of byDrawer) {
      byDrawer.set(
        key,
        list.sort((a, b) => b.count - a.count),
      );
    }
    return { drawers, byDrawer };
  }

  /** One drawer with the bars physically inside it — the drawer dialog and the audit minutes. */
  async getDrawer(drawerId: string, scope: ScopeSelector) {
    const drawer = await goldDrawerRepository.findById(drawerId, scope);
    if (drawer === null) throw new NotFoundError();
    // Unpaginated on purpose — the dialog counts these and the audit sheet prints them, and gold
    // returned the drawer's whole contents.
    const bars = await goldBarRepository.findInDrawer(drawer._id, scope);
    return { drawer, bars };
  }
}

export const goldVaultService = new GoldVaultService();
