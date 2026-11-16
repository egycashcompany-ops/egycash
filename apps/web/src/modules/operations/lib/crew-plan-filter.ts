// «لوحة التشغيلة» — the bar's three new filters (Round 24).
//
// THE OWNER: «وعاوز ف الفلاتر ازود بين يوم التشغيلة وكل الانوع انه يقدر يفلتر ب كود عربيه و كمان ادخل
// اسم قائد او اخصائى او الكود بتاع اى حد فيهم وكمان افلتر ب الاتجاه». Between «يوم التشغيلة» and «كل
// الأنواع», in that order:
//   · THE VAN — one or more of the board's vans by code (a searchable list), and «بدون سيارة» for the
//     rows without one;
//   · THE PERSON — a box: a captain's or a specialist's NAME or CODE on the row, folded as the pools'
//     search folds it («احمد» finds «أحمد», «١٢» finds 12);
//   · THE DIRECTION — one or more of the areas the board's directions name (a direction of two areas,
//     «المعادي - حلوان», is found under each), and «بدون اتجاه».
// AND-combined with each other and with the type (the list and the chips): a row is shown when it
// passes every filter set. Inside one list the choices are OR-ed — two vans show both.
//
// VIEW ONLY. A filter hides rows from the table, never from the plan: a hidden row keeps its draft,
// «حفظ» saves every change, and «تراجع» takes back the last operation wherever it was. The chips of
// the strip count the WHOLE DAY, as before; what the filters leave is said beside them («المعروض ٥ من
// ٤٨»), so the two numbers never pretend to be one.
import { foldOperationsAreaName, type OperationsCrewMemberDto } from '@ecms/contracts';
import { foldIncludes } from '../../../shared/lib/fold';
import { byVehicleCode } from './crew-vehicles';
import { rowPeople, type PlanRow } from './crew-plan';

/** The van filter's «بدون سيارة», and the direction filter's «بدون اتجاه». */
export const NO_VAN = 'none';
export const NO_DIRECTION = 'none';

export interface PlanRowFilter {
  /** Vehicle ids, or `NO_VAN`. Empty — every row. */
  vans: readonly string[];
  /** A name or a code, as typed. Blank — every row. */
  person: string;
  /** Folded area names (`foldOperationsAreaName`), or `NO_DIRECTION`. Empty — every row. */
  directions: readonly string[];
}

export const EMPTY_ROW_FILTER: PlanRowFilter = { vans: [], person: '', directions: [] };

/** Is any of the three set? */
export const isRowFiltering = (filter: PlanRowFilter): boolean =>
  filter.vans.length > 0 || filter.person.trim() !== '' || filter.directions.length > 0;

/** The same rule as the direction's save (`canonicalOperationsDirection`): its separators. */
const DIRECTION_SEPARATOR = /\s*[-–—/\\|،,؛;+&]\s*|\s+و\s+/u;

/**
 * The areas a row's direction names, each once — its value (folded, the server's rule) and its
 * words as written. The WHOLE text is one area when it is the name of one (`areaNames` — an area
 * whose name holds a separator, «شبرا/الخيمة», is never split), else it is split as the save splits
 * it. None for a row without a direction.
 */
export const directionParts = (
  direction: string | null,
  areaNames: readonly string[] = [],
): { value: string; label: string }[] => {
  if (direction === null || direction.trim() === '') return [];
  const whole = foldOperationsAreaName(direction);
  if (areaNames.some((name) => foldOperationsAreaName(name) === whole)) {
    return [{ value: whole, label: direction.trim() }];
  }
  const seen = new Set<string>();
  return direction
    .split(DIRECTION_SEPARATOR)
    .map((part) => part.trim())
    .flatMap((label) => {
      const value = foldOperationsAreaName(label);
      if (value === '' || seen.has(value)) return [];
      seen.add(value);
      return [{ value, label }];
    });
};

/** The van list: the draft's vans by code (numbers in number order) — `NO_VAN` is the page's. */
export const vanFilterOptions = (rows: readonly PlanRow[]): { value: string; label: string }[] => {
  const seen = new Set<string>();
  return rows
    .flatMap((row) =>
      row.vehicleId === null || seen.has(row.vehicleId)
        ? []
        : [
            (seen.add(row.vehicleId),
            { vehicleId: row.vehicleId, vehicleCode: row.vehicleCode ?? '…' }),
          ],
    )
    .sort(byVehicleCode)
    .map((van) => ({ value: van.vehicleId, label: van.vehicleCode }));
};

/** The direction list: every area the draft's directions name, once, in Arabic order. */
export const directionFilterOptions = (
  rows: readonly PlanRow[],
  areaNames: readonly string[] = [],
): { value: string; label: string }[] => {
  const byValue = new Map<string, string>();
  for (const row of rows) {
    for (const part of directionParts(row.direction, areaNames)) {
      if (!byValue.has(part.value)) byValue.set(part.value, part.label);
    }
  }
  return [...byValue.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ar'));
};

/** Does somebody on the row answer the person box — a captain or a specialist, by name or code? */
export const matchesPerson = (
  row: PlanRow,
  search: string,
  memberOf: (
    employeeId: string,
  ) => Pick<OperationsCrewMemberDto, 'fullNameAr' | 'code'> | undefined,
): boolean => {
  if (search.trim() === '') return true;
  return rowPeople(row).some((employeeId) => {
    const member = memberOf(employeeId);
    return (
      member !== undefined &&
      (foldIncludes(member.fullNameAr, search) || foldIncludes(member.code, search))
    );
  });
};

/** One row against the three filters, AND-ed. The type is the page's `matchesShiftType`. */
export const matchesRowFilter = (
  row: PlanRow,
  filter: PlanRowFilter,
  context: {
    memberOf: (
      employeeId: string,
    ) => Pick<OperationsCrewMemberDto, 'fullNameAr' | 'code'> | undefined;
    areaNames?: readonly string[];
  },
): boolean => {
  if (filter.vans.length > 0) {
    const wanted = row.vehicleId === null ? NO_VAN : row.vehicleId;
    if (!filter.vans.includes(wanted)) return false;
  }
  if (filter.directions.length > 0) {
    const parts = directionParts(row.direction, context.areaNames);
    const hit =
      parts.length === 0
        ? filter.directions.includes(NO_DIRECTION)
        : parts.some((part) => filter.directions.includes(part.value));
    if (!hit) return false;
  }
  return matchesPerson(row, filter.person, context.memberOf);
};
