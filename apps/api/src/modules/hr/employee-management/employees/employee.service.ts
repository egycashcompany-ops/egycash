// The Employee registry service (frozen design). Two hire paths create employees — from an
// Accepted Job Offer (recruitment) or Direct Registration (go-live onboarding) — both entering
// PROBATION-first (D1), with the personal data copied/supplied once and owned here after
// (snapshot-then-own; the applicant record stays immutable pre-hire history). The national-id
// person guard (F2/I6) guarantees one employee per person forever: an exited match routes to
// Rehire, an employed match is a hard block. Post-hire employment facts are mutated ONLY by
// the Personnel Actions engine (employee-actions feature); this service owns reads, personal-
// data edits (plain audited updates — I4), the login link (ADR-017), and the composed timeline.
//
// Cross-feature access goes through barrels (ADR-003); the actions REPOSITORY is imported by
// file (not barrel) to keep the import graph acyclic (see employee.migration.ts).
import { Types } from 'mongoose';
import {
  HrEmployeeEvents,
  HrEmployeeTemplates,
  parseNationalId,
  type CreateEmployee,
  type CreateEmployeeLogin,
  type CreateUser,
  type DirectRegisterEmployee,
  type EmployeeTimelineItemDto,
  type ListEmployeesQuery,
  type Paginated,
  type UpdateEmployeePersonal,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, ValidationError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../../platform/kernel/unit-of-work';
import { notificationsService } from '../../../../platform/notifications';
import {
  branchService,
  departmentService,
  jobTitleService,
  sectionService,
} from '../../../../platform/organization';
import { userService, type UserDoc } from '../../../../platform/users';
import { normalizeArabic } from '../../shared/arabic';
import { applicantService } from '../../recruitment/applicants';
import { jobOfferService } from '../../recruitment/job-offers';
// File import (not the barrel) — the barrel would close an import cycle via the actions service.
import { employeeActionRepository } from '../employee-actions/employee-action.repository';
import { employeeRepository, type EmployeeListFilter } from './employee.repository';
import { nextEmployeeNumber } from './employee-sequence';
import { buildEmployeeCode } from './employee-number';
import { personalFromApplicant } from './employee.migration';
import {
  type EmployeeDoc,
  type EmployeePersonalData,
  type EmployeeProbation,
  type EmployeeStatusEvent,
  type EmploymentDetails,
} from './employee.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'employee', entityId: id });

/** Probation-first entry (D1): months > 0 ⇒ unconfirmed probation; 0 ⇒ straight to active. */
const entryProbation = (
  hiredAt: Date,
  months: number,
  wantsProbation: boolean,
  confirmedBy: Types.ObjectId | null,
): { status: 'probation' | 'active'; probation: EmployeeProbation } => {
  if (months > 0 && wantsProbation) {
    const endDate = new Date(hiredAt);
    endDate.setMonth(endDate.getMonth() + months);
    return {
      status: 'probation',
      probation: { endDate, confirmedAt: null, confirmedBy: null, extendedTo: null, failed: false },
    };
  }
  return {
    status: 'active',
    probation: { endDate: null, confirmedAt: hiredAt, confirmedBy: confirmedBy, extendedTo: null, failed: false },
  };
};

class EmployeeService {
  /** Fire-and-forget hiring notification to the reporting manager + the creator. */
  private async notifyHire(doc: EmployeeDoc): Promise<void> {
    const recipients = new Set<string>();
    if (doc.employment.managerId !== null) recipients.add(String(doc.employment.managerId));
    if (doc.createdBy !== null) recipients.add(String(doc.createdBy));
    await notificationsService
      .notify({
        template: HrEmployeeTemplates.Created,
        to: { userIds: [...recipients] },
        data: { employeeCode: doc.code, applicantCode: doc.applicantCode ?? doc.code },
        entityRef: entityRef(String(doc._id)),
      })
      .catch(() => undefined);
  }

  /**
   * One employee per person, forever (frozen design F2/I6): an exited national-id match must
   * be REHIRED (same number, same file); an employed match is a hard block.
   */
  private async assertPersonNotEmployed(nationalId: string | null): Promise<void> {
    if (nationalId === null) return;
    const existing = await employeeRepository.findByNationalIdSystem(nationalId);
    if (existing === null) return;
    if (existing.status === 'exited') {
      throw new BusinessRuleError(
        `this national id belongs to exited employee ${existing.code} — use Rehire on that employee (id ${String(existing._id)})`,
      );
    }
    throw new ConflictError(`this national id already belongs to employee ${existing.code}`);
  }

  private async recordHireAction(
    doc: EmployeeDoc,
    entryStatus: 'probation' | 'active',
    by: string,
  ): Promise<Types.ObjectId> {
    const action = await employeeActionRepository.recordHire({
      employeeId: doc._id,
      employeeCode: doc.code,
      hiredAt: doc.hiredAt,
      by: new Types.ObjectId(by),
      entryStatus,
      origin: doc.origin,
    });
    return action._id;
  }

  /**
   * Create an Employee from an Accepted Job Offer. Reads employment data only from the offer's
   * Accepted Snapshot and copies the personal data ONCE from the applicant's raw document (I5).
   */
  async create(ctx: AuthContext, input: CreateEmployee, scope: ScopeSelector): Promise<EmployeeDoc> {
    const offer = await jobOfferService.acceptedOfferById(input.jobOfferId);
    if (offer === null) {
      throw new BusinessRuleError('employee creation requires an accepted job offer');
    }
    const snapshot = offer.acceptedSnapshot;
    if (snapshot === null) {
      throw new BusinessRuleError('the accepted offer has no accepted-terms snapshot');
    }
    // Duplicate-hire guard (fast path; the unique offer index is the race-safe backstop).
    const existing = await employeeRepository.findByOfferId(input.jobOfferId);
    if (existing !== null) {
      throw new ConflictError('an employee has already been created from this offer');
    }

    // Preserve the Job Requisition reference (carried by the applicant), confirm the applicant
    // is still in the active pipeline, and read the RAW doc for the one-time personal copy.
    const applicant = await applicantService.getById(String(offer.applicantId), scope);
    if (applicant.status !== 'new') {
      throw new BusinessRuleError('applicant is no longer in the active pipeline');
    }
    await this.assertPersonNotEmployed(applicant.nationalId);

    const t = snapshot.terms;
    const employment: EmploymentDetails = {
      jobTitleId: t.jobTitleId,
      departmentId: t.departmentId,
      // The offer snapshot does not carry a section/position; kept null (future-proof, ADR-016/017).
      sectionId: null,
      branchId: t.branchId,
      jobPositionId: null,
      managerId: t.managerId,
      employmentType: t.employmentType,
      salary: t.salary === null ? null : { amount: t.salary.amount, currency: t.salary.currency },
      allowances: t.allowances.map((a) => ({ name: a.name, amount: a.amount, currency: a.currency })),
      benefits: [...t.benefits],
      probationMonths: t.probationMonths,
      startDate: t.startDate,
    };
    const hiredAt = input.hiringDate ?? new Date();
    const entry = entryProbation(hiredAt, employment.probationMonths, true, new Types.ObjectId(ctx.userId));

    const branch = await branchService.getById(String(employment.branchId));

    // Atomic: allocate the permanent Global Employee Number and insert the record in one
    // transaction; the unique offer index guarantees no duplicate under concurrency.
    const doc = await unitOfWork(async (session) => {
      const employeeNumber = await nextEmployeeNumber(session);
      const code = buildEmployeeCode(branch.code, employeeNumber);
      const hireEvent: EmployeeStatusEvent = {
        from: null,
        to: entry.status,
        reason: null,
        effectiveDate: hiredAt,
        at: new Date(),
        by: new Types.ObjectId(ctx.userId),
        actionId: null,
      };
      return employeeRepository.create(
        {
          employeeNumber,
          code,
          status: entry.status,
          origin: 'recruitment',
          personal: personalFromApplicant(applicant),
          probation: entry.probation,
          exit: null,
          employmentPeriods: [{ hiredAt, exitedAt: null, exitType: null }],
          actionSeq: 1,
          statusHistory: [hireEvent],
          userId: null,
          applicantId: offer.applicantId,
          applicantCode: offer.applicantCode,
          jobRequisitionId: applicant.jobRequisitionId,
          jobOfferId: offer._id,
          offerCode: offer.code,
          acceptedOfferRevision: snapshot.revisionNumber,
          employment,
          branchId: employment.branchId,
          departmentId: employment.departmentId,
          sectionId: employment.sectionId,
          hiredAt,
        },
        { by: ctx.userId, session },
      );
    });

    await this.recordHireAction(doc, entry.status, ctx.userId);
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: [
        { field: 'code', old: null, new: doc.code },
        { field: 'jobOfferId', old: null, new: String(doc.jobOfferId) },
        { field: 'status', old: null, new: entry.status },
      ],
    });
    await emit(HrEmployeeEvents.EmployeeCreated, {
      employeeId: String(doc._id),
      code: doc.code,
      applicantId: String(doc.applicantId),
      jobOfferId: String(doc.jobOfferId),
      origin: 'recruitment',
    });
    await this.notifyHire(doc);
    return doc;
  }

  /**
   * Direct Registration (D4 — go-live workforce onboarding / walk-in hire). Full personal +
   * employment payload; recruitment references stay null; national-id duplicate guard runs
   * against employees AND live applicants (I6). Tenured staff may enter straight as `active`.
   */
  async registerDirect(
    ctx: AuthContext,
    input: DirectRegisterEmployee,
    scope: ScopeSelector,
  ): Promise<EmployeeDoc> {
    void scope;
    const identity = input.personal.identity;

    // Identity derivation mirrors applicant registration: derived fields are never client-set.
    const derived = identity.nationalId !== undefined ? parseNationalId(identity.nationalId) : null;
    if (identity.nationalId !== undefined && derived === null) {
      throw new ValidationError([
        { field: 'personal.identity.nationalId', code: 'INVALID', message: 'invalid Egyptian national ID' },
      ]);
    }
    if (identity.nationalId !== undefined) {
      await this.assertPersonNotEmployed(identity.nationalId);
      const liveApplicant = await applicantService.findLiveByNationalIdSystem(identity.nationalId);
      if (liveApplicant !== null) {
        throw new ConflictError(
          `a live applicant (${liveApplicant.code}) with this national id is in the recruitment pipeline — hire them through it`,
        );
      }
    }

    // Org referents must exist, cohere, and be active (same rules the actions engine applies).
    const e = input.employment;
    const department = await departmentService.getById(e.departmentId);
    if (String(department.branchId) !== e.branchId) {
      throw new BusinessRuleError('the department does not belong to the selected branch');
    }
    if (e.sectionId != null) {
      const section = await sectionService.getById(e.sectionId);
      if (String(section.departmentId) !== e.departmentId) {
        throw new BusinessRuleError('the section does not belong to the selected department');
      }
    }
    const title = await jobTitleService.getById(e.jobTitleId);
    if (title.status !== 'active') {
      throw new BusinessRuleError('the selected job title is not active');
    }

    const personal: EmployeePersonalData = {
      fullNameAr: identity.fullNameAr,
      fullNameEn: identity.fullNameEn ?? null,
      searchName: normalizeArabic([identity.fullNameAr, identity.fullNameEn ?? ''].join(' ')),
      nationalId: identity.nationalId ?? null,
      birthDate: derived?.birthDate ?? null,
      gender: derived?.gender ?? null,
      nationality: identity.nationality,
      placeOfBirth: derived?.governorate ?? null,
      photoFileId: identity.photoFileId === undefined ? null : new Types.ObjectId(identity.photoFileId),
      maritalStatus: identity.maritalStatus ?? null,
      religion: identity.religion ?? null,
      nationalIdExpiry: identity.nationalIdExpiry ?? null,
      dependentsCount: identity.dependentsCount ?? null,
      contact: {
        primaryPhone: input.personal.contact.primaryPhone,
        secondaryPhone: input.personal.contact.secondaryPhone ?? null,
        email: input.personal.contact.email ?? null,
        preferredContactChannel: input.personal.contact.preferredContactChannel ?? null,
      },
      officialAddress: input.personal.officialAddress ?? null,
      currentAddress: input.personal.currentAddress ?? null,
      military:
        input.personal.military === undefined
          ? null
          : {
              status: input.personal.military.status,
              certificateRef: input.personal.military.certificateRef ?? null,
              completedAt: input.personal.military.completedAt ?? null,
            },
      education:
        input.personal.education === undefined
          ? null
          : {
              level: input.personal.education.level,
              institution: input.personal.education.institution ?? null,
              specialization: input.personal.education.specialization ?? null,
              graduationYear: input.personal.education.graduationYear ?? null,
              grade: input.personal.education.grade ?? null,
            },
      experience: input.personal.experience.map((x) => ({
        employer: x.employer,
        position: x.position ?? null,
        from: x.from ?? null,
        to: x.to ?? null,
        leavingReason: x.leavingReason ?? null,
      })),
      drivingLicenses: input.personal.drivingLicenses.map((d) => ({
        class: d.class,
        expiry: d.expiry ?? null,
      })),
      certifications: [...input.personal.certifications],
      references: input.personal.references.map((r) => ({
        name: r.name,
        relationship: r.relationship ?? null,
        phone: r.phone ?? null,
      })),
    };

    const employment: EmploymentDetails = {
      jobTitleId: new Types.ObjectId(e.jobTitleId),
      departmentId: new Types.ObjectId(e.departmentId),
      sectionId: e.sectionId == null ? null : new Types.ObjectId(e.sectionId),
      branchId: new Types.ObjectId(e.branchId),
      jobPositionId: null,
      managerId: e.managerId == null ? null : new Types.ObjectId(e.managerId),
      employmentType: e.employmentType,
      salary: e.salary == null ? null : { amount: e.salary.amount, currency: e.salary.currency },
      allowances: e.allowances.map((a) => ({ name: a.name, amount: a.amount, currency: a.currency })),
      benefits: [...e.benefits],
      probationMonths: e.probationMonths,
      startDate: e.startDate,
    };
    const hiredAt = input.hiringDate ?? new Date();
    const entry = entryProbation(
      hiredAt,
      employment.probationMonths,
      input.entryStatus === 'probation',
      new Types.ObjectId(ctx.userId),
    );

    const branch = await branchService.getById(e.branchId);
    const doc = await unitOfWork(async (session) => {
      const employeeNumber = await nextEmployeeNumber(session);
      const code = buildEmployeeCode(branch.code, employeeNumber);
      const hireEvent: EmployeeStatusEvent = {
        from: null,
        to: entry.status,
        reason: null,
        effectiveDate: hiredAt,
        at: new Date(),
        by: new Types.ObjectId(ctx.userId),
        actionId: null,
      };
      return employeeRepository.create(
        {
          employeeNumber,
          code,
          status: entry.status,
          origin: 'direct',
          personal,
          probation: entry.probation,
          exit: null,
          employmentPeriods: [{ hiredAt, exitedAt: null, exitType: null }],
          actionSeq: 1,
          statusHistory: [hireEvent],
          userId: null,
          applicantId: null,
          applicantCode: null,
          jobRequisitionId: null,
          jobOfferId: null,
          offerCode: null,
          acceptedOfferRevision: null,
          employment,
          branchId: employment.branchId,
          departmentId: employment.departmentId,
          sectionId: employment.sectionId,
          hiredAt,
        },
        { by: ctx.userId, session },
      );
    });

    await this.recordHireAction(doc, entry.status, ctx.userId);
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: [
        { field: 'code', old: null, new: doc.code },
        { field: 'origin', old: null, new: 'direct' },
        { field: 'status', old: null, new: entry.status },
      ],
    });
    await emit(HrEmployeeEvents.EmployeeCreated, {
      employeeId: String(doc._id),
      code: doc.code,
      applicantId: null,
      jobOfferId: null,
      origin: 'direct',
    });
    await this.notifyHire(doc);
    return doc;
  }

  /**
   * Post-hire personal-data edits — plain audited updates, NOT personnel actions (I4).
   * Groups are replaced whole; a national-id change re-derives birth date/gender/place of
   * birth server-side and re-runs the person guard.
   */
  async updatePersonal(
    ctx: AuthContext,
    id: string,
    input: UpdateEmployeePersonal,
    scope: ScopeSelector,
  ): Promise<EmployeeDoc> {
    const before = await employeeRepository.getById(id, scope);
    const personal: EmployeePersonalData = JSON.parse(JSON.stringify(before.personal)) as EmployeePersonalData;
    // JSON round-trip stringifies dates — restore the Date fields we keep untouched below.
    const changes: { field: string; old: string | null; new: string | null }[] = [];
    const jsonOf = (v: unknown): string | null => (v == null ? null : JSON.stringify(v));

    if (input.identity !== undefined) {
      const idn = input.identity;
      if (idn.nationalId !== undefined && idn.nationalId !== before.personal.nationalId) {
        const derived = parseNationalId(idn.nationalId);
        if (derived === null) {
          throw new ValidationError([
            { field: 'identity.nationalId', code: 'INVALID', message: 'invalid Egyptian national ID' },
          ]);
        }
        await this.assertPersonNotEmployed(idn.nationalId);
        changes.push({ field: 'personal.nationalId', old: '[masked]', new: '[masked]' });
        personal.nationalId = idn.nationalId;
        personal.birthDate = derived.birthDate;
        personal.gender = derived.gender;
        personal.placeOfBirth = derived.governorate;
      }
      if (idn.fullNameAr !== undefined && idn.fullNameAr !== before.personal.fullNameAr) {
        changes.push({ field: 'personal.fullNameAr', old: before.personal.fullNameAr, new: idn.fullNameAr });
        personal.fullNameAr = idn.fullNameAr;
      }
      if (idn.fullNameEn !== undefined && idn.fullNameEn !== before.personal.fullNameEn) {
        changes.push({ field: 'personal.fullNameEn', old: before.personal.fullNameEn, new: idn.fullNameEn });
        personal.fullNameEn = idn.fullNameEn;
      }
      personal.searchName = normalizeArabic([personal.fullNameAr, personal.fullNameEn ?? ''].join(' '));
      if (idn.nationality !== undefined) personal.nationality = idn.nationality;
      if (idn.photoFileId !== undefined) personal.photoFileId = new Types.ObjectId(idn.photoFileId);
      if (idn.maritalStatus !== undefined) {
        changes.push({ field: 'personal.maritalStatus', old: before.personal.maritalStatus, new: idn.maritalStatus });
        personal.maritalStatus = idn.maritalStatus;
      }
      if (idn.religion !== undefined) personal.religion = idn.religion;
      if (idn.nationalIdExpiry !== undefined) personal.nationalIdExpiry = idn.nationalIdExpiry;
      if (idn.dependentsCount !== undefined) personal.dependentsCount = idn.dependentsCount;
    }
    if (input.contact !== undefined) {
      changes.push({ field: 'personal.contact', old: jsonOf(before.personal.contact), new: jsonOf(input.contact) });
      personal.contact = {
        primaryPhone: input.contact.primaryPhone ?? before.personal.contact.primaryPhone,
        secondaryPhone:
          input.contact.secondaryPhone === undefined
            ? before.personal.contact.secondaryPhone
            : input.contact.secondaryPhone,
        email: input.contact.email === undefined ? before.personal.contact.email : input.contact.email,
        preferredContactChannel:
          input.contact.preferredContactChannel === undefined
            ? before.personal.contact.preferredContactChannel
            : input.contact.preferredContactChannel,
      };
    }
    if (input.officialAddress !== undefined) {
      changes.push({
        field: 'personal.officialAddress',
        old: jsonOf(before.personal.officialAddress),
        new: jsonOf(input.officialAddress),
      });
      personal.officialAddress = input.officialAddress ?? null;
    }
    if (input.currentAddress !== undefined) {
      changes.push({
        field: 'personal.currentAddress',
        old: jsonOf(before.personal.currentAddress),
        new: jsonOf(input.currentAddress),
      });
      personal.currentAddress = input.currentAddress ?? null;
    }
    if (input.military !== undefined) {
      changes.push({ field: 'personal.military', old: jsonOf(before.personal.military), new: jsonOf(input.military) });
      personal.military =
        input.military == null
          ? null
          : {
              status: input.military.status,
              certificateRef: input.military.certificateRef ?? null,
              completedAt: input.military.completedAt ?? null,
            };
    }
    if (input.education !== undefined) {
      changes.push({ field: 'personal.education', old: jsonOf(before.personal.education), new: jsonOf(input.education) });
      personal.education =
        input.education == null
          ? null
          : {
              level: input.education.level,
              institution: input.education.institution ?? null,
              specialization: input.education.specialization ?? null,
              graduationYear: input.education.graduationYear ?? null,
              grade: input.education.grade ?? null,
            };
    }
    if (input.experience !== undefined) {
      changes.push({ field: 'personal.experience', old: `${String(before.personal.experience.length)} entries`, new: `${String(input.experience.length)} entries` });
      personal.experience = input.experience.map((x) => ({
        employer: x.employer,
        position: x.position ?? null,
        from: x.from ?? null,
        to: x.to ?? null,
        leavingReason: x.leavingReason ?? null,
      }));
    }
    if (input.drivingLicenses !== undefined) {
      changes.push({ field: 'personal.drivingLicenses', old: jsonOf(before.personal.drivingLicenses), new: jsonOf(input.drivingLicenses) });
      personal.drivingLicenses = input.drivingLicenses.map((d) => ({ class: d.class, expiry: d.expiry ?? null }));
    }
    if (input.certifications !== undefined) {
      changes.push({ field: 'personal.certifications', old: jsonOf(before.personal.certifications), new: jsonOf(input.certifications) });
      personal.certifications = [...input.certifications];
    }
    if (input.references !== undefined) {
      changes.push({ field: 'personal.references', old: `${String(before.personal.references.length)} entries`, new: `${String(input.references.length)} entries` });
      personal.references = input.references.map((r) => ({
        name: r.name,
        relationship: r.relationship ?? null,
        phone: r.phone ?? null,
      }));
    }

    if (changes.length === 0 && input.identity === undefined) {
      throw new BusinessRuleError('nothing to update');
    }

    // Restore Date instances lost to the JSON round-trip for untouched fields.
    if (input.identity?.nationalId === undefined) {
      personal.birthDate = before.personal.birthDate;
      personal.nationalIdExpiry =
        input.identity?.nationalIdExpiry === undefined
          ? before.personal.nationalIdExpiry
          : input.identity.nationalIdExpiry;
    }
    if (input.identity?.photoFileId === undefined) personal.photoFileId = before.personal.photoFileId;
    if (input.experience === undefined) personal.experience = before.personal.experience;
    if (input.drivingLicenses === undefined) personal.drivingLicenses = before.personal.drivingLicenses;
    if (input.military === undefined) personal.military = before.personal.military;

    const updated = await employeeRepository.updateById(
      id,
      { personal },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({ entityRef: entityRef(id), action: 'update', changes });
    return updated;
  }

  async list(query: ListEmployeesQuery, scope: ScopeSelector): Promise<Paginated<EmployeeDoc>> {
    return employeeRepository.listEmployees({
      filter: this.toFilter(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      scope,
    });
  }

  private toFilter(query: ListEmployeesQuery): EmployeeListFilter {
    return {
      status: query.status,
      employed: query.employed,
      origin: query.origin,
      applicantId: query.applicantId,
      jobOfferId: query.jobOfferId,
      branchId: query.branchId,
      departmentId: query.departmentId,
      sectionId: query.sectionId,
      jobTitleId: query.jobTitleId,
      managerId: query.managerId,
      employmentType: query.employmentType,
      search: query.search,
    };
  }

  async getById(id: string, scope: ScopeSelector): Promise<EmployeeDoc> {
    return employeeRepository.getById(id, scope);
  }

  /** Employed direct reports (manager tree seed). Reports reference the manager's USER id. */
  async subordinates(id: string, scope: ScopeSelector): Promise<EmployeeDoc[]> {
    const employee = await employeeRepository.getById(id, scope);
    if (employee.userId === null) return [];
    return employeeRepository.findDirectReports(String(employee.userId), scope);
  }

  /** Exited-employee match for a national id — powers the Rehire prompt (F2). */
  async rehireCheck(nationalId: string): Promise<EmployeeDoc | null> {
    return employeeRepository.findByNationalIdSystem(nationalId);
  }

  /**
   * The composed profile timeline (frozen design §6): Employee File milestones + notes,
   * applied/scheduled Personnel Actions, and audited personal-data edits — merged at read
   * time, stored nowhere twice, newest first. Each source degrades gracefully (BD-007).
   */
  async timeline(id: string, scope: ScopeSelector): Promise<EmployeeTimelineItemDto[]> {
    const employee = await employeeRepository.getById(id, scope);
    const items: EmployeeTimelineItemDto[] = [];

    // 1 — Recruitment-era milestones + notes from the Employee File (when assembled).
    try {
      const { employeeFileService } = await import('../employee-file');
      const file = await employeeFileService.findByEmployeeIdSystem(id);
      if (file !== null) {
        for (const t of file.timeline) {
          items.push({
            at: t.at.toISOString(),
            source: t.type === 'note' ? 'note' : 'recruitment',
            type: t.type,
            refType: t.refType,
            refId: t.refId === null ? null : String(t.refId),
            detail: t.detail,
            by: t.by === null ? null : String(t.by),
          });
        }
      }
    } catch {
      // file source unavailable — degrade (BD-007)
    }

    // 2 — Personnel actions (applied + still-scheduled; cancelled/failed excluded from the story).
    const actions = await employeeActionRepository.listForEmployee(id, {
      page: 1,
      pageSize: 100,
      sortBy: 'createdAt',
      sortDir: 'desc',
    });
    for (const a of actions.items) {
      if (a.status !== 'applied' && a.status !== 'scheduled') continue;
      items.push({
        at: (a.appliedAt ?? a.effectiveDate).toISOString(),
        source: 'action',
        type: a.status === 'scheduled' ? `${a.type} (scheduled)` : a.type,
        refType: 'employeeAction',
        refId: String(a._id),
        detail: a.reason,
        by: a.by === null ? null : String(a.by),
      });
    }

    // 3 — Audited personal-data edits ('update' audit records on this employee).
    try {
      const audits = await auditService.listAuditLogs({
        page: 1,
        pageSize: 100,
        sortBy: 'at',
        sortDir: 'desc',
        entityType: 'employee',
        entityId: String(employee._id),
        action: 'update',
      });
      for (const row of audits.items) {
        items.push({
          at: row.at.toISOString(),
          source: 'personal',
          type: 'personalDataUpdated',
          refType: null,
          refId: null,
          detail: row.changes.map((c) => c.field).join(', '),
          by: row.actor.userId === null ? null : String(row.actor.userId),
        });
      }
    } catch {
      // audit source unavailable — degrade (BD-007)
    }

    return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }

  /**
   * Create the login account for an Employee (Employee ← one User, ADR-017). The organizational
   * placement is copied from the Employee (never supplied by the caller); the username defaults to
   * the Employee Code. The platform User is the authority for the link (`user.employeeId`, unique);
   * the employee's `userId` is a denormalized back-reference set here.
   */
  async createLogin(
    ctx: AuthContext,
    employeeId: string,
    input: CreateEmployeeLogin,
    scope: ScopeSelector,
  ): Promise<{ user: UserDoc; activationToken: string; employeeCode: string }> {
    const employee = await employeeRepository.getById(employeeId, scope);
    if (employee.userId !== null) {
      throw new ConflictError('this employee already has a login account');
    }
    if (employee.status === 'exited') {
      throw new BusinessRuleError('an exited employee cannot receive a login account');
    }
    const createUser: CreateUser = {
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      ...(input.phone === undefined ? {} : { phone: input.phone }),
      locale: input.locale,
      organization: {
        branchId: String(employee.branchId),
        departmentId: employee.departmentId === null ? null : String(employee.departmentId),
        sectionId: employee.sectionId === null ? null : String(employee.sectionId),
        jobTitleId: String(employee.employment.jobTitleId),
      },
    };
    const { user, activationToken } = await userService.create(createUser, ctx.userId, {
      username: input.username ?? employee.code,
      employeeId,
    });
    await employeeRepository.updateById(
      employeeId,
      { userId: user._id },
      { by: ctx.userId, version: employee.__v, scope },
    );
    await auditService.record({
      entityRef: entityRef(employeeId),
      action: 'loginCreated',
      changes: [{ field: 'userId', old: null, new: String(user._id) }],
    });
    return { user, activationToken, employeeCode: employee.code };
  }

  /** Probation reminder task (D1): notify HR + the manager shortly before probation lapses. */
  async remindEndingProbations(daysAhead = 7): Promise<number> {
    const from = new Date();
    const to = new Date(from.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    const ending = await employeeRepository.findProbationEndingSystem(from, to);
    for (const employee of ending) {
      const recipients = new Set<string>();
      if (employee.employment.managerId !== null) recipients.add(String(employee.employment.managerId));
      if (employee.createdBy !== null) recipients.add(String(employee.createdBy));
      const deadline = employee.probation?.extendedTo ?? employee.probation?.endDate ?? null;
      await notificationsService
        .notify({
          template: HrEmployeeTemplates.ProbationEnding,
          to: recipients.size > 0 ? { userIds: [...recipients] } : { permission: 'employee.manageActions', scope: 'organization' },
          data: {
            employeeCode: employee.code,
            endDate: deadline === null ? '' : deadline.toISOString(),
          },
          entityRef: entityRef(String(employee._id)),
        })
        .catch(() => undefined);
    }
    return ending.length;
  }
}

export const employeeService = new EmployeeService();
