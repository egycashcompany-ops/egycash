// The Files-service surface behind a contract's pages («مرفقات العقد»), as the notices' and the
// dealership's: the CATEGORY so intake refuses what the screen cannot show (photos and PDFs, 10 MB
// each), and the AUTHORIZER (ADR-023) so the platform's own file endpoints ask the contracts'
// grants rather than opening a side door to the same bytes.
import {
  FLEET_VEHICLE_CONTRACT_FILE_CATEGORY,
  FLEET_VEHICLE_CONTRACT_FILE_MAX_MB,
  FLEET_VEHICLE_CONTRACT_FILE_MIMES,
  type CreateFileCategory,
} from '@ecms/contracts';
import { fileCategoryService, type FileEntityAuthorizer } from '../../../platform/files';
import { hasPermission } from '../../../shared/types';
import { fleetVehicleContractRepository } from './vehicle-contract.repository';

const VEHICLE_CONTRACT_DOCS_CATEGORY: CreateFileCategory = {
  key: FLEET_VEHICLE_CONTRACT_FILE_CATEGORY,
  name: { ar: 'مرفقات عقود توريد السيارات', en: 'Vehicle supply contract attachments' },
  allowedMimeTypes: [...FLEET_VEHICLE_CONTRACT_FILE_MIMES],
  maxSizeMb: FLEET_VEHICLE_CONTRACT_FILE_MAX_MB,
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

/** Boot-time idempotent seed, so the category exists before the first upload asks for it. */
export const ensureVehicleContractDocsCategory = async (): Promise<void> => {
  const category = await fileCategoryService.ensure(VEHICLE_CONTRACT_DOCS_CATEGORY);
  cachedCategoryId = String(category._id);
};

/** The category id an upload writes into (ensures + caches on first use). */
export const resolveVehicleContractDocsCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) await ensureVehicleContractDocsCategory();
  return cachedCategoryId ?? '';
};

/**
 * Reads need `fleetVehicleContract.view`; writes `fleetVehicleContract.edit` or `.create` (the
 * editor uploads a new contract's pages right after creating it). Either way the contract must be
 * live — a deleted contract's pages are reachable by nobody.
 */
export const vehicleContractFileAuthorizer: FileEntityAuthorizer = {
  entityType: 'vehicleContract',
  async authorize({ ctx, entityId, intent }): Promise<boolean> {
    const allowed =
      intent === 'write'
        ? hasPermission(ctx, 'fleetVehicleContract.edit') ||
          hasPermission(ctx, 'fleetVehicleContract.create')
        : hasPermission(ctx, 'fleetVehicleContract.view');
    if (!allowed) return false;
    try {
      await fleetVehicleContractRepository.getById(entityId);
      return true;
    } catch {
      return false;
    }
  },
};
