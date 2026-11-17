// What a job write does to the job's places (P-ORG-3 §5.2), decided without I/O.
//
// The request sends the WHOLE set. Duplicates are merged (a «نقل إلى» onto a place the job already
// has is a removal of the moved one). What is new must be placeable; what is already stored may stay
// even under a stopped department or section — that is how a form that was sent a «موقوف» row keeps
// it by sending it back.
import { type ChartIndex, type ChartInput } from './org-chart.groups';

export interface PlaceKeyed {
  departmentCatalogId: string;
  sectionCatalogId: string | null;
}

export interface StoredPlace extends PlaceKeyed {
  id: string;
}

export const keyOf = (place: PlaceKeyed): string =>
  `${place.departmentCatalogId.toLowerCase()}|${place.sectionCatalogId?.toLowerCase() ?? ''}`;

/** One entry per place, first occurrence kept. */
export const mergePlaces = <P extends PlaceKeyed>(places: readonly P[]): P[] => {
  const seen = new Set<string>();
  const out: P[] = [];
  for (const place of places) {
    const key = keyOf(place);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(place);
  }
  return out;
};

/** Why a NEW place cannot be written — or null when it can. */
export const refusePlace = (place: PlaceKeyed, index: ChartIndex): string | null => {
  const department = index.departmentByEntry.get(place.departmentCatalogId.toLowerCase());
  if (department === undefined || !department.shown || !department.editable) {
    return 'the department is not editable here (no active rows, not linked, or stopped)';
  }
  if (place.sectionCatalogId === null) return null;
  const section = index.sectionByEntry.get(place.sectionCatalogId.toLowerCase());
  if (section === undefined || section.department !== department) {
    return 'the section is not a section of this department';
  }
  if (!section.section.shown || !section.section.editable) return 'the section is stopped';
  return null;
};

export interface PlacePlan {
  toAdd: PlaceKeyed[];
  toRemove: StoredPlace[];
  /** The set as it will stand after the write. */
  after: PlaceKeyed[];
}

export interface PlaceRefusal {
  refused: { place: PlaceKeyed; reason: string }[];
}

/**
 * Compare the requested set with what is stored. `jobActiveAfter` is the job's status AFTER this
 * write: a new place is written only for a job that is active then.
 */
export const planPlaces = (
  stored: readonly StoredPlace[],
  requested: readonly PlaceKeyed[],
  index: ChartIndex,
  jobActiveAfter: boolean,
): PlacePlan | PlaceRefusal => {
  const wanted = mergePlaces(requested);
  const storedKeys = new Map(stored.map((place) => [keyOf(place), place]));
  const wantedKeys = new Set(wanted.map(keyOf));
  const toAdd = wanted.filter((place) => !storedKeys.has(keyOf(place)));
  const refused = toAdd
    .map((place) => ({ place, reason: jobActiveAfter ? refusePlace(place, index) : 'the job is not active' }))
    .filter((r): r is { place: PlaceKeyed; reason: string } => r.reason !== null);
  if (refused.length > 0) return { refused };
  return {
    toAdd,
    toRemove: stored.filter((place) => !wantedKeys.has(keyOf(place))),
    after: wanted,
  };
};

/** «العمليات › الخزينة» — the labels an audit entry records, sorted. */
export const labelPlaces = (places: readonly PlaceKeyed[], input: ChartInput): string[] => {
  const departments = new Map(input.departmentEntries.map((entry) => [entry.id.toLowerCase(), entry.name.ar]));
  const sections = new Map(input.sectionEntries.map((entry) => [entry.id.toLowerCase(), entry.name.ar]));
  return places
    .map((place) => {
      const department = departments.get(place.departmentCatalogId.toLowerCase()) ?? place.departmentCatalogId;
      if (place.sectionCatalogId === null) return department;
      return `${department} › ${sections.get(place.sectionCatalogId.toLowerCase()) ?? place.sectionCatalogId}`;
    })
    .sort((a, b) => a.localeCompare(b, 'ar'));
};
