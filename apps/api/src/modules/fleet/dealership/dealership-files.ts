// The Files-service surface behind a dealership invoice's scan — the same two pieces the vehicle
// licence image has (`vehicles/vehicle-files.ts`), for the same two reasons: the CATEGORY so intake
// refuses what the screen cannot show, and the AUTHORIZER (ADR-023) so the platform's own file
// endpoints ask the dealership's grants rather than opening a side door to the same bytes.
import { FLEET_DEALERSHIP_FILE_CATEGORY, type CreateFileCategory } from '@ecms/contracts';
import { fileCategoryService, type FileEntityAuthorizer } from '../../../platform/files';
import { hasPermission } from '../../../shared/types';
import { fleetDealershipRepository } from './dealership.repository';

/** A photo or a scan of the bill — what the screen renders in an `<img>` and prints inline. */
const DEALERSHIP_DOCS_CATEGORY: CreateFileCategory = {
  key: FLEET_DEALERSHIP_FILE_CATEGORY,
  name: { ar: 'فواتير التوكيل', en: 'Dealership invoices' },
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxSizeMb: 10,
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

/** Boot-time idempotent seed, so the category exists before the first upload asks for it. */
export const ensureDealershipDocsCategory = async (): Promise<void> => {
  const category = await fileCategoryService.ensure(DEALERSHIP_DOCS_CATEGORY);
  cachedCategoryId = String(category._id);
};

/** The category id an upload writes into (ensures + caches on first use). */
export const resolveDealershipDocsCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) await ensureDealershipDocsCategory();
  return cachedCategoryId ?? '';
};

/** Reads need `fleetDealership.view`, writes `fleetDealership.edit` — the screen's own grants. */
export const dealershipFileAuthorizer: FileEntityAuthorizer = {
  entityType: 'dealershipInvoice',
  async authorize({ ctx, entityId, intent }): Promise<boolean> {
    const permission = intent === 'write' ? 'fleetDealership.edit' : 'fleetDealership.view';
    if (!hasPermission(ctx, permission)) return false;
    try {
      await fleetDealershipRepository.getById(entityId);
      return true;
    } catch {
      return false;
    }
  },
};
