// ATM machine map and owner-drawn zones — constants, input schemas and DTOs (module `atm`).
//
// The spec is docs/12-planning/atm-map-zones.md (owner decisions D-M1…D-M8, designer decisions
// DM-n, unknowns GM-n); this file is its §6.1. The zone geometry the api and the web both run lives
// beside it in `atm-map-geometry.ts`.
//
// Two layers on one map, kept apart on purpose:
//   · a ZONE («قطاع») is a polygon a supervisor draws for ONE branch (D-M6). A machine belongs to
//     a zone by its position (D-M2); its Area is untouched and the legacy `zone` string stays ''.
//   · a machine's LOCATION is derived on the server from the register's free-text AP/AV cells, or
//     placed by a person (`atmMachine.locate`). The register text itself never rides these DTOs.
import { z } from 'zod';
import { objectId, type LocalizedString } from '../common/index.js';
import {
  ATM_MAP_ZONE_MAX_POINTS,
  ATM_MAP_ZONE_MIN_POINTS,
  round6,
  type AtmMapLatLng,
} from './atm-map-geometry.js';
import { type AtmBankCode } from './atm-register.js';

// ── Limits (DM-37, DM-18, DM-45) ────────────────────────────────────────────────────────────────

export const ATM_MAP_ZONES_PER_BRANCH_MAX = 200;
/** `selfIntersects` is O(n²) per zone; this bounds one branch's work and `GET /zones`. */
export const ATM_MAP_ZONE_POINTS_PER_BRANCH_MAX = 20_000;
/** 20,000 points × ≈ 34 B ≈ 680 KB, so a valid save always stays below the 1 MB body limit. */
export const ATM_MAP_SAVE_POINTS_MAX = 20_000;
export const ATM_MAP_ZONE_NAME_MAX = 60;
/** A move longer than this needs a reason (DM-18): a slip of the mouse at low zoom is the error. */
export const ATM_MAP_MOVE_REASON_METERS = 1000;
/** Links one resolve call opens, sequentially (§5.1). */
export const ATM_MAP_LINK_BATCH_MAX = 20;
export const ATM_MAP_SYNC_MAX_MACHINES = 5000;
/** A text placement whose server parse moved further than this from the preview is 409 (DM-45). */
export const ATM_MAP_PARSE_TOLERANCE_METERS = 1;

/** The box the `outsideEgypt` warning checks (DM-35). It warns and never blocks. */
export const EGYPT_BOUNDS = { south: 21.7, north: 31.9, west: 24.6, east: 37.0 } as const;

/**
 * The approved mockup's twelve zone colours, in its order (research ux.md §4). `cased`: under 3:1
 * against the map, so the outline gets a dark casing.
 */
export const ATM_MAP_ZONE_PALETTE = [
  { key: 'indigo', hex: '#483bba', cased: false },
  { key: 'mustard', hex: '#d3a813', cased: true },
  { key: 'raspberry', hex: '#a4546f', cased: false },
  { key: 'mint', hex: '#5bc4a3', cased: true },
  { key: 'plum', hex: '#8a1586', cased: false },
  { key: 'sky', hex: '#4ba3f7', cased: true },
  { key: 'olive', hex: '#406113', cased: false },
  { key: 'coral', hex: '#ed7665', cased: true },
  { key: 'petrol', hex: '#007ca5', cased: false },
  { key: 'orchid', hex: '#d179ca', cased: true },
  { key: 'ochre', hex: '#a27825', cased: false },
  { key: 'violet', hex: '#8264e7', cased: false },
] as const;
export type AtmMapZonePaletteKey = (typeof ATM_MAP_ZONE_PALETTE)[number]['key'];

// ── Vocabulary (§3.3) ───────────────────────────────────────────────────────────────────────────

/** The machine's state on the map, not the register's (DM-16). Default `active` (DM-3). */
export const ATM_MAP_STATUS_FILTERS = ['active', 'archived', 'all'] as const;
export const AtmMapStatusFilterSchema = z.enum(ATM_MAP_STATUS_FILTERS);
export type AtmMapStatusFilter = z.infer<typeof AtmMapStatusFilterSchema>;

/** Where a located point came from (DM-19 labels). `manual` = any pin or paste set by a person. */
export const ATM_MAP_LOCATION_SOURCES = [
  'registerUrl',
  'registerCoordinates',
  'registerPlusCode',
  'registerShortCode',
  'registerShortLink',
  'manual',
] as const;
export const AtmMapLocationSourceSchema = z.enum(ATM_MAP_LOCATION_SOURCES);
export type AtmMapLocationSource = z.infer<typeof AtmMapLocationSourceSchema>;

/** Why a machine has no point (§4.3 ranking). Stored on the location document. */
export const ATM_MAP_UNLOCATED_REASONS = [
  'shortLink',
  'shortLinkFailed',
  'noCoordinates',
  'shortPlusCodeNoReference',
  'invalidCoordinates',
  'unreadable',
  'none',
  'noEntry',
  'conflictingEntries',
] as const;
export const AtmMapUnlocatedReasonSchema = z.enum(ATM_MAP_UNLOCATED_REASONS);
export type AtmMapUnlocatedReason = z.infer<typeof AtmMapUnlocatedReasonSchema>;

/** The DTO form adds `notSynced`: an active machine with no location document yet. */
export const ATM_MAP_UNLOCATED_REASONS_DTO = [...ATM_MAP_UNLOCATED_REASONS, 'notSynced'] as const;
export type AtmMapUnlocatedReasonDto = (typeof ATM_MAP_UNLOCATED_REASONS_DTO)[number];

/** DM-34, DM-35, DM-44. Every one but `outsideEgypt` comes with `needsReview`. */
export const ATM_MAP_LOCATION_WARNINGS = [
  'outsideEgypt',
  'weakReference',
  'viewportOnly',
  'ambiguousUrl',
  'sourcesDisagree',
] as const;
export const AtmMapLocationWarningSchema = z.enum(ATM_MAP_LOCATION_WARNINGS);
export type AtmMapLocationWarning = z.infer<typeof AtmMapLocationWarningSchema>;

/** Why one short link did not resolve (§5.1). */
export const ATM_MAP_LINK_FAILURES = [
  'timeout',
  'httpStatus',
  'tooManyRedirects',
  'hostNotAllowed',
  'consentPage',
  'network',
  'invalidUrl',
  'noCoordinates',
] as const;
export const AtmMapLinkFailureSchema = z.enum(ATM_MAP_LINK_FAILURES);
export type AtmMapLinkFailure = z.infer<typeof AtmMapLinkFailureSchema>;

/** AP (`locationPlusCode`) and AV (`locationUrl`) as one open-entry set reads them (§4.3). */
export interface AtmMapLocationTexts {
  plusCode: string | null;
  url: string | null;
}

/** The point a short Plus Code was recovered against (DM-34); `url` = the same link's viewport. */
export type AtmMapReferenceBasis = 'area' | 'branch' | 'url';

// ── Input schemas ───────────────────────────────────────────────────────────────────────────────

const latitude = () => z.number().finite().min(-90).max(90);
const longitude = () => z.number().finite().min(-180).max(180);

/** A zone vertex. Rounded to 6 decimals on the way in, as the editor rounds it (DM-48). */
const LatLngSchema = z
  .object({ lat: latitude(), lng: longitude() })
  .strict()
  .transform((p): AtmMapLatLng => ({ lat: round6(p.lat), lng: round6(p.lng) }));
const ZoneNameSchema = z.string().trim().min(1).max(ATM_MAP_ZONE_NAME_MAX);
/** Stored lowercase (DM-32): `#ABCDEF` and `#abcdef` are one colour. */
const ZoneColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((c) => c.toLowerCase());
const ZonePointsSchema = z
  .array(LatLngSchema)
  .min(ATM_MAP_ZONE_MIN_POINTS)
  .max(ATM_MAP_ZONE_MAX_POINTS);

/** GET /atm/map/points. `branchId` may only NARROW inside the caller's reach (DM-11). */
export const AtmMapPointsQuerySchema = z
  .object({ branchId: objectId().optional(), status: AtmMapStatusFilterSchema.default('active') })
  .strict();
export type AtmMapPointsQuery = z.infer<typeof AtmMapPointsQuerySchema>;

export const AtmMapZonesQuerySchema = z.object({ branchId: objectId().optional() }).strict();
export type AtmMapZonesQuery = z.infer<typeof AtmMapZonesQuerySchema>;

export const AtmMapLocationSummaryQuerySchema = AtmMapZonesQuerySchema;
export type AtmMapLocationSummaryQuery = z.infer<typeof AtmMapLocationSummaryQuerySchema>;

/** A zone created in this save, named by the editor until the server gives it an id. */
const TempIdSchema = z.string().regex(/^new-[a-z0-9]{1,24}$/);

/**
 * Codes a refinement below reports. A Zod custom issue's own `code` is always `custom`, so the
 * machine-readable code rides `message` and `params.code`.
 */
export const ATM_MAP_SAVE_ISSUES = [
  'DUPLICATE_TEMP_ID',
  'DUPLICATE_ID',
  'UPDATED_AND_DELETED',
  'NO_FIELDS',
  'TOO_MANY_POINTS_IN_SAVE',
] as const;
export type AtmMapSaveIssue = (typeof ATM_MAP_SAVE_ISSUES)[number];

/**
 * PUT /atm/map/zones — every change of one branch's zones, saved together under the revision the
 * editor loaded (DM-7). `branchId` is a consistency check only: the server files the save under
 * the branch it resolves itself (DM-12), and a different one here is 400 `BRANCH_MISMATCH`.
 */
export const SaveAtmMapZoneSetSchema = z
  .object({
    branchId: objectId(),
    revision: z.number().int().min(0),
    creates: z
      .array(
        z
          .object({
            tempId: TempIdSchema,
            name: ZoneNameSchema,
            color: ZoneColorSchema,
            points: ZonePointsSchema,
          })
          .strict(),
      )
      .max(ATM_MAP_ZONES_PER_BRANCH_MAX),
    updates: z
      .array(
        z
          .object({
            id: objectId(),
            name: ZoneNameSchema.optional(),
            color: ZoneColorSchema.optional(),
            points: ZonePointsSchema.optional(),
          })
          .strict(),
      )
      .max(ATM_MAP_ZONES_PER_BRANCH_MAX),
    deletes: z.array(objectId()).max(ATM_MAP_ZONES_PER_BRANCH_MAX),
    /** The final order, top = first = the highest priority (D-M7). */
    order: z.array(z.union([objectId(), TempIdSchema])).max(ATM_MAP_ZONES_PER_BRANCH_MAX),
  })
  .strict()
  .superRefine((save, ctx) => {
    const report = (path: (string | number)[], code: AtmMapSaveIssue): void => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: code, params: { code } });
    };
    const firstSeen = (values: readonly string[], path: (i: number) => (string | number)[]) => {
      const seen = new Set<string>();
      values.forEach((value, i) => {
        const key = value.toLowerCase();
        if (seen.has(key)) report(path(i), 'DUPLICATE_ID');
        seen.add(key);
      });
    };

    const tempIds = new Set<string>();
    save.creates.forEach((create, i) => {
      if (tempIds.has(create.tempId)) report(['creates', i, 'tempId'], 'DUPLICATE_TEMP_ID');
      tempIds.add(create.tempId);
    });
    firstSeen(
      save.updates.map((u) => u.id),
      (i) => ['updates', i, 'id'],
    );
    firstSeen(save.deletes, (i) => ['deletes', i]);
    firstSeen(save.order, (i) => ['order', i]);

    const updated = new Set(save.updates.map((u) => u.id.toLowerCase()));
    save.deletes.forEach((id, i) => {
      if (updated.has(id.toLowerCase())) report(['deletes', i], 'UPDATED_AND_DELETED');
    });
    save.updates.forEach((update, i) => {
      if (update.name === undefined && update.color === undefined && update.points === undefined) {
        report(['updates', i], 'NO_FIELDS');
      }
    });

    const points =
      save.creates.reduce((sum, c) => sum + c.points.length, 0) +
      save.updates.reduce((sum, u) => sum + (u.points?.length ?? 0), 0);
    if (points > ATM_MAP_SAVE_POINTS_MAX) report([], 'TOO_MANY_POINTS_IN_SAVE');
  });
export type SaveAtmMapZoneSet = z.infer<typeof SaveAtmMapZoneSetSchema>;
export type SaveAtmMapZoneSetInput = z.input<typeof SaveAtmMapZoneSetSchema>;

/** POST /atm/map/locations/parse — the paste box's preview (DM-14). Never fetches a link. */
export const ParseAtmMapLocationSchema = z
  .object({ machineId: objectId(), text: z.string().trim().min(1).max(2048) })
  .strict();
export type ParseAtmMapLocation = z.infer<typeof ParseAtmMapLocationSchema>;

/** Required by the server for a move longer than `ATM_MAP_MOVE_REASON_METERS` (DM-18). */
const MoveReason = z.string().trim().min(1).max(300).optional();

/**
 * PUT /atm/map/machines/:machineId/location. `version` is the location document's `__v`, or
 * `null` when the machine has none yet. In text mode `expected` is the point the person previewed
 * (DM-45).
 */
export const PlaceAtmMachineLocationSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('pin'),
      lat: latitude(),
      lng: longitude(),
      version: z.number().int().min(0).nullable(),
      reason: MoveReason,
    })
    .strict(),
  z
    .object({
      mode: z.literal('text'),
      text: z.string().trim().min(1).max(2048),
      expected: z.object({ lat: latitude(), lng: longitude() }).strict(),
      version: z.number().int().min(0).nullable(),
      reason: MoveReason,
    })
    .strict(),
]);
export type PlaceAtmMachineLocation = z.infer<typeof PlaceAtmMachineLocationSchema>;

export const ApproveAtmMachineLocationSchema = z
  .object({ version: z.number().int().min(0) })
  .strict();
export type ApproveAtmMachineLocation = z.infer<typeof ApproveAtmMachineLocationSchema>;

export const SyncAtmMapLocationsSchema = z.object({ branchId: objectId().optional() }).strict();
export type SyncAtmMapLocations = z.infer<typeof SyncAtmMapLocationsSchema>;

/** One pass, no retry of failed links (DM-46): there is deliberately no `retryFailed`. */
export const ResolveAtmMapLinksSchema = z.object({ branchId: objectId().optional() }).strict();
export type ResolveAtmMapLinks = z.infer<typeof ResolveAtmMapLinksSchema>;

// ── DTOs ────────────────────────────────────────────────────────────────────────────────────────

export interface AtmMapContextBranchDto {
  id: string;
  name: LocalizedString;
  canManageZones: boolean;
  canLocate: boolean;
}

export interface AtmMapContextDto {
  branches: AtmMapContextBranchDto[];
  /** The view grant is organization-wide and the top bar does not narrow it → «كل الفروع». */
  organizationWide: boolean;
  /** Where a zone save is filed (`resolveZoneEditBranch`, §6.2). */
  editBranchId: string | null;
  /** Why `editBranchId` is null. */
  editBlocked: 'chooseBranch' | 'branchNotEditable' | null;
}

export type AtmMapPointState = 'located' | 'review' | 'unlocated';

/** One machine on the map. No register text, `manualText` or `moveReason` is ever in it. */
export interface AtmMapPointDto {
  machineId: string;
  code: string;
  name: string;
  branchId: string;
  area: string;
  bankName: string;
  /** The open entries' common register bank, or null (DM-17). */
  bankCode: AtmBankCode | null;
  active: boolean;
  lat: number | null;
  lng: number | null;
  state: AtmMapPointState;
  source: AtmMapLocationSource | null;
  reason: AtmMapUnlocatedReasonDto | null;
  warnings: AtmMapLocationWarning[];
  /** DM-20: `moved` = a manual pin (setByName/setAt); `approved` = reviewedByName/reviewedAt. */
  lastSet: { kind: 'moved' | 'approved'; byName: string | null; at: string } | null;
}

export interface AtmMapPointsDto {
  points: AtmMapPointDto[];
  generatedAt: string;
}

export interface AtmMapZoneDto {
  id: string;
  branchId: string;
  name: string;
  color: string;
  order: number;
  points: AtmMapLatLng[];
  updatedAt: string;
}

export interface AtmMapZoneSetDto {
  branchId: string;
  /** 0 when the branch has never saved a zone. */
  revision: number;
  zones: AtmMapZoneDto[];
}

export interface AtmMapZonesDto {
  sets: AtmMapZoneSetDto[];
}

export interface AtmMapReferenceDto {
  lat: number;
  lng: number;
  basis: AtmMapReferenceBasis;
  machines: number;
}

export interface AtmMachineLocationDetailDto {
  machineId: string;
  /** The location document's `__v`; null when there is none yet. */
  version: number | null;
  state: AtmMapPointState;
  lat: number | null;
  lng: number | null;
  source: AtmMapLocationSource | null;
  reason: AtmMapUnlocatedReasonDto | null;
  warnings: AtmMapLocationWarning[];
  needsReview: boolean;
  pinned: boolean;
  reference: AtmMapReferenceDto | null;
  shortLink: {
    status: 'pending' | 'resolved' | 'failed';
    failure: AtmMapLinkFailure | null;
    attempts: number;
  } | null;
  /** The caller holds `atmRegister.view` and can read every source entry (§6.5 Detail). */
  sourceVisible: boolean;
  /** = `seenText`, only when `sourceVisible`. */
  sourceText: AtmMapLocationTexts | null;
  manualText: string | null;
  moveReason: string | null;
  setByName: string | null;
  setAt: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  derivedAt: string | null;
}

export type AtmMapParseResultDto =
  | {
      ok: true;
      lat: number;
      lng: number;
      kind: 'url' | 'coordinates' | 'plusCode' | 'shortPlusCode' | 'viewport';
      needsReview: boolean;
      warnings: AtmMapLocationWarning[];
    }
  | {
      ok: false;
      reason:
        | 'shortLink'
        | 'noCoordinates'
        | 'invalidCoordinates'
        | 'unreadable'
        | 'shortPlusCodeNoReference';
    };

export interface AtmMapLocationSummaryDto {
  totalActive: number;
  located: number;
  review: number;
  unlocated: number;
  byReason: Record<AtmMapUnlocatedReasonDto, number>;
  /** Machines with no document, or whose open entries moved since the last sync. */
  pendingSync: number;
  shortLinksPending: number;
  shortLinksFailed: number;
  lastSyncAt: string | null;
}

/**
 * processed = located + review + unlocated (every active machine evaluated); changed = documents
 * written; conflicts = writes that matched no document because a person wrote it in between;
 * kept = processed − changed − conflicts.
 */
export interface AtmMapSyncResultDto {
  processed: number;
  changed: number;
  located: number;
  review: number;
  unlocated: number;
  kept: number;
  conflicts: number;
}

export type AtmMapLinkStopReason = 'budget' | 'rateLimited' | 'unreachable';

export interface AtmMapLinkResolveResultDto {
  attempted: number;
  resolved: number;
  failed: number;
  remaining: number;
  conflicts: number;
  /** Another run holds the company-wide lease; nothing was touched (DM-47). */
  busy: boolean;
  stopReason: AtmMapLinkStopReason | null;
}
