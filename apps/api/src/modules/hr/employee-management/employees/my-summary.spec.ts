// The welcome page's card: exactly the fields it names, and the birthday as a calendar day.
//
// The card is read by every signed-in employee about themselves, and is the one place their own
// record is shown outside the profile. What it must NOT carry matters as much as what it does — a
// spread of the record would hand the page a national id and a phone number nobody asked it for.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { type EmployeePlacementDto } from '@ecms/contracts';
import { toMyEmployeeSummaryDto } from './employee.mapper';
import { type EmployeeDoc } from './employee.model';

const ID = new Types.ObjectId();

const doc = (personal: Record<string, unknown> = {}): EmployeeDoc =>
  ({
    _id: ID,
    code: '0010125',
    personal: {
      fullNameAr: 'أحمد محمد',
      fullNameEn: 'Ahmed Mohamed',
      nationalId: '29001011234567',
      birthDate: new Date('1990-03-07T00:00:00.000Z'),
      photoFileId: null,
      contact: {
        primaryPhone: '01000000001',
        secondaryPhone: null,
        email: null,
        preferredContactChannel: null,
      },
      ...personal,
    },
    employment: { salary: { amount: 15000, currency: 'EGP' } },
  }) as unknown as EmployeeDoc;

const unit = (ar: string, en: string) => ({ id: 'x', code: 'c', name: { ar, en } });

const PLACED: EmployeePlacementDto = {
  branch: unit('الرئيسي', 'HQ'),
  department: unit('التشغيل', 'Operations'),
  section: unit('الوردية', 'Shift'),
  jobTitle: unit('سائق', 'Driver'),
};

const UNPLACED: EmployeePlacementDto = {
  branch: null,
  department: null,
  section: null,
  jobTitle: null,
};

describe('the welcome card', () => {
  it('carries exactly its ten fields — nothing else of the record rides along', () => {
    const card = toMyEmployeeSummaryDto(doc(), PLACED);
    expect(card).toEqual({
      employeeId: String(ID),
      code: '0010125',
      fullNameAr: 'أحمد محمد',
      fullNameEn: 'Ahmed Mohamed',
      birthDate: '1990-03-07',
      hasPhoto: false,
      photoFileId: null,
      jobTitle: { ar: 'سائق', en: 'Driver' },
      department: { ar: 'التشغيل', en: 'Operations' },
      branch: { ar: 'الرئيسي', en: 'HQ' },
    });
    const wire = JSON.stringify(card);
    expect(wire).not.toContain('29001011234567');
    expect(wire).not.toContain('01000000001');
    expect(wire).not.toContain('15000');
  });

  /**
   * A birth date is stored as UTC midnight of the day. Read as an instant in Cairo it would still be
   * the same day, but read at UTC−anything it would be the day before — so it is read as the
   * calendar day it is, never through a clock.
   */
  it('gives the birthday as the calendar day stored, YYYY-MM-DD', () => {
    expect(toMyEmployeeSummaryDto(doc(), PLACED).birthDate).toBe('1990-03-07');
    const leap = doc({ birthDate: new Date('2000-02-29T00:00:00.000Z') });
    expect(toMyEmployeeSummaryDto(leap, PLACED).birthDate).toBe('2000-02-29');
  });

  it('says null when there is no birth date, rather than inventing one', () => {
    expect(toMyEmployeeSummaryDto(doc({ birthDate: null }), PLACED).birthDate).toBeNull();
  });

  // The file id is the picture's version: a new photo is a new id, so the person's own top bar and
  // welcome page never keep showing the old face from their cache.
  it('says whether there is a photo, and which file is the current one', () => {
    const fileId = new Types.ObjectId();
    const card = toMyEmployeeSummaryDto(doc({ photoFileId: fileId }), PLACED);
    expect(card.hasPhoto).toBe(true);
    expect(card.photoFileId).toBe(String(fileId));
    expect(toMyEmployeeSummaryDto(doc(), PLACED).photoFileId).toBeNull();
    // A record written before the field existed has no `photoFileId` at all: no photo.
    expect(toMyEmployeeSummaryDto(doc({ photoFileId: undefined }), PLACED).hasPhoto).toBe(false);
  });

  it('leaves a unit that did not resolve as null', () => {
    const card = toMyEmployeeSummaryDto(doc({ fullNameEn: null }), UNPLACED);
    expect(card.jobTitle).toBeNull();
    expect(card.department).toBeNull();
    expect(card.branch).toBeNull();
    expect(card.fullNameEn).toBeNull();
  });
});
