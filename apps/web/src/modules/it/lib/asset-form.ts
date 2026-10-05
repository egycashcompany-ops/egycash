// The asset form's state, and the new asset that starts from the last one of its category.
//
// «ماذا لو عندي 20 جهاز بنفس المواصفات .. هفضل أكتب نفس المواصفات !؟ أكيد لأ .. لما أختار الفئة
// يحمل البيانات كلها من السابق ماعدا السيريال والـ Tag والحاجات المتغيره فقط». A batch of
// identical devices shares everything but what makes each unit itself: its serial number, its
// printed tag, where it sits and what is noted about it. So when a category is picked for a new
// asset, the most recently registered asset of that category fills the form — every box still
// empty, never one somebody already typed in, and never a per-unit one.
import { type ItAssetDto } from '@ecms/contracts';
import { SPEC_FIELDS, specsDraft, toLines, type SpecsDraft } from './asset-specs';

export interface AssetFormState {
  name: string;
  description: string;
  categoryId: string;
  serialNumber: string;
  model: string;
  manufacturer: string;
  externalTag: string;
  branchId: string;
  location: string;
  purchaseDate: string;
  purchaseCost: string;
  purchaseVendorId: string;
  invoiceRef: string;
  warrantyStart: string;
  warrantyEnd: string;
  warrantyVendorId: string;
  warrantyTerms: string;
  notes: string;
  specs: SpecsDraft;
  /** One per line. */
  accessories: string;
}

/** The fields edited as one text box each. */
export type AssetTextKey = {
  [K in keyof AssetFormState]: AssetFormState[K] extends string ? K : never;
}[keyof AssetFormState];

const day = (iso: string | null): string => (iso === null ? '' : iso.slice(0, 10));

export const assetFormFrom = (asset: ItAssetDto | null): AssetFormState => ({
  name: asset?.name ?? '',
  description: asset?.description ?? '',
  categoryId: asset?.categoryId ?? '',
  serialNumber: asset?.serialNumber ?? '',
  model: asset?.model ?? '',
  manufacturer: asset?.manufacturer ?? '',
  externalTag: asset?.externalTag ?? '',
  branchId: asset?.branchId ?? '',
  location: asset?.location ?? '',
  purchaseDate: day(asset?.purchase?.date ?? null),
  purchaseCost:
    asset?.purchase?.cost === undefined || asset.purchase === null
      ? ''
      : String(asset.purchase.cost ?? ''),
  purchaseVendorId: asset?.purchase?.vendorId ?? '',
  invoiceRef: asset?.purchase?.invoiceRef ?? '',
  warrantyStart: day(asset?.warranty?.start ?? null),
  warrantyEnd: day(asset?.warranty?.end ?? null),
  warrantyVendorId: asset?.warranty?.vendorId ?? '',
  warrantyTerms: asset?.warranty?.terms ?? '',
  notes: asset?.notes ?? '',
  specs: specsDraft(asset?.specs ?? null),
  accessories: toLines(asset?.accessories ?? []),
});

/**
 * What one unit of a batch shares with the others: everything but its serial number, its printed
 * tag, its location and its notes («ماعدا السيريال والـ Tag والحاجات المتغيره»). The category is
 * the one just picked, so it is not copied either.
 */
export const SHARED_FIELDS: readonly Exclude<
  AssetTextKey,
  'serialNumber' | 'externalTag' | 'location' | 'notes' | 'categoryId'
>[] = [
  'name',
  'description',
  'manufacturer',
  'model',
  'branchId',
  'purchaseDate',
  'purchaseCost',
  'purchaseVendorId',
  'invoiceRef',
  'warrantyStart',
  'warrantyEnd',
  'warrantyVendorId',
  'warrantyTerms',
  'accessories',
];

/**
 * The form, filled from `template` — the last asset registered in the picked category, as
 * `assetFormFrom` reads it.
 *
 * A box is filled only while it holds nothing of the user's own: empty, or still exactly what the
 * template applied before put there (`previous` — picking a second category swaps one template for
 * the other instead of leaving the first one's values behind). Anything typed stays.
 */
export const prefillFrom = (
  form: AssetFormState,
  template: AssetFormState,
  previous: AssetFormState | null = null,
): AssetFormState => {
  const untouched = (mine: string, earlier: string | undefined): boolean =>
    mine === '' || (earlier !== undefined && earlier !== '' && mine === earlier);
  const next: AssetFormState = { ...form, specs: { ...form.specs } };
  for (const key of SHARED_FIELDS) {
    if (untouched(form[key], previous?.[key])) next[key] = template[key];
  }
  for (const { key } of SPEC_FIELDS) {
    if (untouched(form.specs[key], previous?.specs[key])) next.specs[key] = template.specs[key];
  }
  if (untouched(form.specs.networkAdapters, previous?.specs.networkAdapters)) {
    next.specs.networkAdapters = template.specs.networkAdapters;
  }
  return next;
};
