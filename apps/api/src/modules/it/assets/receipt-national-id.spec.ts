// The holder's national ID leaves the API only for a reader granted `itAsset.viewNationalId`
// (Security Architecture §3: a national ID is shown in full only behind a sensitive-data grant).
// A receipt is read and reprinted on `itAsset.view`; reading the register must not be reading
// everyone's national ID.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { receiptNationalId, toItCustodyReceiptDto } from '../it.mappers';
import { type ItCustodyReceiptDoc } from './receipt.model';

const receipt = (overrides: Partial<ItCustodyReceiptDoc> = {}): ItCustodyReceiptDoc =>
  ({
    _id: new Types.ObjectId(),
    formNumber: 11,
    employeeId: new Types.ObjectId(),
    employeeCode: '0100026',
    employeeName: 'كريم سامح فؤاد منير حمدي',
    jobTitle: { ar: 'أخصائي تسويات', en: 'Settlements specialist' },
    nationalId: '29801011234567',
    section: { ar: 'التسويات', en: 'Settlements' },
    department: { ar: 'الإدارة المالية', en: 'Finance' },
    issuedAt: new Date('2026-10-05T09:00:00.000Z'),
    issuedByUserId: null,
    branchId: new Types.ObjectId(),
    lines: [],
    signedCopy: null,
    __v: 0,
    createdAt: new Date('2026-10-05T09:00:00.000Z'),
    updatedAt: new Date('2026-10-05T09:00:00.000Z'),
    ...overrides,
  }) as ItCustodyReceiptDoc;

describe('the national ID on a receipt', () => {
  it('is withheld by default — a mapping that forgets the grant reveals nothing', () => {
    const dto = toItCustodyReceiptDto(receipt());
    expect(dto.nationalId).toBeNull();
    expect(dto.nationalIdVisible).toBe(false);
    expect(JSON.stringify(dto)).not.toContain('29801011234567');
  });

  it('is shown in full to a reader holding the grant', () => {
    const dto = toItCustodyReceiptDto(receipt(), true);
    expect(dto.nationalId).toBe('29801011234567');
    expect(dto.nationalIdVisible).toBe(true);
  });

  it('tells «not shown to you» from «HR has none»', () => {
    expect(receiptNationalId(null, true)).toEqual({ nationalId: null, nationalIdVisible: true });
    expect(receiptNationalId('29801011234567', false)).toEqual({
      nationalId: null,
      nationalIdVisible: false,
    });
  });

  it('the section and department are not sensitive — every reader gets them', () => {
    const dto = toItCustodyReceiptDto(receipt());
    expect(dto.section).toEqual({ ar: 'التسويات', en: 'Settlements' });
    expect(dto.department).toEqual({ ar: 'الإدارة المالية', en: 'Finance' });
  });

  it('a receipt from before the identity line maps with nothing to show', () => {
    const old = receipt();
    delete old.nationalId;
    delete old.section;
    delete old.department;
    const dto = toItCustodyReceiptDto(old, true);
    expect([dto.nationalId, dto.section, dto.department]).toEqual([null, null, null]);
  });
});

// 2026-11-19 — a DEPARTMENT CUSTODY paper: «ليكون في عهدة إدارة … بموقع …», signed by its
// responsible person, whose identity line is the paper's as an employee's is.
describe('the department a paper was written for', () => {
  const IT = new Types.ObjectId();
  const SERVER_ROOM = new Types.ObjectId();

  it('names the department and the place as the paper kept them', () => {
    const dto = toItCustodyReceiptDto(
      receipt({
        custodian: {
          departmentId: IT,
          departmentName: { ar: 'تكنولوجيا المعلومات', en: 'IT' },
          locationId: SERVER_ROOM,
          locationName: { ar: 'غرفة السيرفرات', en: 'Server room' },
        },
      }),
    );
    expect(dto.custodian).toEqual({
      departmentId: String(IT),
      departmentName: { ar: 'تكنولوجيا المعلومات', en: 'IT' },
      locationId: String(SERVER_ROOM),
      locationName: { ar: 'غرفة السيرفرات', en: 'Server room' },
    });
    // The signer's own department («– …») is still the signer's, not the custodian.
    expect(dto.department).toEqual({ ar: 'الإدارة المالية', en: 'Finance' });
  });

  it('is null on an employee’s paper, and on every paper from before department custody', () => {
    expect(toItCustodyReceiptDto(receipt({ custodian: null })).custodian).toBeNull();
    const old = receipt();
    delete old.custodian;
    expect(toItCustodyReceiptDto(old).custodian).toBeNull();
  });
});
