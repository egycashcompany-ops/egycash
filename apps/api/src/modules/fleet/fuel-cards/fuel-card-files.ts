// The Files-service surface behind a fuel card's photo — the receipt photo's twin
// (`receipts/receipt-files.ts`): the CATEGORY so intake refuses what the screen cannot show, and
// the AUTHORIZER (ADR-023) so the platform's own file endpoints ask the cards' grants.
import { FLEET_FUEL_CARD_FILE_CATEGORY, type CreateFileCategory } from '@ecms/contracts';
import { fileCategoryService, type FileEntityAuthorizer } from '../../../platform/files';
import { hasPermission } from '../../../shared/types';
import { fleetFuelCardRepository } from './fuel-card.repository';

const FUEL_CARD_DOCS_CATEGORY: CreateFileCategory = {
  key: FLEET_FUEL_CARD_FILE_CATEGORY,
  name: { ar: 'صور كروت الوقود', en: 'Fuel card photos' },
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxSizeMb: 10,
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

/** Boot-time idempotent seed, so the category exists before the first upload asks for it. */
export const ensureFuelCardDocsCategory = async (): Promise<void> => {
  const category = await fileCategoryService.ensure(FUEL_CARD_DOCS_CATEGORY);
  cachedCategoryId = String(category._id);
};

export const resolveFuelCardDocsCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) await ensureFuelCardDocsCategory();
  return cachedCategoryId ?? '';
};

/** Reads need `fleetFuelCard.view`, writes `fleetFuelCard.edit` — the screen's own grants. */
export const fuelCardFileAuthorizer: FileEntityAuthorizer = {
  entityType: 'fuelCard',
  async authorize({ ctx, entityId, intent }): Promise<boolean> {
    const permission = intent === 'write' ? 'fleetFuelCard.edit' : 'fleetFuelCard.view';
    if (!hasPermission(ctx, permission)) return false;
    try {
      await fleetFuelCardRepository.getById(entityId);
      return true;
    } catch {
      return false;
    }
  },
};
