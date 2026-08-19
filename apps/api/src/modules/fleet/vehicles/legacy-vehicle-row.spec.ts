// A vehicle row written BEFORE a field existed, mapped for the wire.
//
// This is the bug that took `/fleet/vehicles` down after the catalogs slice, and it is worth a
// test of its own because the mistake is invisible in the type system: `FleetVehicleDoc` says
// `licenseImage: FleetVehicleLicenseImage | null`, and for a row that predates the field the
// truth is `undefined`. Reads go through `.lean()`, which returns the stored BSON — a mongoose
// `default` is applied on WRITE, so it never reaches a document that was written earlier.
//
// `=== null` therefore let `undefined` through: the reference fields became the STRING
// "undefined", and the subdocument threw `Cannot read properties of undefined (reading 'fileId')`
// — a 500 that the registry showed as "تعذر التحميل / Unexpected error".
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { toVehicleDto } from '../fleet.mappers';
import { type FleetVehicleDoc } from './vehicle.model';

/** Exactly the keys a pre-catalogs-slice row has — the new ones are ABSENT, not null. */
const legacyRow = (): FleetVehicleDoc =>
  ({
    _id: new Types.ObjectId(),
    code: '150',
    typeId: new Types.ObjectId(),
    plateNumber: 'س ص 150',
    chassisNumber: 'CH-150',
    motorNumber: 'MO-150',
    joinedAt: new Date('2024-01-01T00:00:00.000Z'),
    licenseExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
    licenseClass: 'ملاكي',
    branchId: null,
    departmentId: null,
    radio: { issi: null, motorolaSn: null },
    status: 'active',
    statusReason: null,
    __v: 0,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    isDeleted: false,
  }) as unknown as FleetVehicleDoc;

describe('a vehicle row that predates the catalogs slice', () => {
  it('maps instead of throwing — the registry must still list it', () => {
    expect(() => toVehicleDto(legacyRow(), false)).not.toThrow();
  });

  it('reports every absent reference as null, never the string "undefined"', () => {
    const dto = toVehicleDto(legacyRow(), false);
    expect(dto.licenseClassId).toBeNull();
    expect(dto.operationId).toBeNull();
    expect(dto.insuranceCompanyId).toBeNull();
    expect(dto.licenseImage).toBeNull();
    // The failure this guards against is silent, so assert the shape and not just falsiness.
    expect(JSON.stringify(dto)).not.toContain('"undefined"');
  });

  it('keeps a branchless legacy vehicle readable — null is a fact, not an error', () => {
    expect(toVehicleDto(legacyRow(), false).branchId).toBeNull();
  });

  it('survives a row with no radio subdocument at all', () => {
    const noRadio = { ...legacyRow() } as Record<string, unknown>;
    delete noRadio.radio;
    const dto = toVehicleDto(noRadio as unknown as FleetVehicleDoc, false);
    expect(dto.radio).toEqual({ issi: null, motorolaSn: null });
  });

  it('still maps a fully populated row — the guard must not nullify real values', () => {
    const classId = new Types.ObjectId();
    const operationId = new Types.ObjectId();
    const insurerId = new Types.ObjectId();
    const branchId = new Types.ObjectId();
    const fileId = new Types.ObjectId();
    const dto = toVehicleDto(
      {
        ...legacyRow(),
        licenseClassId: classId,
        operationId,
        insuranceCompanyId: insurerId,
        branchId,
        radio: { issi: 'ISSI-1', motorolaSn: 'SN-1' },
        licenseImage: {
          fileId,
          fileName: 'license.png',
          mime: 'image/png',
          size: 2048,
          uploadedAt: new Date('2026-02-01T00:00:00.000Z'),
        },
      } as unknown as FleetVehicleDoc,
      true,
    );
    expect(dto.licenseClassId).toBe(String(classId));
    expect(dto.operationId).toBe(String(operationId));
    expect(dto.insuranceCompanyId).toBe(String(insurerId));
    expect(dto.branchId).toBe(String(branchId));
    expect(dto.radio).toEqual({ issi: 'ISSI-1', motorolaSn: 'SN-1' });
    expect(dto.licenseImage).toEqual({
      fileId: String(fileId),
      fileName: 'license.png',
      mime: 'image/png',
      size: 2048,
      uploadedAt: '2026-02-01T00:00:00.000Z',
    });
    expect(dto.inWorkshop).toBe(true);
  });
});
