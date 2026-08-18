// The standing crew (الطاقم الثابت) — one row per vehicle, no date.
//
// NEW ECMS CAPABILITY. Legacy had none: `/tashghela` rendered `t.leader || ""`
// (contad_app.js:2305-2311) and the board started empty every morning, which is exactly why the
// whole crew had to be dragged again each day. This row is the permanent answer to "who normally
// crews this vehicle", and each day's board is seeded from it.
//
// HOLDING A ROW IS MEMBERSHIP — the same rule `crew-requirements.model.ts` states for people, for
// the same reason. There is no day-independent "cash-transfer vehicle" marker anywhere in ECMS to
// derive the list from: `typeId` is make/model, `missionTypeId` lives on the per-DAY Fleet duty
// row, and `operationId` (التشغيل) is deliberately never seeded and never migrated
// (fleet.seed.ts:40-43) so it is null on every real row. Legacy's marker,
// `cars.department == 'نقل اموال'`, lived only in an EJS template and the frozen fleet design
// records it as bug H5 — misspelled, "never matches real data", explicitly not carried. Reviving
// it would re-import a dropped bug. So a vehicle is a cash-transfer vehicle because Operations
// added it here, and stops being one when the row goes.
//
// WHAT IS DELIBERATELY ABSENT:
//   · `notes` — a note on a DAY's crew row is about that day. A permanent note is a different
//     thing, and nobody asked for one.
//   · `isActive` — membership is the row. Two ways to say "not in the fleet" is one too many, and
//     the seed would then have to pick which one it believes.
//   · `sortOrder` — the board reads in vehicle-code order, which is the order operators name them
//     in. A hand-maintained order is a field somebody has to keep true.
//   · any date — that is the whole point of the entity.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface OperationsStandingCrewDoc extends BaseDocFields {
  vehicleId: Types.ObjectId;
  /**
   * The same three slots at the same ceiling as a day's crew row. It has to be the same shape:
   * this is the template the day is seeded from, so anything it cannot express is something the
   * seed can never produce.
   */
  captainEmployeeIds: Types.ObjectId[];
  specialist1EmployeeIds: Types.ObjectId[];
  specialist2EmployeeIds: Types.ObjectId[];
  direction: string | null;
  plannedTime: string | null;
}

/** Empty slot = `[]`. There is no null slot: "nobody assigned" is a list of nobody. */
const crewSlot = {
  type: [Schema.Types.ObjectId],
  default: (): Types.ObjectId[] => [],
};

const standingCrewSchema = new Schema<OperationsStandingCrewDoc>(
  {
    vehicleId: { type: Schema.Types.ObjectId, required: true },
    captainEmployeeIds: crewSlot,
    specialist1EmployeeIds: crewSlot,
    specialist2EmployeeIds: crewSlot,
    direction: { type: String, default: null },
    plannedTime: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One standing row per vehicle — the entity's identity, and the DB half of "a vehicle appears
// twice" protection. Partial on `isDeleted` so a vehicle removed from the fleet can be added back
// without colliding with its own tombstone.
standingCrewSchema.index(
  { vehicleId: 1 },
  { unique: true, name: 'ux_standing_vehicle', partialFilterExpression: { isDeleted: false } },
);

export const OperationsStandingCrewModel = model<OperationsStandingCrewDoc>(
  'OperationsStandingCrew',
  standingCrewSchema,
  'operations_standing_crews',
);
