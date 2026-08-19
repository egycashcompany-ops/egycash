// السبائك — the bar register (gold `controllers/bar.controller.js`).
//
// Bars are normally BORN from a confirmed receiving receipt, not created here: the Bars screen
// says so, and this service's `create` exists because the gold API exposed it. Editing a bar
// records a `modified` entry on its history and re-counts whatever drawers it left or joined —
// the counters are never nudged, always recomputed.
import {
  type CreateGoldBar,
  type ListGoldBarsQuery,
  type Paginated,
  type UpdateGoldBar,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { BusinessRuleError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { goldCompanyRepository } from '../companies/company.repository';
import { recountDrawer } from '../shared/drawer-counters';
import { goldBarRepository } from './bar.repository';
import { type GoldBarDoc } from './bar.model';

const entityRef = (id: string) => ({ moduleId: 'gold', entityType: 'bar', entityId: id });

const snapshot = (doc: GoldBarDoc) => ({
  serialNumber: doc.serialNumber,
  companyId: doc.companyId === null ? null : String(doc.companyId),
  metalType: doc.metalType,
  brand: doc.brand,
  purity: doc.purity,
  weight: doc.weight,
  sealed: doc.sealed,
  weightBeforeSeal: doc.weightBeforeSeal,
  weightAfterSeal: doc.weightAfterSeal,
  currentVaultId: doc.currentVaultId === null ? null : String(doc.currentVaultId),
  currentDrawerId: doc.currentDrawerId === null ? null : String(doc.currentDrawerId),
  status: doc.status,
  notes: doc.notes,
});

const oid = (v: string | null | undefined): Types.ObjectId | null =>
  v === null || v === undefined ? null : new Types.ObjectId(v);

class GoldBarService {
  async list(query: ListGoldBarsQuery, scope: ScopeSelector): Promise<Paginated<GoldBarDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.companyId !== undefined) {
      filter.companyId = { $in: query.companyId.map((v) => new Types.ObjectId(v)) };
    }
    if (query.metalType !== undefined) filter.metalType = { $in: query.metalType };
    if (query.purity !== undefined) filter.purity = { $in: query.purity };
    if (query.status !== undefined) filter.status = { $in: query.status };
    if (query.vaultId !== undefined) filter.currentVaultId = new Types.ObjectId(query.vaultId);
    if (query.drawerId !== undefined) filter.currentDrawerId = new Types.ObjectId(query.drawerId);
    if (query.minWeight !== undefined || query.maxWeight !== undefined) {
      const weight: Record<string, number> = {};
      if (query.minWeight !== undefined) weight.$gte = query.minWeight;
      if (query.maxWeight !== undefined) weight.$lte = query.maxWeight;
      filter.weight = weight;
    }
    // `search` and `serialNumber` both match the serial, and `search` wins when both are sent —
    // the gold precedence, kept so a saved filter behaves the same.
    const serial = query.search ?? query.serialNumber;
    if (serial !== undefined && serial !== '') {
      filter.serialNumber = new RegExp(serial.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    return goldBarRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['createdAt', 'serialNumber', 'weight'],
      scope,
    });
  }

  async getById(id: string, scope: ScopeSelector): Promise<GoldBarDoc> {
    return goldBarRepository.getById(id, scope);
  }

  async create(input: CreateGoldBar, by: string): Promise<GoldBarDoc> {
    const companyExists = await goldCompanyRepository.exists({
      _id: new Types.ObjectId(input.companyId),
    } as never);
    if (!companyExists) throw new BusinessRuleError('Company does not exist');
    const doc = await goldBarRepository.create(
      {
        serialNumber: input.serialNumber,
        companyId: new Types.ObjectId(input.companyId),
        parentCompanyId: oid(input.parentCompanyId),
        metalType: input.metalType,
        brand: input.brand ?? null,
        purity: input.purity ?? null,
        weight: input.weight,
        sealed: input.sealed ?? false,
        weightBeforeSeal: input.weightBeforeSeal ?? null,
        weightAfterSeal: input.weightAfterSeal ?? null,
        currentVaultId: oid(input.currentVaultId),
        currentDrawerId: oid(input.currentDrawerId),
        status: 'in_vault',
        notes: input.notes ?? null,
        history: [
          {
            action: 'created',
            fromVaultId: null,
            fromDrawerId: null,
            toVaultId: oid(input.currentVaultId),
            toDrawerId: oid(input.currentDrawerId),
            reference: null,
            byUserId: new Types.ObjectId(by),
            at: new Date(),
            notes: null,
          },
        ],
      },
      { by },
    );
    await recountDrawer(input.currentDrawerId);
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return doc;
  }

  async update(
    id: string,
    input: UpdateGoldBar,
    by: string,
    scope: ScopeSelector,
  ): Promise<GoldBarDoc> {
    const before = await goldBarRepository.getById(id, scope);
    const previousDrawer = before.currentDrawerId === null ? null : String(before.currentDrawerId);

    const set: Partial<GoldBarDoc> = {};
    if (input.serialNumber !== undefined) set.serialNumber = input.serialNumber;
    if (input.companyId !== undefined) set.companyId = new Types.ObjectId(input.companyId);
    if (input.parentCompanyId !== undefined) set.parentCompanyId = oid(input.parentCompanyId);
    if (input.metalType !== undefined) set.metalType = input.metalType;
    if (input.purity !== undefined) set.purity = input.purity ?? null;
    if (input.brand !== undefined) set.brand = input.brand ?? null;
    if (input.weight !== undefined) set.weight = input.weight;
    if (input.sealed !== undefined) set.sealed = input.sealed;
    if (input.weightBeforeSeal !== undefined) set.weightBeforeSeal = input.weightBeforeSeal ?? null;
    if (input.weightAfterSeal !== undefined) set.weightAfterSeal = input.weightAfterSeal ?? null;
    if (input.currentVaultId !== undefined) set.currentVaultId = oid(input.currentVaultId);
    if (input.currentDrawerId !== undefined) set.currentDrawerId = oid(input.currentDrawerId);
    if (input.status !== undefined) set.status = input.status;
    if (input.notes !== undefined) set.notes = input.notes ?? null;

    const updated = await goldBarRepository.updateById(id, set, {
      by,
      version: input.version,
      scope,
    });
    // The history entry is appended AFTER the versioned write so the optimistic check still guards
    // the edit; the trail is a consequence of the edit, not part of the race.
    await goldBarRepository.pushHistory(id, {
      action: 'modified',
      fromVaultId: null,
      fromDrawerId: null,
      toVaultId: null,
      toDrawerId: null,
      reference: null,
      byUserId: new Types.ObjectId(by),
      at: new Date(),
      notes: input.changeNote ?? null,
    });

    const nextDrawer = updated.currentDrawerId === null ? null : String(updated.currentDrawerId);
    if (previousDrawer !== nextDrawer) await recountDrawer(previousDrawer);
    await recountDrawer(nextDrawer);

    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }

  /** Archive, not erase: the bar leaves circulation but its history stays readable. */
  async remove(id: string, by: string, scope: ScopeSelector): Promise<void> {
    const bar = await goldBarRepository.getById(id, scope);
    const drawerId = bar.currentDrawerId === null ? null : String(bar.currentDrawerId);
    await goldBarRepository.patch(id, { status: 'archived' });
    await goldBarRepository.softDeleteById(id, { by, scope });
    await recountDrawer(drawerId);
    await auditService.record({ entityRef: entityRef(id), action: 'delete', changes: [] });
  }

  async purities(scope: ScopeSelector): Promise<string[]> {
    return goldBarRepository.distinctPurities(scope);
  }
}

export const goldBarService = new GoldBarService();
