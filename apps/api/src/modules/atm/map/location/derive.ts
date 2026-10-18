// Choosing a machine's location from its register text, and deciding what a re-derivation may
// write (docs/12-planning/atm-map-zones.md §4.3, DM-2, DM-34, DM-44).
//
// Pure: no model, no query. The service reads the open entries through its one projected helper
// (`openEntryLocationTexts`), hands the texts here, and writes what `applyDerivation` returns. Ids
// are strings at this edge.
//
// THE TWO RULES THAT MATTER MOST.
//   · No location is invented. A point is placed only when the text gives one; a short Plus Code
//     is recovered only against located pins of the SAME branch (DM-34), never another branch, and
//     every recovered point waits for a person (DM-4).
//   · A pin a person set is never erased by text that yields nothing (DM-2). It is replaced only
//     when the register text changed since the pin was set AND the new text gives a point.
import {
  ATM_MAP_LOCATION_WARNINGS,
  round6,
  type AtmBankCode,
  type AtmMapLatLng,
  type AtmMapLinkFailure,
  type AtmMapLocationSource,
  type AtmMapLocationTexts,
  type AtmMapLocationWarning,
  type AtmMapReferenceBasis,
  type AtmMapUnlocatedReason,
} from '@ecms/contracts';
import {
  haversineMeters,
  insideEgypt,
  readLocationText,
  type LocationCandidate,
} from './maps-text';
import { decode, recoverNearest } from './plus-code';

/** Which register column produced the point. */
export type AtmMapLocationField = 'locationUrl' | 'locationPlusCode';

/** Two candidates further apart than this make the winner a review pin (DM-44c). */
export const SOURCES_DISAGREE_METERS = 1000;
/** DM-34: a basis of fewer pins than this, or one spread wider, is `weakReference`. */
export const WEAK_REFERENCE_MIN_PINS = 3;
export const WEAK_REFERENCE_SPREAD_DEGREES = 0.4;

/** The point a short code was recovered against. `weak` is never stored; it becomes a warning. */
export interface ReferencePoint {
  lat: number;
  lng: number;
  basis: AtmMapReferenceBasis;
  machines: number;
  weak: boolean;
}
export type StoredReference = Omit<ReferencePoint, 'weak'>;

/** The location document's `shortLink` (§3.3). */
export interface StoredShortLink {
  url: string;
  status: 'pending' | 'resolved' | 'failed';
  lat: number | null;
  lng: number | null;
  viewportOnly: boolean;
  failure: AtmMapLinkFailure | null;
  attempts: number;
  lastAttemptAt: Date | null;
  claimedAt: Date | null;
}

export interface DeriveInput {
  /** null = no usable open entry (then `entryProblem` says why). */
  texts: AtmMapLocationTexts | null;
  /** Sorted ids of ALL open entries (→ `seenEntryIds`). */
  entryIds: string[];
  entryProblem: 'noEntry' | 'conflictingEntries' | null;
  /** The document's stored `shortLink`, when it has one. */
  resolvedLink: {
    url: string;
    status: 'pending' | 'resolved' | 'failed';
    lat?: number | null;
    lng?: number | null;
    viewportOnly?: boolean;
    failure?: AtmMapLinkFailure | null;
  } | null;
  /** DM-34: the reference for a short code; `urlReference` is the same URL's own viewport. */
  reference: (urlReference: AtmMapLatLng | null) => ReferencePoint | null;
}

export interface Derived {
  status: 'located' | 'unlocated';
  lat: number | null;
  lng: number | null;
  source: AtmMapLocationSource | null;
  needsReview: boolean;
  reason: AtmMapUnlocatedReason | null;
  warnings: AtmMapLocationWarning[];
  sourceField: AtmMapLocationField | null;
  /** The short link to keep queued (or resolved) for this machine; null = none is needed. */
  shortLinkUrl: string | null;
  reference: StoredReference | null;
  seenText: AtmMapLocationTexts | null;
  seenEntryIds: string[];
}

// ── Texts ───────────────────────────────────────────────────────────────────────────────────────

const clean = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
};

/** Trimmed, `''` as null; a null text is the all-empty pair (§4.3 comparisons). */
export const normalizeTexts = (texts: AtmMapLocationTexts | null): AtmMapLocationTexts => ({
  plusCode: clean(texts?.plusCode),
  url: clean(texts?.url),
});

export const sameTexts = (
  a: AtmMapLocationTexts | null,
  b: AtmMapLocationTexts | null,
): boolean => {
  const x = normalizeTexts(a);
  const y = normalizeTexts(b);
  return x.plusCode === y.plusCode && x.url === y.url;
};

export const sameIds = (a: readonly string[], b: readonly string[]): boolean => {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((id, i) => id === y[i]);
};

/** One open register entry, as `openEntryLocationTexts` projects it. */
export interface OpenEntryTexts {
  id: string;
  locationUrl?: string | null;
  locationPlusCode?: string | null;
}

/**
 * Which register entry is the source (§4.3). None → `noEntry` (an entry that ended is not used,
 * GM-23). Several — only an exempt duplicate pair (EG-8) — are merged field by field: each field's
 * non-empty values must agree, otherwise `conflictingEntries`.
 */
export const mergeOpenEntries = (
  entries: readonly OpenEntryTexts[],
): Pick<DeriveInput, 'texts' | 'entryIds' | 'entryProblem'> => {
  const entryIds = entries.map((e) => e.id).sort();
  if (entries.length === 0) return { texts: null, entryIds, entryProblem: 'noEntry' };
  /** The field's one value, null when empty everywhere, undefined when the entries disagree. */
  const single = (values: (string | null | undefined)[]): string | null | undefined => {
    const set = new Set(values.map(clean).filter((v): v is string => v !== null));
    return set.size > 1 ? undefined : ([...set][0] ?? null);
  };
  const url = single(entries.map((e) => e.locationUrl));
  const plusCode = single(entries.map((e) => e.locationPlusCode));
  if (url === undefined || plusCode === undefined) {
    return { texts: null, entryIds, entryProblem: 'conflictingEntries' };
  }
  return { texts: { plusCode, url }, entryIds, entryProblem: null };
};

/** DM-17: the open entries' common register bank, or null when they differ (or there is none). */
export const commonBankCode = (
  codes: readonly (AtmBankCode | null | undefined)[],
): AtmBankCode | null => {
  const set = new Set(codes.map((code) => code ?? null));
  return set.size === 1 ? ([...set][0] ?? null) : null;
};

// ── Reference point (DM-34) ─────────────────────────────────────────────────────────────────────

/** One location document of the pool, joined to its machine's `area` and deleted flag. */
export interface ReferencePoolEntry {
  machineId: string;
  branchId: string;
  area: string | null;
  machineDeleted: boolean;
  status: 'located' | 'unlocated';
  lat: number | null;
  lng: number | null;
  needsReview: boolean;
  source: AtmMapLocationSource | null;
  warnings: readonly AtmMapLocationWarning[];
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

const areaKey = (area: string | null): string => (area ?? '').trim().toLowerCase();

/**
 * The reference for a short code of machine `selfId` (DM-34): the median of the trustworthy pins
 * of the same branch and the same area (trimmed, case-folded), else of the same branch, else null.
 * Only located pins that need no review, did not come from a short code and carry no warning count,
 * so one recovery never chains on another. Another branch is never used.
 */
export const referenceFor = (
  pool: readonly ReferencePoolEntry[],
  branchId: string,
  area: string | null,
  selfId: string,
): ReferencePoint | null => {
  const pins = pool.filter(
    (p) =>
      p.branchId === branchId &&
      p.machineId !== selfId &&
      !p.machineDeleted &&
      p.status === 'located' &&
      p.lat !== null &&
      p.lng !== null &&
      !p.needsReview &&
      p.source !== 'registerShortCode' &&
      p.warnings.length === 0,
  );
  const sameArea = pins.filter((p) => areaKey(p.area) === areaKey(area));
  const basis: AtmMapReferenceBasis | null =
    sameArea.length > 0 ? 'area' : pins.length > 0 ? 'branch' : null;
  if (basis === null) return null;
  const used = basis === 'area' ? sameArea : pins;
  const lat = round6(median(used.map((p) => p.lat as number)));
  const lng = round6(median(used.map((p) => p.lng as number)));
  const weak =
    used.length < WEAK_REFERENCE_MIN_PINS ||
    used.some(
      (p) =>
        Math.abs((p.lat as number) - lat) > WEAK_REFERENCE_SPREAD_DEGREES ||
        Math.abs((p.lng as number) - lng) > WEAK_REFERENCE_SPREAD_DEGREES,
    );
  return { lat, lng, basis, machines: used.length, weak };
};

/**
 * `DeriveInput.reference` for one machine: the URL's own viewport when the code came from a URL
 * (basis `url`, never weak — it is the same link's own map), otherwise `referenceFor`.
 */
export const referenceLookup =
  (pool: readonly ReferencePoolEntry[], branchId: string, area: string | null, selfId: string) =>
  (urlReference: AtmMapLatLng | null): ReferencePoint | null =>
    urlReference !== null
      ? { lat: urlReference.lat, lng: urlReference.lng, basis: 'url', machines: 0, weak: false }
      : referenceFor(pool, branchId, area, selfId);

// ── Ranking (§4.3) ──────────────────────────────────────────────────────────────────────────────

interface Ranked {
  rank: number;
  field: AtmMapLocationField;
  candidate: LocationCandidate;
  point: AtmMapLatLng | null;
  source: AtmMapLocationSource | null;
  reason: AtmMapUnlocatedReason | null;
  needsReview: boolean;
  warnings: AtmMapLocationWarning[];
  reference: ReferencePoint | null;
}

/** AV's candidates first, then AP's, each in the order they occur in the cell. */
const candidatesOf = (
  texts: AtmMapLocationTexts,
): { field: AtmMapLocationField; candidate: LocationCandidate }[] => [
  ...(texts.url === null ? [] : readLocationText(texts.url)).map((candidate) => ({
    field: 'locationUrl' as const,
    candidate,
  })),
  ...(texts.plusCode === null ? [] : readLocationText(texts.plusCode)).map((candidate) => ({
    field: 'locationPlusCode' as const,
    candidate,
  })),
];

const point = (lat: number, lng: number): AtmMapLatLng => ({ lat: round6(lat), lng: round6(lng) });

const rank = (
  field: AtmMapLocationField,
  candidate: LocationCandidate,
  input: Pick<DeriveInput, 'resolvedLink' | 'reference'>,
): Ranked => {
  const base = { field, candidate, point: null, source: null, reason: null, needsReview: false };
  const located = (
    r: number,
    p: AtmMapLatLng,
    source: AtmMapLocationSource,
    needsReview: boolean,
    warnings: AtmMapLocationWarning[],
    reference: ReferencePoint | null = null,
  ): Ranked => ({ ...base, rank: r, point: p, source, needsReview, warnings, reference });
  const unlocated = (r: number, reason: AtmMapUnlocatedReason): Ranked => ({
    ...base,
    rank: r,
    reason,
    warnings: [],
    reference: null,
  });

  switch (candidate.kind) {
    case 'coordinates':
      return located(
        1,
        point(candidate.lat, candidate.lng),
        candidate.via === 'url' ? 'registerUrl' : 'registerCoordinates',
        candidate.ambiguous,
        candidate.ambiguous ? ['ambiguousUrl'] : [],
      );
    case 'plusCode': {
      const centre = decode(candidate.code);
      return located(2, point(centre.lat, centre.lng), 'registerPlusCode', false, []);
    }
    case 'shortLink': {
      const stored = input.resolvedLink;
      if (stored !== null && stored.url === candidate.url) {
        if (
          stored.status === 'resolved' &&
          typeof stored.lat === 'number' &&
          typeof stored.lng === 'number'
        ) {
          const viewportOnly = stored.viewportOnly === true;
          return located(
            3,
            point(stored.lat, stored.lng),
            'registerShortLink',
            viewportOnly,
            viewportOnly ? ['viewportOnly'] : [],
          );
        }
        if (stored.status === 'failed') return unlocated(7, 'shortLinkFailed');
      }
      return unlocated(6, 'shortLink');
    }
    case 'shortPlusCode': {
      const reference = input.reference(candidate.urlReference);
      if (reference === null) return unlocated(9, 'shortPlusCodeNoReference');
      const recovered = recoverNearest(candidate.code, reference.lat, reference.lng);
      const weak = reference.weak && reference.basis !== 'url';
      return located(
        4,
        point(recovered.lat, recovered.lng),
        'registerShortCode',
        true,
        weak ? ['weakReference'] : [],
        reference,
      );
    }
    case 'viewport':
      return located(5, point(candidate.lat, candidate.lng), 'registerUrl', true, ['viewportOnly']);
    case 'noCoordinates':
      return unlocated(8, 'noCoordinates');
    case 'invalidCoordinates':
      return unlocated(10, 'invalidCoordinates');
    case 'unreadable':
      return unlocated(11, 'unreadable');
  }
};

const ordered = (warnings: Iterable<AtmMapLocationWarning>): AtmMapLocationWarning[] => {
  const set = new Set(warnings);
  return ATM_MAP_LOCATION_WARNINGS.filter((w) => set.has(w));
};

const unlocatedResult = (
  reason: AtmMapUnlocatedReason,
  seenText: AtmMapLocationTexts | null,
  seenEntryIds: string[],
  shortLinkUrl: string | null,
): Derived => ({
  status: 'unlocated',
  lat: null,
  lng: null,
  source: null,
  needsReview: false,
  reason,
  warnings: [],
  sourceField: null,
  shortLinkUrl,
  reference: null,
  seenText,
  seenEntryIds,
});

/** A machine's location, from its open entries' AP/AV text (§4.3 ranking table). */
export const deriveLocation = (input: DeriveInput): Derived => {
  const seenEntryIds = [...input.entryIds].sort();
  if (input.entryProblem !== null) {
    return unlocatedResult(input.entryProblem, null, seenEntryIds, null);
  }
  const seenText = normalizeTexts(input.texts);
  // Best rank wins; on equal rank the earlier one (AV before AP, then cell order).
  const ranked = candidatesOf(seenText).map(({ field, candidate }) =>
    rank(field, candidate, input),
  );
  const winner = ranked.reduce<Ranked | null>(
    (best, r) => (best === null || r.rank < best.rank ? r : best),
    null,
  );
  if (winner === null) return unlocatedResult('none', seenText, seenEntryIds, null);

  // The short link worth keeping: it is the winner (rank 3, 6, 7), or the winner ranks 4 or worse
  // and a resolved link would outrank it. A link nobody needs is never fetched.
  const firstShortLink = ranked.find((r) => r.candidate.kind === 'shortLink');
  const shortLinkUrl =
    firstShortLink !== undefined &&
    firstShortLink.candidate.kind === 'shortLink' &&
    (firstShortLink === winner || winner.rank >= 4)
      ? firstShortLink.candidate.url
      : null;

  const at = winner.point;
  if (at === null || winner.source === null) {
    return unlocatedResult(winner.reason ?? 'unreadable', seenText, seenEntryIds, shortLinkUrl);
  }

  const points = ranked.flatMap((r) => (r.point === null ? [] : [r.point]));
  const disagree = points.some((a, i) =>
    points.slice(i + 1).some((b) => haversineMeters(a, b) > SOURCES_DISAGREE_METERS),
  );
  const warnings = ordered([
    ...winner.warnings,
    ...(disagree ? (['sourcesDisagree'] as const) : []),
    ...(insideEgypt(at) ? [] : (['outsideEgypt'] as const)),
  ]);
  const reference =
    winner.reference === null
      ? null
      : {
          lat: winner.reference.lat,
          lng: winner.reference.lng,
          basis: winner.reference.basis,
          machines: winner.reference.machines,
        };
  return {
    status: 'located',
    lat: at.lat,
    lng: at.lng,
    source: winner.source,
    needsReview: winner.needsReview || disagree,
    reason: null,
    warnings,
    sourceField: winner.field,
    shortLinkUrl,
    reference,
    seenText,
    seenEntryIds,
  };
};

/**
 * Sync pass 2 (§6.5): a machine whose best candidate is a short Plus Code — no coordinates, full
 * code or resolved link beside it — is derived after pass 1, against the pool pass 1 left.
 */
export const bestCandidateIsShortCode = (
  input: Pick<DeriveInput, 'texts' | 'entryProblem' | 'resolvedLink'>,
): boolean => {
  if (input.entryProblem !== null) return false;
  const candidates = candidatesOf(normalizeTexts(input.texts));
  if (!candidates.some((c) => c.candidate.kind === 'shortPlusCode')) return false;
  // Only whether something outranks a short code (ranks 1–3); no reference is asked for.
  const context = { resolvedLink: input.resolvedLink, reference: () => null };
  return !candidates.some(
    ({ field, candidate }) =>
      candidate.kind !== 'shortPlusCode' && rank(field, candidate, context).rank <= 3,
  );
};

// ── Re-derive precedence (§4.3, DM-2) ───────────────────────────────────────────────────────────

/** The stored fields the precedence reads. */
export interface ExistingLocation {
  status: 'located' | 'unlocated';
  lat: number | null;
  lng: number | null;
  source: AtmMapLocationSource | null;
  needsReview: boolean;
  reason: AtmMapUnlocatedReason | null;
  warnings: readonly AtmMapLocationWarning[];
  pinned: boolean;
  pinText: AtmMapLocationTexts | null;
  seenText: AtmMapLocationTexts | null;
  seenEntryIds: readonly string[];
  sourceField: AtmMapLocationField | null;
  reference: StoredReference | null;
  shortLink: StoredShortLink | null;
}

/** Every field a derivation may write. The provenance fields are only ever cleared here. */
export interface LocationWrite {
  status: 'located' | 'unlocated';
  lat: number | null;
  lng: number | null;
  source: AtmMapLocationSource | null;
  needsReview: boolean;
  reason: AtmMapUnlocatedReason | null;
  warnings: AtmMapLocationWarning[];
  sourceField: AtmMapLocationField | null;
  reference: StoredReference | null;
  seenText: AtmMapLocationTexts | null;
  seenEntryIds: string[];
  shortLink: StoredShortLink | null;
  pinned: boolean;
  pinText: null;
  pinEntryIds: string[];
  reviewedBy: null;
  reviewedByName: null;
  reviewedAt: null;
  manualText: null;
  moveReason: null;
}

export interface DerivationOutcome {
  /** The precedence-table row that applied (§4.3). */
  row: 1 | 2 | 3 | 4 | 5;
  /** null = nothing to write. */
  write: 'insert' | 'update' | null;
  set: Partial<LocationWrite>;
  /** The point (or located/unlocated) moved — the only time `setBy/setAt` change (§6.5 Sync 4). */
  pointChanged: boolean;
  /** Row 4: a pin a person set was replaced; it gets its own audit row (DM-15). */
  replacedPin: boolean;
}

/**
 * The link the document keeps: a new or changed URL is queued afresh; the same URL keeps its stored
 * result (one pass, DM-46); no URL clears it.
 */
export const nextShortLink = (
  stored: StoredShortLink | null,
  url: string | null,
): StoredShortLink | null => {
  if (url === null) return null;
  if (stored !== null && stored.url === url) return stored;
  return {
    url,
    status: 'pending',
    lat: null,
    lng: null,
    viewportOnly: false,
    failure: null,
    attempts: 0,
    lastAttemptAt: null,
    claimedAt: null,
  };
};

const sameReference = (a: StoredReference | null, b: StoredReference | null): boolean =>
  a === null || b === null
    ? a === b
    : a.lat === b.lat && a.lng === b.lng && a.basis === b.basis && a.machines === b.machines;

const sameList = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const sameSeenText = (a: AtmMapLocationTexts | null, b: AtmMapLocationTexts | null): boolean =>
  a === null || b === null ? a === b : sameTexts(a, b);

const derivedFields = (derived: Derived, stored: StoredShortLink | null) => ({
  status: derived.status,
  lat: derived.lat,
  lng: derived.lng,
  source: derived.source,
  needsReview: derived.needsReview,
  reason: derived.reason,
  warnings: [...derived.warnings],
  sourceField: derived.sourceField,
  reference: derived.reference,
  seenText: derived.seenText,
  seenEntryIds: [...derived.seenEntryIds],
  shortLink: nextShortLink(stored, derived.shortLinkUrl),
});

/** A replaced pin loses who placed or approved it, and why it was moved (§3.3). */
const clearedProvenance = (): Pick<
  LocationWrite,
  | 'pinText'
  | 'pinEntryIds'
  | 'reviewedBy'
  | 'reviewedByName'
  | 'reviewedAt'
  | 'manualText'
  | 'moveReason'
> => ({
  pinText: null,
  pinEntryIds: [],
  reviewedBy: null,
  reviewedByName: null,
  reviewedAt: null,
  manualText: null,
  moveReason: null,
});

/**
 * What a re-derivation writes over the existing document (§4.3 precedence table). `currentTexts` is
 * the open entries' current text (the sync), or the stored `seenText` (the resolver, which never
 * reads the register).
 */
export const applyDerivation = (
  existing: ExistingLocation | null,
  derived: Derived,
  currentTexts: AtmMapLocationTexts | null,
): DerivationOutcome => {
  if (existing === null) {
    return {
      row: 1,
      write: 'insert',
      set: { ...derivedFields(derived, null), pinned: false },
      pointChanged: derived.status === 'located',
      replacedPin: false,
    };
  }

  const pointChanged =
    existing.status !== derived.status ||
    existing.lat !== derived.lat ||
    existing.lng !== derived.lng;
  const seenChanged =
    !sameSeenText(existing.seenText, derived.seenText) ||
    !sameIds(existing.seenEntryIds, derived.seenEntryIds);
  const seenFields = { seenText: derived.seenText, seenEntryIds: [...derived.seenEntryIds] };

  if (!existing.pinned) {
    const differs =
      pointChanged ||
      seenChanged ||
      existing.source !== derived.source ||
      existing.needsReview !== derived.needsReview ||
      existing.reason !== derived.reason ||
      !sameList(existing.warnings, derived.warnings) ||
      existing.sourceField !== derived.sourceField ||
      !sameReference(existing.reference, derived.reference) ||
      (existing.shortLink?.url ?? null) !== derived.shortLinkUrl;
    return {
      row: 2,
      write: differs ? 'update' : null,
      set: differs ? { ...derivedFields(derived, existing.shortLink), pinned: false } : {},
      pointChanged: differs && pointChanged,
      replacedPin: false,
    };
  }

  if (sameTexts(currentTexts, existing.pinText)) {
    // Row 3: the text the pin was set against still holds — the point stays. A pinned document
    // whose text equals `pinText` carries no short link (§3.3), so one queued meanwhile is dropped.
    const set: Partial<LocationWrite> = {
      ...(seenChanged ? seenFields : {}),
      ...(existing.shortLink !== null ? { shortLink: null } : {}),
    };
    const write = Object.keys(set).length > 0 ? 'update' : null;
    return { row: 3, write, set, pointChanged: false, replacedPin: false };
  }

  if (derived.status === 'located') {
    // Row 4: the register moved since the pin was set, and the new text gives a point.
    return {
      row: 4,
      write: 'update',
      set: { ...derivedFields(derived, existing.shortLink), pinned: false, ...clearedProvenance() },
      pointChanged,
      replacedPin: true,
    };
  }

  // Row 5: the register moved but gives no point — the pin stays (DM-2 refinement); a new short
  // link is queued, and its resolution later replaces the pin through row 4.
  const shortLink = nextShortLink(existing.shortLink, derived.shortLinkUrl);
  const set: Partial<LocationWrite> = {
    ...(seenChanged ? seenFields : {}),
    ...(shortLink !== existing.shortLink ? { shortLink } : {}),
  };
  const write = Object.keys(set).length > 0 ? 'update' : null;
  return { row: 5, write, set, pointChanged: false, replacedPin: false };
};
