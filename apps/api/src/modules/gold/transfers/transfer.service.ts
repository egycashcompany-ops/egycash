// عمليات التحويل — moving OWNERSHIP between companies (gold `controllers/transfer.controller.js`).
//
// Nothing physical moves: the bars stay in their drawers and confirming only rewrites `companyId`.
// That is why there is no drawer re-count anywhere in this file, and why reverting needs one fact
// only — who owned them before.
import {
  type CreateGoldTransfer,
  type ListGoldTransfersQuery,
  type Paginated,
  type UpdateGoldTransfer,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { BusinessRuleError, ConflictError } from '../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { goldBarRepository } from '../bars/bar.repository';
import {
  GOLD_NUMBER_ATTEMPTS,
  GOLD_NUMBER_PREFIXES,
  nextGoldNumber,
} from '../shared/document-number';
import { resolveCreateBranchId, resolveEmployeeRef } from '../shared/ecms-refs';
import { goldTransferRepository } from './transfer.repository';
import { GoldTransferModel, type GoldTransferDoc } from './transfer.model';

const entityRef = (id: string) => ({ moduleId: 'gold', entityType: 'transfer', entityId: id });

const snapshot = (doc: GoldTransferDoc) => ({
  transferNumber: doc.transferNumber,
  status: doc.status,
  transferDate: doc.transferDate,
  metalType: doc.metalType,
  currentOwnerId: doc.currentOwnerId === null ? null : String(doc.currentOwnerId),
  newOwnerId: doc.newOwnerId === null ? null : String(doc.newOwnerId),
  supervisor1EmployeeId:
    doc.supervisor1EmployeeId === null ? null : String(doc.supervisor1EmployeeId),
  supervisor2EmployeeId:
    doc.supervisor2EmployeeId === null ? null : String(doc.supervisor2EmployeeId),
  barsCount: doc.barsCount,
  totalWeight: doc.totalWeight,
  approvedBy: doc.approvedBy,
  notes: doc.notes,
});

const oid = (v: string | null | undefined): Types.ObjectId | null =>
  v === null || v === undefined ? null : new Types.ObjectId(v);

type TransferHeaderInput = CreateGoldTransfer | UpdateGoldTransfer;

class GoldTransferService {
  async nextNumber(): Promise<string> {
    return nextGoldNumber(GoldTransferModel, 'transferNumber', GOLD_NUMBER_PREFIXES.transfer);
  }

  private async summarize(barIds: readonly string[]) {
    const bars = await goldBarRepository.findByIds(barIds);
    return {
      barIds: bars.map((bar) => bar._id),
      barsCount: bars.length,
      totalWeight: bars.reduce((sum, bar) => sum + bar.weight, 0),
    };
  }

  private async applyHeader(
    set: Partial<GoldTransferDoc>,
    input: TransferHeaderInput,
  ): Promise<void> {
    if (input.transferDate !== undefined) set.transferDate = input.transferDate;
    if (input.metalType !== undefined) set.metalType = input.metalType;
    if (input.currentOwnerId !== undefined) set.currentOwnerId = oid(input.currentOwnerId);
    if (input.currentOwnerDelegateId !== undefined) {
      set.currentOwnerDelegateId = oid(input.currentOwnerDelegateId);
    }
    if (input.currentOwnerNationalId !== undefined) {
      set.currentOwnerNationalId = input.currentOwnerNationalId ?? null;
    }
    if (input.newOwnerId !== undefined) set.newOwnerId = oid(input.newOwnerId);
    if (input.newOwnerDelegateId !== undefined) {
      set.newOwnerDelegateId = oid(input.newOwnerDelegateId);
    }
    if (input.newOwnerNationalId !== undefined) {
      set.newOwnerNationalId = input.newOwnerNationalId ?? null;
    }
    if (input.approvedBy !== undefined) set.approvedBy = input.approvedBy ?? null;
    if (input.notes !== undefined) set.notes = input.notes ?? null;
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
    query: ListGoldTransfersQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<GoldTransferDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.status !== undefined) filter.status = { $in: query.status };
    if (query.metalType !== undefined) filter.metalType = { $in: query.metalType };
    if (query.search !== undefined && query.search !== '') {
      filter.transferNumber = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    return goldTransferRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'transferDate',
      sortDir: query.sortDir,
      sortableFields: ['transferDate', 'createdAt', 'transferNumber', 'totalWeight'],
      scope,
    });
  }

  async getById(id: string, scope: ScopeSelector): Promise<GoldTransferDoc> {
    return goldTransferRepository.getById(id, scope);
  }

  async create(input: CreateGoldTransfer, ctx: AuthContext): Promise<GoldTransferDoc> {
    const branchId = await resolveCreateBranchId(ctx);
    const base: Partial<GoldTransferDoc> = {
      status: 'draft',
      branchId: branchId === null ? null : new Types.ObjectId(branchId),
      ...(await this.summarize(input.barIds)),
    };
    await this.applyHeader(base, input);

    for (let attempt = 0; attempt < GOLD_NUMBER_ATTEMPTS; attempt += 1) {
      const transferNumber = await nextGoldNumber(
        GoldTransferModel,
        'transferNumber',
        GOLD_NUMBER_PREFIXES.transfer,
        attempt,
      );
      try {
        const doc = await goldTransferRepository.create(
          { ...base, transferNumber },
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
    throw new ConflictError('تعذّر توليد رقم تحويل فريد، حاول مرة أخرى');
  }

  async update(
    id: string,
    input: UpdateGoldTransfer,
    by: string,
    scope: ScopeSelector,
  ): Promise<GoldTransferDoc> {
    const before = await goldTransferRepository.getById(id, scope);
    if (before.status === 'confirmed') throw new ConflictError('لا يمكن تعديل تحويل معتمد');
    const set: Partial<GoldTransferDoc> = {};
    await this.applyHeader(set, input);
    if (input.barIds !== undefined) Object.assign(set, await this.summarize(input.barIds));
    const updated = await goldTransferRepository.updateById(id, set, {
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

  async confirm(
    id: string,
    version: number,
    by: string,
    scope: ScopeSelector,
  ): Promise<GoldTransferDoc> {
    const transfer = await goldTransferRepository.getById(id, scope);
    if (transfer.status === 'confirmed') throw new ConflictError('التحويل معتمد بالفعل');
    if (transfer.newOwnerId === null) {
      throw new BusinessRuleError('اختر المالك الجديد قبل الاعتماد');
    }
    if (transfer.barIds.length === 0) throw new BusinessRuleError('اختر سبائك للتحويل');
    const bars = await goldBarRepository.findByIds(transfer.barIds);
    const unavailable = bars.filter((bar) => bar.status !== 'in_vault');
    if (unavailable.length > 0) {
      throw new ConflictError(
        `سبائك غير متاحة للتحويل: ${unavailable.map((b) => b.serialNumber).join(', ')}`,
      );
    }
    const now = new Date();
    const actor = new Types.ObjectId(by);
    for (const bar of bars) {
      await goldBarRepository.pushHistory(
        bar._id,
        {
          action: 'transferred',
          fromVaultId: null,
          fromDrawerId: null,
          toVaultId: null,
          toDrawerId: null,
          reference: transfer.transferNumber,
          byUserId: actor,
          at: now,
          notes: null,
        },
        { companyId: transfer.newOwnerId },
      );
    }
    const updated = await goldTransferRepository.updateById(
      id,
      { status: 'confirmed' },
      { by, version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'transfer',
      changes: diffChanges(
        { status: transfer.status, bars: 0 },
        { status: 'confirmed', bars: bars.length },
      ),
    });
    return updated;
  }

  async revert(
    id: string,
    version: number,
    by: string,
    scope: ScopeSelector,
  ): Promise<GoldTransferDoc> {
    const transfer = await goldTransferRepository.getById(id, scope);
    if (transfer.status !== 'confirmed') {
      throw new BusinessRuleError('يمكن التراجع عن التحويلات المعتمدة فقط');
    }
    if (transfer.currentOwnerId === null) {
      throw new BusinessRuleError('المالك السابق غير معروف، تعذّر التراجع');
    }
    const bars = await goldBarRepository.findByIds(transfer.barIds);
    const now = new Date();
    const actor = new Types.ObjectId(by);
    for (const bar of bars) {
      await goldBarRepository.pushHistory(
        bar._id,
        {
          action: 'revert-transferred',
          fromVaultId: null,
          fromDrawerId: null,
          toVaultId: null,
          toDrawerId: null,
          reference: transfer.transferNumber,
          byUserId: actor,
          at: now,
          notes: null,
        },
        { companyId: transfer.currentOwnerId },
      );
    }
    const updated = await goldTransferRepository.updateById(
      id,
      { status: 'reverted' },
      { by, version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'revert',
      changes: diffChanges({ status: 'confirmed' }, { status: 'reverted' }),
    });
    return updated;
  }

  async recordPrint(id: string, scope: ScopeSelector) {
    await goldTransferRepository.getById(id, scope);
    return goldTransferRepository.recordPrint(id);
  }
}

export const goldTransferService = new GoldTransferService();
