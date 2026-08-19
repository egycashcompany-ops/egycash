// A driver-profile row written BEFORE the licence image existed, mapped for the wire.
//
// The same trap the vehicle registry fell into, guarded before it can fire here: `.lean()` returns
// the stored BSON, and a mongoose `default: null` is applied on WRITE — so a profile saved before
// the field existed has no `licenseImage` key at all, and it arrives as `undefined` rather than
// `null`. A `=== null` test would let it straight through into a property read on nothing, which
// is a 500 on the drivers list for every pre-existing driver in the database.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { toDriverProfileDto } from '../fleet.mappers';
import { type FleetDriverProfileDoc } from './driver-profile.model';

/** Exactly the keys a pre-licence-image row has — the new one is ABSENT, not null. */
const legacyRow = (): FleetDriverProfileDoc =>
  ({
    _id: new Types.ObjectId(),
    employeeId: new Types.ObjectId(),
    kind: 'driver',
    licenseNumber: 'DL-4471',
    licenseExpiresAt: new Date('2027-05-01T00:00:00.000Z'),
    specialization: 'cashTransport',
    area: 'المهندسين',
    isActive: true,
    __v: 0,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    isDeleted: false,
  }) as unknown as FleetDriverProfileDoc;

describe('a driver profile that predates the licence image', () => {
  it('maps instead of throwing — the registry must still list it', () => {
    expect(() => toDriverProfileDto(legacyRow())).not.toThrow();
  });

  it('reports the absent image as null, so the UI offers upload rather than a broken view', () => {
    expect(toDriverProfileDto(legacyRow()).licenseImage).toBeNull();
  });

  it('keeps every fleet-owned fact intact while doing so', () => {
    const dto = toDriverProfileDto(legacyRow());
    expect(dto.licenseNumber).toBe('DL-4471');
    expect(dto.specialization).toBe('cashTransport');
    expect(dto.area).toBe('المهندسين');
    expect(dto.isActive).toBe(true);
  });

  it('maps a row that DOES carry an image, down to the file id and the upload stamp', () => {
    const fileId = new Types.ObjectId();
    const withImage = {
      ...legacyRow(),
      licenseImage: {
        fileId,
        fileName: 'license.jpg',
        mime: 'image/jpeg',
        size: 2048,
        uploadedAt: new Date('2026-03-01T00:00:00.000Z'),
      },
    } as unknown as FleetDriverProfileDoc;
    expect(toDriverProfileDto(withImage).licenseImage).toEqual({
      fileId: String(fileId),
      fileName: 'license.jpg',
      mime: 'image/jpeg',
      size: 2048,
      uploadedAt: '2026-03-01T00:00:00.000Z',
    });
  });
});
