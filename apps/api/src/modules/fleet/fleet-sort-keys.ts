// Sort keys the Fleet registers publish but do not store.
//
// Three shapes, and the third is the one worth reading twice:
//
//   • JOINED FROM FLEET'S OWN COLLECTIONS — «كود السيارة», «النوع». Declared beside the repository
//     that owns the reference; see `VEHICLE_CODE_SORT`.
//   • JOINED ACROSS THE FR-11 LINE — «اسم السائق». The name belongs to HR, and Fleet may not
//     import HR or name its collections, so the join is declared by HR on the platform seam
//     (`DirectoryNameSource`) and only performed here.
//   • COMPUTED PER VEHICLE — «فارق عداد الصيانة», «منذ الخدمة», «المتبقي». Those live in
//     `maintenance/alarm-sort.ts`, beside the projection that derives them: they are the one kind
//     a REPOSITORY cannot ask for, because computing them reads the registers themselves.
import { getDirectoryNameSource } from '../../platform/directory';
import { type SortDerivedField } from '../../shared/base/base.repository';

/**
 * «اسم السائق», as a sort key — one per driver field a register records.
 *
 * `null` when no employee directory has registered, which is the seam's own fail-closed posture:
 * the key is then not published at all, so the order falls back to the register's default rather
 * than to a `$sort` on a field that does not exist — a page that quietly ignores the arrow is
 * worse than one that visibly does not offer it.
 */
export const driverNameSort = (key: string, localField: string): SortDerivedField | null => {
  const source = getDirectoryNameSource();
  // `== null` covers both the unregistered seam and a deployment that registered nothing: either
  // way there is nowhere to read a name from, and the key is simply not published.
  if (source == null) return null;
  return { key, from: source.collection, localField, pick: source.nameField };
};

/** The name keys a register publishes, with the ones the directory cannot answer dropped. */
export const driverNameSorts = (
  fields: readonly (readonly [key: string, localField: string])[],
): SortDerivedField[] =>
  fields
    .map(([key, localField]) => driverNameSort(key, localField))
    .filter((entry): entry is SortDerivedField => entry !== null);
