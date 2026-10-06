// The Files-service surface behind a notice's two scans — the signed paper and the cheque — as the
// dealership invoice's (`dealership/dealership-files.ts`): the CATEGORY so intake refuses what the
// screen cannot show, and the AUTHORIZER (ADR-023) so the platform's own file endpoints ask the
// notices' grants.
import { FLEET_NOTICE_FILE_CATEGORY, type CreateFileCategory } from '@ecms/contracts';
import { fileCategoryService, type FileEntityAuthorizer } from '../../../platform/files';
import { hasPermission } from '../../../shared/types';
import { fleetNoticeRepository } from './notice.repository';

const NOTICE_DOCS_CATEGORY: CreateFileCategory = {
  key: FLEET_NOTICE_FILE_CATEGORY,
  name: { ar: 'صور الإخطارات والشيكات', en: 'Notice and cheque scans' },
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxSizeMb: 10,
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

/** Boot-time idempotent seed, so the category exists before the first upload asks for it. */
export const ensureNoticeDocsCategory = async (): Promise<void> => {
  const category = await fileCategoryService.ensure(NOTICE_DOCS_CATEGORY);
  cachedCategoryId = String(category._id);
};

export const resolveNoticeDocsCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) await ensureNoticeDocsCategory();
  return cachedCategoryId ?? '';
};

/** Reads need `fleetNotice.view`, writes `fleetNotice.edit` — the screen's own grants. */
export const noticeFileAuthorizer: FileEntityAuthorizer = {
  entityType: 'fleetNotice',
  async authorize({ ctx, entityId, intent }): Promise<boolean> {
    const permission = intent === 'write' ? 'fleetNotice.edit' : 'fleetNotice.view';
    if (!hasPermission(ctx, permission)) return false;
    try {
      await fleetNoticeRepository.getById(entityId);
      return true;
    } catch {
      return false;
    }
  },
};
