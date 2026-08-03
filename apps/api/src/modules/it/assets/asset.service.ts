// The asset register (design §2.2, §4.1). IT-1 registers, edits, resolves by code and prints
// labels; custody (assign/return/transfer/dispose) and the asset event history are IT-2. Status
// is derived (FR-2): registration is the only operation here, so every asset it touches is
// `inStock`.
import { Types } from 'mongoose';
import {
  ItEvents,
  type CreateItAsset,
  type ItAssetLabels,
  type ListItAssetsQuery,
  type Paginated,
  type UpdateItAsset,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { diffChanges } from '../../../shared/utils/diff';
import { emit } from '../../../platform/kernel/event-bus';
import { pdfDriverEnabled, renderPdfFromHtml } from '../../../platform/pdf';
import { itCatalogItemRepository } from '../catalog-items';
import { itVendorRepository } from '../vendors';
import { itAssetRepository } from './asset.repository';
import { nextAssetCode } from './asset-sequence';
import { buildAssetLabelSheetHtml, renderLabelQrs } from './asset-labels';
import { type ItAssetDoc, type ItAssetPurchaseSub, type ItAssetWarrantySub } from './asset.model';

const entityRef = (id: string) => ({ moduleId: 'it', entityType: 'asset', entityId: id });

const snapshot = (doc: ItAssetDoc) => ({
  assetCode: doc.assetCode,
  name: doc.name,
  description: doc.description,
  categoryId: String(doc.categoryId),
  status: doc.status,
  serialNumber: doc.serialNumber,
  model: doc.model,
  manufacturer: doc.manufacturer,
  externalTag: doc.externalTag,
  branchId: String(doc.branchId),
  location: doc.location,
  purchase: doc.purchase,
  warranty: doc.warranty,
  notes: doc.notes,
});

const eventPayload = (doc: ItAssetDoc) => ({
  assetId: String(doc._id),
  assetCode: doc.assetCode,
  categoryId: String(doc.categoryId),
});

const toPurchaseSub = (input: NonNullable<CreateItAsset['purchase']>): ItAssetPurchaseSub => ({
  date: input.date ?? null,
  cost: input.cost ?? null,
  vendorId: input.vendorId === undefined ? null : new Types.ObjectId(input.vendorId),
  invoiceRef: input.invoiceRef ?? null,
});

const toWarrantySub = (input: NonNullable<CreateItAsset['warranty']>): ItAssetWarrantySub => ({
  vendorId: input.vendorId === undefined ? null : new Types.ObjectId(input.vendorId),
  start: input.start,
  end: input.end,
  terms: input.terms ?? null,
});

class ItAssetService {
  private async assertCategory(categoryId: string): Promise<void> {
    const category = await itCatalogItemRepository.findActiveOfKind(categoryId, 'assetCategory');
    if (category === null) {
      throw new BusinessRuleError('categoryId must reference an active asset category');
    }
  }

  private async assertVendor(vendorId: string, field: string): Promise<void> {
    const vendor = await itVendorRepository.findActive(vendorId);
    if (vendor === null) {
      throw new BusinessRuleError(`${field} must reference an active vendor`);
    }
  }

  private async assertReferences(input: {
    categoryId?: string | undefined;
    purchase?: CreateItAsset['purchase'] | null | undefined;
    warranty?: CreateItAsset['warranty'] | null | undefined;
  }): Promise<void> {
    if (input.categoryId !== undefined) await this.assertCategory(input.categoryId);
    const purchaseVendor = input.purchase?.vendorId;
    if (purchaseVendor !== undefined) await this.assertVendor(purchaseVendor, 'purchase.vendorId');
    const warrantyVendor = input.warranty?.vendorId;
    if (warrantyVendor !== undefined) await this.assertVendor(warrantyVendor, 'warranty.vendorId');
  }

  async register(input: CreateItAsset, by: string): Promise<ItAssetDoc> {
    await this.assertReferences(input);
    if (input.serialNumber !== undefined) {
      // The unique partial index is the authority; the pre-check names the colliding field.
      const clash = await itAssetRepository.findBySerial(input.serialNumber);
      if (clash !== null) {
        throw new ConflictError(`serial number "${input.serialNumber}" already registered`);
      }
    }
    const assetCode = await nextAssetCode();
    const doc = await itAssetRepository.create(
      {
        assetCode,
        name: input.name,
        description: input.description ?? null,
        categoryId: new Types.ObjectId(input.categoryId),
        status: 'inStock',
        serialNumber: input.serialNumber ?? null,
        model: input.model ?? null,
        manufacturer: input.manufacturer ?? null,
        externalTag: input.externalTag ?? null,
        branchId: new Types.ObjectId(input.branchId),
        location: input.location ?? null,
        purchase: input.purchase === undefined ? null : toPurchaseSub(input.purchase),
        warranty: input.warranty === undefined ? null : toWarrantySub(input.warranty),
        notes: input.notes ?? null,
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    await emit(ItEvents.AssetRegistered, eventPayload(doc));
    return doc;
  }

  async list(query: ListItAssetsQuery): Promise<Paginated<ItAssetDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.categoryId !== undefined) filter.categoryId = new Types.ObjectId(query.categoryId);
    if (query.status !== undefined) filter.status = query.status;
    if (query.branchId !== undefined) filter.branchId = new Types.ObjectId(query.branchId);
    if (query.search !== undefined && query.search !== '') {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { assetCode: pattern },
        { name: pattern },
        { serialNumber: pattern },
        { externalTag: pattern },
      ];
    }
    return itAssetRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['createdAt', 'assetCode', 'name', 'status'],
    });
  }

  async getById(id: string): Promise<ItAssetDoc> {
    return itAssetRepository.getById(id);
  }

  async getByCode(assetCode: string): Promise<ItAssetDoc> {
    const doc = await itAssetRepository.findByCode(assetCode);
    if (doc === null) throw new NotFoundError(`asset "${assetCode}" not found`);
    return doc;
  }

  async update(id: string, input: UpdateItAsset, by: string): Promise<ItAssetDoc> {
    const before = await itAssetRepository.getById(id);
    await this.assertReferences({
      categoryId: input.categoryId,
      purchase: input.purchase ?? undefined,
      warranty: input.warranty ?? undefined,
    });
    if (input.serialNumber !== undefined && input.serialNumber !== null) {
      const clash = await itAssetRepository.findBySerial(input.serialNumber);
      if (clash !== null && String(clash._id) !== id) {
        throw new ConflictError(`serial number "${input.serialNumber}" already registered`);
      }
    }
    const set: Partial<ItAssetDoc> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.description !== undefined) set.description = input.description;
    if (input.categoryId !== undefined) set.categoryId = new Types.ObjectId(input.categoryId);
    if (input.serialNumber !== undefined) set.serialNumber = input.serialNumber;
    if (input.model !== undefined) set.model = input.model;
    if (input.manufacturer !== undefined) set.manufacturer = input.manufacturer;
    if (input.externalTag !== undefined) set.externalTag = input.externalTag;
    if (input.location !== undefined) set.location = input.location;
    if (input.purchase !== undefined) {
      set.purchase = input.purchase === null ? null : toPurchaseSub(input.purchase);
    }
    if (input.warranty !== undefined) {
      set.warranty = input.warranty === null ? null : toWarrantySub(input.warranty);
    }
    if (input.notes !== undefined) set.notes = input.notes;
    const updated = await itAssetRepository.updateById(id, set, { by, version: input.version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    await emit(ItEvents.AssetUpdated, eventPayload(updated));
    return updated;
  }

  /**
   * FR-5: an asset is deletable only while registered-in-error is still possible. In IT-1 no
   * custody operation exists, so `inStock` is exactly that window; IT-2's history events tighten
   * this guard to "no event beyond `registered`" without changing the permission.
   */
  async remove(id: string, by: string): Promise<void> {
    const doc = await itAssetRepository.getById(id);
    if (doc.status !== 'inStock') {
      throw new BusinessRuleError('only an in-stock asset with no history can be deleted (FR-5)');
    }
    await itAssetRepository.softDeleteById(id, { by });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'delete',
      changes: diffChanges(snapshot(doc), {}),
    });
  }

  /**
   * Label sheet (design §4.2): PDF when the chromium driver is configured, the same HTML as a
   * print view when it is not — nothing in dev/CI depends on a browser binary.
   */
  async renderLabels(
    input: ItAssetLabels,
  ): Promise<{ kind: 'pdf'; body: Buffer } | { kind: 'html'; body: string }> {
    const assets = await itAssetRepository.findManyByIds(input.assetIds);
    if (assets.length === 0) throw new NotFoundError('none of the requested assets exist');
    const labels = await renderLabelQrs(
      assets.map((a) => ({ assetCode: a.assetCode, name: a.name })),
    );
    const html = buildAssetLabelSheetHtml(labels);
    if (pdfDriverEnabled()) {
      const pdf = await renderPdfFromHtml(html);
      if (pdf !== null) return { kind: 'pdf', body: pdf };
    }
    return { kind: 'html', body: html };
  }
}

export const itAssetService = new ItAssetService();
