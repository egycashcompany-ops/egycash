// «غير محدد» — the ONE catalog row per side a violation whose type nobody wrote is filed under.
//
// The go-live import adds it (only for a side some book row actually left blank) and files such a
// row under it; the fleet dashboard's «مخالفات الفترة حسب النوع» names it «غير محدد» and draws it
// LAST, after every type somebody did write. Both read this one record, so the name the import
// writes is the name the dashboard recognises.
//
// KNOWN LIMIT: the dashboard recognises the row by its Arabic NAME (the catalog keeps no other
// mark). A clerk who renames it in «الكتالوجات» turns it into an ordinary type: it is then sorted
// like any other and drawn under its new name — nothing is lost, only the «last» place.
import { type FleetViolationSide, type LocalizedString } from '@ecms/contracts';

/** The catalog row a violation whose type nobody wrote is filed under, one per side. */
export const UNSPECIFIED_VIOLATION_TYPE: Readonly<
  Record<FleetViolationSide, { ar: string; en: string }>
> = {
  company: { ar: 'غير محدد (مخالفات الشركة)', en: 'Unspecified (company)' },
  driver: { ar: 'غير محدد (مخالفات السائقين)', en: 'Unspecified (driver)' },
};

/** Spacing folded, so «غير محدد  (مخالفات السائقين) » is still the row. */
const folded = (name: string): string => name.replace(/\s+/gu, ' ').trim();

const UNSPECIFIED_NAMES = new Set(
  Object.values(UNSPECIFIED_VIOLATION_TYPE).map((name) => folded(name.ar)),
);

/** Is this catalog name the «غير محدد» row (either side's)? A type gone from the catalog is not. */
export const isUnspecifiedViolationType = (name: LocalizedString | null | undefined): boolean =>
  name != null && typeof name.ar === 'string' && UNSPECIFIED_NAMES.has(folded(name.ar));
