// The Applicant intake pipeline + lifecycle (Sprint 4.1 plan §2/§6/§7/§9), Stage 1 only.
// One pipeline serves every registration path (§2.1); public/integration surfaces are not
// built this sprint (OQ-17/18 open) but would call `register()` the same way. Requisition
// reference and OCR extraction go through swappable seams (OQ-30). National-ID derivation
// and applicant numbering are real (BD-002).
import { Types } from 'mongoose';
import {
  HrEvents,
  parseNationalId,
  type BulkApplicants,
  type BulkApplicantsResultDto,
  type ConfirmApplicantIdentity,
  type ExportApplicantsQuery,
  type ListApplicantsQuery,
  type Paginated,
  type RegisterApplicant,
  type RestoreApplicant,
  type UpdateApplicant,
  type WithdrawApplicant,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, ValidationError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { diffChanges } from '../../../../shared/utils/diff';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { fileService, type UploadedBinary } from '../../../../platform/files';
import { normalizeArabic } from '../../shared/arabic';
import { applicantRepository, type ApplicantListFilter } from './applicant.repository';
import { applicantSourceRepository } from './applicant-source.repository';
import { nextApplicantNumber } from './applicant-sequence';
import { getRequisitionValidator } from './requisition-ref';
import { applicantExportRow } from './applicant.mapper';
import { type ApplicantDoc } from './applicant.model';

export const APPLICANT_EXPORT_MAX_ROWS = 10_000;

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'applicant', entityId: id });

const buildSearchName = (ar: string, en: string | null): string =>
  normalizeArabic([ar, en ?? ''].join(' '));

const oid = (v: string | undefined | null): Types.ObjectId | null =>
  v === undefined || v === null ? null : new Types.ObjectId(v);

const csvEscape = (value: string): string =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

class ApplicantService {
  /** The single intake entry point (§2.1). */
  async register(ctx: AuthContext, input: RegisterApplicant): Promise<ApplicantDoc> {
    // Idempotent intake: a retried submission with the same key returns the first result.
    if (input.intakeKey !== undefined) {
      const existing = await applicantRepository.findByIntakeKey(input.intakeKey);
      if (existing !== null) return existing;
    }

    // Source must exist and be active (§3).
    const source = await applicantSourceRepository.findActiveById(input.sourceId);
    if (source === null) {
      throw new ValidationError([
        { field: 'sourceId', code: 'INVALID', message: 'unknown or inactive applicant source' },
      ]);
    }

    // Requisition reference is OPTIONAL (direct intake). When supplied it is validated behind
    // the Stage-0 seam; when absent the applicant simply carries no linked Job Request.
    const resolution =
      input.jobRequisitionId === undefined
        ? null
        : await getRequisitionValidator().resolve({
            jobRequisitionId: input.jobRequisitionId,
            branchId: input.branchId ?? null,
          });
    if (resolution !== null && !resolution.ok) {
      throw new ValidationError([
        { field: 'jobRequisitionId', code: 'INVALID', message: resolution.error ?? 'invalid requisition' },
      ]);
    }

    // Identity: derive from the National ID when supplied; enforce live-uniqueness.
    const derived = input.identity.nationalId !== undefined
      ? parseNationalId(input.identity.nationalId)
      : null;
    if (input.identity.nationalId !== undefined && derived === null) {
      throw new ValidationError([
        { field: 'identity.nationalId', code: 'INVALID', message: 'invalid Egyptian national ID' },
      ]);
    }
    if (input.identity.nationalId !== undefined) {
      const clash = await applicantRepository.findLiveByNationalId(input.identity.nationalId);
      if (clash !== null) {
        throw new ConflictError('a live applicant with this national ID already exists');
      }
    }

    const now = new Date();
    const code = await nextApplicantNumber(now.getUTCFullYear());
    const branchId = resolution?.branchId ?? input.branchId ?? null;

    const doc = await applicantRepository.create(
      {
        code,
        status: 'new',
        jobRequisitionId:
          input.jobRequisitionId === undefined ? null : new Types.ObjectId(input.jobRequisitionId),
        branchId: oid(branchId),
        sourceId: new Types.ObjectId(input.sourceId),
        sourceDetail:
          input.sourceDetail === undefined
            ? null
            : {
                referrerUserId: oid(input.sourceDetail.referrerUserId),
                agencyName: input.sourceDetail.agencyName ?? null,
                externalPlatform: input.sourceDetail.externalPlatform ?? null,
                externalId: input.sourceDetail.externalId ?? null,
                note: input.sourceDetail.note ?? null,
              },
        intakeChannel: input.intakeChannel,
        intakeKey: input.intakeKey ?? null,
        expectedSalary: input.expectedSalary ?? null,
        earliestStartDate: input.earliestStartDate ?? null,
        willingToRelocate: input.willingToRelocate ?? false,
        willingToTravel: input.willingToTravel ?? false,
        willingToShiftWork: input.willingToShiftWork ?? false,
        externalRef: input.externalRef ?? null,
        identityVerification: 'unverified',
        identityVerifiedBy: null,
        identityVerifiedAt: null,
        fullNameAr: input.identity.fullNameAr,
        fullNameEn: input.identity.fullNameEn ?? null,
        searchName: buildSearchName(input.identity.fullNameAr, input.identity.fullNameEn ?? null),
        nationalId: input.identity.nationalId ?? null,
        birthDate: derived?.birthDate ?? null,
        gender: derived?.gender ?? null,
        nationality: input.identity.nationality,
        placeOfBirth: derived?.governorate ?? null,
        photoFileId: oid(input.identity.photoFileId),
        maritalStatus: input.identity.maritalStatus ?? null,
        religion: input.identity.religion ?? null,
        nationalIdExpiry: input.identity.nationalIdExpiry ?? null,
        dependentsCount: input.identity.dependentsCount ?? null,
        contact: {
          primaryPhone: input.contact.primaryPhone,
          secondaryPhone: input.contact.secondaryPhone ?? null,
          email: input.contact.email ?? null,
          preferredContactChannel: input.contact.preferredContactChannel ?? null,
        },
        officialAddress: input.officialAddress ?? null,
        currentAddress: input.currentAddress ?? null,
        military:
          input.military === undefined
            ? null
            : {
                status: input.military.status,
                certificateRef: input.military.certificateRef ?? null,
                completedAt: input.military.completedAt ?? null,
              },
        education:
          input.education === undefined
            ? null
            : {
                level: input.education.level,
                institution: input.education.institution ?? null,
                specialization: input.education.specialization ?? null,
                graduationYear: input.education.graduationYear ?? null,
                grade: input.education.grade ?? null,
              },
        experience: (input.experience ?? []).map((e) => ({
          employer: e.employer,
          position: e.position ?? null,
          from: e.from ?? null,
          to: e.to ?? null,
          leavingReason: e.leavingReason ?? null,
        })),
        drivingLicenses: (input.drivingLicenses ?? []).map((l) => ({
          class: l.class,
          expiry: l.expiry ?? null,
        })),
        certifications: input.certifications ?? [],
        references: (input.references ?? []).map((r) => ({
          name: r.name,
          relationship: r.relationship ?? null,
          phone: r.phone ?? null,
        })),
        duplicateFlag: false,
        duplicateOf: [],
        attachmentCount: 0,
        withdrawnReason: null,
        withdrawnAt: null,
      },
      { by: ctx.userId },
    );

    const withDuplicates = await this.flagDuplicates(doc, ctx.userId);

    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges(
        {},
        { code: doc.code, source: source.key, requisition: input.jobRequisitionId ?? null },
      ),
    });
    await emit(HrEvents.ApplicantCreated, {
      applicantId: String(doc._id),
      code: doc.code,
      ...(input.jobRequisitionId === undefined ? {} : { jobRequisitionId: input.jobRequisitionId }),
      sourceId: input.sourceId,
    });
    return withDuplicates;
  }

  /** Heuristic duplicate detection (§2.1 rule 5) — flags, never blocks. */
  private async flagDuplicates(doc: ApplicantDoc, by: string): Promise<ApplicantDoc> {
    const candidates = await applicantRepository.findDuplicateCandidates({
      nationalId: doc.nationalId,
      primaryPhone: doc.contact.primaryPhone,
      searchName: doc.searchName,
      birthDate: doc.birthDate,
      excludeId: String(doc._id),
    });
    if (candidates.length === 0) return doc;
    const duplicateOf = candidates.map((c) => c._id);
    await applicantRepository.setDuplicateFlag(String(doc._id), duplicateOf, by);
    return { ...doc, duplicateFlag: true, duplicateOf };
  }

  async list(query: ListApplicantsQuery, scope: ScopeSelector): Promise<Paginated<ApplicantDoc>> {
    return applicantRepository.listApplicants({
      filter: this.toFilter(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      scope,
    });
  }

  private toFilter(query: ListApplicantsQuery | ExportApplicantsQuery): ApplicantListFilter {
    return {
      status: query.status,
      sourceId: query.sourceId,
      intakeChannel: query.intakeChannel,
      jobRequisitionId: query.jobRequisitionId,
      branchId: query.branchId,
      identityVerification: query.identityVerification,
      duplicateOnly: query.duplicateOnly,
      hasAttachments: query.hasAttachments,
      createdFrom: query.createdFrom,
      createdTo: query.createdTo,
      search: 'search' in query ? query.search : undefined,
    };
  }

  async getById(id: string, scope: ScopeSelector): Promise<ApplicantDoc> {
    return applicantRepository.getById(id, scope);
  }

  /** Of the given ids, those that are live (`new`) — used by the Interviews eligibility view. */
  async liveIdsAmong(ids: string[], scope: ScopeSelector): Promise<Set<string>> {
    return applicantRepository.liveIdsAmong(ids, scope);
  }

  /** Live applicants (`new`), recent-first — used by the Screening eligibility view. */
  async listActive(limit: number, branchId: string | undefined, scope: ScopeSelector): Promise<ApplicantDoc[]> {
    return applicantRepository.listActive(limit, branchId, scope);
  }

  async update(
    ctx: AuthContext,
    id: string,
    input: UpdateApplicant,
    scope: ScopeSelector,
  ): Promise<ApplicantDoc> {
    const before = await applicantRepository.getById(id, scope);
    if (before.status !== 'new') {
      throw new BusinessRuleError('cannot edit an applicant that is not in the active pipeline');
    }
    const set: Partial<ApplicantDoc> = {};
    if (input.fullNameAr !== undefined) set.fullNameAr = input.fullNameAr;
    if (input.fullNameEn !== undefined) set.fullNameEn = input.fullNameEn;
    if (input.fullNameAr !== undefined || input.fullNameEn !== undefined) {
      set.searchName = buildSearchName(
        input.fullNameAr ?? before.fullNameAr,
        input.fullNameEn ?? before.fullNameEn,
      );
    }
    if (input.contact !== undefined) {
      set.contact = {
        primaryPhone: input.contact.primaryPhone ?? before.contact.primaryPhone,
        secondaryPhone: input.contact.secondaryPhone ?? before.contact.secondaryPhone,
        email: input.contact.email ?? before.contact.email,
        preferredContactChannel:
          input.contact.preferredContactChannel ?? before.contact.preferredContactChannel,
      };
    }
    if (input.officialAddress !== undefined) set.officialAddress = input.officialAddress;
    if (input.currentAddress !== undefined) set.currentAddress = input.currentAddress;
    if (input.expectedSalary !== undefined) set.expectedSalary = input.expectedSalary;
    if (input.earliestStartDate !== undefined) set.earliestStartDate = input.earliestStartDate;
    if (input.willingToRelocate !== undefined) set.willingToRelocate = input.willingToRelocate;
    if (input.willingToTravel !== undefined) set.willingToTravel = input.willingToTravel;
    if (input.willingToShiftWork !== undefined) set.willingToShiftWork = input.willingToShiftWork;
    if (input.military !== undefined) {
      set.military = {
        status: input.military.status,
        certificateRef: input.military.certificateRef ?? null,
        completedAt: input.military.completedAt ?? null,
      };
    }
    if (input.education !== undefined) {
      set.education = {
        level: input.education.level,
        institution: input.education.institution ?? null,
        specialization: input.education.specialization ?? null,
        graduationYear: input.education.graduationYear ?? null,
        grade: input.education.grade ?? null,
      };
    }
    if (input.experience !== undefined) {
      set.experience = input.experience.map((e) => ({
        employer: e.employer,
        position: e.position ?? null,
        from: e.from ?? null,
        to: e.to ?? null,
        leavingReason: e.leavingReason ?? null,
      }));
    }
    if (input.drivingLicenses !== undefined) {
      set.drivingLicenses = input.drivingLicenses.map((l) => ({ class: l.class, expiry: l.expiry ?? null }));
    }
    if (input.certifications !== undefined) set.certifications = input.certifications;
    if (input.references !== undefined) {
      set.references = input.references.map((r) => ({
        name: r.name,
        relationship: r.relationship ?? null,
        phone: r.phone ?? null,
      }));
    }

    const updated = await applicantRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
      scope,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges({ name: before.fullNameAr }, { name: updated.fullNameAr }),
    });
    await emit(HrEvents.ApplicantUpdated, {
      applicantId: id,
      code: updated.code,
      ...(updated.jobRequisitionId === null
        ? {}
        : { jobRequisitionId: String(updated.jobRequisitionId) }),
      sourceId: String(updated.sourceId),
    });
    return updated;
  }

  /** Confirm identity (§2.1 rule 4) — the ID-gate path; supplying a National ID here verifies it. */
  async confirmIdentity(
    ctx: AuthContext,
    id: string,
    input: ConfirmApplicantIdentity,
    scope: ScopeSelector,
  ): Promise<ApplicantDoc> {
    const before = await applicantRepository.getById(id, scope);
    const set: Partial<ApplicantDoc> = {
      identityVerification: 'verified',
      identityVerifiedBy: new Types.ObjectId(ctx.userId),
      identityVerifiedAt: new Date(),
    };
    if (input.fullNameAr !== undefined) {
      set.fullNameAr = input.fullNameAr;
      set.searchName = buildSearchName(input.fullNameAr, before.fullNameEn);
    }
    const nationalId = input.nationalId ?? before.nationalId;
    if (nationalId === null) {
      throw new BusinessRuleError('a national ID is required to verify identity');
    }
    const derived = parseNationalId(nationalId);
    if (derived === null) {
      throw new ValidationError([
        { field: 'nationalId', code: 'INVALID', message: 'invalid Egyptian national ID' },
      ]);
    }
    if (input.nationalId !== undefined && input.nationalId !== before.nationalId) {
      const clash = await applicantRepository.findLiveByNationalId(input.nationalId);
      if (clash !== null && String(clash._id) !== id) {
        throw new ConflictError('a live applicant with this national ID already exists');
      }
      set.nationalId = input.nationalId;
    }
    set.birthDate = derived.birthDate;
    set.gender = derived.gender;
    set.placeOfBirth = derived.governorate;

    const updated = await applicantRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
      scope,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [{ field: 'identityVerification', old: before.identityVerification, new: 'verified' }],
    });
    await emit(HrEvents.ApplicantIdentityVerified, {
      applicantId: id,
      code: updated.code,
      ...(updated.jobRequisitionId === null
        ? {}
        : { jobRequisitionId: String(updated.jobRequisitionId) }),
      sourceId: String(updated.sourceId),
    });
    return updated;
  }

  async withdraw(
    ctx: AuthContext,
    id: string,
    input: WithdrawApplicant,
    scope: ScopeSelector,
  ): Promise<ApplicantDoc> {
    const before = await applicantRepository.getById(id, scope);
    if (before.status === 'withdrawn') return before; // idempotent
    const updated = await applicantRepository.updateById(
      id,
      { status: 'withdrawn', withdrawnReason: input.reason, withdrawnAt: new Date() },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [{ field: 'status', old: before.status, new: 'withdrawn' }],
    });
    await emit(HrEvents.ApplicantWithdrawn, { applicantId: id, code: updated.code, reason: input.reason });
    return updated;
  }

  /**
   * Restore a withdrawn applicant to the active pipeline (`withdrawn` → `new`). All prior
   * history is preserved — screening, interviews, offers, audit and timeline records are left
   * untouched; the applicant simply becomes live again from wherever they were. Version-checked
   * + audited; emits `hr.applicant.restored` so downstream consumers can react.
   */
  async restore(
    ctx: AuthContext,
    id: string,
    input: RestoreApplicant,
    scope: ScopeSelector,
  ): Promise<ApplicantDoc> {
    const before = await applicantRepository.getById(id, scope);
    if (before.status === 'new') return before; // idempotent — already active
    if (before.status !== 'withdrawn') {
      throw new BusinessRuleError('only a withdrawn applicant can be restored');
    }
    const updated = await applicantRepository.updateById(
      id,
      { status: 'new', withdrawnReason: null, withdrawnAt: null },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [
        { field: 'status', old: before.status, new: 'new' },
        ...(input.reason === undefined ? [] : [{ field: 'restoreReason', old: null, new: input.reason }]),
      ],
    });
    await emit(HrEvents.ApplicantRestored, {
      applicantId: id,
      code: updated.code,
      ...(updated.jobRequisitionId === null
        ? {}
        : { jobRequisitionId: String(updated.jobRequisitionId) }),
      sourceId: String(updated.sourceId),
    });
    return updated;
  }

  /**
   * Transition to the terminal `rejected` status as a consequence of an Initial-Screening
   * rejection (Stage 2). Called only by the screening service (cross-feature via the
   * applicants barrel). Idempotent and safe: only a live (`new`) applicant is transitioned;
   * an already-terminal applicant (rejected/withdrawn) is left untouched, never overridden.
   */
  async markRejectedByScreening(
    ctx: AuthContext,
    id: string,
    meta: { screeningId: string; reason: string },
    scope: ScopeSelector,
  ): Promise<ApplicantDoc> {
    const before = await applicantRepository.getById(id, scope);
    if (before.status !== 'new') return before;
    const updated = await applicantRepository.updateById(
      id,
      { status: 'rejected' },
      { by: ctx.userId, version: before.__v, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [{ field: 'status', old: before.status, new: 'rejected' }],
    });
    await emit(HrEvents.ApplicantRejected, {
      applicantId: id,
      code: updated.code,
      screeningId: meta.screeningId,
      reason: meta.reason,
    });
    return updated;
  }

  /**
   * Transition to the terminal `rejected` status as a consequence of a failed interview
   * round (Stage 3). Called only by the interview service. Idempotent and safe: only a
   * live (`new`) applicant is transitioned; an already-terminal applicant is left untouched.
   */
  async markRejectedByInterview(
    ctx: AuthContext,
    id: string,
    meta: { interviewId: string; reason: string },
    scope: ScopeSelector,
  ): Promise<ApplicantDoc> {
    const before = await applicantRepository.getById(id, scope);
    if (before.status !== 'new') return before;
    const updated = await applicantRepository.updateById(
      id,
      { status: 'rejected' },
      { by: ctx.userId, version: before.__v, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [{ field: 'status', old: before.status, new: 'rejected' }],
    });
    await emit(HrEvents.ApplicantRejected, {
      applicantId: id,
      code: updated.code,
      interviewId: meta.interviewId,
      reason: meta.reason,
    });
    return updated;
  }

  /**
   * Transition to the terminal `rejected` status as a consequence of a rejected Evaluation phase
   * (Security Check / Medical / Driving Test / …). Called only by the evaluation service. Idempotent
   * and safe: only a live (`new`) applicant is transitioned; an already-terminal applicant is left
   * untouched, never overridden.
   */
  async markRejectedByEvaluation(
    ctx: AuthContext,
    id: string,
    meta: { evaluationId: string; phaseKey: string; reason: string },
    scope: ScopeSelector,
  ): Promise<ApplicantDoc> {
    const before = await applicantRepository.getById(id, scope);
    if (before.status !== 'new') return before;
    const updated = await applicantRepository.updateById(
      id,
      { status: 'rejected' },
      { by: ctx.userId, version: before.__v, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [{ field: 'status', old: before.status, new: 'rejected' }],
    });
    await emit(HrEvents.ApplicantRejected, {
      applicantId: id,
      code: updated.code,
      evaluationId: meta.evaluationId,
      reason: meta.reason,
    });
    return updated;
  }

  /**
   * Re-enter the pipeline after a stage decision that rejected the applicant is corrected
   * (`rejected` → `new`). Called only by the stage services when HR edits a rejection (the
   * approved "rejection is not final" rule). Idempotent: a non-rejected applicant is returned
   * untouched. Audited; emits `hr.applicant.restored`.
   */
  async reactivateFromRejection(
    ctx: AuthContext,
    id: string,
    meta: { reason: string },
    scope: ScopeSelector,
  ): Promise<ApplicantDoc> {
    const before = await applicantRepository.getById(id, scope);
    if (before.status !== 'rejected') return before;
    const updated = await applicantRepository.updateById(
      id,
      { status: 'new' },
      { by: ctx.userId, version: before.__v, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [
        { field: 'status', old: before.status, new: 'new' },
        { field: 'reactivateReason', old: null, new: meta.reason },
      ],
    });
    await emit(HrEvents.ApplicantRestored, {
      applicantId: id,
      code: updated.code,
      ...(updated.jobRequisitionId === null ? {} : { jobRequisitionId: String(updated.jobRequisitionId) }),
      sourceId: String(updated.sourceId),
    });
    return updated;
  }

  // ── Bulk (generic per-row-audited executor — §9) ────────────────────────────

  async bulk(
    ctx: AuthContext,
    input: BulkApplicants,
    scope: ScopeSelector,
  ): Promise<BulkApplicantsResultDto> {
    const results: BulkApplicantsResultDto['results'] = [];
    for (const id of input.ids) {
      try {
        if (input.action === 'withdraw') {
          const current = await applicantRepository.getById(id, scope);
          await this.withdraw(
            ctx,
            id,
            { reason: input.reason ?? 'bulk withdraw', version: current.__v },
            scope,
          );
        }
        results.push({ id, ok: true });
      } catch (error) {
        results.push({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const succeeded = results.filter((r) => r.ok).length;
    return { requested: input.ids.length, succeeded, failed: results.length - succeeded, results };
  }

  // ── Export (audited, PII-masked by default — §9) ────────────────────────────

  async export(
    ctx: AuthContext,
    query: ExportApplicantsQuery,
    scope: ScopeSelector,
    unmask: boolean,
  ): Promise<{ csv: string; rowCount: number }> {
    const rows = await applicantRepository.streamForExport(
      this.toFilter(query),
      scope,
      APPLICANT_EXPORT_MAX_ROWS,
    );
    const headers = [
      'code',
      'status',
      'fullNameAr',
      'fullNameEn',
      'nationalId',
      'gender',
      'primaryPhone',
      'email',
      'identityVerification',
      'intakeChannel',
      'createdAt',
    ];
    const lines = [headers.join(',')];
    for (const doc of rows) {
      const row = applicantExportRow(doc, unmask);
      lines.push(headers.map((h) => csvEscape(row[h] ?? '')).join(','));
    }
    await auditService.record({
      entityRef: { moduleId: 'hr', entityType: 'applicantExport', entityId: ctx.userId },
      action: 'export',
      changes: [
        { field: 'rowCount', old: null, new: rows.length },
        { field: 'unmasked', old: null, new: unmask },
      ],
    });
    return { csv: lines.join('\r\n'), rowCount: rows.length };
  }

  // ── Attachments (bytes via the platform Files service — §2.2) ───────────────

  async addAttachment(
    ctx: AuthContext,
    id: string,
    binary: UploadedBinary,
    meta: { title: string; categoryId: string; notes?: string | undefined },
    scope: ScopeSelector,
  ): Promise<{ fileId: string }> {
    const applicant = await applicantRepository.getById(id, scope);
    const file = await fileService.upload(
      ctx,
      {
        moduleId: 'hr',
        entityType: 'applicant',
        entityId: String(applicant._id),
        categoryId: meta.categoryId,
        displayName: meta.title,
        visibility: 'private',
        tags: [],
        ...(meta.notes === undefined ? {} : { description: meta.notes }),
      },
      binary,
    );
    await applicantRepository.adjustAttachmentCount(id, 1);
    return { fileId: String(file._id) };
  }

  async listAttachments(id: string, scope: ScopeSelector): Promise<unknown[]> {
    await applicantRepository.getById(id, scope);
    const page = await fileService.list(
      { moduleId: 'hr', entityType: 'applicant', entityId: id, page: 1, pageSize: 100, sortDir: 'desc' },
      scope,
    );
    return page.items.map((f) => fileService.toDto(f));
  }

  async removeAttachment(
    ctx: AuthContext,
    id: string,
    fileId: string,
    scope: ScopeSelector,
  ): Promise<void> {
    await applicantRepository.getById(id, scope);
    await fileService.softDelete(ctx, fileId, scope);
    await applicantRepository.adjustAttachmentCount(id, -1);
  }
}

export const applicantService = new ApplicantService();
