// Applicant DTO mapping. National ID is MASKED by default (Security Architecture §3);
// the raw value never leaves the service layer through the standard DTO.
import { maskNationalId, type ApplicantDto, type ApplicantSourceDto } from '@ecms/contracts';
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

export const toApplicantDto = (doc: ApplicantDoc): ApplicantDto => ({
  id: String(doc._id),
  code: doc.code,
  status: doc.status,
  jobRequisitionId: doc.jobRequisitionId === null ? null : String(doc.jobRequisitionId),
  branchId: doc.branchId === null ? null : String(doc.branchId),
  sourceId: String(doc.sourceId),
  sourceDetail:
    doc.sourceDetail === null
      ? null
      : {
          ...(doc.sourceDetail.referrerUserId === null
            ? {}
            : { referrerUserId: String(doc.sourceDetail.referrerUserId) }),
          ...(doc.sourceDetail.agencyName === null ? {} : { agencyName: doc.sourceDetail.agencyName }),
          ...(doc.sourceDetail.externalPlatform === null
            ? {}
            : { externalPlatform: doc.sourceDetail.externalPlatform }),
          ...(doc.sourceDetail.externalId === null ? {} : { externalId: doc.sourceDetail.externalId }),
          ...(doc.sourceDetail.note === null ? {} : { note: doc.sourceDetail.note }),
        },
  intakeChannel: doc.intakeChannel,
  identityVerification: doc.identityVerification,
  fullNameAr: doc.fullNameAr,
  fullNameEn: doc.fullNameEn,
  nationalIdMasked: doc.nationalId === null ? null : maskNationalId(doc.nationalId),
  birthDate: iso(doc.birthDate),
  gender: doc.gender,
  nationality: doc.nationality,
  placeOfBirth: doc.placeOfBirth,
  photoFileId: doc.photoFileId === null ? null : String(doc.photoFileId),
  maritalStatus: doc.maritalStatus,
  religion: doc.religion,
  nationalIdExpiry: iso(doc.nationalIdExpiry),
  dependentsCount: doc.dependentsCount,
  contact: {
    primaryPhone: doc.contact.primaryPhone,
    secondaryPhone: doc.contact.secondaryPhone,
    email: doc.contact.email,
    preferredContactChannel: doc.contact.preferredContactChannel,
  },
  officialAddress: doc.officialAddress,
  currentAddress: doc.currentAddress,
  military:
    doc.military === null
      ? null
      : {
          status: doc.military.status,
          ...(doc.military.certificateRef === null ? {} : { certificateRef: doc.military.certificateRef }),
          ...(doc.military.completedAt === null ? {} : { completedAt: doc.military.completedAt.toISOString() }),
        },
  education:
    doc.education === null
      ? null
      : {
          level: doc.education.level,
          ...(doc.education.institution === null ? {} : { institution: doc.education.institution }),
          ...(doc.education.specialization === null
            ? {}
            : { specialization: doc.education.specialization }),
          ...(doc.education.graduationYear === null
            ? {}
            : { graduationYear: doc.education.graduationYear }),
          ...(doc.education.grade === null ? {} : { grade: doc.education.grade }),
        },
  experience: doc.experience.map((e) => ({
    employer: e.employer,
    ...(e.position === null ? {} : { position: e.position }),
    ...(e.from === null ? {} : { from: e.from.toISOString() }),
    ...(e.to === null ? {} : { to: e.to.toISOString() }),
    ...(e.leavingReason === null ? {} : { leavingReason: e.leavingReason }),
  })),
  drivingLicenses: doc.drivingLicenses.map((l) => ({
    class: l.class,
    ...(l.expiry === null ? {} : { expiry: l.expiry.toISOString() }),
  })),
  certifications: doc.certifications,
  references: doc.references.map((r) => ({
    name: r.name,
    ...(r.relationship === null ? {} : { relationship: r.relationship }),
    ...(r.phone === null ? {} : { phone: r.phone }),
  })),
  expectedSalary: doc.expectedSalary,
  earliestStartDate: iso(doc.earliestStartDate),
  willingToRelocate: doc.willingToRelocate,
  willingToTravel: doc.willingToTravel,
  willingToShiftWork: doc.willingToShiftWork,
  externalRef: doc.externalRef,
  duplicateFlag: doc.duplicateFlag,
  duplicateOf: doc.duplicateOf.map(String),
  attachmentCount: doc.attachmentCount,
  withdrawnReason: doc.withdrawnReason,
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

/** The unmasked National ID is exposed ONLY through the audited export path (§9). */
export const applicantExportRow = (doc: ApplicantDoc, unmask: boolean): Record<string, string> => ({
  code: doc.code,
  status: doc.status,
  fullNameAr: doc.fullNameAr,
  fullNameEn: doc.fullNameEn ?? '',
  nationalId: doc.nationalId === null ? '' : unmask ? doc.nationalId : maskNationalId(doc.nationalId),
  gender: doc.gender ?? '',
  primaryPhone: doc.contact.primaryPhone,
  email: doc.contact.email ?? '',
  identityVerification: doc.identityVerification,
  intakeChannel: doc.intakeChannel,
  createdAt: doc.createdAt.toISOString(),
});
