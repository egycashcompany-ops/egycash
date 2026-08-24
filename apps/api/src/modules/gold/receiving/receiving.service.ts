// عمليات الدخول — bringing metal into the vault (gold `controllers/receiving.controller.js`).
//
// THE RULE THIS FILE EXISTS FOR: a receipt is data until it is CONFIRMED, and bars exist only
// after that. A draft holds the whole shipment as embedded `lines`, is editable, printable and
// re-openable; confirming is the single moment that turns each line into a real bar, stamps it
// into a drawer and re-counts that drawer. A confirmed receipt is locked. Reverting is possible
// only while none of its bars has moved since — otherwise undoing the entry would erase metal that
// has already been delivered or transferred.
//
// Everything above is the gold system's, unchanged. The port's only additions are the ECMS
// references (crew leader, vehicle, both custodians) resolved into id + snapshot on every write.
import {
  type CreateGoldReceiving,
  type ListGoldReceivingQuery,
  type Paginated,
  type UpdateGoldReceiving,
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
import { resolveCreateBranchId, resolveEmployeeRef, resolveVehicleRef } from '../shared/ecms-refs';
import { goldReceivingReceiptRepository } from './receiving-receipt.repository';
import {
  GoldReceivingReceiptModel,
  type GoldReceivingLineSub,
  type GoldReceivingReceiptDoc,
} from './receiving-receipt.model';

const entityRef = (id: string) => ({
  moduleId: 'gold',
  entityType: 'receivingReceipt',
  entityId: id,
});

const snapshot = (doc: GoldReceivingReceiptDoc) => ({
  receiptNumber: doc.receiptNumber,
  status: doc.status,
  receiptDate: doc.receiptDate,
  deliveredByUs: doc.deliveredByUs,
  teamLeaderEmployeeId: doc.teamLeaderEmployeeId === null ? null : String(doc.teamLeaderEmployeeId),
  vehicleId: doc.vehicleId === null ? null : String(doc.vehicleId),
  companyId: doc.companyId === null ? null : String(doc.companyId),
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

const num = (v: number | null | undefined): number | null =>
  v === null || v === undefined ? null : v;

/**
 * Keep only the lines the operator actually filled in — the gold filter, verbatim: a row counts
 * when it carries a serial OR a weight, so a half-typed row is neither silently dropped nor
 * silently confirmed.
 */
const normalizeLines = (lines: CreateGoldReceiving['lines']): GoldReceivingLineSub[] =>
  lines
    .filter((l) => (l.serialNumber ?? '') !== '' || (l.weight || 0) !== 0)
    .map((l) => ({
      serialNumber: (l.serialNumber ?? '').trim(),
      brand: (l.brand ?? '').trim() === '' ? null : (l.brand ?? '').trim(),
      metalType: l.metalType,
      purity: l.purity ?? null,
      weight: l.weight,
      weightBeforePacking: num(l.weightBeforePacking),
      weightAfterPacking: num(l.weightAfterPacking),
      vaultId: oid(l.vaultId),
      drawerId: oid(l.drawerId),
    }));

/** Serials repeated WITHIN one receipt — caught before the receipt is even saved. */
const intraDuplicates = (serials: readonly string[]): string[] => {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const s of serials) {
    const key = s.toLowerCase();
    if (seen.has(key)) dup.add(s);
    else seen.add(key);
  }
  return [...dup];
};

const assertNoIntraDuplicates = (lines: GoldReceivingLineSub[]): void => {
  const dup = intraDuplicates(lines.map((l) => l.serialNumber).filter((s) => s !== ''));
  if (dup.length > 0) {
    throw new ConflictError(`سيريالات مكررة داخل الإيصال: ${dup.join('، ')}`);
  }
};

/** The header fields both create and update accept — the two payloads share them exactly. */
type ReceivingHeaderInput = CreateGoldReceiving | UpdateGoldReceiving;

const totals = (lines: GoldReceivingLineSub[]) => ({
  barsCount: lines.length,
  totalWeight: lines.reduce((sum, l) => sum + l.weight, 0),
});

class GoldReceivingService {
  async nextNumber(): Promise<string> {
    return nextGoldNumber(
      GoldReceivingReceiptModel,
      'receiptNumber',
      GOLD_NUMBER_PREFIXES.receiving,
    );
  }

  async list(
    query: ListGoldReceivingQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<GoldReceivingReceiptDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.companyId !== undefined) {
      filter.companyId = { $in: query.companyId.map((v) => new Types.ObjectId(v)) };
    }
    if (query.status !== undefined) filter.status = { $in: query.status };
    if (query.search !== undefined && query.search !== '') {
      filter.receiptNumber = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    if (query.from !== undefined || query.to !== undefined) {
      const range: Record<string, Date> = {};
      if (query.from !== undefined) range.$gte = query.from;
      if (query.to !== undefined) range.$lte = query.to;
      filter.receiptDate = range;
    }
    return goldReceivingReceiptRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'receiptDate',
      sortDir: query.sortDir,
      sortableFields: ['receiptDate', 'createdAt', 'receiptNumber', 'totalWeight'],
      scope,
    });
  }

  async getById(id: string, scope: ScopeSelector): Promise<GoldReceivingReceiptDoc> {
    return goldReceivingReceiptRepository.getById(id, scope);
  }

  /** The ECMS references a header write carries, resolved to id + display snapshot. */
  private async resolveHeaderRefs(input: ReceivingHeaderInput) {
    const [leader, vehicle, supervisor1, supervisor2] = await Promise.all([
      input.teamLeaderEmployeeId === undefined
        ? null
        : resolveEmployeeRef(input.teamLeaderEmployeeId, 'teamLeaderEmployeeId'),
      input.vehicleId === undefined ? null : resolveVehicleRef(input.vehicleId),
      input.supervisor1EmployeeId === undefined
        ? null
        : resolveEmployeeRef(input.supervisor1EmployeeId, 'supervisor1EmployeeId'),
      input.supervisor2EmployeeId === undefined
        ? null
        : resolveEmployeeRef(input.supervisor2EmployeeId, 'supervisor2EmployeeId'),
    ]);
    return { leader, vehicle, supervisor1, supervisor2 };
  }

  private applyHeader(
    set: Partial<GoldReceivingReceiptDoc>,
    input: ReceivingHeaderInput,
    refs: Awaited<ReturnType<GoldReceivingService['resolveHeaderRefs']>>,
  ): void {
    if (input.receiptDate !== undefined) set.receiptDate = input.receiptDate;
    if (input.releaseType !== undefined) set.releaseType = input.releaseType ?? null;
    if (input.releaseOrderNumber !== undefined) {
      set.releaseOrderNumber = input.releaseOrderNumber ?? null;
    }
    if (input.releaseLetterNumber !== undefined) {
      set.releaseLetterNumber = input.releaseLetterNumber ?? null;
    }
    if (input.releaseLetterDate !== undefined)
      set.releaseLetterDate = input.releaseLetterDate ?? null;
    if (input.companyId !== undefined) set.companyId = oid(input.companyId);
    if (input.companyDelegateId !== undefined) set.companyDelegateId = oid(input.companyDelegateId);
    if (input.companyDelegateNationalId !== undefined) {
      set.companyDelegateNationalId = input.companyDelegateNationalId ?? null;
    }
    if (input.storageDelegateId !== undefined) set.storageDelegateId = oid(input.storageDelegateId);
    if (input.storageDelegateNationalId !== undefined) {
      set.storageDelegateNationalId = input.storageDelegateNationalId ?? null;
    }
    if (input.representativeId !== undefined) set.representativeId = oid(input.representativeId);
    if (input.nationalId !== undefined) set.nationalId = input.nationalId ?? null;
    if (input.keyHolder !== undefined) set.keyHolder = input.keyHolder ?? null;
    if (input.keyHolderNationalId !== undefined) {
      set.keyHolderNationalId = input.keyHolderNationalId ?? null;
    }
    if (input.notes !== undefined) set.notes = input.notes ?? null;
    if (input.storageLocation !== undefined) set.storageLocation = input.storageLocation ?? null;
    // The three integrated references, id and snapshot written together — never one without the
    // other, or a receipt could print a name that belongs to somebody else's id.
    if (refs.leader !== null) {
      set.teamLeaderEmployeeId = oid(refs.leader.id);
      set.teamLeaderName = refs.leader.name;
    }
    if (refs.vehicle !== null) {
      set.vehicleId = oid(refs.vehicle.id);
      set.vehicleNumber = refs.vehicle.number;
    }
    if (refs.supervisor1 !== null) {
      set.supervisor1EmployeeId = oid(refs.supervisor1.id);
      set.supervisor1Name = refs.supervisor1.name;
    }
    if (refs.supervisor2 !== null) {
      set.supervisor2EmployeeId = oid(refs.supervisor2.id);
      set.supervisor2Name = refs.supervisor2.name;
    }
  }

  /**
   * Save a DRAFT.
   *
   * Numbering follows the gold rule exactly: when EGYCASH did the transport the operator types the
   * number by hand (it comes off the paper book), and when the owner delivered it themselves the
   * server allocates the next R-number of the day.
   */
  async create(input: CreateGoldReceiving, ctx: AuthContext): Promise<GoldReceivingReceiptDoc> {
    const lines = normalizeLines(input.lines);
    assertNoIntraDuplicates(lines);
    const deliveredByUs = input.deliveredByUs !== false;
    const branchId = await resolveCreateBranchId(ctx);
    const refs = await this.resolveHeaderRefs(input);

    const base: Partial<GoldReceivingReceiptDoc> = {
      status: 'draft',
      lines,
      barIds: [],
      branchId: branchId === null ? null : new Types.ObjectId(branchId),
      deliveredByUs,
      ...totals(lines),
    };
    this.applyHeader(base, input, refs);

    if (deliveredByUs) {
      const receiptNumber = (input.receiptNumber ?? '').trim();
      if (receiptNumber === '') throw new BusinessRuleError('أدخل رقم الإيصال يدويًا');
      if (await goldReceivingReceiptRepository.numberTaken(receiptNumber)) {
        throw new ConflictError('رقم الإيصال مستخدم بالفعل، اختر رقمًا آخر');
      }
      const doc = await goldReceivingReceiptRepository.create(
        { ...base, receiptNumber },
        { by: ctx.userId },
      );
      await this.auditCreate(doc);
      return doc;
    }

    // Server-allocated number. Retry on the unique index rather than trusting the count: two
    // operators saving in the same second used to produce the same number.
    for (let attempt = 0; attempt < GOLD_NUMBER_ATTEMPTS; attempt += 1) {
      const receiptNumber = await nextGoldNumber(
        GoldReceivingReceiptModel,
        'receiptNumber',
        GOLD_NUMBER_PREFIXES.receiving,
        attempt,
      );
      try {
        const doc = await goldReceivingReceiptRepository.create(
          { ...base, receiptNumber },
          { by: ctx.userId },
        );
        await this.auditCreate(doc);
        return doc;
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
      }
    }
    throw new ConflictError('تعذّر توليد رقم إيصال فريد، حاول مرة أخرى');
  }

  private async auditCreate(doc: GoldReceivingReceiptDoc): Promise<void> {
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
  }

  /** Edit a draft. A CONFIRMED receipt is locked — that is what confirming means. */
  async update(
    id: string,
    input: UpdateGoldReceiving,
    by: string,
    scope: ScopeSelector,
  ): Promise<GoldReceivingReceiptDoc> {
    const before = await goldReceivingReceiptRepository.getById(id, scope);
    if (before.status === 'confirmed') {
      throw new ConflictError('الإيصالات المعتمدة لا يمكن تعديلها');
    }
    const refs = await this.resolveHeaderRefs(input);
    const set: Partial<GoldReceivingReceiptDoc> = {};
    this.applyHeader(set, input, refs);
    if (input.deliveredByUs !== undefined) set.deliveredByUs = input.deliveredByUs;

    // Renaming is allowed only on the hand-typed side, exactly as in gold.
    if (input.deliveredByUs !== false && input.receiptNumber !== undefined) {
      const receiptNumber = input.receiptNumber.trim();
      if (receiptNumber !== '' && receiptNumber !== before.receiptNumber) {
        if (await goldReceivingReceiptRepository.numberTaken(receiptNumber, id)) {
          throw new ConflictError('رقم الإيصال مستخدم بالفعل');
        }
        set.receiptNumber = receiptNumber;
      }
    }
    if (input.lines !== undefined) {
      const lines = normalizeLines(input.lines);
      assertNoIntraDuplicates(lines);
      set.lines = lines;
      Object.assign(set, totals(lines));
    }
    const updated = await goldReceivingReceiptRepository.updateById(id, set, {
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

  /**
   * CONFIRM — the one moment the receipt becomes metal in a drawer.
   *
   * Every check below is a gold check, in the gold order: an owner, at least one line, every line
   * complete, and no serial that already exists anywhere in the system.
   */
  async confirm(
    id: string,
    version: number,
    by: string,
    scope: ScopeSelector,
  ): Promise<GoldReceivingReceiptDoc> {
    const receipt = await goldReceivingReceiptRepository.getById(id, scope);
    if (receipt.status === 'confirmed') throw new ConflictError('الإيصال معتمد بالفعل');
    if (receipt.companyId === null) throw new BusinessRuleError('اختر الشركة قبل الاعتماد');
    if (receipt.lines.length === 0) throw new BusinessRuleError('لا توجد سبائك في الإيصال');
    const incomplete = receipt.lines.filter((l) => l.serialNumber === '' || l.weight === 0);
    if (incomplete.length > 0) {
      throw new BusinessRuleError('كل سبيكة تحتاج رقمًا تسلسليًا ووزنًا');
    }
    assertNoIntraDuplicates(receipt.lines);
    const serials = receipt.lines.map((l) => l.serialNumber);
    const existing = await goldBarRepository.findBySerials(serials);
    if (existing.length > 0) {
      throw new ConflictError(
        `سيريالات موجودة بالفعل في النظام: ${existing.map((b) => b.serialNumber).join('، ')}`,
      );
    }

    const now = new Date();
    const actor = new Types.ObjectId(by);
    const created = await goldBarRepository.insertMany(
      receipt.lines.map((line) => ({
        serialNumber: line.serialNumber,
        companyId: receipt.companyId,
        brand: line.brand,
        metalType: line.metalType,
        purity: line.purity,
        weight: line.weight,
        weightBeforeSeal: line.weightBeforePacking,
        weightAfterSeal: line.weightAfterPacking,
        // A bar counts as sealed exactly when a post-packing weight was recorded — the gold rule.
        sealed: line.weightAfterPacking !== null,
        currentVaultId: line.vaultId,
        currentDrawerId: line.drawerId,
        branchId: receipt.branchId,
        status: 'in_vault' as const,
        createdBy: actor,
        updatedBy: actor,
        history: [
          {
            action: 'received',
            fromVaultId: null,
            fromDrawerId: null,
            toVaultId: line.vaultId,
            toDrawerId: line.drawerId,
            reference: receipt.receiptNumber,
            byUserId: actor,
            at: now,
            notes: null,
          },
        ],
      })),
    );

    const updated = await goldReceivingReceiptRepository.updateById(
      id,
      { barIds: created.map((bar) => bar._id), status: 'confirmed' },
      { by, version, scope },
    );
    await recountDrawers(created.map((bar) => bar.currentDrawerId?.toString()));
    await auditService.record({
      entityRef: entityRef(id),
      action: 'receive',
      changes: diffChanges(
        { status: receipt.status, bars: 0 },
        { status: 'confirmed', bars: created.length },
      ),
    });
    return updated;
  }

  /**
   * REVERT — undo a confirmed entry.
   *
   * Only while nothing has happened to the bars since. A bar that has been delivered or
   * transferred is no longer this receipt's to erase, and the gold system refuses the whole
   * operation rather than reverting it partly.
   */
  async revert(
    id: string,
    version: number,
    by: string,
    scope: ScopeSelector,
  ): Promise<GoldReceivingReceiptDoc> {
    const receipt = await goldReceivingReceiptRepository.getById(id, scope);
    if (receipt.status !== 'confirmed') {
      throw new BusinessRuleError('يمكن التراجع عن الإيصالات المعتمدة فقط');
    }
    const bars = await goldBarRepository.findByIds(receipt.barIds);
    const moved = bars.filter((bar) => bar.status !== 'in_vault');
    if (moved.length > 0) {
      throw new ConflictError(
        `تعذّر التراجع: سبائك تحرّكت بعد الإدخال (${moved.map((b) => b.serialNumber).join(', ')})`,
      );
    }
    const now = new Date();
    const actor = new Types.ObjectId(by);
    const drawerIds = bars.map((bar) => bar.currentDrawerId?.toString());
    for (const bar of bars) {
      await goldBarRepository.pushHistory(
        bar._id,
        {
          action: 'revert-received',
          fromVaultId: null,
          fromDrawerId: null,
          toVaultId: null,
          toDrawerId: null,
          reference: receipt.receiptNumber,
          byUserId: actor,
          at: now,
          notes: null,
        },
        { status: 'archived', isDeleted: true, deletedAt: now, deletedBy: actor },
      );
    }
    const updated = await goldReceivingReceiptRepository.updateById(
      id,
      { status: 'reverted', barIds: [] },
      { by, version, scope },
    );
    await recountDrawers(drawerIds);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'revert',
      changes: diffChanges({ status: 'confirmed' }, { status: 'reverted' }),
    });
    return updated;
  }

  async recordPrint(id: string, scope: ScopeSelector) {
    await goldReceivingReceiptRepository.getById(id, scope);
    return goldReceivingReceiptRepository.recordPrint(id);
  }
}

export const goldReceivingService = new GoldReceivingService();
