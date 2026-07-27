// Applicant DTO mapping. National ID is MASKED by default (Security Architecture §3);
// the raw value never leaves the service layer through the standard DTO.
//
// LEGACY TOLERANCE: fields added after the first applicant release (intake channel, religion,
// NID expiry, offer-move stamps, …) may be MISSING on documents read with `.lean()` — lean
// reads do not apply schema defaults, and one `undefined.toISOString()` used to 500 the whole
// list. Every access below therefore normalizes `undefined` to the field's default. The boot
// migration (recruitment.migration.ts) backfills the stored documents; this keeps the mapper
// total even if a future field is missed.
import {
  maskNationalId,
  type ApplicantDto,
  type ApplicantSourceDto,
  type PlacementChangeDto,
} from '@ecms/contracts';
import { placementDto, placementLabelDto } from '../workflow/stage-mapper';
import { type ApplicantDoc } from './applicant.model';
import { type ApplicantSourceDoc } from './applicant-source.model';

const iso = (d: Date | null | undefined): string | null =>
  d === null || d === undefined ? null : d.toISOString();

export const toApplicantSourceDto = (doc: ApplicantSourceDoc): ApplicantSourceDto => ({
  id: String(doc._id),
  key: doc.key,
  name: doc.name,
  kind: doc.kind,
  requiresDetail: doc.requiresDetail,
  active: doc.active,
  version: doc.__v,
});

export const toApplicantDto = (doc: ApplicantDoc): ApplicantDto => {
  const sourceDetail = doc.sourceDetail ?? null;
  const military = doc.military ?? null;
  const education = doc.education ?? null;
  return {
    id: String(doc._id),
    code: doc.code,
    status: doc.status,
    jobRequisitionId: doc.jobRequisitionId == null ? null : String(doc.jobRequisitionId),
    branchId: doc.branchId == null ? null : String(doc.branchId),
    placement: placementDto(doc.placement),
    placementLabel: placementLabelDto(doc.placementLabel),
    placementHistory: (doc.placementHistory ?? []).map((c) => ({
      from: placementDto(c.from),
      to: placementDto(c.to),
      fromLabel: placementLabelDto(c.fromLabel),
      toLabel: placementLabelDto(c.toLabel),
      changed: c.changed as PlacementChangeDto['changed'],
      reason: c.reason,
      note: c.note,
      source: c.source as PlacementChangeDto['source'],
      sourceRef:
        c.sourceEntityType === null || c.sourceEntityId === null
          ? null
          : { entityType: c.sourceEntityType, entityId: String(c.sourceEntityId) },
      by: c.by === null ? null : String(c.by),
      at: c.at.toISOString(),
      correlationId: c.correlationId,
    })),
    sourceId: String(doc.sourceId),
    sourceDetail:
      sourceDetail === null
        ? null
        : {
            ...(sourceDetail.referrerUserId == null
              ? {}
              : { referrerUserId: String(sourceDetail.referrerUserId) }),
            ...(sourceDetail.agencyName == null ? {} : { agencyName: sourceDetail.agencyName }),
            ...(sourceDetail.externalPlatform == null
              ? {}
              : { externalPlatform: sourceDetail.externalPlatform }),
            ...(sourceDetail.externalId == null ? {} : { externalId: sourceDetail.externalId }),
            ...(sourceDetail.note == null ? {} : { note: sourceDetail.note }),
          },
    intakeChannel: doc.intakeChannel ?? 'internal',
    identityVerification: doc.identityVerification ?? 'unverified',
    fullNameAr: doc.fullNameAr,
    fullNameEn: doc.fullNameEn ?? null,
    nationalIdMasked: doc.nationalId == null ? null : maskNationalId(doc.nationalId),
    birthDate: iso(doc.birthDate),
    gender: doc.gender ?? null,
    nationality: doc.nationality ?? 'Egyptian',
    placeOfBirth: doc.placeOfBirth ?? null,
    photoFileId: doc.photoFileId == null ? null : String(doc.photoFileId),
    maritalStatus: doc.maritalStatus ?? null,
    religion: doc.religion ?? null,
    nationalIdExpiry: iso(doc.nationalIdExpiry),
    dependentsCount: doc.dependentsCount ?? null,
    contact: {
      primaryPhone: doc.contact.primaryPhone,
      secondaryPhone: doc.contact.secondaryPhone ?? null,
      email: doc.contact.email ?? null,
      preferredContactChannel: doc.contact.preferredContactChannel ?? null,
    },
    officialAddress: doc.officialAddress ?? null,
    currentAddress: doc.currentAddress ?? null,
    military:
      military === null
        ? null
        : {
            status: military.status,
            ...(military.certificateRef == null ? {} : { certificateRef: military.certificateRef }),
            ...(military.completedAt == null ? {} : { completedAt: military.completedAt.toISOString() }),
          },
    education:
      education === null
        ? null
        : {
            level: education.level,
            ...(education.institution == null ? {} : { institution: education.institution }),
            ...(education.specialization == null ? {} : { specialization: education.specialization }),
            ...(education.graduationYear == null ? {} : { graduationYear: education.graduationYear }),
            ...(education.grade == null ? {} : { grade: education.grade }),
          },
    experience: (doc.experience ?? []).map((e) => ({
      employer: e.employer,
      ...(e.position == null ? {} : { position: e.position }),
      ...(e.from == null ? {} : { from: e.from.toISOString() }),
      ...(e.to == null ? {} : { to: e.to.toISOString() }),
      ...(e.leavingReason == null ? {} : { leavingReason: e.leavingReason }),
    })),
    drivingLicenses: (doc.drivingLicenses ?? []).map((l) => ({
      class: l.class,
      ...(l.expiry == null ? {} : { expiry: l.expiry.toISOString() }),
    })),
    certifications: doc.certifications ?? [],
    references: (doc.references ?? []).map((r) => ({
      name: r.name,
      ...(r.relationship == null ? {} : { relationship: r.relationship }),
      ...(r.phone == null ? {} : { phone: r.phone }),
    })),
    expectedSalary: doc.expectedSalary ?? null,
    earliestStartDate: iso(doc.earliestStartDate),
    willingToRelocate: doc.willingToRelocate ?? false,
    willingToTravel: doc.willingToTravel ?? false,
    willingToShiftWork: doc.willingToShiftWork ?? false,
    externalRef: doc.externalRef ?? null,
    duplicateFlag: doc.duplicateFlag ?? false,
    duplicateOf: (doc.duplicateOf ?? []).map(String),
    attachmentCount: doc.attachmentCount ?? 0,
    withdrawnReason: doc.withdrawnReason ?? null,
    movedToOfferAt: iso(doc.movedToOfferAt),
    version: doc.__v,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
};

/** The unmasked National ID is exposed ONLY through the audited export path (§9). */
export const applicantExportRow = (doc: ApplicantDoc, unmask: boolean): Record<string, string> => ({
  code: doc.code,
  status: doc.status,
  fullNameAr: doc.fullNameAr,
  fullNameEn: doc.fullNameEn ?? '',
  nationalId: doc.nationalId == null ? '' : unmask ? doc.nationalId : maskNationalId(doc.nationalId),
  gender: doc.gender ?? '',
  primaryPhone: doc.contact.primaryPhone,
  email: doc.contact.email ?? '',
  identityVerification: doc.identityVerification ?? 'unverified',
  intakeChannel: doc.intakeChannel ?? 'internal',
  createdAt: doc.createdAt.toISOString(),
});
