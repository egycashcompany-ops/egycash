// Machine locations: the register read, the paste-box parse, a person's pin, its approval, and the
// two batch actions — the sync from the register and the short-link resolution
// (docs/12-planning/atm-map-zones.md §4.3, §5, §6.5).
//
// THE REGISTER IS READ THROUGH ONE HELPER, `openEntryLocationTexts`, with a projection of four
// fields. An entry holds `keys`, `receiptNotes` and `handoverNotes` in the clear and the
// `safeCombination` ref; none of them is ever loaded into this feature's memory (the logger's rule).
// The register is never written here (DM-13): the derivation is re-run by an explicit, audited sync.
//
// WHO MAY ACT, per machine: the map's read scope finds it (or it is a 404 — indistinguishable from
// one that does not exist), and `atmMachine.locate` must reach its branch (or 403). Every write
// copies `branchId` from the machine, never from the request.
//
// BATCH WRITES RUN OUTSIDE A TRANSACTION, from documents loaded earlier, while a person may place or
// approve a pin in between. So every batch update is guarded by the loaded `__v`, a new document is
// an upsert that leaves an existing one alone, and a write that matches nothing is COUNTED in
// `conflicts`, never thrown: the person's write stands, and the next sync re-evaluates the machine.
//
// AUDITS (DM-15): one run row per batch call, plus a per-machine `update` for every PINNED point a
// batch replaces (precedence row 4), so a pin a person set is never replaced without its own trail.
// Each replaced pin's row is recorded the moment its write lands, and the run row from a `finally`
// (marked as failed when the run stopped on an error), so a run that fails part-way loses neither.
// Interactive writes audit per machine, `entityId = machineId`.
import {
  ATM_MAP_LINK_BATCH_MAX,
  ATM_MAP_MOVE_REASON_METERS,
  ATM_MAP_PARSE_TOLERANCE_METERS,
  ATM_MAP_SYNC_MAX_MACHINES,
  ErrorCodes,
  round6,
  type AtmMachineLocationDetailDto,
  type AtmMapLatLng,
  type AtmMapLinkResolveResultDto,
  type AtmMapLocationTexts,
  type AtmMapParseResultDto,
  type AtmMapPointState,
  type AtmMapSyncResultDto,
  type AtmMapUnlocatedReasonDto,
  type ApproveAtmMachineLocation,
  type AuditChange,
  type ParseAtmMapLocation,
  type PlaceAtmMachineLocation,
  type ResolveAtmMapLinks,
  type SyncAtmMapLocations,
} from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { getCache } from '../../../infrastructure/redis/cache';
import { BaseRepository } from '../../../shared/base/base.repository';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  StaleDocumentError,
  ValidationError,
} from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import {
  hasPermission,
  keyReachesBranch,
  scopeSelector,
  type AuthContext,
} from '../../../shared/types';
import { AtmMachineModel, type AtmMachineDoc } from '../machines/machine.model';
import { type PendingAudit } from '../register/register-coupling';
import { AtmRegisterEntryModel } from '../register/register.model';
import { atmRegisterEntryRepository } from '../register/register.repository';
import { actorName } from '../shared/atm-context';
import {
  AtmMachineLocationModel,
  type AtmMachineLocationDoc,
  type AtmMachineLocationShortLink,
} from './machine-location.model';
import { mapScopeBranches, mapScopeMatch, narrowToBranch, writableBranches } from './map-scope';
import {
  applyDerivation,
  bestCandidateIsShortCode,
  deriveLocation,
  hasShortCodeCandidate,
  mergeOpenEntries,
  normalizeTexts,
  pinHolds,
  referenceLookup,
  sameIds,
  sameTexts,
  type DerivationOutcome,
  type Derived,
  type ExistingLocation,
  type OpenEntryTexts,
  type ReferencePoolEntry,
  type StoredShortLink,
} from './location/derive';
import { haversineMeters, insideEgypt } from './location/maps-text';
import {
  defaultShortLinkDeps,
  emptyShortLinkBatchResult,
  runShortLinkBatch,
  type ShortLinkDeps,
  type ShortLinkResult,
} from './location/short-link-resolver';

// ── The register, read once and projected (§4.3) ────────────────────────────────────────────────

/** Exactly these four fields of an open register entry — never `keys`, notes or the combination. */
export const OPEN_ENTRY_LOCATION_PROJECTION = {
  _id: 1,
  machineId: 1,
  locationUrl: 1,
  locationPlusCode: 1,
} as const;

export interface OpenEntryLocationRow {
  _id: Types.ObjectId;
  machineId: Types.ObjectId;
  locationUrl?: string | null;
  locationPlusCode?: string | null;
}

/**
 * Every read of register text for this feature: the open entries of `machineIds`, projected to
 * their AP/AV text (index `ix_machine_status`). Serves the summary, the sync, Place and Approve.
 */
export const openEntryLocationTexts = async (
  machineIds: readonly Types.ObjectId[],
): Promise<OpenEntryLocationRow[]> =>
  AtmRegisterEntryModel.find(
    { machineId: { $in: [...machineIds] }, isDeleted: false, status: 'open' },
    OPEN_ENTRY_LOCATION_PROJECTION,
  )
    .lean<OpenEntryLocationRow[]>()
    .exec();

/** The rows above, grouped by machine, in the shape `mergeOpenEntries` reads. */
export const entriesByMachine = (
  rows: readonly OpenEntryLocationRow[],
): Map<string, OpenEntryTexts[]> => {
  const out = new Map<string, OpenEntryTexts[]>();
  for (const row of rows) {
    const key = String(row.machineId);
    const list = out.get(key) ?? [];
    list.push({
      id: String(row._id),
      locationUrl: row.locationUrl ?? null,
      locationPlusCode: row.locationPlusCode ?? null,
    });
    out.set(key, list);
  }
  return out;
};

/** The open entries' current text and ids for one machine (`mergeOpenEntries`). */
const currentTextsOf = async (machineId: Types.ObjectId) =>
  mergeOpenEntries(
    entriesByMachine(await openEntryLocationTexts([machineId])).get(String(machineId)) ?? [],
  );

/** A text as stored: trimmed, `''` as null; null stays null (noEntry, conflictingEntries). */
const storedTexts = (texts: AtmMapLocationTexts | null): AtmMapLocationTexts | null =>
  texts === null ? null : normalizeTexts(texts);

// ── Shared shapes ───────────────────────────────────────────────────────────────────────────────

/** The fields every location read projects — never the register texts unless asked. */
export type LocationState = Pick<AtmMachineLocationDoc, 'status' | 'needsReview' | 'reason'> | null;

/** One mapping for the points, the summary and the detail (§6.4). */
export const locationState = (
  doc: LocationState,
): { state: AtmMapPointState; reason: AtmMapUnlocatedReasonDto | null } => {
  if (doc === null) return { state: 'unlocated', reason: 'notSynced' };
  if (doc.status === 'located')
    return { state: doc.needsReview ? 'review' : 'located', reason: null };
  return { state: 'unlocated', reason: doc.reason ?? 'unreadable' };
};

const existingOf = (doc: AtmMachineLocationDoc): ExistingLocation => ({
  status: doc.status,
  lat: doc.lat,
  lng: doc.lng,
  source: doc.source,
  needsReview: doc.needsReview,
  reason: doc.reason,
  warnings: doc.warnings,
  pinned: doc.pinned,
  pinText: doc.pinText,
  seenText: doc.seenText,
  seenEntryIds: doc.seenEntryIds.map(String),
  sourceField: doc.sourceField,
  reference: doc.reference,
  shortLink: doc.shortLink,
});

/** The audited fields of a location (§6.5 Place 5). */
const locationSnapshot = (
  doc: Pick<
    AtmMachineLocationDoc,
    'lat' | 'lng' | 'status' | 'source' | 'needsReview' | 'reason' | 'pinned' | 'moveReason'
  >,
) => ({
  lat: doc.lat,
  lng: doc.lng,
  status: doc.status,
  source: doc.source,
  needsReview: doc.needsReview,
  reason: doc.reason,
  pinned: doc.pinned,
  moveReason: doc.moveReason,
});

const locationRef = (machineId: string) => ({
  moduleId: 'atm',
  entityType: 'machineLocation',
  entityId: machineId,
});

/** Row 4 of a batch: the replaced pin's own trail (DM-15). */
const replacedPinAudit = (
  machineId: string,
  before: Pick<AtmMachineLocationDoc, 'lat' | 'lng' | 'source' | 'pinned'>,
  after: { lat: number | null; lng: number | null; source: unknown; pinned: boolean },
): PendingAudit => ({
  entityRef: locationRef(machineId),
  action: 'update',
  changes: diffChanges(
    { lat: before.lat, lng: before.lng, source: before.source, pinned: before.pinned },
    { lat: after.lat, lng: after.lng, source: after.source, pinned: after.pinned },
  ),
});

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

/** Interactive writes go through the base repository's versioned update (409 STALE_DOCUMENT). */
const locationRepository = new BaseRepository<AtmMachineLocationDoc>(AtmMachineLocationModel, {
  branchField: 'branchId',
});

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/** A bulk write whose only failures are E11000 on `ux_machine` — a person's first pin won (§6.5). */
const onlyDuplicateKeyErrors = (error: unknown): boolean => {
  const { writeErrors } = (error ?? {}) as { writeErrors?: unknown };
  if (writeErrors === undefined || writeErrors === null) return false;
  const list: unknown[] = Array.isArray(writeErrors) ? writeErrors : [writeErrors];
  return list.length > 0 && list.every(isDuplicateKey);
};

// ── The reference pool (DM-34) ──────────────────────────────────────────────────────────────────

/**
 * The trustworthy pins of `branchIds` — located, no review, not from a short code, no warning —
 * of every machine that is not deleted, joined to the machine's area. Built once per request,
 * never per machine; `referenceFor` filters it again and leaves the machine itself out.
 */
const loadReferencePool = async (branchIds: readonly string[]): Promise<ReferencePoolEntry[]> => {
  if (branchIds.length === 0) return [];
  const docs = await AtmMachineLocationModel.find(
    {
      branchId: { $in: branchIds.map(oid) },
      isDeleted: false,
      status: 'located',
      needsReview: false,
      source: { $ne: 'registerShortCode' },
      warnings: { $size: 0 },
    },
    {
      machineId: 1,
      branchId: 1,
      status: 1,
      lat: 1,
      lng: 1,
      needsReview: 1,
      source: 1,
      warnings: 1,
    },
  )
    .lean<AtmMachineLocationDoc[]>()
    .exec();
  if (docs.length === 0) return [];
  const machines = await AtmMachineModel.find(
    { _id: { $in: docs.map((doc) => doc.machineId) }, isDeleted: false },
    { area: 1 },
  )
    .lean<Pick<AtmMachineDoc, '_id' | 'area'>[]>()
    .exec();
  const areaOf = new Map(machines.map((m) => [String(m._id), m.area]));
  return docs.flatMap((doc) => {
    const area = areaOf.get(String(doc.machineId));
    return area === undefined ? [] : [poolEntry(doc, String(doc.branchId), area)];
  });
};

const poolEntry = (
  state: Pick<
    AtmMachineLocationDoc,
    'machineId' | 'status' | 'lat' | 'lng' | 'needsReview' | 'source' | 'warnings'
  >,
  branchId: string,
  area: string | null,
): ReferencePoolEntry => ({
  machineId: String(state.machineId),
  branchId,
  area,
  machineDeleted: false,
  status: state.status,
  lat: state.lat,
  lng: state.lng,
  needsReview: state.needsReview,
  source: state.source,
  warnings: state.warnings,
});

// ── Machine access (routes 6, 9, 10, 11) ────────────────────────────────────────────────────────

type MachineRow = Pick<AtmMachineDoc, '_id' | 'branchId' | 'area' | 'isActive'>;

/**
 * The machine, when the map's read scope finds it (else 404 — indistinguishable from one that does
 * not exist) and `atmMachine.locate` reaches its branch (else 403).
 */
const machineForLocate = async (machineId: string, ctx: AuthContext): Promise<MachineRow> => {
  const machine = await AtmMachineModel.findOne(
    {
      $and: [
        { _id: oid(machineId), isDeleted: false },
        mapScopeMatch(scopeSelector(ctx, 'atmMap.view')),
      ],
    },
    { branchId: 1, area: 1, isActive: 1 },
  )
    .lean<MachineRow>()
    .exec();
  if (machine === null) throw new NotFoundError();
  if (!keyReachesBranch(ctx, 'atmMachine.locate', String(machine.branchId))) {
    throw new ForbiddenError('the locate key does not reach this branch');
  }
  return machine;
};

const liveLocation = async (machineId: Types.ObjectId): Promise<AtmMachineLocationDoc | null> =>
  AtmMachineLocationModel.findOne({ machineId, isDeleted: false })
    .lean<AtmMachineLocationDoc>()
    .exec();

// ── Parse (DM-14) ───────────────────────────────────────────────────────────────────────────────

type ParseFailure = Extract<AtmMapParseResultDto, { ok: false }>['reason'];

interface Parsed {
  result: AtmMapParseResultDto;
  derived: Derived;
}

/** The paste box's text, read exactly as one register cell and ranked by §4.3 (no stored link). */
const parseFor = async (machine: MachineRow, text: string): Promise<Parsed> => {
  const branchId = String(machine.branchId);
  const pool = await loadReferencePool([branchId]);
  const derived = deriveLocation({
    texts: { url: text, plusCode: null },
    entryIds: [],
    entryProblem: null,
    resolvedLink: null,
    reference: referenceLookup(pool, branchId, machine.area, String(machine._id)),
  });
  if (derived.status === 'located' && derived.lat !== null && derived.lng !== null) {
    const kind =
      derived.source === 'registerCoordinates'
        ? 'coordinates'
        : derived.source === 'registerPlusCode'
          ? 'plusCode'
          : derived.source === 'registerShortCode'
            ? 'shortPlusCode'
            : derived.warnings.includes('viewportOnly')
              ? 'viewport'
              : 'url';
    return {
      derived,
      result: {
        ok: true,
        lat: derived.lat,
        lng: derived.lng,
        kind,
        needsReview: derived.needsReview,
        warnings: derived.warnings,
      },
    };
  }
  const known: readonly ParseFailure[] = [
    'shortLink',
    'noCoordinates',
    'invalidCoordinates',
    'unreadable',
    'shortPlusCodeNoReference',
  ];
  const reason = known.find((r) => r === derived.reason) ?? 'unreadable';
  return { derived, result: { ok: false, reason } };
};

// ── The detail DTO ──────────────────────────────────────────────────────────────────────────────

const iso = (value: Date | null | undefined): string | null =>
  value === null || value === undefined ? null : new Date(value).toISOString();

/**
 * `sourceVisible` (§6.5 Detail): the key check FIRST — for a caller without it, `scopeSelector`
 * falls back to `own`, and the register's `own` is "entries I created", which would show the AP/AV
 * text to whoever ran the import. Then every source entry must be readable by the caller.
 */
const sourceVisibleFor = async (
  doc: AtmMachineLocationDoc | null,
  ctx: AuthContext,
): Promise<boolean> => {
  if (doc === null || !hasPermission(ctx, 'atmRegister.view')) return false;
  if (doc.seenEntryIds.length === 0) return false;
  const scope = scopeSelector(ctx, 'atmRegister.view');
  for (const id of doc.seenEntryIds) {
    if ((await atmRegisterEntryRepository.findById(String(id), scope)) === null) return false;
  }
  return true;
};

const toDetailDto = (
  machineId: string,
  doc: AtmMachineLocationDoc | null,
  sourceVisible: boolean,
): AtmMachineLocationDetailDto => {
  const { state, reason } = locationState(doc);
  return {
    machineId,
    version: doc === null ? null : doc.__v,
    state,
    lat: doc?.lat ?? null,
    lng: doc?.lng ?? null,
    source: doc?.source ?? null,
    reason,
    warnings: doc === null ? [] : [...doc.warnings],
    needsReview: doc?.needsReview ?? false,
    pinned: doc?.pinned ?? false,
    reference:
      doc?.reference === null || doc?.reference === undefined
        ? null
        : {
            lat: doc.reference.lat,
            lng: doc.reference.lng,
            basis: doc.reference.basis,
            machines: doc.reference.machines,
          },
    shortLink:
      doc?.shortLink === null || doc?.shortLink === undefined
        ? null
        : {
            status: doc.shortLink.status,
            failure: doc.shortLink.failure ?? null,
            attempts: doc.shortLink.attempts,
          },
    sourceVisible,
    sourceText: sourceVisible && doc !== null ? normalizeTexts(doc.seenText) : null,
    manualText: doc?.manualText ?? null,
    moveReason: doc?.moveReason ?? null,
    setByName: doc?.setByName ?? null,
    setAt: iso(doc?.setAt),
    reviewedByName: doc?.reviewedByName ?? null,
    reviewedAt: iso(doc?.reviewedAt),
    derivedAt: iso(doc?.derivedAt),
  };
};

// ── Batch scope (routes 7 and 8, §6.3 error contract) ───────────────────────────────────────────

/**
 * The machines a batch may touch: the map's read scope limited to the branches `atmMachine.locate`
 * can write, narrowed by `branchId`. An empty writable set is 403 whether or not a branch is
 * named; a branch outside the READ reach is 400 `OUT_OF_REACH`; readable but not writable is 403.
 */
const batchScope = async (
  ctx: AuthContext,
  branchId: string | undefined,
): Promise<{ match: FilterQuery<AtmMachineDoc>; branches: 'all' | string[] }> => {
  const view = scopeSelector(ctx, 'atmMap.view');
  const writable = await writableBranches(ctx, 'atmMachine.locate', mapScopeBranches(view));
  if (writable !== 'all' && writable.length === 0) {
    throw new ForbiddenError('the locate key reaches no branch on the map');
  }
  const narrow = narrowToBranch(view, branchId, 'body.branchId');
  if (branchId !== undefined && writable !== 'all' && !writable.includes(branchId)) {
    throw new ForbiddenError('the locate key does not reach this branch');
  }
  return {
    match: {
      $and: [
        { isDeleted: false, isActive: true },
        mapScopeMatch(view),
        writable === 'all' ? {} : { branchId: { $in: writable.map(oid) } },
        narrow,
      ],
    } as FilterQuery<AtmMachineDoc>,
    branches: branchId !== undefined ? [branchId] : writable,
  };
};

// ── Test hooks (§5.3, §6.5 Sync 4) ──────────────────────────────────────────────────────────────

let shortLinkDeps: ShortLinkDeps = defaultShortLinkDeps;

/** Integration tests never touch the network or DNS (the `setOutboundPolicyForTests` pattern). */
export const setShortLinkDepsForTests = (deps: ShortLinkDeps | null): void => {
  shortLinkDeps = deps ?? defaultShortLinkDeps;
};

let syncBeforeWrite: (() => Promise<void>) | null = null;

/** Runs between the sync's derivation and its writes, so a test can place a pin in between. */
export const setSyncBeforeWriteForTests = (fn: (() => Promise<void>) | null): void => {
  syncBeforeWrite = fn;
};

/** The company-wide single flight of the resolver (DM-47); count 1 = acquired. */
export const RESOLVE_LEASE_KEY = 'lock:atm-map-resolve';
const RESOLVE_LEASE_SECONDS = 60;
/** A claim older than this was left by a run that died (§5.4); above the 12 s per-link deadline. */
const CLAIM_TTL_MS = 60_000;

// ── The service ─────────────────────────────────────────────────────────────────────────────────

interface SyncPlan {
  machine: Pick<AtmMachineDoc, '_id' | 'branchId' | 'area'>;
  doc: AtmMachineLocationDoc | null;
  outcome: DerivationOutcome;
}

/** What a plan leaves stored, assuming its write lands — for the pool and the counts. */
const afterState = (plan: SyncPlan) => {
  const base = plan.doc ?? {
    status: 'unlocated' as const,
    lat: null,
    lng: null,
    source: null,
    needsReview: false,
    reason: null,
    warnings: [],
  };
  const set = plan.outcome.write === null ? {} : plan.outcome.set;
  return {
    machineId: plan.machine._id,
    status: set.status ?? base.status,
    lat: set.lat !== undefined ? set.lat : base.lat,
    lng: set.lng !== undefined ? set.lng : base.lng,
    source: set.source !== undefined ? set.source : base.source,
    needsReview: set.needsReview ?? base.needsReview,
    reason: set.reason !== undefined ? set.reason : base.reason,
    warnings: set.warnings ?? base.warnings,
    pinned: set.pinned ?? plan.doc?.pinned ?? false,
  };
};

class AtmMachineLocationService {
  /** POST /locations/parse — a result, never an error; a short link is never fetched here. */
  async parse(input: ParseAtmMapLocation, ctx: AuthContext): Promise<AtmMapParseResultDto> {
    const machine = await machineForLocate(input.machineId, ctx);
    return (await parseFor(machine, input.text)).result;
  }

  /** GET /machines/:machineId/location. */
  async detail(machineId: string, ctx: AuthContext): Promise<AtmMachineLocationDetailDto> {
    const machine = await machineForLocate(machineId, ctx);
    const doc = await liveLocation(machine._id);
    return toDetailDto(machineId, doc, await sourceVisibleFor(doc, ctx));
  }

  /** PUT /machines/:machineId/location — a person's pin, from the map or from a pasted text. */
  async place(
    machineId: string,
    input: PlaceAtmMachineLocation,
    ctx: AuthContext,
  ): Promise<AtmMachineLocationDetailDto> {
    const machine = await machineForLocate(machineId, ctx);

    // 1. The point.
    let point: AtmMapLatLng;
    let parsed: Parsed | null = null;
    if (input.mode === 'pin') {
      point = { lat: round6(input.lat), lng: round6(input.lng) };
    } else {
      parsed = await parseFor(machine, input.text);
      if (!parsed.result.ok) {
        throw new ValidationError([
          { field: 'body.text', code: parsed.result.reason, message: 'the text gives no location' },
        ]);
      }
      point = { lat: parsed.result.lat, lng: parsed.result.lng };
      if (haversineMeters(point, input.expected) > ATM_MAP_PARSE_TOLERANCE_METERS) {
        throw new ConflictError(
          'the text now reads as another point — preview it again',
          ErrorCodes.ATM_MAP_PARSE_CHANGED,
        );
      }
    }

    // 2. The version.
    const existing = await liveLocation(machine._id);
    if (existing === null ? input.version !== null : input.version !== existing.__v) {
      throw new StaleDocumentError();
    }

    // 3. A long move needs a reason (DM-18).
    const moved =
      existing !== null &&
      existing.status === 'located' &&
      existing.lat !== null &&
      existing.lng !== null
        ? haversineMeters({ lat: existing.lat, lng: existing.lng }, point)
        : null;
    if (moved !== null && moved > ATM_MAP_MOVE_REASON_METERS && input.reason === undefined) {
      throw new ValidationError([
        { field: 'body.reason', code: 'REQUIRED', message: 'a move this long needs a reason' },
      ]);
    }

    // 4. The pin, protected against the register text it was set against (DM-2).
    const current = await currentTextsOf(machine._id);
    const texts = storedTexts(current.texts);
    const entryIds = current.entryIds.map(oid);
    const now = new Date();
    const by = oid(ctx.userId);
    // A pasted SHORT code is confirmed by this person: the confirmation is the review (DM-4).
    const confirmsShortCode = parsed?.derived.source === 'registerShortCode';
    const set = {
      status: 'located' as const,
      lat: point.lat,
      lng: point.lng,
      source: 'manual' as const,
      needsReview: false,
      reason: null,
      warnings: insideEgypt(point) ? [] : ['outsideEgypt' as const],
      pinned: true,
      sourceField: null,
      reference: confirmsShortCode ? (parsed?.derived.reference ?? null) : null,
      shortLink: null,
      manualText: input.mode === 'text' ? input.text : null,
      moveReason: input.reason ?? null,
      setBy: by,
      setByName: actorName(ctx),
      setAt: now,
      ...(confirmsShortCode
        ? { reviewedBy: by, reviewedByName: actorName(ctx), reviewedAt: now }
        : {}),
      pinText: texts,
      pinEntryIds: entryIds,
      seenText: texts,
      seenEntryIds: entryIds,
    };

    let saved: AtmMachineLocationDoc;
    if (existing === null) {
      try {
        const [doc] = await AtmMachineLocationModel.create([
          {
            ...set,
            machineId: machine._id,
            branchId: machine.branchId,
            createdBy: by,
            updatedBy: by,
          },
        ]);
        if (doc === undefined) throw new NotFoundError('create returned no document');
        saved = doc.toObject() as AtmMachineLocationDoc;
      } catch (error) {
        // Another writer — a sync, or a second tab — created it first.
        if (isDuplicateKey(error)) throw new StaleDocumentError();
        throw error;
      }
    } else {
      saved = await locationRepository.updateById(String(existing._id), set, {
        by: ctx.userId,
        version: existing.__v,
      });
    }

    // 5. One audit per machine.
    const distance: AuditChange[] =
      moved === null ? [] : [{ field: 'distanceMeters', old: null, new: Math.round(moved) }];
    await auditService.record({
      entityRef: locationRef(machineId),
      action: existing === null ? 'create' : 'update',
      changes: [
        ...diffChanges(
          existing === null ? {} : locationSnapshot(existing),
          locationSnapshot(saved),
        ),
        ...distance,
      ],
    });
    return toDetailDto(machineId, saved, await sourceVisibleFor(saved, ctx));
  }

  /** POST /machines/:machineId/location/approve — confirm a review pin as it was derived. */
  async approve(
    machineId: string,
    input: ApproveAtmMachineLocation,
    ctx: AuthContext,
  ): Promise<AtmMachineLocationDetailDto> {
    const machine = await machineForLocate(machineId, ctx);
    const existing = await liveLocation(machine._id);
    if (existing === null || !existing.needsReview) {
      throw new BusinessRuleError(
        'the location is not under review',
        ErrorCodes.ATM_MAP_NOT_UNDER_REVIEW,
      );
    }
    // DM-45: approving a pin derived from text that has since moved would protect out-of-date text
    // forever (DM-2 would then see "equal"). Sync first, then review again.
    const current = await currentTextsOf(machine._id);
    if (
      !sameIds(current.entryIds, existing.seenEntryIds.map(String)) ||
      !sameTexts(current.texts, existing.seenText)
    ) {
      throw new ConflictError(
        'the register text changed since this pin was derived — sync first',
        ErrorCodes.ATM_MAP_SOURCE_CHANGED,
      );
    }
    if (input.version !== existing.__v) throw new StaleDocumentError();
    const now = new Date();
    const saved = await locationRepository.updateById(
      String(existing._id),
      {
        needsReview: false,
        pinned: true,
        reviewedBy: oid(ctx.userId),
        reviewedByName: actorName(ctx),
        reviewedAt: now,
        pinText: storedTexts(current.texts),
        pinEntryIds: current.entryIds.map(oid),
        shortLink: null,
      },
      { by: ctx.userId, version: existing.__v },
    );
    await auditService.record({
      entityRef: locationRef(machineId),
      action: 'update',
      changes: diffChanges(locationSnapshot(existing), locationSnapshot(saved)),
    });
    return toDetailDto(machineId, saved, await sourceVisibleFor(saved, ctx));
  }

  /** POST /locations/sync — re-derive every active machine in the writable scope (§6.5). */
  async sync(input: SyncAtmMapLocations, ctx: AuthContext): Promise<AtmMapSyncResultDto> {
    // 1. The scope.
    const { match, branches } = await batchScope(ctx, input.branchId);

    // 2. Machines, their documents and their open entries.
    const machines = await AtmMachineModel.find(match, { _id: 1, branchId: 1, area: 1 })
      .limit(ATM_MAP_SYNC_MAX_MACHINES + 1)
      .lean<Pick<AtmMachineDoc, '_id' | 'branchId' | 'area'>[]>()
      .exec();
    if (machines.length > ATM_MAP_SYNC_MAX_MACHINES) {
      throw new ValidationError([
        {
          field: 'body.branchId',
          code: 'TOO_MANY_MACHINES',
          message: `more than ${String(ATM_MAP_SYNC_MAX_MACHINES)} machines — sync one branch at a time`,
        },
      ]);
    }
    const ids = machines.map((m) => m._id);
    const [docs, rows] = await Promise.all([
      AtmMachineLocationModel.find({ machineId: { $in: ids }, isDeleted: false })
        .lean<AtmMachineLocationDoc[]>()
        .exec(),
      openEntryLocationTexts(ids),
    ]);
    const docOf = new Map(docs.map((doc) => [String(doc.machineId), doc]));
    const entries = entriesByMachine(rows);
    const mergedOf = new Map(
      machines.map((m) => [String(m._id), mergeOpenEntries(entries.get(String(m._id)) ?? [])]),
    );
    const storedPool = await loadReferencePool([
      ...new Set(machines.map((m) => String(m.branchId))),
    ]);

    // 3. The DM-34 pool a derivation reads never holds a point this same sync is still deciding,
    //    so a second sync over the same register finds the same references and writes nothing
    //    (§9.3 #5). Pass 1a — no short code at all — reads no reference. Pass 1b — a short code
    //    beside a better candidate, read only for `sourcesDisagree` (DM-44c) — reads the stored
    //    pins of the machines this sync does not evaluate, pass 1a's results and the pins row 3
    //    keeps. Pass 2 — the short codes — reads that pool plus pass 1b's results.
    type Machine = (typeof machines)[number];
    const merged = (machine: Machine) => mergedOf.get(String(machine._id)) ?? mergeOpenEntries([]);
    const plan = (machine: Machine, pool: readonly ReferencePoolEntry[]): SyncPlan => {
      const id = String(machine._id);
      const doc = docOf.get(id) ?? null;
      const texts = merged(machine);
      const derived = deriveLocation({
        ...texts,
        resolvedLink: doc?.shortLink ?? null,
        reference: referenceLookup(pool, String(machine.branchId), machine.area, id),
      });
      return {
        machine,
        doc,
        outcome: applyDerivation(doc === null ? null : existingOf(doc), derived, texts.texts),
      };
    };
    const passOf = (machine: Machine): '1a' | '1b' | '2' => {
      const texts = merged(machine);
      if (!hasShortCodeCandidate(texts)) return '1a';
      return bestCandidateIsShortCode({
        texts: texts.texts,
        entryProblem: texts.entryProblem,
        resolvedLink: docOf.get(String(machine._id))?.shortLink ?? null,
      })
        ? '2'
        : '1b';
    };
    const evaluated = new Set(machines.map((m) => String(m._id)));
    const pool = new Map(
      storedPool
        .filter((entry) => !evaluated.has(entry.machineId))
        .map((entry) => [entry.machineId, entry]),
    );
    const overlay = (p: SyncPlan): void => {
      pool.set(
        String(p.machine._id),
        poolEntry(afterState(p), String(p.machine.branchId), p.machine.area),
      );
    };
    const pass1a = machines.filter((m) => passOf(m) === '1a').map((m) => plan(m, []));
    pass1a.forEach(overlay);
    for (const m of machines) {
      const doc = docOf.get(String(m._id));
      if (passOf(m) !== '1a' && doc !== undefined && pinHolds(doc, merged(m).texts)) {
        pool.set(String(m._id), poolEntry(doc, String(m.branchId), m.area));
      }
    }
    const pool1b = [...pool.values()];
    const pass1b = machines.filter((m) => passOf(m) === '1b').map((m) => plan(m, pool1b));
    pass1b.forEach(overlay);
    const pool2 = [...pool.values()];
    const plans = [
      ...pass1a,
      ...pass1b,
      ...machines.filter((m) => passOf(m) === '2').map((m) => plan(m, pool2)),
    ];

    if (syncBeforeWrite !== null) await syncBeforeWrite();

    // 4. Only the documents that changed, under the version guard. A pin a person set (row 4) is
    //    written on its own and audited the moment it lands, so no later failure can lose its trail
    //    (DM-15); every other write goes in one unordered bulk write.
    const now = new Date();
    const by = oid(ctx.userId);
    const setByFields = { setBy: by, setByName: actorName(ctx), setAt: now };
    const writes = plans.filter((p) => p.outcome.write !== null);
    const opOf = (p: SyncPlan) => {
      const pointFields = p.outcome.pointChanged ? setByFields : {};
      if (p.doc === null) {
        // A new document leaves an existing one alone: a person's first pin in between wins.
        return {
          filter: { machineId: p.machine._id, isDeleted: false },
          update: {
            $setOnInsert: {
              ...p.outcome.set,
              branchId: p.machine.branchId,
              ...pointFields,
              // The run's mark: the landed writes are read back by it (below).
              derivedAt: now,
              schemaVersion: 1,
              deletedAt: null,
              deletedBy: null,
              createdBy: by,
              updatedBy: by,
              createdAt: now,
              updatedAt: now,
              __v: 0,
            },
          },
          upsert: true,
          timestamps: false,
        };
      }
      return {
        filter: { _id: p.doc._id, __v: p.doc.__v, isDeleted: false },
        update: {
          $set: { ...p.outcome.set, ...pointFields, derivedAt: now, updatedBy: by },
          $inc: { __v: 1 },
        },
      };
    };
    const replacesPin = (p: SyncPlan): p is SyncPlan & { doc: AtmMachineLocationDoc } =>
      p.outcome.replacedPin && p.doc !== null;
    const ops = writes.filter((p) => !replacesPin(p)).map((p) => ({ updateOne: opOf(p) }));

    // 6 (recorded whatever happens next). One run row — marked `failed` when the run stopped on an
    // error, with the machines known to have changed by then — and the replaced pins' own trail.
    const pinsReplaced: string[] = [];
    let result: AtmMapSyncResultDto | null = null;
    let changedMachineIds: string[] | null = null;
    let completed = false;
    try {
      for (const p of writes.filter(replacesPin)) {
        const { filter, update } = opOf(p);
        const written = await AtmMachineLocationModel.updateOne(filter, update).exec();
        if (written.matchedCount !== 1) continue;
        pinsReplaced.push(String(p.machine._id));
        await auditService.record(replacedPinAudit(String(p.machine._id), p.doc, afterState(p)));
      }
      if (ops.length > 0) {
        try {
          await AtmMachineLocationModel.bulkWrite(ops as never, { ordered: false });
        } catch (error) {
          if (!onlyDuplicateKeyErrors(error)) throw error;
        }
      }
      // Which writes landed: an insert that met a person's document and an update whose version a
      // person moved both match nothing, so neither carries this run's mark.
      const landed = new Set(
        writes.length === 0
          ? []
          : (
              await AtmMachineLocationModel.find(
                {
                  machineId: { $in: writes.map((p) => p.machine._id) },
                  isDeleted: false,
                  derivedAt: now,
                },
                { machineId: 1 },
              )
                .lean<Pick<AtmMachineLocationDoc, 'machineId'>[]>()
                .exec()
            ).map((doc) => String(doc.machineId)),
      );
      changedMachineIds = writes.map((p) => String(p.machine._id)).filter((id) => landed.has(id));

      const counts: AtmMapSyncResultDto = {
        processed: plans.length,
        changed: landed.size,
        located: 0,
        review: 0,
        unlocated: 0,
        kept: 0,
        conflicts: writes.length - landed.size,
      };
      for (const p of plans) {
        const after = afterState(p);
        if (after.status === 'located' && after.needsReview) counts.review += 1;
        else if (after.status === 'located') counts.located += 1;
        else counts.unlocated += 1;
      }
      counts.kept = counts.processed - counts.changed - counts.conflicts;
      result = counts;

      // 5. «آخر مزامنة» moves for every evaluated machine, changed or not; no version bump.
      if (ids.length > 0) {
        await AtmMachineLocationModel.updateMany(
          { machineId: { $in: ids }, isDeleted: false },
          { $set: { derivedAt: now } },
          { timestamps: false },
        ).exec();
      }
      completed = true;
      return counts;
    } finally {
      await auditService.record({
        entityRef: {
          moduleId: 'atm',
          entityType: 'mapLocationSync',
          entityId: String(new Types.ObjectId()),
        },
        action: 'atmMapLocationSync',
        changes: [
          { field: 'branchIds', old: null, new: branches },
          { field: 'counts', old: null, new: result },
          { field: 'changedMachineIds', old: null, new: changedMachineIds ?? pinsReplaced },
          ...(completed ? [] : [{ field: 'failed', old: null, new: true }]),
        ],
      });
    }
  }

  /** POST /locations/resolve-links — one pass over the pending short links (§5, §6.5). */
  async resolveLinks(
    input: ResolveAtmMapLinks,
    ctx: AuthContext,
  ): Promise<AtmMapLinkResolveResultDto> {
    const { match } = await batchScope(ctx, input.branchId);
    const scopeMachines = async (): Promise<Pick<AtmMachineDoc, '_id' | 'area'>[]> =>
      AtmMachineModel.find(match, { _id: 1, area: 1 })
        .lean<Pick<AtmMachineDoc, '_id' | 'area'>[]>()
        .exec();
    const remaining = async (machineIds: readonly Types.ObjectId[]): Promise<number> =>
      AtmMachineLocationModel.countDocuments({
        machineId: { $in: [...machineIds] },
        isDeleted: false,
        'shortLink.status': 'pending',
      }).exec();

    // The lease is one atomic SET NX EX carrying this run's token: it always has its TTL, so a
    // process or a connection that dies after taking it cannot wedge the resolver, and the release
    // deletes it only while it is still this run's — never a successor's (§5.1, DM-47).
    const cache = getCache();
    const leaseToken = String(new Types.ObjectId());
    if (!(await cache.setIfAbsent(RESOLVE_LEASE_KEY, leaseToken, RESOLVE_LEASE_SECONDS))) {
      return {
        attempted: 0,
        resolved: 0,
        failed: 0,
        remaining: await remaining((await scopeMachines()).map((m) => m._id)),
        conflicts: 0,
        busy: true,
        stopReason: null,
      };
    }
    try {
      const machines = await scopeMachines();
      const machineIds = machines.map((m) => m._id);
      const areaOf = new Map(machines.map((m) => [String(m._id), m.area]));
      const selected = await AtmMachineLocationModel.find(
        { machineId: { $in: machineIds }, isDeleted: false, 'shortLink.status': 'pending' },
        { _id: 1, machineId: 1, branchId: 1, 'shortLink.url': 1 },
      )
        .sort({ 'shortLink.lastAttemptAt': 1, _id: 1 })
        .limit(ATM_MAP_LINK_BATCH_MAX)
        .lean<Pick<AtmMachineLocationDoc, '_id' | 'machineId' | 'branchId' | 'shortLink'>[]>()
        .exec();
      const items = selected.flatMap((doc) =>
        doc.shortLink === null
          ? []
          : [
              {
                id: doc._id,
                machineId: String(doc.machineId),
                branchId: String(doc.branchId),
                url: doc.shortLink.url,
              },
            ],
      );
      type Item = (typeof items)[number];

      let pool: ReferencePoolEntry[] | null = null;
      const claims = new Map<string, Date>();
      const by = oid(ctx.userId);

      const store = async (
        item: Item,
        answer: Extract<ShortLinkResult, { status: 'resolved' | 'failed' }>,
      ): Promise<'stored' | 'conflict'> => {
        pool ??= await loadReferencePool([...new Set(items.map((i) => i.branchId))]);
        const now = new Date();
        const link: StoredShortLink = {
          url: item.url,
          status: answer.status,
          lat: answer.status === 'resolved' ? round6(answer.lat) : null,
          lng: answer.status === 'resolved' ? round6(answer.lng) : null,
          viewportOnly: answer.status === 'resolved' ? answer.viewportOnly : false,
          failure: answer.status === 'failed' ? answer.failure : null,
          attempts: 1,
          lastAttemptAt: now,
          claimedAt: null,
        };
        // An unmatched write is re-read and applied once more; a second miss is a conflict.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const doc = await AtmMachineLocationModel.findOne({ _id: item.id, isDeleted: false })
            .lean<AtmMachineLocationDoc>()
            .exec();
          if (doc === null || doc.shortLink?.url !== item.url) return 'conflict';
          let set: Record<string, unknown> = { shortLink: link };
          let outcome: DerivationOutcome | null = null;
          // The re-derivation reads the STORED text: the resolver never reads the register.
          if (doc.seenText !== null) {
            const derived = deriveLocation({
              texts: doc.seenText,
              entryIds: doc.seenEntryIds.map(String),
              entryProblem: null,
              resolvedLink: link,
              reference: referenceLookup(
                pool,
                item.branchId,
                areaOf.get(item.machineId) ?? null,
                item.machineId,
              ),
            });
            outcome = applyDerivation(
              { ...existingOf(doc), shortLink: link },
              derived,
              doc.seenText,
            );
            if (outcome.write !== null) {
              set = {
                ...outcome.set,
                shortLink: 'shortLink' in outcome.set ? outcome.set.shortLink : link,
                ...(outcome.pointChanged
                  ? { setBy: by, setByName: actorName(ctx), setAt: now }
                  : {}),
              };
            }
          }
          const written = await AtmMachineLocationModel.updateOne(
            { _id: doc._id, __v: doc.__v, isDeleted: false, 'shortLink.url': item.url },
            { $set: { ...set, updatedBy: by }, $inc: { __v: 1 } },
          ).exec();
          if (written.matchedCount === 1) {
            // The replaced pin's trail is recorded the moment its write lands (DM-15).
            if (outcome?.replacedPin === true) {
              const after = { ...existingOf(doc), ...outcome.set };
              await auditService.record(
                replacedPinAudit(item.machineId, doc, {
                  lat: after.lat ?? null,
                  lng: after.lng ?? null,
                  source: after.source ?? null,
                  pinned: after.pinned ?? false,
                }),
              );
            }
            return 'stored';
          }
        }
        return 'conflict';
      };

      // The run row is recorded whatever happens: a claim, store or release that throws part-way
      // leaves the links already opened in it, with `stopReason: 'error'`.
      const run = emptyShortLinkBatchResult<Item>();
      let remainingAfter: number | null = null;
      let completed = false;
      try {
        await runShortLinkBatch(
          items,
          {
            // Immediately before the fetch, without a version bump: a person's open pin form never
            // goes stale because of a claim (§5.4).
            claim: async (item) => {
              const at = new Date();
              const claimed = await AtmMachineLocationModel.findOneAndUpdate(
                {
                  _id: item.id,
                  isDeleted: false,
                  'shortLink.status': 'pending',
                  'shortLink.url': item.url,
                  $or: [
                    { 'shortLink.claimedAt': null },
                    { 'shortLink.claimedAt': { $lt: new Date(at.getTime() - CLAIM_TTL_MS) } },
                  ],
                },
                { $set: { 'shortLink.claimedAt': at } },
                { new: true, timestamps: false },
              )
                .lean()
                .exec();
              if (claimed === null) return false;
              claims.set(String(item.id), at);
              return true;
            },
            store,
            release: async (item) => {
              await AtmMachineLocationModel.updateOne(
                {
                  _id: item.id,
                  'shortLink.url': item.url,
                  'shortLink.claimedAt': claims.get(String(item.id)) ?? null,
                },
                { $set: { 'shortLink.claimedAt': null } },
                { timestamps: false },
              ).exec();
            },
          },
          shortLinkDeps,
          run,
        );
        remainingAfter = await remaining(machineIds);
        completed = true;
        return {
          attempted: run.attempted,
          resolved: run.resolved,
          failed: run.failed,
          remaining: remainingAfter,
          conflicts: run.conflicts,
          busy: false,
          stopReason: run.stopReason,
        };
      } finally {
        // One run row — no URL anywhere in it (the replaced pins' rows are already recorded).
        await auditService.record({
          entityRef: {
            moduleId: 'atm',
            entityType: 'mapLinkResolution',
            entityId: String(new Types.ObjectId()),
          },
          action: 'atmMapLinkResolve',
          changes: [
            {
              field: 'counts',
              old: null,
              new: {
                attempted: run.attempted,
                resolved: run.resolved,
                failed: run.failed,
                remaining: remainingAfter,
                conflicts: run.conflicts,
                stopReason: completed ? run.stopReason : 'error',
              },
            },
            {
              field: 'outcomes',
              old: null,
              new: run.outcomes.map((o) => ({
                machineId: o.item.machineId,
                status: o.status,
                failure: o.failure,
              })),
            },
          ],
        });
      }
    } finally {
      await cache.delIfValue(RESOLVE_LEASE_KEY, leaseToken);
    }
  }
}

export const atmMachineLocationService = new AtmMachineLocationService();
export type { AtmMachineLocationShortLink };
