// A zone («قطاع») on the machine map — a polygon a supervisor draws for ONE branch (D-M6;
// docs/12-planning/atm-map-zones.md §3.1).
//
// A NEW map layer (D-M2): a machine belongs to a zone by its position, computed in the browser
// (DM-9); nothing here touches the machine's Area or the legacy `zone` string. The ring is open —
// the first point is not repeated — with 3–500 points rounded to 6 decimals (DM-6). No GeoJSON and
// no `2dsphere` index: no geo query is ever asked, and such an index would refuse the
// self-intersecting drafts an editor passes through. Names are unique per branch in the SERVICE,
// under the set's revision check, never by an index (DM-8): one save may swap two names.
import { Schema, model, type Types } from 'mongoose';
import {
  ATM_MAP_ZONE_MAX_POINTS,
  ATM_MAP_ZONE_MIN_POINTS,
  type AtmMapLatLng,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export type { AtmMapLatLng };

export interface AtmMapZoneDoc extends BaseDocFields {
  /** Immutable; the branch the zone belongs to (D-M6). */
  branchId: Types.ObjectId;
  /** 1..60 after trim. */
  name: string;
  /** `#rrggbb`, lowercase (DM-32). */
  color: string;
  /** 0..n-1 within the branch; lower = higher priority (D-M7). */
  order: number;
  /** Open ring, 3..500 points, 6 decimals (DM-6). */
  points: AtmMapLatLng[];
}

const pointSchema = new Schema<AtmMapLatLng>(
  {
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
  },
  { _id: false },
);

const zoneSchema = new Schema<AtmMapZoneDoc>(
  {
    branchId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    color: { type: String, required: true, match: /^#[0-9a-f]{6}$/ },
    order: { type: Number, required: true, min: 0 },
    points: {
      type: [pointSchema],
      required: true,
      validate: {
        validator: (v: unknown[]) =>
          v.length >= ATM_MAP_ZONE_MIN_POINTS && v.length <= ATM_MAP_ZONE_MAX_POINTS,
      },
    },
    ...baseFields,
  },
  baseSchemaOptions,
);

// Exact names — `atm-indexes.ts` builds these at boot (§3.4).
zoneSchema.index(
  { branchId: 1, order: 1 },
  { name: 'ix_branch_order', partialFilterExpression: { isDeleted: false } },
);

export const AtmMapZoneModel = model<AtmMapZoneDoc>('AtmMapZone', zoneSchema, 'atm_map_zones');
