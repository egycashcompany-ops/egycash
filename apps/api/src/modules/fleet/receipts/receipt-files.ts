// The Files-service surface behind a receipt's photo — the dealership invoice's twin
// (`dealership/dealership-files.ts`): the CATEGORY so intake refuses what the screen cannot show,
// and the AUTHORIZER (ADR-023) so the platform's own file endpoints ask the receipts' grants.
import { FLEET_RECEIPT_FILE_CATEGORY, type CreateFileCategory } from '@ecms/contracts';
import { fileCategoryService, type FileEntityAuthorizer } from '../../../platform/files';
import { hasPermission } from '../../../shared/types';
import { fleetReceiptRepository } from './receipt.repository';

const RECEIPT_DOCS_CATEGORY: CreateFileCategory = {
  key: FLEET_RECEIPT_FILE_CATEGORY,
  name: { ar: 'إيصالات العهدة', en: 'Custody receipts' },
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxSizeMb: 10,
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

/** Boot-time idempotent seed, so the category exists before the first upload asks for it. */
export const ensureReceiptDocsCategory = async (): Promise<void> => {
  const category = await fileCategoryService.ensure(RECEIPT_DOCS_CATEGORY);
  cachedCategoryId = String(category._id);
};

export const resolveReceiptDocsCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) await ensureReceiptDocsCategory();
  return cachedCategoryId ?? '';
};

/** Reads need `fleetReceipt.view`, writes `fleetReceipt.edit` — the screen's own grants. */
export const receiptFileAuthorizer: FileEntityAuthorizer = {
  entityType: 'receipt',
  async authorize({ ctx, entityId, intent }): Promise<boolean> {
    const permission = intent === 'write' ? 'fleetReceipt.edit' : 'fleetReceipt.view';
    if (!hasPermission(ctx, permission)) return false;
    try {
      await fleetReceiptRepository.getById(entityId);
      return true;
    } catch {
      return false;
    }
  },
};
