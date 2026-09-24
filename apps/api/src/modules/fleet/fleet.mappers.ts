// Doc → DTO mapping for the FL-2 entities. `inWorkshop` is computed by the caller (FR-12) and
// passed in — the mapper never invents a derived fact.
import { type Types } from 'mongoose';
import {
  type FleetAccidentDto,
  type FleetCatalogItemDto,
  type FleetDriverProfileDto,
  type FleetDriverUnavailabilityDto,
  type FleetGrievanceDto,
  type FleetMaintenanceVisitDto,
  type FleetOdometerLogDto,
  type FleetVehicleDto,
  type FleetVehicleTypeDto,
  type FleetViolationDto,
} from '@ecms/contracts';
import { type FleetCatalogItemDoc } from './catalogs/catalog-item.model';
import { type FleetVehicleTypeDoc } from './vehicle-types/vehicle-type.model';
import { type FleetVehicleDoc } from './vehicles/vehicle.model';
import { type FleetDriverProfileDoc } from './driver-profiles/driver-profile.model';
import { type FleetUnavailabilityDoc } from './availability/unavailability.model';
import { type FleetOdometerLogDoc } from './odometer/odometer.model';
import { type FleetMaintenanceVisitDoc } from './maintenance/maintenance.model';
import { type FleetAccidentDoc } from './accidents/accident.model';
import { type FleetGrievanceDoc, type FleetViolationDoc } from './violations/violation.model';

const iso = (d: Date): string => d.toISOString();

export const toVehicleTypeDto = (doc: FleetVehicleTypeDoc): FleetVehicleTypeDto => ({
  id: String(doc._id),
  name: doc.name,
  maintenanceIntervalKm: doc.maintenanceIntervalKm,
  isActive: doc.isActive,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toCatalogItemDto = (doc: FleetCatalogItemDoc): FleetCatalogItemDto => ({
  id: String(doc._id),
  kind: doc.kind,
  name: doc.name,
  countsForAlarm: doc.countsForAlarm,
  violationSide: doc.violationSide,
  isActive: doc.isActive,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toVehicleDto = (doc: FleetVehicleDoc, inWorkshop: boolean): FleetVehicleDto => ({
  id: String(doc._id),
  code: doc.code,
  typeId: String(doc.typeId),
  plateNumber: doc.plateNumber,
  chassisNumber: doc.chassisNumber,
  motorNumber: doc.motorNumber,
  joinedAt: iso(doc.joinedAt),
  licenseExpiresAt: iso(doc.licenseExpiresAt),
  // The legacy free-text `licenseClass` column is deliberately NOT mapped: it is migration
  // evidence, not a fact any client should read or round-trip back.
  //
  // Every optional field below is compared with `== null`, not `=== null`, and that is the whole
  // point: reads go through `.lean()`, which hands back the stored BSON, and a mongoose `default`
  // is applied on WRITE. A row written before a field existed simply does not have the key, so it
  // arrives as `undefined` — which `=== null` lets straight through into `String(undefined)` or,
  // for the subdocument, into a read of a property on nothing.
  licenseClassId: doc.licenseClassId == null ? null : String(doc.licenseClassId),
  operationId: doc.operationId == null ? null : String(doc.operationId),
  insuranceCompanyId: doc.insuranceCompanyId == null ? null : String(doc.insuranceCompanyId),
  branchId: doc.branchId == null ? null : String(doc.branchId),
  departmentId: doc.departmentId == null ? null : String(doc.departmentId),
  radio: { issi: doc.radio?.issi ?? null, motorolaSn: doc.radio?.motorolaSn ?? null },
  status: doc.status,
  statusReason: doc.statusReason ?? null,
  licenseImage:
    doc.licenseImage == null
      ? null
      : {
          fileId: String(doc.licenseImage.fileId),
          fileName: doc.licenseImage.fileName,
          mime: doc.licenseImage.mime,
          size: doc.licenseImage.size,
          uploadedAt: iso(doc.licenseImage.uploadedAt),
        },
  inWorkshop,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toDriverProfileDto = (doc: FleetDriverProfileDoc): FleetDriverProfileDto => ({
  id: String(doc._id),
  employeeId: String(doc.employeeId),
  // `== null`, like the catalog references below: both were REQUIRED until licences became
  // optional, so a profile written before that carries a value, one written since may carry null,
  // and neither shape is a surprise to a reader who is told the field can be absent.
  licenseNumber: doc.licenseNumber ?? null,
  licenseExpiresAt: doc.licenseExpiresAt == null ? null : iso(doc.licenseExpiresAt),
  // `== null` for the three catalog references and the legacy enum alike: every one of them was
  // added after profiles already existed, so a stored row simply has no such key and it arrives
  // as `undefined` rather than as the `null` the schema default writes.
  jobId: doc.jobId == null ? null : String(doc.jobId),
  specializationId: doc.specializationId == null ? null : String(doc.specializationId),
  licenseTypeId: doc.licenseTypeId == null ? null : String(doc.licenseTypeId),
  specialization: doc.specialization ?? null,
  area: doc.area,
  isActive: doc.isActive,
  // `== null`, not `=== null`: reads go through `.lean()`, and a profile written before the
  // licence image existed simply has no such key — it arrives as `undefined`, which `=== null`
  // would let straight through into a property read on nothing.
  licenseImage:
    doc.licenseImage == null
      ? null
      : {
          fileId: String(doc.licenseImage.fileId),
          fileName: doc.licenseImage.fileName,
          mime: doc.licenseImage.mime,
          size: doc.licenseImage.size,
          uploadedAt: iso(doc.licenseImage.uploadedAt),
        },
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toUnavailabilityDto = (doc: FleetUnavailabilityDoc): FleetDriverUnavailabilityDto => ({
  id: String(doc._id),
  employeeId: String(doc.employeeId),
  from: iso(doc.from),
  to: iso(doc.to),
  reason: doc.reason,
  notes: doc.notes,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

/**
 * `vehicleCode` is passed in rather than looked up here: a mapper runs once per row and a lookup
 * per row would be a query per row. The caller resolves the whole page's codes in one go.
 */
/**
 * The id of a row's vehicle, or nothing — a row kept from the old book for a car the registry
 * never had has none, and `String(null)` would hand the registry the word «null» to look up.
 */
export const vehicleIdOf = (doc: { vehicleId: Types.ObjectId | null }): string | null =>
  doc.vehicleId == null ? null : String(doc.vehicleId);

/** The DISTINCT vehicle ids on a page, nulls left out — what one `codesByIds` call is asked for. */
export const vehicleIdsOf = (docs: readonly { vehicleId: Types.ObjectId | null }[]): string[] => [
  ...new Set(docs.flatMap((doc) => (doc.vehicleId == null ? [] : [String(doc.vehicleId)]))),
];

/** The code the registry answered, or — for a row with no vehicle — the one the old book wrote. */
const codeOr = (doc: { vehicleCode?: string | null }, resolved: string | null): string | null =>
  resolved ?? doc.vehicleCode ?? null;

export const toOdometerLogDto = (
  doc: FleetOdometerLogDoc,
  vehicleCode: string | null,
): FleetOdometerLogDto => ({
  id: String(doc._id),
  vehicleId: vehicleIdOf(doc),
  vehicleCode: codeOr(doc, vehicleCode),
  date: iso(doc.date),
  outReading: doc.outReading,
  inReading: doc.inReading,
  km: doc.km,
  driver1EmployeeId: doc.driver1EmployeeId === null ? null : String(doc.driver1EmployeeId),
  driver2EmployeeId: doc.driver2EmployeeId === null ? null : String(doc.driver2EmployeeId),
  // `?? null`: rows written before the field existed carry nothing at all.
  driver1Name: doc.driver1Name ?? null,
  driver2Name: doc.driver2Name ?? null,
  notes: doc.notes,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toAccidentDto = (
  doc: FleetAccidentDoc,
  vehicleCode: string | null = null,
): FleetAccidentDto => ({
  id: String(doc._id),
  vehicleId: vehicleIdOf(doc),
  vehicleCode: codeOr(doc, vehicleCode),
  occurredAt: doc.occurredAt == null ? null : iso(doc.occurredAt),
  culprit: doc.culprit,
  culpritEmployeeId: doc.culpritEmployeeId === null ? null : String(doc.culpritEmployeeId),
  statement: doc.statement,
  companyCost: doc.companyCost,
  amountCollected: doc.amountCollected,
  paidAmount: doc.paidAmount,
  // `?? 0`: files written before transfers existed carry neither field.
  transferredIn: doc.transferredIn ?? 0,
  transferredOut: doc.transferredOut ?? 0,
  status: doc.status,
  notes: doc.notes,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toViolationDto = (
  doc: FleetViolationDoc,
  vehicleCode: string | null = null,
): FleetViolationDto => ({
  id: String(doc._id),
  kind: doc.kind,
  vehicleId: vehicleIdOf(doc),
  vehicleCode: codeOr(doc, vehicleCode),
  violationTypeId: String(doc.violationTypeId),
  amount: doc.amount,
  year: doc.year,
  count: doc.count,
  unitValue: doc.unitValue,
  date: doc.date === null ? null : iso(doc.date),
  // The statement this fine is carried on, when that is not its own date's year — `null` on every
  // row nobody has moved. The board needs it to draw «محمولة على ٢٠٢٦» beside a 2025 date.
  filedYear: doc.filedYear ?? null,
  // Where it goes back to when the badge is pressed. `null` on every row that is not carried.
  homeVehicleId:
    doc.homeVehicleId === undefined || doc.homeVehicleId === null
      ? null
      : String(doc.homeVehicleId),
  driverEmployeeId: doc.driverEmployeeId === null ? null : String(doc.driverEmployeeId),
  driverName: doc.driverName ?? null,
  collected: doc.collected,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toGrievanceDto = (doc: FleetGrievanceDoc): FleetGrievanceDto => ({
  id: String(doc._id),
  vehicleId: String(doc.vehicleId),
  year: doc.year,
  totalBeforeGrievance: doc.totalBeforeGrievance,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

/**
 * The joins are passed IN rather than looked up here, for the reason the odometer's are: a mapper
 * runs once per row, and a lookup inside one is a query per row.
 */
export interface MaintenanceVisitJoins {
  vehicleCode: string | null;
}

export const toMaintenanceVisitDto = (
  doc: FleetMaintenanceVisitDoc,
  joins: MaintenanceVisitJoins,
): FleetMaintenanceVisitDto => ({
  id: String(doc._id),
  vehicleId: vehicleIdOf(doc),
  vehicleCode: codeOr(doc, joins.vehicleCode),
  inDate: iso(doc.inDate),
  outDate: doc.outDate === null ? null : iso(doc.outDate),
  workshopId: String(doc.workshopId),
  workTypeId: String(doc.workTypeId),
  spareParts: doc.spareParts,
  sparePartIds: (doc.sparePartIds ?? []).map(String),
  odometerAtService: doc.odometerAtService,
  // `== null` on purpose: a visit written before the field existed has `undefined`, not `null`.
  exitOdometer: doc.exitOdometer == null ? null : doc.exitOdometer,
  // Stored drivers, read the same forgiving way — old visits carry neither key.
  driverInEmployeeId: doc.driverInEmployeeId == null ? null : String(doc.driverInEmployeeId),
  driverOutEmployeeId: doc.driverOutEmployeeId == null ? null : String(doc.driverOutEmployeeId),
  driverInName: doc.driverInName ?? null,
  driverOutName: doc.driverOutName ?? null,
  takenInByEmployeeId: doc.takenInByEmployeeId === null ? null : String(doc.takenInByEmployeeId),
  takenOutByEmployeeId: doc.takenOutByEmployeeId === null ? null : String(doc.takenOutByEmployeeId),
  notes: doc.notes,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});
