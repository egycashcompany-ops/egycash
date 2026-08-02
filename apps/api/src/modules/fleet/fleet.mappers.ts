// Doc → DTO mapping for the FL-2 entities. `inWorkshop` is computed by the caller (FR-12) and
// passed in — the mapper never invents a derived fact.
import {
  type FleetCatalogItemDto,
  type FleetDriverProfileDto,
  type FleetDriverUnavailabilityDto,
  type FleetVehicleDto,
  type FleetVehicleTypeDto,
} from '@ecms/contracts';
import { type FleetCatalogItemDoc } from './catalogs/catalog-item.model';
import { type FleetVehicleTypeDoc } from './vehicle-types/vehicle-type.model';
import { type FleetVehicleDoc } from './vehicles/vehicle.model';
import { type FleetDriverProfileDoc } from './driver-profiles/driver-profile.model';
import { type FleetUnavailabilityDoc } from './availability/unavailability.model';

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
  licenseClass: doc.licenseClass,
  branchId: doc.branchId === null ? null : String(doc.branchId),
  departmentId: doc.departmentId === null ? null : String(doc.departmentId),
  radio: { issi: doc.radio.issi, motorolaSn: doc.radio.motorolaSn },
  status: doc.status,
  statusReason: doc.statusReason,
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
