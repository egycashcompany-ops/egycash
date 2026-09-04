// The Employee aggregate — the system of record for the whole post-hire lifecycle (frozen
// design docs/12-planning/employee-module-design.md). Created from an Accepted Job Offer
// (recruitment hire) or by Direct Registration (go-live onboarding; recruitment refs null).
// Personal data is copied ONCE from the applicant at hire (snapshot-then-own) and owned here
// after; `nationalId` is stored raw but ALWAYS masked in DTOs (Security Architecture §3).
// The employment snapshot is mutated ONLY by applied Personnel Actions (employee-actions
// feature); `statusHistory` is the LEGACY pre-actions trail, frozen at migration.
// `employmentPeriods` is a DERIVED index over hire/rehire/exit actions. A unique index on
// `jobOfferId` guarantees at most one employee per accepted offer.
import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  EMPLOYEE_EXIT_TYPES,
  EMPLOYEE_ORIGINS,
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
  INSURANCE_STATUSES,
  WEAPON_LICENSE_TYPES,
  type InsuranceStatus,
  type WeaponLicenseType,
  JOB_VALUE_SOURCES,
  type JobValueSource,
  type EmployeeExitType,
  type EmployeeOrigin,
  type EmployeeStatus,
  type EmploymentType,
  type Gender,
  type MaritalStatus,
  type MilitaryStatus,
  type EducationLevel,
  type ContactChannel,
  type Address,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface EmployeeMoney {
  amount: number;
  currency: string;
}

export interface EmployeeAllowance {
  name: string;
  amount: number;
  currency: string;
}

/** One entry in the LEGACY status trail (frozen at migration; `actionId` links where known). */
export interface EmployeeStatusEvent {
  from: EmployeeStatus | null;
  to: EmployeeStatus;
  reason: string | null;
  effectiveDate: Date;
  at: Date;
  by: Types.ObjectId | null;
  actionId: Types.ObjectId | null;
}

export interface EmploymentDetails {
  jobTitleId: Types.ObjectId;
  departmentId: Types.ObjectId;
  /** Section within the department (ADR-015 hierarchy); null when none was specified. */
  sectionId: Types.ObjectId | null;
  branchId: Types.ObjectId;
  /** Reporting manager — null when none is set. */
  managerId: Types.ObjectId | null;
  employmentType: EmploymentType;
  /** Compensation — null when none was set. */
  salary: EmployeeMoney | null;
  /**
   * P-HR-22 / D-JOB-4 — whether `salary` was copied from the job or set by a human.
   *
   * `manual` is the schema default, so every employee who predates this field is read as an
   * override and a future re-apply can never reach them.
   */
  salarySource: JobValueSource;
  allowances: EmployeeAllowance[];
  benefits: string[];
  probationMonths: number;
  startDate: Date;
}

export interface EmployeeContact {
  primaryPhone: string;
  secondaryPhone: string | null;
  email: string | null;
  preferredContactChannel: ContactChannel | null;
}

/** Personal data owned by the employee post-hire — same shapes the applicant stores. */
export interface EmployeePersonalData {
  fullNameAr: string;
  fullNameEn: string | null;
  /** Arabic-normalized name(s) for search. */
  searchName: string;
  /** Stored raw; ALWAYS masked in DTOs (Security Architecture §3). */
  nationalId: string | null;
  birthDate: Date | null;
  gender: Gender | null;
  nationality: string;
  placeOfBirth: string | null;
  photoFileId: Types.ObjectId | null;
  maritalStatus: MaritalStatus | null;
  religion: string | null;
  nationalIdExpiry: Date | null;
  dependentsCount: number | null;
  contact: EmployeeContact;
  officialAddress: Address | null;
  currentAddress: Address | null;
  military: { status: MilitaryStatus; certificateRef: string | null; completedAt: Date | null } | null;
  education: {
    level: EducationLevel;
    institution: string | null;
    specialization: string | null;
    graduationYear: number | null;
    grade: string | null;
  } | null;
  experience: {
    employer: string;
    position: string | null;
    from: Date | null;
    to: Date | null;
    leavingReason: string | null;
  }[];
  drivingLicenses: { class: string; expiry: Date | null }[];
  certifications: string[];
  references: { name: string; relationship: string | null; phone: string | null }[];
}

/** Probation state — null when the employee never entered probation (migrated actives). */
export interface EmployeeProbation {
  /** null when probationMonths was 0 (entered straight as active). */
  endDate: Date | null;
  confirmedAt: Date | null;
  confirmedBy: Types.ObjectId | null;
  /** HR extension — replaces endDate as the operative deadline. */
  extendedTo: Date | null;
  failed: boolean;
}

/** How the current (last) employment ended — null while employed. */
export interface EmployeeExit {
  type: EmployeeExitType;
  reason: string | null;
  effectiveDate: Date;
  eligibleForRehire: boolean;
  by: Types.ObjectId | null;
}

/**
 * The employee's social-insurance file. Null until somebody files one.
 *
 * The wages here are STATUTORY BRACKETS, not pay — see the contract's comment. Nothing in payroll
 * reads this block, and `employment.salary` is never populated from it.
 */
export interface EmployeeInsuranceRecord {
  insuranceNumber: string | null;
  occupation: string | null;
  occupationCode: string | null;
  grossWage: number | null;
  contributionWage: number | null;
  basicWage: number | null;
  employerShare: number | null;
  employeeShare: number | null;
  status: InsuranceStatus | null;
}

/** Retired-officer / armed-security facts. Null for the ~90% of the workforce with none. */
export interface EmployeeOfficerRecord {
  reserveOfficer: boolean;
  rank: string | null;
  weaponLicense: { type: WeaponLicenseType; expiry: Date | null } | null;
  professionPractice: boolean;
  retirementDate: Date | null;
}

/** One hire→exit span. DERIVED from hire/rehire/exit actions — rebuildable, never hand-edited. */
export interface EmploymentPeriod {
  hiredAt: Date;
  exitedAt: Date | null;
  exitType: EmployeeExitType | null;
}

export interface EmployeeDoc extends BaseDocFields {
  /**
   * PERMANENT identity: the Global Employee Number `0125` — allocated once at hire from a single
   * company-wide counter, and never changed (ADR-017). Not unique-indexed; see the index comment
   * at the foot of this file.
   */
  employeeNumber: string;
  /**
   * The Employee Code — `<BranchCodeAtHire><employeeNumber>`, e.g. `0100004`. COMPOSED ONCE AT HIRE
   * AND FROZEN: no transfer, rehire or branch-code correction rewrites it (ADR-017).
   *
   * Do NOT treat it as derivable from this document. Re-composing it from the employee's CURRENT
   * branch is wrong and will disagree with the stored value for anyone who has moved — read `code`,
   * and use `branchId` when you want to know where the employee actually is.
   */
  code: string;
  status: EmployeeStatus;
  origin: EmployeeOrigin;
  personal: EmployeePersonalData;
  /** Social-insurance file (التأمينات الاجتماعية) — null until one is filed. */
  insurance: EmployeeInsuranceRecord | null;
  /** Officer / armed-security profile (بيانات الضباط) — null for everyone without one. */
  officer: EmployeeOfficerRecord | null;
  probation: EmployeeProbation | null;
  exit: EmployeeExit | null;
  employmentPeriods: EmploymentPeriod[];
  /** Per-employee Personnel Action sequence — atomic `$inc`, the history's total order. */
  actionSeq: number;
  /** LEGACY pre-actions status trail, frozen at migration (oldest first, starts with the hire). */
  statusHistory: EmployeeStatusEvent[];
  /** The linked login account (Employee ← one User), null until a login is created (ADR-017). */
  userId: Types.ObjectId | null;
  // Preserved recruitment references — null for direct registrations.
  applicantId: Types.ObjectId | null;
  applicantCode: string | null;
  jobRequisitionId: Types.ObjectId | null;
  jobOfferId: Types.ObjectId | null;
  offerCode: string | null;
  acceptedOfferRevision: number | null;
  // Employment snapshot (mutated ONLY by applied Personnel Actions).
  employment: EmploymentDetails;
  // Denormalized organizational placement (backs the branch/department/section data scopes).
  branchId: Types.ObjectId;
  departmentId: Types.ObjectId;
  sectionId: Types.ObjectId | null;
  hiredAt: Date;
}

const employmentSchema = new Schema<EmploymentDetails>(
  {
    jobTitleId: { type: Schema.Types.ObjectId, required: true },
    departmentId: { type: Schema.Types.ObjectId, required: true },
    sectionId: { type: Schema.Types.ObjectId, default: null },
    branchId: { type: Schema.Types.ObjectId, required: true },
    managerId: { type: Schema.Types.ObjectId, default: null },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, required: true },
    salary: {
      type: new Schema<EmployeeMoney>(
        { amount: { type: Number, required: true }, currency: { type: String, required: true } },
        { _id: false },
      ),
      default: null,
    },
    // D-JOB-4 fails safe: absent means `manual`, so the existing population is protected without
    // a backfill and no re-apply written later can reach an employee it never wrote.
    salarySource: { type: String, enum: JOB_VALUE_SOURCES, default: 'manual' },
    allowances: {
      type: [
        new Schema<EmployeeAllowance>(
          {
            name: { type: String, required: true },
            amount: { type: Number, required: true },
            currency: { type: String, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    benefits: { type: [String], default: [] },
    probationMonths: { type: Number, required: true },
    startDate: { type: Date, required: true },
  },
  { _id: false },
);

const addressSchema = new Schema<Address>(
  {
    line1: { type: String, required: true },
    line2: { type: String, default: undefined },
    city: { type: String, required: true },
    governorate: { type: String, required: true },
    postalCode: { type: String, default: undefined },
  },
  { _id: false },
);

const personalSchema = new Schema<EmployeePersonalData>(
  {
    fullNameAr: { type: String, required: true },
    fullNameEn: { type: String, default: null },
    searchName: { type: String, required: true },
    nationalId: { type: String, default: null },
    birthDate: { type: Date, default: null },
    gender: { type: String, default: null },
    nationality: { type: String, required: true, default: 'Egyptian' },
    placeOfBirth: { type: String, default: null },
    photoFileId: { type: Schema.Types.ObjectId, default: null },
    maritalStatus: { type: String, default: null },
    religion: { type: String, default: null },
    nationalIdExpiry: { type: Date, default: null },
    dependentsCount: { type: Number, default: null },
    contact: {
      type: new Schema<EmployeeContact>(
        {
          primaryPhone: { type: String, required: true },
          secondaryPhone: { type: String, default: null },
          email: { type: String, default: null },
          preferredContactChannel: { type: String, default: null },
        },
        { _id: false },
      ),
      required: true,
    },
    officialAddress: { type: addressSchema, default: null },
    currentAddress: { type: addressSchema, default: null },
    military: {
      type: new Schema(
        {
          status: { type: String, required: true },
          certificateRef: { type: String, default: null },
          completedAt: { type: Date, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    education: {
      type: new Schema(
        {
          level: { type: String, required: true },
          institution: { type: String, default: null },
          specialization: { type: String, default: null },
          graduationYear: { type: Number, default: null },
          grade: { type: String, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    experience: {
      type: [
        new Schema(
          {
            employer: { type: String, required: true },
            position: { type: String, default: null },
            from: { type: Date, default: null },
            to: { type: Date, default: null },
            leavingReason: { type: String, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    drivingLicenses: {
      type: [
        new Schema(
          { class: { type: String, required: true }, expiry: { type: Date, default: null } },
          { _id: false },
        ),
      ],
      default: [],
    },
    certifications: { type: [String], default: [] },
    references: {
      type: [
        new Schema(
          {
            name: { type: String, required: true },
            relationship: { type: String, default: null },
            phone: { type: String, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { _id: false },
);

const statusEventSchema = new Schema<EmployeeStatusEvent>(
  {
    from: { type: String, enum: [...EMPLOYEE_STATUSES, null], default: null },
    to: { type: String, enum: EMPLOYEE_STATUSES, required: true },
    reason: { type: String, default: null },
    effectiveDate: { type: Date, required: true },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, default: null },
    actionId: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const probationSchema = new Schema<EmployeeProbation>(
  {
    endDate: { type: Date, default: null },
    confirmedAt: { type: Date, default: null },
    confirmedBy: { type: Schema.Types.ObjectId, default: null },
    extendedTo: { type: Date, default: null },
    failed: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

const exitSchema = new Schema<EmployeeExit>(
  {
    type: { type: String, enum: EMPLOYEE_EXIT_TYPES, required: true },
    reason: { type: String, default: null },
    effectiveDate: { type: Date, required: true },
    eligibleForRehire: { type: Boolean, required: true },
    by: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const insuranceSchema = new Schema<EmployeeInsuranceRecord>(
  {
    insuranceNumber: { type: String, default: null },
    occupation: { type: String, default: null },
    occupationCode: { type: String, default: null },
    // Wages are statutory brackets, never pay. Nothing in payroll reads them.
    grossWage: { type: Number, default: null },
    contributionWage: { type: Number, default: null },
    basicWage: { type: Number, default: null },
    employerShare: { type: Number, default: null },
    employeeShare: { type: Number, default: null },
    status: { type: String, enum: [...INSURANCE_STATUSES, null], default: null },
  },
  { _id: false },
);

const weaponLicenseSchema = new Schema<NonNullable<EmployeeOfficerRecord['weaponLicense']>>(
  {
    type: { type: String, enum: WEAPON_LICENSE_TYPES, required: true },
    expiry: { type: Date, default: null },
  },
  { _id: false },
);

const officerSchema = new Schema<EmployeeOfficerRecord>(
  {
    reserveOfficer: { type: Boolean, required: true, default: false },
    rank: { type: String, default: null },
    weaponLicense: { type: weaponLicenseSchema, default: null },
    professionPractice: { type: Boolean, required: true, default: false },
    retirementDate: { type: Date, default: null },
  },
  { _id: false },
);

const employmentPeriodSchema = new Schema<EmploymentPeriod>(
  {
    hiredAt: { type: Date, required: true },
    exitedAt: { type: Date, default: null },
    exitType: { type: String, enum: [...EMPLOYEE_EXIT_TYPES, null], default: null },
  },
  { _id: false },
);

const employeeSchema = new Schema<EmployeeDoc>(
  {
    employeeNumber: { type: String, required: true },
    code: { type: String, required: true },
    status: { type: String, enum: EMPLOYEE_STATUSES, required: true, default: 'probation' },
    origin: { type: String, enum: EMPLOYEE_ORIGINS, required: true, default: 'recruitment' },
    personal: { type: personalSchema, required: true },
    insurance: { type: insuranceSchema, default: null },
    officer: { type: officerSchema, default: null },
    probation: { type: probationSchema, default: null },
    exit: { type: exitSchema, default: null },
    employmentPeriods: { type: [employmentPeriodSchema], default: [] },
    actionSeq: { type: Number, required: true, default: 0 },
    statusHistory: { type: [statusEventSchema], default: [] },
    userId: { type: Schema.Types.ObjectId, default: null },
    applicantId: { type: Schema.Types.ObjectId, default: null },
    applicantCode: { type: String, default: null },
    jobRequisitionId: { type: Schema.Types.ObjectId, default: null },
    jobOfferId: { type: Schema.Types.ObjectId, default: null },
    offerCode: { type: String, default: null },
    acceptedOfferRevision: { type: Number, default: null },
    employment: { type: employmentSchema, required: true },
    branchId: { type: Schema.Types.ObjectId, required: true },
    departmentId: { type: Schema.Types.ObjectId, required: true },
    sectionId: { type: Schema.Types.ObjectId, default: null },
    hiredAt: { type: Date, required: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The Global Employee Number: permanent, never reissued by the allocator, and NOT unique-indexed.
//
// The allocator is a single atomic `$inc` on one global key, so it cannot hand the same number out
// twice — uniqueness for everything this system issues is a property of how numbers are made, and
// the index was only ever a second line of defence. It is relaxed because the go-live workforce
// carries two numbers the company itself issued twice on paper, decades of records deep (1311 and
// 1651, four people, all long since exited). A unique index would have forced us to renumber two of
// them, and renumbering rewrites the code printed on their file — the exact loss this whole design
// exists to prevent. Recording history faithfully beats re-asserting a guarantee the allocator
// already provides.
employeeSchema.index({ employeeNumber: 1 }, { name: 'ix_employeeNumber' });
// The Employee Code IS uniquely indexed, and it is the identity people actually use. Two employees
// sharing a global number still differ here whenever they were hired into different branches, which
// is true of both legacy pairs.
employeeSchema.index({ code: 1 }, { unique: true, name: 'ux_code' });
// At most one employee per accepted offer — prevents duplicate hiring, DB-enforced.
// (jobOfferId is null for direct registrations — nulls are exempt via the type filter.)
employeeSchema.index(
  { jobOfferId: 1 },
  { unique: true, name: 'ux_offer', partialFilterExpression: { jobOfferId: { $type: 'objectId' }, isDeleted: false } },
);
// One login account per employee (Employee ← one User); nulls are exempt.
employeeSchema.index(
  { userId: 1 },
  { unique: true, name: 'ux_userId', partialFilterExpression: { userId: { $type: 'objectId' } } },
);
employeeSchema.index({ applicantId: 1 }, { name: 'ix_applicantId' });
employeeSchema.index({ status: 1, createdAt: -1 }, { name: 'ix_status_createdAt' });
employeeSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branchId_status' });
employeeSchema.index({ departmentId: 1, status: 1 }, { name: 'ix_departmentId_status' });
employeeSchema.index({ sectionId: 1, status: 1 }, { name: 'ix_sectionId_status' });
// Duplicate-person guard + rehire-check lookups (uniqueness enforced in the service so the
// migration can never be blocked by legacy data).
employeeSchema.index({ 'personal.nationalId': 1 }, { name: 'ix_nationalId' });
// Direct reports (subordinates endpoint / exit direct-reports decision).
employeeSchema.index({ 'employment.managerId': 1, status: 1 }, { name: 'ix_managerId_status' });

/** Hydrated (save-able) document — what the Personnel Actions engine mutates. */
export type EmployeeEntity = HydratedDocument<EmployeeDoc>;

export const EmployeeModel = model<EmployeeDoc>('Employee', employeeSchema, 'hr_employees');
