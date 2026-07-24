// Legacy-tolerance regression: applicants created by earlier releases are missing every
// later-added field, and `.lean()` reads skip schema defaults — the mapper must stay total
// (one `undefined.toISOString()` used to 500 the whole applicants list).
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { toApplicantDto, applicantExportRow } from './applicant.mapper';
import { type ApplicantDoc } from './applicant.model';

/** The shape of a first-release applicant document — late fields absent, not null. */
const legacyDoc = (): ApplicantDoc =>
  ({
    _id: new Types.ObjectId(),
    code: 'APP-2026-000001',
    status: 'new',
    sourceId: new Types.ObjectId(),
    fullNameAr: 'محمد قديم',
    searchName: 'محمد قديم',
    nationality: 'Egyptian',
    contact: { primaryPhone: '01012345678' },
    isDeleted: false,
    __v: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  }) as unknown as ApplicantDoc;

describe('toApplicantDto — legacy documents', () => {
  it('maps a document missing every late-added field without throwing', () => {
    const dto = toApplicantDto(legacyDoc());
    expect(dto.movedToOfferAt).toBeNull();
    expect(dto.religion).toBeNull();
    expect(dto.nationalIdExpiry).toBeNull();
    expect(dto.intakeChannel).toBe('internal');
    expect(dto.identityVerification).toBe('unverified');
    expect(dto.fullNameEn).toBeNull();
    expect(dto.experience).toEqual([]);
    expect(dto.drivingLicenses).toEqual([]);
    expect(dto.certifications).toEqual([]);
    expect(dto.references).toEqual([]);
    expect(dto.duplicateOf).toEqual([]);
    expect(dto.duplicateFlag).toBe(false);
    expect(dto.attachmentCount).toBe(0);
    expect(dto.expectedSalary).toBeNull();
    expect(dto.military).toBeNull();
    expect(dto.education).toBeNull();
    expect(dto.sourceDetail).toBeNull();
    expect(dto.willingToRelocate).toBe(false);
    expect(dto.contact.secondaryPhone).toBeNull();
  });

  it('export row tolerates the same legacy shape', () => {
    const row = applicantExportRow(legacyDoc(), false);
    expect(row.intakeChannel).toBe('internal');
    expect(row.identityVerification).toBe('unverified');
    expect(row.nationalId).toBe('');
  });
});
