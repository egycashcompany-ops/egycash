// How a crew's van is named on every screen after «لوحة التشغيلة» (Round 24).
//
// THE OWNER: «عاوز لو عربيه من غير كود عادى تظهر ان اوزع عليها محصنات». Since Round 24 a crew row
// WITHOUT A VAN carries محصنات like a van: «توزيع المحصنات» lists it, «تسليم المحصنات» hands its load
// over, and its legs reach the day board, the vault's screens and «صرف الخزينة». Its `vehicleId` and
// `vehicleCode` are then null — and a screen must say «بدون سيارة», never "null", "undefined", an id,
// or the «…» that means «Fleet cannot name this van» (a van that EXISTS — `vehicleId` set, code
// null).
//
// Several such crews on one day are told apart as the board tells them apart: «بدون سيارة (1)»,
// «بدون سيارة (2)» — numbered in the order they are listed, which is the order they were added
// (`looseCrewNumbers`).

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The two facts a name is made of — every crew and leg DTO carries them. */
export interface CrewVan {
  vehicleId: string | null;
  vehicleCode: string | null;
}

/** A crew with no van — «بدون سيارة». */
export const hasNoVan = (crew: CrewVan): boolean => crew.vehicleId === null;

/**
 * The van-less crews of a list, numbered from 1 in the list's order: crew row id → its number.
 * A list with one such crew still numbers it — as the board does.
 */
export const looseCrewNumbers = (
  crews: readonly (CrewVan & { crewAssignmentId: string })[],
): Map<string, number> => {
  const numbers = new Map<string, number>();
  for (const crew of crews) {
    if (hasNoVan(crew) && !numbers.has(crew.crewAssignmentId)) {
      numbers.set(crew.crewAssignmentId, numbers.size + 1);
    }
  }
  return numbers;
};

/**
 * Where a code is printed (a cell, a card's head): the van's code; «…» when Fleet cannot name an
 * existing van; «بدون سيارة» — «بدون سيارة (n)» when numbered — for a crew without one.
 */
export const vanCodeText = (t: Translate, crew: CrewVan, number?: string | null): string => {
  if (!hasNoVan(crew)) return crew.vehicleCode ?? '…';
  return number === undefined || number === null
    ? t('operations.crewPlan.noVehicle')
    : t('operations.crewPlan.looseRow', { n: number });
};

/**
 * In a sentence («سُلّمت محصنتان إلى …»): «السيارة 249», or «الطاقم بدون سيارة (n)» — a crew without
 * a van read as a crew, not as a van called «بدون سيارة».
 */
export const vanPhrase = (t: Translate, crew: CrewVan, number?: string | null): string => {
  if (!hasNoVan(crew))
    return t('operations.distribution.vanLabel', { code: crew.vehicleCode ?? '…' });
  return number === undefined || number === null
    ? t('operations.distribution.looseCrew')
    : t('operations.distribution.looseLabel', { n: number });
};
