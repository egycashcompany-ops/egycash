// Doc → DTO mapping for the FL-2 entities. `inWorkshop` is computed by the caller (FR-12) and
// passed in — the mapper never invents a derived fact.
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
  licenseNumber: doc.licenseNumber,
  licenseExpiresAt: iso(doc.licenseExpiresAt),
  specialization: doc.specialization,
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
export const toOdometerLogDto = (
  doc: FleetOdometerLogDoc,
  vehicleCode: string | null,
): FleetOdometerLogDto => ({
  id: String(doc._id),
  vehicleId: String(doc.vehicleId),
  vehicleCode,
  date: iso(doc.date),
  outReading: doc.outReading,
  inReading: doc.inReading,
  km: doc.km,
  driver1EmployeeId: doc.driver1EmployeeId === null ? null : String(doc.driver1EmployeeId),
  driver2EmployeeId: doc.driver2EmployeeId === null ? null : String(doc.driver2EmployeeId),
  notes: doc.notes,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toAccidentDto = (doc: FleetAccidentDoc): FleetAccidentDto => ({
  id: String(doc._id),
  vehicleId: String(doc.vehicleId),
  occurredAt: iso(doc.occurredAt),
  culprit: doc.culprit,
  statement: doc.statement,
  companyCost: doc.companyCost,
  amountCollected: doc.amountCollected,
  paidAmount: doc.paidAmount,
  status: doc.status,
  notes: doc.notes,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toViolationDto = (doc: FleetViolationDoc): FleetViolationDto => ({
  id: String(doc._id),
  kind: doc.kind,
  vehicleId: String(doc.vehicleId),
  violationTypeId: String(doc.violationTypeId),
  amount: doc.amount,
  year: doc.year,
  count: doc.count,
  unitValue: doc.unitValue,
  date: doc.date === null ? null : iso(doc.date),
  driverEmployeeId: doc.driverEmployeeId === null ? null : String(doc.driverEmployeeId),
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
  vehicleId: String(doc.vehicleId),
  vehicleCode: joins.vehicleCode,
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
  takenInByEmployeeId: doc.takenInByEmployeeId === null ? null : String(doc.takenInByEmployeeId),
  takenOutByEmployeeId: doc.takenOutByEmployeeId === null ? null : String(doc.takenOutByEmployeeId),
  notes: doc.notes,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});
