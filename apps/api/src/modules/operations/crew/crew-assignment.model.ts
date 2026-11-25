// The cash-transfer crew assignment — the legacy tashghela row normalized (discovery §8): one row
// per (operating day, vehicle) holding captain + specialist 1/2 + direction/time/notes. This row
// is what later slices resolve crews through: `day + vehicle → crew`, and with the shipment legs,
// `day + vehicle + leg → crew` — the legacy (car_num, date) join preserved as an entity instead of
// being duplicated onto every shipment (discovery §4.1: specialists were NEVER on the shipment).
//
// The row ANCHORS on the Fleet duty assignment for the same (vehicle, date) — the frozen §9.4
// boundary: Fleet owns (vehicle, drivers, mission type)/day; Operations attaches the cash crew to
// that row by id and never re-models it. Legacy `tybe` therefore has no field here (it is Fleet's
// missionTypeId); legacy `car_status` arrives with the vault/dispatch slice that writes it.
//
// Upsert-in-place per (day, vehicle) exactly as legacy replaced the tashghela row
// (contad_app.js:2413) — no history row; the audit trail carries the changes.
//
// ROUND 20 — A ROW WITHOUT A VAN. «وعاوز اقدر اضيف صف ميكونش ليه عربيه واضيف كل البيانات برضو»: a
// crew row may now have NO vehicle (and so no Fleet duty row) — a crew planned before its van is
// known. Such a row is the board's alone: every reader that is about VANS (the van cards, the
// distribution, the captain's day, a leg's crew) reads `OperationsVanCrewDoc` through the
// repository's van reads and never sees one. And the row gained the legacy board's two other
// columns, «النوع» (`shiftTypeId`, the `أنواع التشغيل` catalog) and its colour (`rowColour`).
//
// ROUND 24 — THE OWNER REVERSED "A ROW WITHOUT A VAN CARRIES NOTHING" for the محصنات: «عاوز لو عربيه
// من غير كود عادى تظهر ان اوزع عليها محصنات». A row without a van is now a crew like any other to
// every reader AFTER the board — «توزيع المحصنات» places delivery legs on it, «تسليم المحصنات»
// hands its load over, its captain sees his route in the app — and the leg it carries has
// `vehicleId` null. Only the daily PICKUP leg (the shipment form's crew) still takes a van's row
// (`findVanById`). And the anchor loosened the other way too: «مكان بدون سيارة دا لما ادوس عليه
// يجيب كل السيارات اللى مش عليها طاقم» — a row may hold a van the Fleet roster does not have that
// day, with `fleetDutyAssignmentId` null (crew.service.ts `plan`).
import { Schema, model, type Types } from 'mongoose';
import {
  OPERATIONS_CREW_ROW_COLOURS,
  OPERATIONS_CREW_ROW_NO_COLOUR,
  OPERATIONS_LEGACY_CREW_ROW_COLOURS,
  type OperationsCrewRowColourSetting,
  type OperationsLegacyCrewRowColour,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface OperationsCrewAssignmentDoc extends BaseDocFields {
  operationsDayId: Types.ObjectId;
  /** Null for a row without a van (Round 20). */
  vehicleId: Types.ObjectId | null;
  /**
   * The Fleet duty row of the same (vehicle, day) — null when `vehicleId` is, and (Round 24) also
   * for a van the Fleet roster did not have that day when the row took it. Never the join key for
   * the van's drivers: read them by (vehicle, day) (shipment.service.ts `vanCardsOf`), so a van the
   * roster takes in later the same day shows its drivers too.
   */
  fleetDutyAssignmentId: Types.ObjectId | null;
  /**
   * «النوع» — a row of `operations_shift_types`, or null («اختر»). Optional on the type because rows
   * written before Round 20 carry no such field; `.lean()` reads absent as undefined.
   */
  shiftTypeId?: Types.ObjectId | null;
  /**
   * The row's colour picked by hand (Round 20), or null. Optional for the same reason. Round 24b: a
   * name of the types' palette, null meaning «لون النوع» — the board then draws the row in its
   * type's colour. A row written before Round 24b may still hold one of Round 20's six names until
   * the boot migrates it (`migrateCrewRowColoursToPalette`), which is why the type says so: every
   * reader goes through `canonicalCrewRowColour`, and nothing writes a legacy name. Round 34 C:
   * or `'none'` — «بدون لون», picked by hand over the type's colour (`OPERATIONS_CREW_ROW_NO_COLOUR`).
   */
  rowColour?: OperationsCrewRowColourSetting | OperationsLegacyCrewRowColour | null;
  /**
   * The three slots, each now holding up to `CREW_SLOT_CAPACITY` people (six per vehicle). The
   * cap is a contract rule (`PlanOperationsCrewRowSchema`), enforced where the payload arrives
   * rather than restated here — Mongoose runs document validators on `save()` and this row is
   * only ever written through an upsert, so a schema validator would be decoration.
   *
   * WHY THE FIELDS ARE RENAMED AND NOT WIDENED IN PLACE. Mongo matches `{ captainEmployeeId: x }`
   * against an ARRAY containing `x` just as happily as against the scalar `x`. Had the names
   * stayed, every stored query — including `findForCaptainDay`, the captaincy anchor of the whole
   * mobile identity chain — would have gone on returning the right documents while every
   * `String(row.captainEmployeeId) === employeeId` in TypeScript quietly became false for a
   * two-captain crew. That is a defect that passes its own tests. Renaming makes the compiler
   * enumerate all 24 call sites instead.
   */
  captainEmployeeIds: Types.ObjectId[];
  specialist1EmployeeIds: Types.ObjectId[];
  specialist2EmployeeIds: Types.ObjectId[];
  direction: string | null;
  plannedTime: string | null;
  notes: string | null;
}

/** Empty slot = `[]`. There is no null slot: "nobody assigned" is a list of nobody. */
const crewSlot = {
  type: [Schema.Types.ObjectId],
  default: (): Types.ObjectId[] => [],
};

const crewAssignmentSchema = new Schema<OperationsCrewAssignmentDoc>(
  {
    operationsDayId: { type: Schema.Types.ObjectId, required: true },
    vehicleId: { type: Schema.Types.ObjectId, default: null },
    fleetDutyAssignmentId: { type: Schema.Types.ObjectId, default: null },
    shiftTypeId: { type: Schema.Types.ObjectId, default: null },
    // The palette's names, «بدون لون» (`'none'`, Round 34 C), and Round 20's
    // (`OPERATIONS_LEGACY_CREW_ROW_COLOURS`) for a row not yet migrated — the enum describes what
    // the collection may hold, not what is written now.
    rowColour: {
      type: String,
      enum: [
        ...new Set<string | null>([
          ...OPERATIONS_CREW_ROW_COLOURS,
          OPERATIONS_CREW_ROW_NO_COLOUR,
          ...Object.keys(OPERATIONS_LEGACY_CREW_ROW_COLOURS),
          null,
        ]),
      ],
      default: null,
    },
    captainEmployeeIds: crewSlot,
    specialist1EmployeeIds: crewSlot,
    specialist2EmployeeIds: crewSlot,
    // The pre-capacity `captainEmployeeId` / `specialist1EmployeeId` / `specialist2EmployeeId`
    // columns are deliberately ABSENT from this map, and their DATA is deliberately still in the
    // collection. Nothing deletes them — `migrateCrewSlotsToArrays` reads them, converts them, and
    // leaves them exactly as written, because the source of a conversion is the only way to check
    // it afterwards. What un-mapping them buys is the thing a `@deprecated` comment cannot: with
    // the paths off the document type, `row.captainEmployeeId` stops compiling. Left declared,
    // every one of the 24 reads this rename is meant to surface would have gone on type-checking
    // while returning null — the same silent-success failure that made the rename necessary.
    direction: { type: String, default: null },
    plannedTime: { type: String, default: null },
    notes: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The legacy (car_num, date) identity, normalized: one crew row per vehicle per operating day.
// A concurrent double-plan for the same vehicle-day collides here (the fleet ux_vehicle_date
// precedent); the crew-member half spans three multi-valued fields and is service-checked (Q11).
//
// PARTIAL ON A PRESENT VAN since Round 20: a day may hold any number of rows WITHOUT a van, and a
// unique index over every live row would make the second of them collide with the first on
// (day, null). `$type: 'objectId'` leaves exactly those rows out and keeps every van row in. A
// database built before carries the old shape until the boot's index-drift repair rebuilds it
// (`migrateCrewAssignmentIndexes`, operations.migration.ts).
crewAssignmentSchema.index(
  { operationsDayId: 1, vehicleId: 1 },
  {
    unique: true,
    name: 'ux_day_vehicle',
    partialFilterExpression: { isDeleted: false, vehicleId: { $type: 'objectId' } },
  },
);
crewAssignmentSchema.index({ operationsDayId: 1 }, { name: 'ix_day' });
// "Which vehicles am I a captain of today?" — the captaincy anchor the mobile surface resolves
// identity through (design §20-هـ). Without it that read is a day-wide scan filtered in memory.
// MULTIKEY now, and under a NEW NAME: `ix_day_captain` indexed the retired scalar, and an index
// keeps its key spec for its lifetime, so re-declaring the same name over a different field is a
// conflict rather than a change.
//
// Neither index is built at boot in production — `mongo.ts:10` sets `autoIndex` to false there and
// index sync is a deploy step — so this declaration is a request to that step, exactly like every
// other index in the codebase. The stale `ix_day_captain` is deliberately NOT dropped here: it
// indexes a column nothing writes any more, and dropping an index is a destructive operation that
// belongs in the same deploy step rather than in application code.
crewAssignmentSchema.index(
  { operationsDayId: 1, captainEmployeeIds: 1 },
  { name: 'ix_day_captains' },
);

/**
 * A crew row ON A VAN. Since Round 24 only the board (which lists vans apart from the rows without
 * one) and the daily pickup leg (`findVanById`) ask for one; `fleetDutyAssignmentId` may still be
 * null — a van the Fleet roster did not have that day.
 */
export type OperationsVanCrewDoc = OperationsCrewAssignmentDoc & {
  vehicleId: Types.ObjectId;
};

/** Is this crew row on a van? `!= null`: a `.lean()` row may hand an absent field back as undefined. */
export const hasVan = (row: OperationsCrewAssignmentDoc): row is OperationsVanCrewDoc =>
  row.vehicleId != null;

/**
 * A crew row's or a shipment leg's van as an id string, or null when it has none (Round 24). Every
 * DTO, audit snapshot and event reads the van through this: `String(row.vehicleId)` would print
 * "null" for a row without a van, and "undefined" for a `.lean()` row missing the field.
 */
export const vehicleIdOf = (row: { vehicleId?: Types.ObjectId | null }): string | null =>
  row.vehicleId == null ? null : String(row.vehicleId);

export const OperationsCrewAssignmentModel = model<OperationsCrewAssignmentDoc>(
  'OperationsCrewAssignment',
  crewAssignmentSchema,
  'operations_crew_assignments',
);
