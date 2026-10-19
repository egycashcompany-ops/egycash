// One counter document per branch: the revision of that branch's zone set (DM-7;
// docs/12-planning/atm-map-zones.md §3.2).
//
// Every save carries the revision the editor loaded and moves it by one, atomically, inside the
// save's transaction; a mismatch is 409 `ATM_MAP_ZONES_STALE` and writes nothing. Two editors have
// no presence or live notice (realtime does not reach branch-scoped users, §6.7), so this is the
// only guard between them. An absent document is revision 0.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface AtmMapZoneSetDoc extends BaseDocFields {
  /** One document per branch. */
  branchId: Types.ObjectId;
  /** ≥ 1 once the branch's first save happened; an absent document is revision 0. */
  revision: number;
}

const zoneSetSchema = new Schema<AtmMapZoneSetDoc>(
  {
    branchId: { type: Schema.Types.ObjectId, required: true },
    revision: { type: Number, required: true, min: 0, default: 0 },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The first save's create is the CAS for revision 0: a second first save hits this and is 409.
zoneSetSchema.index({ branchId: 1 }, { unique: true, name: 'ux_branch' });

export const AtmMapZoneSetModel = model<AtmMapZoneSetDoc>(
  'AtmMapZoneSet',
  zoneSetSchema,
  'atm_map_zone_sets',
);
