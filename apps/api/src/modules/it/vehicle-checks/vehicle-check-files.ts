// The Files-service surface behind a vehicle check's photos («الصور»; design §6.1 "Files"): the
// CATEGORY, so intake refuses what the form cannot carry, and the AUTHORIZER (ADR-023), so the
// platform's own file endpoints ask IT before anyone reaches a photo — two of the cameras look
// inside the car's safe.
import {
  IT_VEHICLE_CHECK_PHOTO_FILE_CATEGORY,
  IT_VEHICLE_CHECK_PHOTO_MAX_MB,
  IT_VEHICLE_CHECK_PHOTO_MIME_TYPES,
  type CreateFileCategory,
} from '@ecms/contracts';
import { fileCategoryService, type FileEntityAuthorizer } from '../../../platform/files';
import { hasPermission } from '../../../shared/types';
import { itVehicleCheckRepository } from './vehicle-check.repository';

const VEHICLE_CHECK_PHOTO_CATEGORY: CreateFileCategory = {
  key: IT_VEHICLE_CHECK_PHOTO_FILE_CATEGORY,
  name: { ar: 'صور فحص أجهزة السيارات', en: 'Vehicle device check photos' },
  allowedMimeTypes: [...IT_VEHICLE_CHECK_PHOTO_MIME_TYPES],
  maxSizeMb: IT_VEHICLE_CHECK_PHOTO_MAX_MB,
  // Kept, as the custody papers are (design §7).
  retentionDays: null,
};

let categoryId: Promise<string> | null = null;

/**
 * Idempotent: the category is created the first time a photo asks for it. Its id.
 *
 * The PROMISE is what is kept, not the id: several photos arriving together on a fresh process
 * share one `ensure` instead of each creating the category and all but one losing its unique key.
 * A failure is forgotten, so the next photo tries again (`ensure-collection.ts`'s rule).
 */
export const vehicleCheckPhotoCategory = (): Promise<string> => {
  categoryId ??= fileCategoryService.ensure(VEHICLE_CHECK_PHOTO_CATEGORY).then(
    (category) => String(category._id),
    (error: unknown) => {
      categoryId = null;
      throw error;
    },
  );
  return categoryId;
};

/**
 * A WRITE is answered only for the report's own reporter, holding `itVehicleCheck.create`, on a
 * live report — unscoped, as filing is (design §4). No READ is answered at all: no screen reads a
 * report or its photos until the dashboard brings `itVehicleCheck.view`.
 */
export const vehicleCheckFileAuthorizer: FileEntityAuthorizer = {
  entityType: 'vehicleCheck',
  async authorize({ ctx, entityId, intent }): Promise<boolean> {
    if (intent === 'read') return false;
    if (!hasPermission(ctx, 'itVehicleCheck.create')) return false;
    return (await itVehicleCheckRepository.findOwnLive(entityId, ctx.userId)) !== null;
  },
};
