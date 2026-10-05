// What a receipt line prints about the device — «إقرار استلام» (FR-18).
//
// «بأنني قد استلمت جهاز لاب توب برقم مسلسل … ومواصفاته كالتالي: [table] ومشتملاته كالتالي: …».
// Each line of a receipt is one page of the acknowledgment, and this is the part of it that comes
// from the asset: the kind of device (its category, as the paper names it), its make and model,
// its specifications table and what is handed over with it. Taken as a SNAPSHOT when the receipt
// is written, like everything else on it: the paper the employee signed must print the same
// tomorrow, whatever is edited on the asset after.
//
// One composer for every path that writes or previews a receipt — the hand-over, a transfer to a
// new holder, a receipt issued for older custody and the print before any of them — so the paper
// previewed is the paper stored.
import { itCatalogItemRepository } from '../catalog-items/catalog-item.repository';
import { itAssetRepository } from './asset.repository';
import { type ItAssetDoc, type ItAssetSpecsSub } from './asset.model';

export interface ReceiptDeviceFields {
  deviceType: string | null;
  manufacturer: string | null;
  model: string | null;
  specs: ItAssetSpecsSub | null;
  accessories: string[];
}

/**
 * The paper's name for each asset's kind of device: its category's Arabic name, by category id.
 * One read for all the lines, outside any transaction — a catalog name is reference data, not
 * part of the custody write. A retired category still names the device it was given to.
 */
export const readDeviceTypes = async (
  assets: readonly Pick<ItAssetDoc, 'categoryId'>[],
): Promise<ReadonlyMap<string, string>> => {
  const categories = await itCatalogItemRepository.findByIdsSystem(
    assets.map((asset) => String(asset.categoryId)),
  );
  return new Map(categories.map((category) => [String(category._id), category.name.ar]));
};

/**
 * The same, for assets known only by id — a hand-over or a transfer, which read their assets again,
 * scoped, inside the transaction. This read only names their kind; it is not the access check.
 */
export const readDeviceTypesOf = async (
  assetIds: readonly string[],
): Promise<ReadonlyMap<string, string>> =>
  readDeviceTypes(await itAssetRepository.findByIdsSystem(assetIds));

/** The table as it prints: every row present, and null when there is nothing to print at all. */
const snapshotSpecs = (specs: ItAssetSpecsSub | null | undefined): ItAssetSpecsSub | null => {
  if (specs == null) return null;
  const snapshot: ItAssetSpecsSub = {
    processor: specs.processor ?? null,
    memory: specs.memory ?? null,
    systemType: specs.systemType ?? null,
    storage: specs.storage ?? null,
    mediaDrive: specs.mediaDrive ?? null,
    displayAdapter: specs.displayAdapter ?? null,
    graphicsMemory: specs.graphicsMemory ?? null,
    networkAdapters: [...(specs.networkAdapters ?? [])],
  };
  const { networkAdapters, ...single } = snapshot;
  return networkAdapters.length === 0 && Object.values(single).every((value) => value === null)
    ? null
    : snapshot;
};

/**
 * One line's device fields. `accessories` is what the hand-over said came with it this time;
 * omitted, the asset's own list is what the paper lists.
 */
export const receiptDeviceFields = (
  asset: ItAssetDoc,
  deviceTypes: ReadonlyMap<string, string>,
  accessories?: readonly string[],
): ReceiptDeviceFields => ({
  deviceType: deviceTypes.get(String(asset.categoryId)) ?? null,
  manufacturer: asset.manufacturer,
  model: asset.model,
  specs: snapshotSpecs(asset.specs),
  accessories: [...(accessories ?? asset.accessories ?? [])],
});
