// «الافتراضى بتاع الربي فى التامين لا يوجد حتى لو العربيه فيها تامين بس لو فيها تامين اقدر ادوس على
// السهم واختار»: a bill names no insurer until the clerk picks one; the car's own, from شاشة
// السيارات, rides along as the one the arrow offers — and is never written onto the bill by itself.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { type FleetDealershipInvoiceDoc } from './dealership.model';
import { toDealershipInvoiceDto, vehicleInsurerOf } from './dealership.service';

const CAR_INSURER = '64b1f0cccccccccccccccc01';
const OTHER_INSURER = '64b1f0cccccccccccccccc02';
const ARCHIVED_INSURER = '64b1f0cccccccccccccccc03';
const MISR = { ar: 'مصر للتأمين', en: 'Misr Insurance' };
const OLD = { ar: 'تأمين قديم', en: 'Old Insurance' };
const catalog = new Map([
  [CAR_INSURER, { name: MISR, active: true }],
  [ARCHIVED_INSURER, { name: OLD, active: false }],
]);

const doc = (over: Partial<FleetDealershipInvoiceDoc> = {}): FleetDealershipInvoiceDoc =>
  ({
    _id: new Types.ObjectId(),
    visitId: new Types.ObjectId(),
    vehicleId: new Types.ObjectId(),
    vehicleCode: null,
    outDate: new Date('2026-10-03T00:00:00.000Z'),
    workKind: 'maintenance',
    workTypeLabel: 'صيانة',
    privateCar: false,
    insuranceCompanyId: null,
    invoiceNumber: null,
    invoiceAmount: null,
    image: null,
    side: null,
    __v: 0,
    createdAt: new Date('2026-10-03T00:00:00.000Z'),
    updatedAt: new Date('2026-10-03T00:00:00.000Z'),
    ...over,
  }) as unknown as FleetDealershipInvoiceDoc;

describe('the insurer the bill’s arrow offers — the car’s own', () => {
  it('names the car’s insurer in both languages while the catalog holds it active', () => {
    // Both names travel: the English screen shows «Misr Insurance», not the Arabic one.
    expect(vehicleInsurerOf(CAR_INSURER, catalog)).toEqual({
      id: CAR_INSURER,
      name: MISR,
      active: true,
    });
  });

  it('offers nothing for a car with no insurer — the arrow holds «لا يوجد» alone', () => {
    expect(vehicleInsurerOf(null, catalog)).toBeNull();
    expect(vehicleInsurerOf(undefined, catalog)).toBeNull();
  });

  it('still names an insurer archived in قوائم الحركة, marked as one a bill cannot be saved with', () => {
    // Not «the car has no insurer»: it has one, which may not be picked.
    expect(vehicleInsurerOf(ARCHIVED_INSURER, catalog)).toEqual({
      id: ARCHIVED_INSURER,
      name: OLD,
      active: false,
    });
  });

  it('offers nothing for an id the catalog does not know at all', () => {
    expect(vehicleInsurerOf(OTHER_INSURER, catalog)).toBeNull();
  });
});

describe('a bill on the wire', () => {
  it('opens on «لا يوجد» even when the car carries an insurer — the car’s rides beside it', () => {
    const dto = toDealershipInvoiceDto({
      doc: doc(),
      vehicleCode: '204',
      insuranceCompanyName: null,
      vehicleInsurer: { id: CAR_INSURER, name: MISR, active: true },
    });
    expect(dto).toMatchObject({
      insuranceCompanyId: null,
      insuranceCompanyName: null,
      vehicleInsuranceCompanyId: CAR_INSURER,
      vehicleInsuranceCompanyName: MISR,
      vehicleInsuranceCompanyActive: true,
      pending: true,
    });
  });

  it('keeps the insurer a bill was saved with, whatever the car carries now', () => {
    const dto = toDealershipInvoiceDto({
      doc: doc({
        insuranceCompanyId: new Types.ObjectId(OTHER_INSURER),
        invoiceNumber: '48213',
        invoiceAmount: 3250,
        side: 'dealership',
      }),
      vehicleCode: '204',
      insuranceCompanyName: 'شركة سابقة',
      vehicleInsurer: null,
    });
    expect(dto).toMatchObject({
      insuranceCompanyId: OTHER_INSURER,
      insuranceCompanyName: 'شركة سابقة',
      vehicleInsuranceCompanyId: null,
      vehicleInsuranceCompanyName: null,
      vehicleInsuranceCompanyActive: false,
      pending: false,
    });
  });
});
