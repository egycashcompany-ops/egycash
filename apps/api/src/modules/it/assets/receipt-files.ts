// The Files-service surface behind a receipt's signed copy — the fuel card photo's twin: the
// CATEGORY so intake refuses what the screen cannot show, and the AUTHORIZER (ADR-023) so the
// platform's own file endpoints ask the custody grants.
import { IT_CUSTODY_RECEIPT_FILE_CATEGORY, type CreateFileCategory } from '@ecms/contracts';
import { fileCategoryService, type FileEntityAuthorizer } from '../../../platform/files';
import { hasPermission, scopeSelector } from '../../../shared/types';
import { itCustodyReceiptRepository } from './receipt.repository';

const CUSTODY_RECEIPT_CATEGORY: CreateFileCategory = {
  key: IT_CUSTODY_RECEIPT_FILE_CATEGORY,
  name: { ar: 'إيصالات استلام العهد', en: 'Custody receipts' },
  // A phone photo of the signed paper, or the office scanner's PDF.
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  maxSizeMb: 10,
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

/** Idempotent: the category is created the first time a signed copy asks for it. */
export const resolveCustodyReceiptCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) {
    const category = await fileCategoryService.ensure(CUSTODY_RECEIPT_CATEGORY);
    cachedCategoryId = String(category._id);
  }
  return cachedCategoryId;
};

/**
 * Reads need `itAsset.view`, writes `itAsset.assign` — the custody screen's own grants — and the
 * receipt must be one the caller can see, under the same branch scope every custody read uses.
 */
export const custodyReceiptFileAuthorizer: FileEntityAuthorizer = {
  entityType: 'custodyReceipt',
  async authorize({ ctx, entityId, intent }): Promise<boolean> {
    const permission = intent === 'write' ? 'itAsset.assign' : 'itAsset.view';
    if (!hasPermission(ctx, permission)) return false;
    const receipt = await itCustodyReceiptRepository.findById(
      entityId,
      scopeSelector(ctx, 'itAsset.view'),
    );
    return receipt !== null;
  },
};
