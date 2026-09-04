// Employee DTO mapping. Dates are ISO strings; the national id is ALWAYS masked (Security
// Architecture §3 — unmasking is a separate, audited path). Three blocks are permission-gated and
// each pairs its payload with a `…Visible` flag, because a redacted block and an absent one are
// both `null` on the wire and mean opposite things:
//   salary/allowances  ← employee.viewCompensation  (compensationVisible)
//   insurance          ← employee.viewInsurance     (insuranceVisible)
//   officer            ← employee.viewOfficer       (officerVisible)
import {
  maskNationalId,
  type EmployeeDto,
  type EmployeeInsuranceDto,
  type EmployeeOfficerDto,
  type EmployeePersonalDto,
  type EmployeeStatusEventDto,
  type EmploymentDetailsDto,
  type EmploymentPeriodDto,
  type EmployeeProbationDto,
  type EmployeeExitDto,
  type RehireCheckResultDto,
} from '@ecms/contracts';
import {
  type EmployeeDoc,
  type EmployeePersonalData,
  type EmployeeStatusEvent,
  type EmploymentDetails,
} from './employee.model';

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

const statusEventDto = (e: EmployeeStatusEvent): EmployeeStatusEventDto => ({
  from: e.from,
  to: e.to,
  reason: e.reason,
  effectiveDate: e.effectiveDate.toISOString(),
  at: e.at.toISOString(),
  by: e.by === null ? null : String(e.by),
  actionId: e.actionId == null ? null : String(e.actionId),
});

const employmentDto = (e: EmploymentDetails, compensationVisible: boolean): EmploymentDetailsDto => ({
  jobTitleId: String(e.jobTitleId),
  departmentId: String(e.departmentId),
  sectionId: e.sectionId === null ? null : String(e.sectionId),
  branchId: String(e.branchId),
  managerId: e.managerId === null ? null : String(e.managerId),
  employmentType: e.employmentType,
  salary:
    !compensationVisible || e.salary === null
      ? null
      : { amount: e.salary.amount, currency: e.salary.currency },
  // Reported even when the figure is redacted: whether a salary follows the job is not the salary.
  salarySource: e.salarySource ?? 'manual',
  allowances: compensationVisible
    ? e.allowances.map((a) => ({ name: a.name, amount: a.amount, currency: a.currency }))
    : [],
  benefits: [...e.benefits],
  probationMonths: e.probationMonths,
  startDate: e.startDate.toISOString(),
});

const personalDto = (p: EmployeePersonalData): EmployeePersonalDto => ({
  fullNameAr: p.fullNameAr,
  fullNameEn: p.fullNameEn,
  nationalIdMasked: p.nationalId === null ? null : maskNationalId(p.nationalId),
  birthDate: iso(p.birthDate),
  gender: p.gender,
  nationality: p.nationality,
  placeOfBirth: p.placeOfBirth,
  photoFileId: p.photoFileId === null ? null : String(p.photoFileId),
  maritalStatus: p.maritalStatus,
  religion: p.religion,
  nationalIdExpiry: iso(p.nationalIdExpiry),
  dependentsCount: p.dependentsCount,
  contact: {
    primaryPhone: p.contact.primaryPhone,
    secondaryPhone: p.contact.secondaryPhone,
    email: p.contact.email,
    preferredContactChannel: p.contact.preferredContactChannel,
  },
  officialAddress: p.officialAddress === null ? null : { ...p.officialAddress },
  currentAddress: p.currentAddress === null ? null : { ...p.currentAddress },
  military:
    p.military === null
      ? null
      : {
          status: p.military.status,
          ...(p.military.certificateRef === null ? {} : { certificateRef: p.military.certificateRef }),
          ...(p.military.completedAt === null ? {} : { completedAt: p.military.completedAt.toISOString() }),
        },
  education:
    p.education === null
      ? null
      : {
          level: p.education.level,
          ...(p.education.institution === null ? {} : { institution: p.education.institution }),
          ...(p.education.specialization === null ? {} : { specialization: p.education.specialization }),
          ...(p.education.graduationYear === null ? {} : { graduationYear: p.education.graduationYear }),
          ...(p.education.grade === null ? {} : { grade: p.education.grade }),
        },
  experience: p.experience.map((e) => ({
    employer: e.employer,
    ...(e.position === null ? {} : { position: e.position }),
    ...(e.from === null ? {} : { from: e.from.toISOString() }),
    ...(e.to === null ? {} : { to: e.to.toISOString() }),
    ...(e.leavingReason === null ? {} : { leavingReason: e.leavingReason }),
  })),
  drivingLicenses: p.drivingLicenses.map((d) => ({
    class: d.class,
    ...(d.expiry === null ? {} : { expiry: d.expiry.toISOString() }),
  })),
  certifications: [...p.certifications],
  references: p.references.map((r) => ({
    name: r.name,
    ...(r.relationship === null ? {} : { relationship: r.relationship }),
    ...(r.phone === null ? {} : { phone: r.phone }),
  })),
});

/**
 * The insurance file, or null when it was never filed OR the caller may not see it. `EmployeeDto`
 * carries `insuranceVisible` alongside so the UI can tell those two apart — a redacted block and an
 * absent one look identical otherwise, and "no insurance file" is a very different statement from
 * "you are not allowed to read this one".
 */
const insuranceDto = (doc: EmployeeDoc, visible: boolean): EmployeeInsuranceDto | null =>
  !visible || doc.insurance == null
    ? null
    : {
        insuranceNumber: doc.insurance.insuranceNumber,
        occupation: doc.insurance.occupation,
        occupationCode: doc.insurance.occupationCode,
        grossWage: doc.insurance.grossWage,
        contributionWage: doc.insurance.contributionWage,
        basicWage: doc.insurance.basicWage,
        employerShare: doc.insurance.employerShare,
        employeeShare: doc.insurance.employeeShare,
        status: doc.insurance.status,
      };

const officerDto = (doc: EmployeeDoc, visible: boolean): EmployeeOfficerDto | null =>
  !visible || doc.officer == null
    ? null
    : {
        reserveOfficer: doc.officer.reserveOfficer,
        rank: doc.officer.rank,
        weaponLicense:
          doc.officer.weaponLicense == null
            ? null
            : {
                type: doc.officer.weaponLicense.type,
                expiry: iso(doc.officer.weaponLicense.expiry),
              },
        professionPractice: doc.officer.professionPractice,
        retirementDate: iso(doc.officer.retirementDate),
      };

const probationDto = (doc: EmployeeDoc): EmployeeProbationDto | null =>
  doc.probation == null
    ? null
    : {
        endDate: iso(doc.probation.endDate),
        confirmedAt: iso(doc.probation.confirmedAt),
        confirmedBy: doc.probation.confirmedBy === null ? null : String(doc.probation.confirmedBy),
        extendedTo: iso(doc.probation.extendedTo),
        failed: doc.probation.failed,
      };

export const exitDto = (doc: EmployeeDoc): EmployeeExitDto | null =>
  doc.exit == null
    ? null
    : {
        type: doc.exit.type,
        reason: doc.exit.reason,
        effectiveDate: doc.exit.effectiveDate.toISOString(),
        eligibleForRehire: doc.exit.eligibleForRehire,
        by: doc.exit.by === null ? null : String(doc.exit.by),
      };

const periodDto = (p: { hiredAt: Date; exitedAt: Date | null; exitType: EmploymentPeriodDto['exitType'] }): EmploymentPeriodDto => ({
  hiredAt: p.hiredAt.toISOString(),
  exitedAt: iso(p.exitedAt),
  exitType: p.exitType,
});

export const toEmployeeDto = (
  doc: EmployeeDoc,
  opts: { compensationVisible: boolean; insuranceVisible: boolean; officerVisible: boolean },
): EmployeeDto => ({
  id: String(doc._id),
  employeeNumber: doc.employeeNumber,
  code: doc.code,
  status: doc.status,
  origin: doc.origin,
  personal: personalDto(doc.personal),
  insurance: insuranceDto(doc, opts.insuranceVisible),
  insuranceVisible: opts.insuranceVisible,
  officer: officerDto(doc, opts.officerVisible),
  officerVisible: opts.officerVisible,
  probation: probationDto(doc),
  exit: exitDto(doc),
  employmentPeriods: (doc.employmentPeriods ?? []).map(periodDto),
  statusHistory: (doc.statusHistory ?? []).map(statusEventDto),
  userId: doc.userId === null ? null : String(doc.userId),
  applicantId: doc.applicantId === null ? null : String(doc.applicantId),
  applicantCode: doc.applicantCode,
  jobRequisitionId: doc.jobRequisitionId === null ? null : String(doc.jobRequisitionId),
  jobOfferId: doc.jobOfferId === null ? null : String(doc.jobOfferId),
  offerCode: doc.offerCode,
  acceptedOfferRevision: doc.acceptedOfferRevision,
  employment: employmentDto(doc.employment, opts.compensationVisible),
  compensationVisible: opts.compensationVisible,
  hiredAt: doc.hiredAt.toISOString(),
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

/** The exited-employee match surfaced by the rehire check / duplicate guard. */
export const toRehireCheckResultDto = (doc: EmployeeDoc): RehireCheckResultDto => ({
  employeeId: String(doc._id),
  employeeNumber: doc.employeeNumber,
  code: doc.code,
  fullNameAr: doc.personal.fullNameAr,
  status: doc.status,
  exit: exitDto(doc),
});
