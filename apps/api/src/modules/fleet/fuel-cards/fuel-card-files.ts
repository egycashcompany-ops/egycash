// The Files-service surface behind a fuel card's photo — the receipt photo's twin
// (`receipts/receipt-files.ts`): the CATEGORY so intake refuses what the screen cannot show, and
// the AUTHORIZERS (ADR-023) so the platform's own file endpoints ask the cards' grants — the photo's
// and, since 6d, its thumbnail's.
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

/** The card the file belongs to is live — a deleted card's files are nobody's to read or write. */
const cardIsLive = async (entityId: string): Promise<boolean> => {
  try {
    await fleetFuelCardRepository.getById(entityId);
    return true;
  } catch {
    return false;
  }
};

/**
 * The PHOTO: writes need `fleetFuelCard.edit`; reads need `fleetFuelCard.reveal` (6d) — the photo
 * shows the PIN on its sticker, so it is the PIN's own grant, on the platform's file endpoints as on
 * the cards' (`GET /fleet/fuel-cards/:id/image`). A reader with the view grant only sees the
 * thumbnail.
 */
export const fuelCardFileAuthorizer: FileEntityAuthorizer = {
  entityType: 'fuelCard',
  async authorize({ ctx, entityId, intent }): Promise<boolean> {
    const permission = intent === 'write' ? 'fleetFuelCard.edit' : 'fleetFuelCard.reveal';
    if (!hasPermission(ctx, permission)) return false;
    return cardIsLive(entityId);
  },
};

/** The photo's THUMBNAIL (6d): reads need `fleetFuelCard.view`, writes `fleetFuelCard.edit`. */
export const fuelCardThumbFileAuthorizer: FileEntityAuthorizer = {
  entityType: 'fuelCardThumb',
  async authorize({ ctx, entityId, intent }): Promise<boolean> {
    const permission = intent === 'write' ? 'fleetFuelCard.edit' : 'fleetFuelCard.view';
    if (!hasPermission(ctx, permission)) return false;
    return cardIsLive(entityId);
  },
};
