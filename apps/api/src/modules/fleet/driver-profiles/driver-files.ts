// The Files-service surface behind a DRIVER's licence scan (design §9.2 — Files owns the bytes,
// the driver profile owns the link). It mirrors the vehicle's seam deliberately: the same two
// pieces, for the same two reasons.
//
//   * the CATEGORY — images only, capped — so intake validation rejects a PDF or a 40 MB scan
//     before a byte is stored, using the platform's own category machinery (no bespoke checks);
//   * the AUTHORIZER (ADR-023) — so a caller who reaches the file through the PLATFORM's file
//     endpoints is asked the same question the fleet endpoints ask: may you see / manage THIS
//     driver? Without it, `fleetDriver.view` would guard the fleet route while `file.view` quietly
//     opened a side door to the same bytes.
//
// A separate category from the vehicle's, not a shared "fleet documents" one: retention and the
// allowed formats for a person's identity document are a decision an administrator must be able
// to make about drivers WITHOUT making the same decision about cars.
import { FLEET_DRIVER_FILE_CATEGORY, type CreateFileCategory } from '@ecms/contracts';
import { fileCategoryService, type FileEntityAuthorizer } from '../../../platform/files';
import { hasPermission } from '../../../shared/types';
import { fleetDriverProfileRepository } from './driver-profile.repository';

/**
 * Image types a phone or a flatbed scanner actually produces. PDF is deliberately absent: the
 * registry renders this in an `<img>`, and a format that cannot be displayed would be accepted
 * here only to fail at the point of use.
 */
const DRIVER_DOCS_CATEGORY: CreateFileCategory = {
  key: FLEET_DRIVER_FILE_CATEGORY,
  name: { ar: 'مستندات السائقين', en: 'Driver documents' },
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxSizeMb: 10,
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

/** Boot-time idempotent seed, so the category exists before the first upload asks for it. */
export const ensureDriverDocsCategory = async (): Promise<void> => {
  const category = await fileCategoryService.ensure(DRIVER_DOCS_CATEGORY);
  cachedCategoryId = String(category._id);
};

/** The category id an upload writes into (ensures + caches on first use). */
export const resolveDriverDocsCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) await ensureDriverDocsCategory();
  // `ensureDriverDocsCategory` always assigns; the fallback keeps the type honest.
  return cachedCategoryId ?? '';
};

/**
 * Fleet's answer to "may this caller reach a driver's files?".
 *
 * Reads need `fleetDriver.view`, writes need `fleetDriver.manage` — the SAME grants the driver
 * endpoints use: whoever may manage a driver profile may manage its licence scan. Unlike the
 * vehicle seam there is no data scope to apply, because driver profiles are organization-level
 * (the repository is constructed with no scope map: a driver's placement is an HR fact read
 * through the directory seam, not a copy this collection re-scopes on). A missing profile denies
 * rather than throws: the caller learns nothing about whether the id exists.
 */
export const driverProfileFileAuthorizer: FileEntityAuthorizer = {
  entityType: 'driverProfile',
  async authorize({ ctx, entityId, intent }): Promise<boolean> {
    const permission = intent === 'write' ? 'fleetDriver.manage' : 'fleetDriver.view';
    if (!hasPermission(ctx, permission)) return false;
    try {
      await fleetDriverProfileRepository.getById(entityId);
      return true;
    } catch {
      return false;
    }
  },
};
