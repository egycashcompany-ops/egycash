// A machine's point on the map — one live document per machine (DM-5;
// docs/12-planning/atm-map-zones.md §3.3).
//
// In its own collection, not on `atm_machines`: master writes are versioned by `__v`, so a location
// write there would make every Operations edit in flight fail with 409, and the first sync would
// bump 2,607 versions; location fields would also leak into the machine's audit snapshot and into
// `AtmMachineDto`, which `atmMachine.view` reads, while D-M5 gates locations by `atmMap.view`.
// Keyed by `machineId`, the document survives archive and reactivation, and the map reads only
// machines that are not deleted, so a deleted machine's document is never shown.
//
// THE TWO TEXTS. `pinText` is the open entries' text when a person placed or approved the pin —
// written ONLY by place and approve. `seenText` is what the last sync read. A sync compares the
// register with `pinText` and never touches it (DM-2): a pin is replaced only when the register
// moved since it was set AND the new text gives a point. Both are copies of P-class register text
// (no K or S value); a DTO returns `seenText` only to a caller who may read the source entries, and
// never `pinText` or `shortLink.url`.
import { Schema, model, type Types } from 'mongoose';
import {
  ATM_MAP_LINK_FAILURES,
  ATM_MAP_LOCATION_SOURCES,
  ATM_MAP_LOCATION_WARNINGS,
  ATM_MAP_UNLOCATED_REASONS,
  type AtmMapLinkFailure,
  type AtmMapLocationSource,
  type AtmMapLocationTexts,
  type AtmMapLocationWarning,
  type AtmMapReferenceBasis,
  type AtmMapUnlocatedReason,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

/** The point a short Plus Code was recovered against (DM-34). */
export interface AtmMachineLocationReference {
  lat: number;
  lng: number;
  basis: AtmMapReferenceBasis;
  machines: number;
}

/** A Google short link of the machine's AV text, opened once on the server (D-M4, DM-46). */
export interface AtmMachineLocationShortLink {
  url: string;
  status: 'pending' | 'resolved' | 'failed';
  lat: number | null;
  lng: number | null;
  /** The point came from a map viewport only (DM-44a). */
  viewportOnly: boolean;
  failure: AtmMapLinkFailure | null;
  /** 0 or 1: one pass (DM-46). */
  attempts: number;
  lastAttemptAt: Date | null;
  /** §5.4 — a run's atomic claim. */
  claimedAt: Date | null;
}

export interface AtmMachineLocationDoc extends BaseDocFields {
  /** One live document per machine. */
  machineId: Types.ObjectId;
  /** Copied from the machine; a machine's branch never changes (UpdateAtmMachineSchema has none). */
  branchId: Types.ObjectId;
  status: 'located' | 'unlocated';
  /** 6 decimals; null when unlocated. */
  lat: number | null;
  lng: number | null;
  /** Null when unlocated. */
  source: AtmMapLocationSource | null;
  /** A pin a person must confirm: a short code (DM-4), or viewportOnly / ambiguousUrl /
   *  sourcesDisagree (DM-44). */
  needsReview: boolean;
  /** Null when located. */
  reason: AtmMapUnlocatedReason | null;
  warnings: AtmMapLocationWarning[];
  /** Manual or approved → protected by DM-2. */
  pinned: boolean;
  /** The open entries' text when the pin was placed or approved; written ONLY by place and approve. */
  pinText: AtmMapLocationTexts | null;
  /** The open entries at that moment (sorted). */
  pinEntryIds: Types.ObjectId[];
  /** The text the last sync read; null for noEntry and conflictingEntries. */
  seenText: AtmMapLocationTexts | null;
  /** Sorted ids of ALL open entries the last sync read. */
  seenEntryIds: Types.ObjectId[];
  /** Which column produced the point. */
  sourceField: 'locationUrl' | 'locationPlusCode' | null;
  reference: AtmMachineLocationReference | null;
  /** Null when the text holds no link worth resolving (§4.3), and on a pinned document whose
   *  current text equals pinText (§6.5 Place/Approve). */
  shortLink: AtmMachineLocationShortLink | null;
  /** The pasted text of a `mode: 'text'` placement (≤ 2048). */
  manualText: string | null;
  /** The last move reason (≤ 300). */
  moveReason: string | null;
  /** Who last changed the point (a person, or the sync's actor). */
  setBy: Types.ObjectId | null;
  /** `actorName(ctx)` snapshot (atm-context.ts). */
  setByName: string | null;
  setAt: Date | null;
  reviewedBy: Types.ObjectId | null;
  /** `actorName(ctx)` snapshot of the approver (DM-20). */
  reviewedByName: string | null;
  reviewedAt: Date | null;
  /** The last sync that EVALUATED this machine, whether or not it changed it (§6.5). */
  derivedAt: Date | null;
}

const nullableText = { type: String, default: null } as const;
const nullableNumber = { type: Number, default: null } as const;
const nullableDate = { type: Date, default: null } as const;

const textsSchema = new Schema<AtmMapLocationTexts>(
  { plusCode: nullableText, url: nullableText },
  { _id: false },
);

const referenceSchema = new Schema<AtmMachineLocationReference>(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    basis: { type: String, required: true, enum: ['area', 'branch', 'url'] },
    machines: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const shortLinkSchema = new Schema<AtmMachineLocationShortLink>(
  {
    url: { type: String, required: true },
    status: { type: String, required: true, enum: ['pending', 'resolved', 'failed'] },
    lat: nullableNumber,
    lng: nullableNumber,
    viewportOnly: { type: Boolean, required: true, default: false },
    failure: { type: String, enum: [...ATM_MAP_LINK_FAILURES, null], default: null },
    attempts: { type: Number, required: true, min: 0, default: 0 },
    lastAttemptAt: nullableDate,
    claimedAt: nullableDate,
  },
  { _id: false },
);

const locationSchema = new Schema<AtmMachineLocationDoc>(
  {
    machineId: { type: Schema.Types.ObjectId, required: true },
    branchId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, required: true, enum: ['located', 'unlocated'] },
    lat: { type: Number, default: null, min: -90, max: 90 },
    lng: { type: Number, default: null, min: -180, max: 180 },
    source: { type: String, enum: [...ATM_MAP_LOCATION_SOURCES, null], default: null },
    needsReview: { type: Boolean, required: true, default: false },
    reason: { type: String, enum: [...ATM_MAP_UNLOCATED_REASONS, null], default: null },
    warnings: { type: [{ type: String, enum: ATM_MAP_LOCATION_WARNINGS }], default: [] },
    pinned: { type: Boolean, required: true, default: false },
    pinText: { type: textsSchema, default: null },
    pinEntryIds: { type: [Schema.Types.ObjectId], default: [] },
    seenText: { type: textsSchema, default: null },
    seenEntryIds: { type: [Schema.Types.ObjectId], default: [] },
    sourceField: { type: String, enum: ['locationUrl', 'locationPlusCode', null], default: null },
    reference: { type: referenceSchema, default: null },
    shortLink: { type: shortLinkSchema, default: null },
    manualText: { type: String, default: null, maxlength: 2048 },
    moveReason: { type: String, default: null, maxlength: 300 },
    setBy: { type: Schema.Types.ObjectId, default: null },
    setByName: nullableText,
    setAt: nullableDate,
    reviewedBy: { type: Schema.Types.ObjectId, default: null },
    reviewedByName: nullableText,
    reviewedAt: nullableDate,
    derivedAt: nullableDate,
    ...baseFields,
  },
  baseSchemaOptions,
);

// Exact names — `atm-indexes.ts` builds these at boot (§3.4). `ux_machine` is also the batch
// writes' guard: a sync's insert that races a person's first pin hits it and is counted, not thrown.
locationSchema.index(
  { machineId: 1 },
  { unique: true, name: 'ux_machine', partialFilterExpression: { isDeleted: false } },
);
locationSchema.index({ branchId: 1, status: 1, needsReview: 1 }, { name: 'ix_branch_status' });
locationSchema.index({ branchId: 1, 'shortLink.status': 1 }, { name: 'ix_branch_link' });

export const AtmMachineLocationModel = model<AtmMachineLocationDoc>(
  'AtmMachineLocation',
  locationSchema,
  'atm_machine_locations',
);
