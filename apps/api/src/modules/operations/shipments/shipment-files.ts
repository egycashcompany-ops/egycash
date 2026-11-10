// The Files-service surface behind a shipment's receipt photo («صورة الإيصال») — the Fleet receipts'
// twin (`fleet/receipts/receipt-files.ts`): the CATEGORY so intake refuses what the board cannot
// show, and the AUTHORIZER (ADR-023) so the platform's own file endpoints ask the shipments' grants.
import {
  OPERATIONS_SHIPMENT_RECEIPT_FILE_CATEGORY,
  type CreateFileCategory,
} from '@ecms/contracts';
import { fileCategoryService, type FileEntityAuthorizer } from '../../../platform/files';
import { hasPermission } from '../../../shared/types';
import { operationsShipmentRepository } from './shipment.repository';

const SHIPMENT_RECEIPT_CATEGORY: CreateFileCategory = {
  key: OPERATIONS_SHIPMENT_RECEIPT_FILE_CATEGORY,
  name: { ar: 'إيصالات الشحنات', en: 'Shipment receipts' },
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxSizeMb: 10,
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

/** Boot-time idempotent seed, so the category exists before the first upload asks for it. */
export const ensureShipmentReceiptCategory = async (): Promise<void> => {
  const category = await fileCategoryService.ensure(SHIPMENT_RECEIPT_CATEGORY);
  cachedCategoryId = String(category._id);
};

export const resolveShipmentReceiptCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) await ensureShipmentReceiptCategory();
  return cachedCategoryId ?? '';
};

/**
 * Reads need `operationsShipment.view`, writes `operationsShipment.edit` — the board's own grants:
 * whoever may edit the row manages its photo, whoever may see the row may see it.
 *
 * `entityType` must match what the service hands `fileService.upload` (and what the shipment's
 * audit already uses): without a registered authorizer the Files service refuses every read of an
 * entity-owned file, so the GET would answer 403.
 */
export const shipmentFileAuthorizer: FileEntityAuthorizer = {
  entityType: 'shipment',
  async authorize({ ctx, entityId, intent }): Promise<boolean> {
    const permission = intent === 'write' ? 'operationsShipment.edit' : 'operationsShipment.view';
    if (!hasPermission(ctx, permission)) return false;
    try {
      await operationsShipmentRepository.getById(entityId);
      return true;
    } catch {
      return false;
    }
  },
};
