// The Files-service surface behind a vehicle's license image (design §9.2 — Files owns bytes,
// Fleet owns the link). Two pieces live here, and both exist so the license image obeys FLEET's
// rules rather than the platform's generic file rules:
//
//   * the CATEGORY — images only, capped — so intake validation rejects a PDF or a 40 MB scan
//     before a byte is stored, using the platform's own category machinery (no bespoke checks);
//   * the AUTHORIZER (ADR-023) — so a caller who reaches the file through the PLATFORM's file
//     endpoints is asked the same question the fleet endpoints ask: may you see / edit THIS
//     vehicle? Without it, `fleetVehicle.view` would guard the fleet route while `file.view`
//     quietly opened a side door to the same bytes.
import { FLEET_VEHICLE_FILE_CATEGORY, type CreateFileCategory } from '@ecms/contracts';
import { fileCategoryService, type FileEntityAuthorizer } from '../../../platform/files';
import { hasPermission, scopeSelector } from '../../../shared/types';
import { fleetVehicleRepository } from './vehicle.repository';

/**
 * Image types a phone or a flatbed scanner actually produces. PDF is deliberately absent: the
 * registry renders this in an `<img>` and prints it inline, and a format that cannot do either
 * would be accepted here only to fail at the point of use.
 */
const VEHICLE_DOCS_CATEGORY: CreateFileCategory = {
  key: FLEET_VEHICLE_FILE_CATEGORY,
  name: { ar: 'مستندات السيارات', en: 'Vehicle documents' },
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxSizeMb: 10,
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

/** Boot-time idempotent seed, so the category exists before the first upload asks for it. */
export const ensureVehicleDocsCategory = async (): Promise<void> => {
  const category = await fileCategoryService.ensure(VEHICLE_DOCS_CATEGORY);
  cachedCategoryId = String(category._id);
};

/** The category id an upload writes into (ensures + caches on first use). */
export const resolveVehicleDocsCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) await ensureVehicleDocsCategory();
  // `ensureVehicleDocsCategory` always assigns; the fallback keeps the type honest.
  return cachedCategoryId ?? '';
};

/**
 * Fleet's answer to "may this caller reach a vehicle's files?".
 *
 * Reads need `fleetVehicle.view`, writes need `fleetVehicle.edit` — the SAME grants the fleet
 * endpoints use (§13: whoever may edit a vehicle may manage its license image). The data scope is
 * applied too, via `getById`, so a branch-scoped user cannot reach another branch's documents by
 * file id. A missing vehicle denies rather than throws: the caller learns nothing about whether
 * the id exists.
 */
export const vehicleFileAuthorizer: FileEntityAuthorizer = {
  entityType: 'vehicle',
  async authorize({ ctx, entityId, intent }): Promise<boolean> {
    const permission = intent === 'write' ? 'fleetVehicle.edit' : 'fleetVehicle.view';
    if (!hasPermission(ctx, permission)) return false;
    try {
      await fleetVehicleRepository.getById(entityId, scopeSelector(ctx, permission));
      return true;
    } catch {
      return false;
    }
  },
};
