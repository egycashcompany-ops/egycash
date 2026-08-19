// عمليات الخروج — releasing metal out of the vault (gold `controllers/delivery.controller.js`).
//
// A delivery references bars that already exist, so the draft holds a SELECTION and confirming is
// what marks each bar `delivered`, clears its vault/drawer and re-counts the drawer it left.
// Reverting reads each bar's own history to find where it came from — the delivery does not store
// the origin, the bar does, which is why a bar that has since moved on is simply skipped.
import {
  type CreateGoldDelivery,
  type ListGoldDeliveryQuery,
  type Paginated,
  type UpdateGoldDelivery,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { BusinessRuleError, ConflictError } from '../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { goldBarRepository } from '../bars/bar.repository';
import { recountDrawers } from '../shared/drawer-counters';
import {
  GOLD_NUMBER_ATTEMPTS,
  GOLD_NUMBER_PREFIXES,
  nextGoldNumber,
} from '../shared/document-number';
import { resolveCreateBranchId, resolveEmployeeRef } from '../shared/ecms-refs';
import { goldDeliveryReceiptRepository } from './delivery-receipt.repository';
import { GoldDeliveryReceiptModel, type GoldDeliveryReceiptDoc } from './delivery-receipt.model';

const entityRef = (id: string) => ({
  moduleId: 'gold',
  entityType: 'deliveryReceipt',
  entityId: id,
});

const snapshot = (doc: GoldDeliveryReceiptDoc) => ({
  receiptNumber: doc.receiptNumber,
  status: doc.status,
  receiptDate: doc.receiptDate,
  companyId: doc.companyId === null ? null : String(doc.companyId),
  metalType: doc.metalType,
  supervisor1EmployeeId:
    doc.supervisor1EmployeeId === null ? null : String(doc.supervisor1EmployeeId),
  supervisor2EmployeeId:
    doc.supervisor2EmployeeId === null ? null : String(doc.supervisor2EmployeeId),
  barsCount: doc.barsCount,
  totalWeight: doc.totalWeight,
  notes: doc.notes,
});

const oid = (v: string | null | undefined): Types.ObjectId | null =>
  v === null || v === undefined ? null : new Types.ObjectId(v);

type DeliveryHeaderInput = CreateGoldDelivery | UpdateGoldDelivery;

class GoldDeliveryService {
  async nextNumber(): Promise<string> {
    return nextGoldNumber(GoldDeliveryReceiptModel, 'receiptNumber', GOLD_NUMBER_PREFIXES.delivery);
  }

  /** Count and weigh a selection — the only two numbers the header carries about its bars. */
  private async summarize(barIds: readonly string[]) {
    const bars = await goldBarRepository.findByIds(barIds);
    return {
      barIds: bars.map((bar) => bar._id),
      barsCount: bars.length,
      totalWeight: bars.reduce((sum, bar) => sum + bar.weight, 0),
    };
  }

  private async applyHeader(
    set: Partial<GoldDeliveryReceiptDoc>,
    input: DeliveryHeaderInput,
  ): Promise<void> {
    if (input.receiptDate !== undefined) set.receiptDate = input.receiptDate;
    if (input.companyId !== undefined) set.companyId = oid(input.companyId);
    if (input.metalType !== undefined) set.metalType = input.metalType;
    if (input.representativeId !== undefined) set.representativeId = oid(input.representativeId);
    if (input.nationalId !== undefined) set.nationalId = input.nationalId ?? null;
    if (input.keyHolder !== undefined) set.keyHolder = input.keyHolder ?? null;
    if (input.notes !== undefined) set.notes = input.notes ?? null;
    // Integration 2 — both custodians are ECMS employees, stored as id + snapshot.
    if (input.supervisor1EmployeeId !== undefined) {
      const ref = await resolveEmployeeRef(input.supervisor1EmployeeId, 'supervisor1EmployeeId');
      set.supervisor1EmployeeId = oid(ref.id);
      set.supervisor1Name = ref.name;
    }
    if (input.supervisor2EmployeeId !== undefined) {
      const ref = await resolveEmployeeRef(input.supervisor2EmployeeId, 'supervisor2EmployeeId');
      set.supervisor2EmployeeId = oid(ref.id);
      set.supervisor2Name = ref.name;
    }
  }

  async list(
    query: ListGoldDeliveryQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<GoldDeliveryReceiptDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.companyId !== undefined) {
      filter.companyId = { $in: query.companyId.map((v) => new Types.ObjectId(v)) };
    }
    if (query.status !== undefined) filter.status = { $in: query.status };
    if (query.metalType !== undefined) filter.metalType = { $in: query.metalType };
    if (query.search !== undefined && query.search !== '') {
      filter.receiptNumber = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    if (query.from !== undefined || query.to !== undefined) {
      const range: Record<string, Date> = {};
      if (query.from !== undefined) range.$gte = query.from;
      if (query.to !== undefined) range.$lte = query.to;
      filter.receiptDate = range;
    }
    return goldDeliveryReceiptRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'receiptDate',
      sortDir: query.sortDir,
      sortableFields: ['receiptDate', 'createdAt', 'receiptNumber', 'totalWeight'],
      scope,
    });
  }

  async getById(id: string, scope: ScopeSelector): Promise<GoldDeliveryReceiptDoc> {
    return goldDeliveryReceiptRepository.getById(id, scope);
  }

  async create(input: CreateGoldDelivery, ctx: AuthContext): Promise<GoldDeliveryReceiptDoc> {
    const branchId = await resolveCreateBranchId(ctx);
    const base: Partial<GoldDeliveryReceiptDoc> = {
      status: 'draft',
      branchId: branchId === null ? null : new Types.ObjectId(branchId),
      ...(await this.summarize(input.barIds)),
    };
    await this.applyHeader(base, input);

    for (let attempt = 0; attempt < GOLD_NUMBER_ATTEMPTS; attempt += 1) {
      const receiptNumber = await nextGoldNumber(
        GoldDeliveryReceiptModel,
        'receiptNumber',
        GOLD_NUMBER_PREFIXES.delivery,
        attempt,
      );
      try {
        const doc = await goldDeliveryReceiptRepository.create(
          { ...base, receiptNumber },
          { by: ctx.userId },
        );
        await auditService.record({
          entityRef: entityRef(String(doc._id)),
          action: 'create',
          changes: diffChanges({}, snapshot(doc)),
        });
        return doc;
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
      }
    }
    throw new ConflictError('تعذّر توليد رقم أمر خروج فريد، حاول مرة أخرى');
  }

  async update(
    id: string,
    input: UpdateGoldDelivery,
    by: string,
    scope: ScopeSelector,
  ): Promise<GoldDeliveryReceiptDoc> {
    const before = await goldDeliveryReceiptRepository.getById(id, scope);
    if (before.status === 'confirmed') {
      throw new ConflictError('Confirmed receipts cannot be edited');
    }
    const set: Partial<GoldDeliveryReceiptDoc> = {};
    await this.applyHeader(set, input);
    if (input.barIds !== undefined) Object.assign(set, await this.summarize(input.barIds));
    const updated = await goldDeliveryReceiptRepository.updateById(id, set, {
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

  /** CONFIRM — the moment the metal leaves. Every bar must still be in the vault. */
  async confirm(
    id: string,
    version: number,
    by: string,
    scope: ScopeSelector,
  ): Promise<GoldDeliveryReceiptDoc> {
    const receipt = await goldDeliveryReceiptRepository.getById(id, scope);
    if (receipt.status === 'confirmed') throw new ConflictError('Receipt already confirmed');
    if (receipt.companyId === null) throw new BusinessRuleError('Company is required');
    if (receipt.barIds.length === 0) throw new BusinessRuleError('Select at least one bar');

    const bars = await goldBarRepository.findByIds(receipt.barIds);
    const notInVault = bars.filter((bar) => bar.status !== 'in_vault');
    if (notInVault.length > 0) {
      throw new ConflictError(`Not in vault: ${notInVault.map((b) => b.serialNumber).join(', ')}`);
    }

    // Claim the receipt FIRST. Gold's `receipt.save()` could not fail, so once its bar loop ran
    // the header write and the recount always followed. Here the write is version-guarded and can
    // throw, so it goes ahead of the bars: a stale confirm is refused with nothing moved, rather
    // than leaving bars delivered under a receipt that still says draft.
    const updated = await goldDeliveryReceiptRepository.updateById(
      id,
      { status: 'confirmed' },
      { by, version, scope },
    );

    const now = new Date();
    const actor = new Types.ObjectId(by);
    const affected = bars.map((bar) => bar.currentDrawerId?.toString());
    for (const bar of bars) {
      await goldBarRepository.pushHistory(
        bar._id,
        {
          action: 'delivered',
          fromVaultId: bar.currentVaultId,
          fromDrawerId: bar.currentDrawerId,
          toVaultId: null,
          toDrawerId: null,
          reference: receipt.receiptNumber,
          byUserId: actor,
          at: now,
          notes: null,
        },
        { status: 'delivered', currentVaultId: null, currentDrawerId: null },
      );
    }
    await recountDrawers(affected);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'deliver',
      changes: diffChanges(
        { status: receipt.status, bars: 0 },
        { status: 'confirmed', bars: bars.length },
      ),
    });
    return updated;
  }

  /**
   * REVERT — put the bars back where they were.
   *
   * The origin is read off each bar's OWN history (the last `delivered` entry carrying this
   * receipt's number), because that is where the gold system recorded it. A bar that is no longer
   * `delivered` has moved on since and is left alone rather than dragged backwards.
   */
  async revert(
    id: string,
    version: number,
    by: string,
    scope: ScopeSelector,
  ): Promise<GoldDeliveryReceiptDoc> {
    const receipt = await goldDeliveryReceiptRepository.getById(id, scope);
    if (receipt.status !== 'confirmed') {
      throw new BusinessRuleError('يمكن التراجع عن الإيصالات المعتمدة فقط');
    }
    const bars = await goldBarRepository.findByIds(receipt.barIds);

    // Same reason as `confirm`: the version-guarded header write goes before the bar writes.
    const updated = await goldDeliveryReceiptRepository.updateById(
      id,
      { status: 'reverted' },
      { by, version, scope },
    );

    const now = new Date();
    const actor = new Types.ObjectId(by);
    const affected: (string | undefined)[] = [];
    for (const bar of bars) {
      if (bar.status !== 'delivered') continue;
      const origin = [...bar.history]
        .reverse()
        .find((h) => h.action === 'delivered' && h.reference === receipt.receiptNumber);
      const vaultId = origin?.fromVaultId ?? null;
      const drawerId = origin?.fromDrawerId ?? null;
      await goldBarRepository.pushHistory(
        bar._id,
        {
          action: 'revert-delivered',
          fromVaultId: null,
          fromDrawerId: null,
          toVaultId: vaultId,
          toDrawerId: drawerId,
          reference: receipt.receiptNumber,
          byUserId: actor,
          at: now,
          notes: null,
        },
        { status: 'in_vault', currentVaultId: vaultId, currentDrawerId: drawerId },
      );
      affected.push(drawerId?.toString());
    }
    await recountDrawers(affected);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'revert',
      changes: diffChanges({ status: 'confirmed' }, { status: 'reverted' }),
    });
    return updated;
  }

  async recordPrint(id: string, scope: ScopeSelector) {
    await goldDeliveryReceiptRepository.getById(id, scope);
    return goldDeliveryReceiptRepository.recordPrint(id);
  }
}

export const goldDeliveryService = new GoldDeliveryService();
