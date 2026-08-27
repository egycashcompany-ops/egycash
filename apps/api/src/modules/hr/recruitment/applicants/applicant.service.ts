// The Applicant intake pipeline + lifecycle (Sprint 4.1 plan §2/§6/§7/§9), Stage 1 only.
// One pipeline serves every registration path (§2.1); public/integration surfaces are not
// built this sprint (OQ-17/18 open) but would call `register()` the same way. Requisition
// reference and OCR extraction go through swappable seams (OQ-30). National-ID derivation
// and applicant numbering are real (BD-002).
import { Types, type FilterQuery } from 'mongoose';
import {
  HrEvents,
  parseNationalId,
  type BulkApplicants,
  type BulkActionResultDto,
  type ConfirmApplicantIdentity,
  type EducationLevel,
  type ExportApplicantsQuery,
  type ListApplicantsQuery,
  type MoveApplicantToOffer,
  type Paginated,
  type ReassignPlacement,
  type RegisterApplicant,
  type RestoreApplicant,
  type UpdateApplicant,
  type WithdrawApplicant,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { diffChanges } from '../../../../shared/utils/diff';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { logger } from '../../../../infrastructure/logging/logger';
import { fileService, type UploadedBinary } from '../../../../platform/files';
import { resolveNationalIdCardCategoryId } from './national-id-card.files';
import { normalizeArabic } from '../../shared/arabic';
import {
  materializeAfterMoveToOffer,
  materializeAfterRegistration,
} from './stage-materializer-seam';
import { applicantRepository, type ApplicantListFilter } from './applicant.repository';
import { applicantSourceRepository } from './applicant-source.repository';
import { nextApplicantNumber } from './applicant-sequence';
import { getRequisitionValidator } from './requisition-ref';
import { applicantExportRow } from './applicant.mapper';
import { reassignThroughSeam } from './placement-seam';
import { resolvePlacement } from './placement-resolver';
import { birthDateRangeForAges } from './age-range';
import { ApplicantModel, type ApplicantDoc } from './applicant.model';
import { type Model } from 'mongoose';
import { unitOfWork } from '../../../../platform/kernel/unit-of-work';
import { type BaseDocFields } from '../../../../shared/base/base.model';
import {
  recruitmentWorkflowEngine,
  registerWorkflowApplicantReader,
  runBulk,
  type LifecycleEvent,
} from '../workflow';
// I5 — registration and identity verification are candidate facts, not workflow transitions, so
// they are written here. The barrel carries no HTTP layer, so this does not close a cycle.
import { recruitmentTimelineService } from '../timeline';

export const APPLICANT_EXPORT_MAX_ROWS = 10_000;

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'applicant', entityId: id });

const buildSearchName = (ar: string, en: string | null): string =>
  normalizeArabic([ar, en ?? ''].join(' '));

const oid = (v: string | undefined | null): Types.ObjectId | null =>
  v === undefined || v === null ? null : new Types.ObjectId(v);

const csvEscape = (value: string): string =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** The subset of the applicant document the engine's lifecycle path needs. */
interface ApplicantLifecycleDoc extends BaseDocFields {
  code: string;
  status: 'new' | 'hired' | 'rejected' | 'withdrawn';
  branchId: Types.ObjectId | null;
}

/**
 * I6 — the workflow envelope needs the candidate's status and placement to describe where they
 * stand. The workflow folder must not import this feature (this feature imports it), so Applicants
 * hands it a reader at module load — the same seam pattern as the stage bindings.
 */
registerWorkflowApplicantReader(async (applicantId) => {
  if (!Types.ObjectId.isValid(applicantId)) return null;
  const doc = await ApplicantModel.findOne({ _id: new Types.ObjectId(applicantId), isDeleted: false })
    .select('code status placement placementLabel')
    .lean<{
      _id: Types.ObjectId;
      code: string;
      status: string;
      placement: ApplicantDoc['placement'];
      placementLabel: ApplicantDoc['placementLabel'];
    }>()
    .exec();
  return doc === null
    ? null
    : {
        _id: doc._id,
        code: doc.code,
        status: doc.status,
        placement: doc.placement,
        placementLabel: doc.placementLabel,
      };
});

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
    // RW1 — placement may be set at intake and stays editable until Offer Acceptance. When both
    // a placement and a bare branchId arrive, `placement.branchId` wins and the scope field
    // follows it; direct intake with neither keeps working (ADR-016).
    // PREFILL FROM THE REQUISITION, NOT ENFORCEMENT (P-HR-REQ §6). A requisition names the job it
    // wants filled, so an applicant registered against one starts from that placement instead of
    // having it retyped — but anything the caller sent wins, and RW1 keeps every field editable
    // until hire. When no validator is wired (the permissive default), these are all null and the
    // merge changes nothing.
    const placementInput =
      resolution === null || !resolution.ok
        ? input.placement
        : {
            ...(input.placement ?? {}),
            jobTitleId: input.placement?.jobTitleId ?? resolution.jobTitleId ?? null,
            departmentId: input.placement?.departmentId ?? resolution.departmentId ?? null,
            branchId: input.placement?.branchId ?? resolution.branchId ?? null,
            sectionId: input.placement?.sectionId ?? resolution.sectionId ?? null,
          };
    const { placement, label: placementLabel } = await resolvePlacement(placementInput);
    const branchId =
      placement.branchId !== null
        ? String(placement.branchId)
        : (resolution?.branchId ?? input.branchId ?? null);
    // F-REQ-1 — the department mirror, from the resolved placement and from nowhere else. There
    // is no bare `input.departmentId` to fall back to (unlike the branch, which ADR-016 lets a
    // direct intake state on its own), so a candidate placed in no department carries none: they
    // are organization-wide until somebody places them, which is what the pipeline already shows.
    const departmentId = placement.departmentId;

    const doc = await applicantRepository.create(
      {
        code,
        status: 'new',
        placement,
        placementLabel,
        placementHistory: [],
        jobRequisitionId:
          input.jobRequisitionId === undefined ? null : new Types.ObjectId(input.jobRequisitionId),
        branchId: oid(branchId),
        departmentId,
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
        motherName: input.identity.motherName ?? null,
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
        formAnswers: input.formAnswers ?? [],
        formSnapshot: input.formSnapshot ?? null,
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
        movedToOfferAt: null,
        movedToOfferBy: null,
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
    await this.fileNationalIdCards(ctx, String(doc._id), doc.code, input.nationalIdCardFileIds ?? []);
    await emit(HrEvents.ApplicantCreated, {
      applicantId: String(doc._id),
      code: doc.code,
      ...(input.jobRequisitionId === undefined ? {} : { jobRequisitionId: input.jobRequisitionId }),
      sourceId: input.sourceId,
    });
    // I5 — a candidate's history starts with their application. Registration is not a workflow
    // transition, so nothing downstream of the engine would record it; the timeline would begin
    // mid-pipeline at the first decision. `recordSafe` keeps a history failure from failing the
    // registration — the deterministic `sourceKey` lets reconciliation repair it later.
    await recruitmentTimelineService.recordSafe({
      applicantId: String(doc._id),
      applicantCode: doc.code,
      type: 'applied',
      correlation: { type: 'applicant', id: String(doc._id) },
      actorUserId: ctx.userId,
      at: doc.createdAt,
      entity: { type: 'applicant', id: String(doc._id) },
      placement: doc.placement,
      placementLabel: doc.placementLabel,
      branchId: doc.branchId,
      metadata: { source: source.key, intakeChannel: doc.intakeChannel },
    });
    // The screening queue row exists from registration (I11) — the queue is data, never a
    // derivation of who has no record yet.
    await materializeAfterRegistration(String(doc._id));
    return withDuplicates;
  }

  /** Heuristic duplicate detection (§2.1 rule 5) — flags, never blocks. */
  // `by` is nullable because a public application has no signed-in user — the repository already
  // writes `updatedBy: null` for that case.
  private async flagDuplicates(doc: ApplicantDoc, by: string | null): Promise<ApplicantDoc> {
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
      movedToOffer: query.movedToOffer,
      createdFrom: query.createdFrom,
      createdTo: query.createdTo,
      search: 'search' in query ? query.search : undefined,
    };
  }

  async getById(id: string, scope: ScopeSelector): Promise<ApplicantDoc> {
    return applicantRepository.getById(id, scope);
  }

  /**
   * Unscoped raw lookup for SYSTEM flows (Employee-registry boot migration and the one-time
   * personal-data copy at hire). Returns the doc as stored — the raw national id is present;
   * callers must never expose it unmasked (Security Architecture §3).
   */
  async findByIdSystem(id: string): Promise<ApplicantDoc | null> {
    return ApplicantModel.findOne({ _id: new Types.ObjectId(id), isDeleted: false });
  }

  /**
   * Unscoped: live (`new`) applicants holding this national id — the Employee module's
   * direct-registration duplicate guard (frozen design I6) checks applicants AND employees.
   */
  async findLiveByNationalIdSystem(nationalId: string): Promise<ApplicantDoc | null> {
    return ApplicantModel.findOne({ nationalId, status: 'new', isDeleted: false });
  }

  /**
   * SYSTEM: the ids of applicants matching candidate-attribute predicates — age range and
   * education level. Stage queues filter on these, but the facts live HERE: a screening
   * denormalizes only what it displays (`applicantCode`, `applicantName`, `branchId`), and I1 is
   * explicit that the denormalized set is closed. So the stage service asks this feature for ids
   * and narrows its own query by them — the batched `$in` I3 permits, not a per-row join.
   *
   * `null` means "no predicate applied": the caller must NOT narrow, which is different from an
   * empty array, which means "nothing matches" and must produce an empty page.
   *
   * Applicants missing the attribute are excluded, deliberately. An unknown birth date cannot
   * satisfy an age range, and quietly including those rows would make the filter mean nothing.
   *
   * On size: this returns every match, uncapped, because a cap would silently drop candidates from
   * a filtered queue — a wrong answer is worse than a large one. The list is one id per matching
   * applicant, which is bounded by the recruitment pipeline rather than by transaction history. If
   * a deployment ever outgrows that, the fix is denormalizing the two fields onto the stage
   * records, and that is an amendment to I1 rather than a tweak here.
   */
  async idsMatchingAttributesSystem(filter: {
    ageFrom?: number | undefined;
    ageTo?: number | undefined;
    educationLevel?: readonly EducationLevel[] | undefined;
  }): Promise<Types.ObjectId[] | null> {
    const conditions: FilterQuery<ApplicantDoc> = {};
    const birthDate = birthDateRangeForAges(filter.ageFrom, filter.ageTo);
    if (birthDate !== null) conditions.birthDate = birthDate;
    if (filter.educationLevel !== undefined) conditions['education.level'] = { $in: filter.educationLevel };
    if (Object.keys(conditions).length === 0) return null;

    const rows = await ApplicantModel.find({ ...conditions, isDeleted: false }, { _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    return rows.map((r) => r._id);
  }

  /**
   * SYSTEM walk over every live applicant, id only, in `_id` order — the input to the boot
   * backfill that materializes missing `waiting` rows (I8/I11).
   *
   * A cursor rather than a page list: the backlog is the whole live pipeline and must never be
   * held in memory. `visit` owns its own failures; one applicant throwing must not end the walk,
   * so anything it lets escape is the caller's decision, not this seam's.
   */
  async eachLiveIdSystem(batchSize: number, visit: (applicantId: string) => Promise<void>): Promise<void> {
    const cursor = ApplicantModel.find({ status: 'new', isDeleted: false }, { _id: 1 })
      .sort({ _id: 1 })
      .batchSize(batchSize)
      .lean()
      .cursor();
    for await (const row of cursor) await visit(String(row._id));
  }

  /**
   * File the just-scanned National-ID images against the applicant that was created from them.
   *
   * COPIED, not re-pointed. A file's entity reference is immutable through the platform's update
   * surface, and deliberately so: being able to move a file onto another entity is being able to
   * put a document somewhere you may read it. `fileService.copy` authorizes the READ of the source
   * (ADR-023) and writes a new row under the applicant, which leaves the scan's own upload alone
   * as the record of what the OCR actually saw.
   *
   * NEVER FATAL. A person joining the pipeline matters more than an image: a copy that fails is
   * logged and the registration stands, and the card can be attached by hand afterwards.
   */
  private async fileNationalIdCards(
    ctx: AuthContext,
    applicantId: string,
    applicantCode: string,
    fileIds: readonly string[],
  ): Promise<void> {
    if (fileIds.length === 0) return;
    try {
      const categoryId = await resolveNationalIdCardCategoryId();
      for (const [index, fileId] of fileIds.entries()) {
        await fileService
          .copy(ctx, fileId, {
            moduleId: 'hr',
            entityType: 'applicant',
            entityId: applicantId,
            categoryId,
            displayName: `${applicantCode} — national id ${index + 1}`,
            visibility: 'private',
          })
          .catch((error: unknown) => {
            logger.warn({ err: error, applicantId, fileId }, 'filing a national-id card failed');
          });
      }
    } catch (error) {
      logger.warn({ err: error, applicantId }, 'the national-id card category is unavailable');
    }
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
    if (input.motherName !== undefined) set.motherName = input.motherName;
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
    const verifiedAt = new Date();
    const set: Partial<ApplicantDoc> = {
      identityVerification: 'verified',
      identityVerifiedBy: new Types.ObjectId(ctx.userId),
      identityVerifiedAt: verifiedAt,
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
    // I5 — verification is a fact about the candidate, not a workflow transition, so it is
    // recorded here or nowhere. The verification instant discriminates the entry, so correcting
    // and re-verifying adds a second entry rather than colliding with the first.
    await recruitmentTimelineService.recordSafe({
      applicantId: id,
      applicantCode: updated.code,
      type: 'identityVerified',
      correlation: { type: 'applicant', id },
      actorUserId: ctx.userId,
      at: verifiedAt,
      entity: { type: 'applicant', id },
      discriminator: verifiedAt.toISOString(),
      branchId: updated.branchId,
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
    // I13/I14 — the ENGINE owns `applicant.status`. Writing it here directly is what let a
    // withdrawn candidate keep matching every stage queue: the engine is where a lifecycle move
    // propagates onto the stage records, and a direct repository write skips that entirely.
    const updated = await this.raiseLifecycleEvent(ctx, id, 'withdrawal', input.reason, undefined, {
      set: { withdrawnReason: input.reason, withdrawnAt: new Date() },
      expectedVersion: input.version,
    });
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
    // Same rule as withdrawal: the engine moves the lifecycle, which is what brings the
    // candidate's stage records back into the queues at exactly the stage they left.
    const updated = await this.raiseLifecycleEvent(
      ctx,
      id,
      'reactivation',
      // `reactivation` demands a reason; the restore DTO leaves it optional, so an unexplained
      // restore still records WHY the status moved rather than being refused as a no-op.
      input.reason ?? 'restored to the active pipeline',
      undefined,
      { set: { withdrawnReason: null, withdrawnAt: null }, expectedVersion: input.version },
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
   * Explicitly move a live applicant to the Job Offer stage. Offer eligibility is NEVER
   * automatic — completing interviews/evaluations does not qualify an applicant; HR moves
   * them here from any interview or evaluation stage when they judge the applicant ready.
   * Only moved applicants can receive an offer (enforced by the Job Offer service) and only
   * they surface in the New Job Offer picker. Idempotent when already moved; audited.
   */
  async moveToOffer(
    ctx: AuthContext,
    id: string,
    input: MoveApplicantToOffer,
    scope: ScopeSelector,
  ): Promise<ApplicantDoc> {
    const before = await applicantRepository.getById(id, scope);
    if (before.movedToOfferAt !== null) return before; // idempotent — already in the offer stage
    if (before.status !== 'new') {
      throw new BusinessRuleError('only an applicant in the active pipeline can be moved to the offer stage');
    }
    const updated = await applicantRepository.updateById(
      id,
      { movedToOfferAt: new Date(), movedToOfferBy: new Types.ObjectId(ctx.userId) },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [
        { field: 'movedToOffer', old: false, new: true },
        ...(input.note === undefined ? [] : [{ field: 'moveToOfferNote', old: null, new: input.note }]),
      ],
    });
    await emit(HrEvents.ApplicantMovedToOffer, {
      applicantId: id,
      code: updated.code,
      ...(updated.jobRequisitionId === null ? {} : { jobRequisitionId: String(updated.jobRequisitionId) }),
      sourceId: String(updated.sourceId),
    });
    // Moving to the Job Offer stage opens that stage's queue row (I11).
    await materializeAfterMoveToOffer(id);
    return updated;
  }

  // ── Lifecycle (I13/I14) — every applicant status change goes through the engine ─────────────

  /**
   * Raise a lifecycle event on the applicant. The ONLY path that changes `applicant.status`:
   * the engine validates it against the lifecycle rules, writes the status and publishes the
   * event in one transaction. An event that does not apply (already rejected, already hired) is
   * a no-op, so the stage transition that raised it still stands.
   */
  async raiseLifecycleEvent(
    ctx: AuthContext,
    id: string,
    event: LifecycleEvent,
    reason: string,
    correlationId?: string,
    options?: { set?: Record<string, unknown>; expectedVersion?: number },
  ): Promise<ApplicantDoc> {
    const result = await unitOfWork(async (session) =>
      recruitmentWorkflowEngine.applyLifecycleEvent(
        ApplicantModel as unknown as Model<ApplicantLifecycleDoc>,
        id,
        event,
        ctx.userId,
        reason,
        session,
        correlationId,
        options,
      ),
    );
    // The engine returns null when the event does not apply (already terminal): either way the
    // caller wants the current document.
    void result;
    // Publish only AFTER the transaction commits (I15). Without this the lifecycle event and the
    // stage closures it performed would sit in the outbox until some unrelated transition flushed
    // it — so the timeline would lag, and reactivation (whose re-materialization is a consumer of
    // the event) would not re-open the candidate's stage at all.
    await recruitmentWorkflowEngine.flush();
    const current = await applicantRepository.findById(id);
    if (current === null) throw new NotFoundError();
    return current;
  }

  /**
   * Terminal rejection raised by an Initial-Screening rejection (Stage 2). Called only by the
   * screening service (cross-feature via the applicants barrel). Idempotent: an already-terminal
   * applicant is left untouched, never overridden.
   */
  async markRejectedByScreening(
    ctx: AuthContext,
    id: string,
    meta: { screeningId: string; reason: string },
    _scope: ScopeSelector,
  ): Promise<ApplicantDoc> {
    return this.raiseLifecycleEvent(ctx, id, 'permanentRejection', meta.reason);
  }

  /** Terminal rejection raised by a failed interview round (Stage 3). */
  async markRejectedByInterview(
    ctx: AuthContext,
    id: string,
    meta: { interviewId: string; reason: string },
    _scope: ScopeSelector,
  ): Promise<ApplicantDoc> {
    return this.raiseLifecycleEvent(ctx, id, 'permanentRejection', meta.reason);
  }

  /** Terminal rejection raised by a rejected evaluation phase. */
  async markRejectedByEvaluation(
    ctx: AuthContext,
    id: string,
    meta: { evaluationId: string; phaseKey: string; reason: string },
    _scope: ScopeSelector,
  ): Promise<ApplicantDoc> {
    return this.raiseLifecycleEvent(ctx, id, 'permanentRejection', meta.reason);
  }

  /**
   * Re-enter the pipeline after a rejection is corrected (`rejected` → `new`). Explicit, never a
   * side effect of a stage correction (I14). Idempotent: a non-rejected applicant is untouched.
   */
  async reactivateFromRejection(
    ctx: AuthContext,
    id: string,
    meta: { reason: string },
    _scope: ScopeSelector,
  ): Promise<ApplicantDoc> {
    return this.raiseLifecycleEvent(ctx, id, 'reactivation', meta.reason);
  }

  // ── Bulk (generic per-row-audited executor — §9) ────────────────────────────

  async bulk(
    ctx: AuthContext,
    input: BulkApplicants,
    scope: ScopeSelector,
  ): Promise<BulkActionResultDto> {
    return runBulk(
      input.ids,
      async (id) => {
        const current = await applicantRepository.getById(id, scope);
        switch (input.action) {
          case 'withdraw':
            await this.withdraw(
              ctx,
              id,
              { reason: input.reason ?? 'bulk withdraw', version: current.__v },
              scope,
            );
            return;
          case 'moveToOffer':
            await this.moveToOffer(ctx, id, { version: current.__v }, scope);
            return;
          case 'moveToScreening':
            // I11 — the screening row is materialized at registration, so "move to screening" is
            // exactly "make sure that row exists". Idempotent, and the repair for a candidate
            // registered before materialization existed.
            await materializeAfterRegistration(id);
            return;
          case 'reassign':
            // RW17 — ONE placement applied across the selection; each candidate is still checked
            // against the editing window on its own, so an ineligible one fails as that item alone.
            await this.reassign(
              ctx,
              id,
              {
                placement: input.placement as ReassignPlacement['placement'],
                reason: input.reason as string,
                source: 'manual',
                version: current.__v,
              },
              scope,
            );
            return;
        }
      },
      {
        entityType: 'applicant',
        action: input.action,
        actorUserId: ctx.userId,
        reason: input.reason ?? null,
      },
    );
  }

  /**
   * RW1 — the single writer of `placement` and its scope mirrors `branchId` (ADR-015) and
   * `departmentId` (F-REQ-1). The
   * reassignment feature composes the whole act (history, stage scopes, timeline, offer revision)
   * and calls this for the applicant's own row, so the mirror can never drift.
   */
  async writePlacement(
    ctx: AuthContext,
    id: string,
    version: number,
    scope: ScopeSelector,
    set: Pick<ApplicantDoc, 'placement' | 'placementLabel' | 'placementHistory'> & {
      branchId: ApplicantDoc['branchId'];
      departmentId: ApplicantDoc['departmentId'];
    },
  ): Promise<ApplicantDoc> {
    return applicantRepository.updateById(id, set, { by: ctx.userId, version, scope });
  }

  /**
   * RW2 — reassign a live candidate's Position and/or Branch. Its own audited action with a
   * mandatory reason and its own permission, never a field edit. Implemented in
   * `placement-reassign.ts`; exposed here so the feature keeps ONE public service.
   */
  async reassign(
    ctx: AuthContext,
    id: string,
    input: ReassignPlacement,
    scope: ScopeSelector,
  ): Promise<ApplicantDoc> {
    return reassignThroughSeam<ApplicantDoc>(ctx, id, input, scope);
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

  /**
   * Applicant counts per lifecycle status, for the aggregated stage counters (RW15/I3). One
   * grouped query, scoped like every other read.
   */
  async statusCounts(branchId: string | undefined, scope: ScopeSelector): Promise<Record<string, number>> {
    return applicantRepository.countByStatus(
      branchId === undefined ? {} : { branchId: new Types.ObjectId(branchId) },
      scope,
    );
  }
}

export const applicantService = new ApplicantService();
