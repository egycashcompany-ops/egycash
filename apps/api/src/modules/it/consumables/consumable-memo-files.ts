// The Files-service surface behind a memo's signed copy — the line acknowledgment's twin
// (`mobile-lines/line-receipt-files.ts`): the CATEGORY, so intake refuses what the screen cannot
// show, and the AUTHORIZER (ADR-023), so the platform's own file endpoints ask the custody grants.
import { IT_CONSUMABLE_MEMO_FILE_CATEGORY, type CreateFileCategory } from '@ecms/contracts';
import { fileCategoryService, type FileEntityAuthorizer } from '../../../platform/files';
import { hasPermission, scopeSelector } from '../../../shared/types';
import { itConsumableMemoRepository } from './consumable-memo.repository';

const CONSUMABLE_MEMO_CATEGORY: CreateFileCategory = {
  key: IT_CONSUMABLE_MEMO_FILE_CATEGORY,
  name: { ar: 'مذكرات صرف المستهلكات', en: 'Consumable issue memos' },
  // A phone photo of the signed paper, or the office scanner's PDF — what a device paper takes.
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  maxSizeMb: 10,
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

/** Idempotent: the category is created the first time a signed copy asks for it. */
export const resolveConsumableMemoCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) {
    const category = await fileCategoryService.ensure(CONSUMABLE_MEMO_CATEGORY);
    cachedCategoryId = String(category._id);
  }
  return cachedCategoryId;
};

/**
 * Reads need `itAsset.view`, writes `itAsset.assign` — the issue's own grants — and the memo must
 * be one the caller can see, under the branch scope every custody read uses.
 */
export const consumableMemoFileAuthorizer: FileEntityAuthorizer = {
  entityType: 'consumableMemo',
  async authorize({ ctx, entityId, intent }): Promise<boolean> {
    const permission = intent === 'write' ? 'itAsset.assign' : 'itAsset.view';
    if (!hasPermission(ctx, permission)) return false;
    const memo = await itConsumableMemoRepository.findById(
      entityId,
      scopeSelector(ctx, 'itAsset.view'),
    );
    return memo !== null;
  },
};
