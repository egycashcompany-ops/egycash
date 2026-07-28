// Job Offer lifecycle (Stage 4). An applicant who cleared all interview rounds receives an
// offer: draft → sent → accepted / rejected / expired / withdrawn. The compensation package
// is versioned (revisions keep their history); at most one offer is active (draft/sent) per
// applicant; sent offers auto-expire past their validity via a scheduled sweep. Sending and
// the four terminal transitions the workflow cares about notify the hiring manager and the
// offer's author through the platform Notifications service (fire-and-forget). The
// "latest offer must be Accepted before Employee Creation" rule is exposed here for the
// (unbuilt) Stage 5 to consult — this stage never touches Employee Creation.
//
// Cross-feature access to the Applicant and Interview aggregates goes through their barrels
// only (ADR-003).
import { Types } from 'mongoose';
import {
  HrOfferEvents,
  HrOfferTemplates,
  type AcceptJobOffer,
  type CreateJobOffer,
  type BulkActionResultDto,
  type BulkJobOffers,
  type ListJobOffersQuery,
  type OfferTerms as OfferTermsInput,
  type Paginated,
  type RejectJobOffer,
  type ReviseJobOffer,
  type SendJobOffer,
  type WithdrawJobOffer,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { notificationsService } from '../../../../platform/notifications';
import { applicantService } from '../applicants';
import { recruitmentWorkflowEngine, registerStageBinding, runBulk, type StageBinding } from '../workflow';
import { JobOfferModel } from './job-offer.model';
import { jobOfferRepository, type JobOfferListFilter } from './job-offer.repository';
import { nextOfferNumber } from './offer-sequence';
import { type JobOfferDoc, type OfferTerms } from './job-offer.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'jobOffer', entityId: id });

/** How the engine addresses this stage (I13) — one live offer per applicant per attempt. */
const BINDING = {
  object: 'offer',
  model: JobOfferModel,
  entityType: 'jobOffer',
} as unknown as StageBinding<never>;

// So the engine can close this collection's still-open records when the candidate leaves the
// pipeline (I14) — the stage never reaches into the lifecycle, only the engine does.
registerStageBinding(BINDING);

type OfferTransition = { record: JobOfferDoc };

const buildTerms = (t: OfferTermsInput): OfferTerms => ({
  jobTitleId: new Types.ObjectId(t.jobTitleId),
  departmentId: new Types.ObjectId(t.departmentId),
  branchId: new Types.ObjectId(t.branchId),
  jobPositionId:
    t.jobPositionId === null || t.jobPositionId === undefined ? null : new Types.ObjectId(t.jobPositionId),
  sectionId: t.sectionId === null || t.sectionId === undefined ? null : new Types.ObjectId(t.sectionId),
  managerId: t.managerId === null || t.managerId === undefined ? null : new Types.ObjectId(t.managerId),
  employmentType: t.employmentType,
  salary: t.salary === null || t.salary === undefined ? null : { amount: t.salary.amount, currency: t.salary.currency },
  allowances: t.allowances.map((a) => ({ name: a.name, amount: a.amount, currency: a.currency })),
  benefits: [...t.benefits],
  probationMonths: t.probationMonths,
  startDate: t.startDate,
  validUntil: t.validUntil,
  notes: t.notes ?? null,
});

class JobOfferService {
  /** Fire-and-forget lifecycle notification to the hiring manager + the offer's author. */
  private async notifyOffer(doc: JobOfferDoc, template: string, includeValidity: boolean): Promise<void> {
    const recipients = new Set<string>();
    if (doc.terms !== null && doc.terms.managerId !== null) recipients.add(String(doc.terms.managerId));
    if (doc.createdBy !== null && doc.createdBy !== undefined) recipients.add(String(doc.createdBy));
    const data: Record<string, string> = { applicantCode: doc.applicantCode };
    if (includeValidity && doc.terms !== null) data.when = doc.terms.validUntil.toISOString();
    await notificationsService
      .notify({
        template,
        to: { userIds: [...recipients] },
        data,
        entityRef: entityRef(String(doc._id)),
      })
      .catch(() => undefined);
  }

  /**
   * Draft a new offer. Eligibility is NEVER automatic — completing interviews/evaluations does
   * not qualify an applicant. Only an applicant HR has explicitly moved to the Job Offer stage
   * (from any interview or evaluation stage) can receive an offer.
   */
  async create(ctx: AuthContext, input: CreateJobOffer, scope: ScopeSelector): Promise<JobOfferDoc> {
    const applicant = await applicantService.getById(input.applicantId, scope);
    if (applicant.status !== 'new') {
      throw new BusinessRuleError('only an applicant in the active pipeline can receive an offer');
    }
    if (applicant.movedToOfferAt === null) {
      throw new BusinessRuleError('applicant must be moved to the Job Offer stage before an offer');
    }
    const existingActive = await jobOfferRepository.findActiveByApplicantId(input.applicantId);
    if (existingActive !== null && existingActive.status !== 'waiting') {
      throw new ConflictError('this applicant already has an active offer');
    }
    // An accepted offer is the end of this stage — no further offers (keeps the accepted
    // snapshot the single source of truth for Employee Creation).
    const alreadyAccepted = await jobOfferRepository.findAcceptedByApplicantId(input.applicantId);
    if (alreadyAccepted !== null) {
      throw new ConflictError('this applicant has already accepted an offer');
    }

    const terms = buildTerms(input.terms);
    // The offer number is allocated when the record LEAVES the queue for `draft` — a waiting
    // offer has none yet (I11).
    const code = await nextOfferNumber(new Date().getUTCFullYear());

    // The queue row is materialized when HR moves the applicant to this stage (I11), so drafting
    // is a transition on that row; only a first-ever offer creates one.
    const waiting =
      existingActive ??
      (
        (await recruitmentWorkflowEngine.ensureStageRecord({
          binding: BINDING,
          applicantId: input.applicantId,
          applicantCode: applicant.code,
          applicantName: applicant.fullNameAr,
          branchId: applicant.branchId,
          attempt: await jobOfferRepository.nextAttemptFor(input.applicantId),
          actorUserId: ctx.userId,
          placement: applicant.placement,
          placementLabel: applicant.placementLabel,
        } as never)) as unknown as { record: JobOfferDoc }
      ).record;

    const { record: doc } = (await recruitmentWorkflowEngine.transition({
      binding: BINDING,
      id: String(waiting._id),
      to: 'draft',
      actorUserId: ctx.userId,
      set: {
        code,
        branchId: terms.branchId,
        terms,
        revisionNumber: 1,
      },
    } as never)) as unknown as OfferTransition;

    await emit(HrOfferEvents.OfferCreated, this.payload(doc));
    return doc;
  }

  async list(query: ListJobOffersQuery, scope: ScopeSelector): Promise<Paginated<JobOfferDoc>> {
    return jobOfferRepository.listOffers({
      filter: this.toFilter(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      scope,
    });
  }

  private toFilter(query: ListJobOffersQuery): JobOfferListFilter {
    return {
      status: query.status,
      applicantId: query.applicantId,
      branchId: query.branchId,
      hired: query.hired,
      search: query.search,
    };
  }

  async getById(id: string, scope: ScopeSelector): Promise<JobOfferDoc> {
    return jobOfferRepository.getById(id, scope);
  }

  /** The applicant's accepted offer, if any — the Employee-Creation gate (Stage 5). */
  async acceptedOfferFor(applicantId: string): Promise<JobOfferDoc | null> {
    return jobOfferRepository.findAcceptedByApplicantId(applicantId);
  }

  /** A specific offer by id, only if it is Accepted — the source Employee Creation reads from. */
  async acceptedOfferById(offerId: string): Promise<JobOfferDoc | null> {
    const offer = await jobOfferRepository.findById(offerId);
    return offer !== null && offer.status === 'accepted' ? offer : null;
  }

  /** Revise the package (keeps the prior version in history). Allowed while draft or sent. */
  async revise(
    ctx: AuthContext,
    id: string,
    input: ReviseJobOffer,
    scope: ScopeSelector,
  ): Promise<JobOfferDoc> {
    const before = await jobOfferRepository.getById(id, scope);
    if (before.status !== 'draft' && before.status !== 'sent') {
      throw new BusinessRuleError('only a draft or sent offer can be revised');
    }
    const terms = buildTerms(input.terms);
    const revisions = [
      ...before.revisions,
      ...(before.terms === null
        ? []
        : [
            {
              revisionNumber: before.revisionNumber,
              terms: before.terms,
              revisedBy: new Types.ObjectId(ctx.userId),
              revisedAt: new Date(),
            },
          ]),
    ];
    const set: Partial<JobOfferDoc> = {
      terms,
      branchId: terms.branchId,
      revisionNumber: before.revisionNumber + 1,
      revisions,
    };
    // Revising an already-sent offer re-issues it (fresh sent timestamp; re-notify).
    const reIssued = before.status === 'sent';
    if (reIssued) set.sentAt = new Date();

    const updated = await jobOfferRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
      scope,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'revisionNumber', old: before.revisionNumber, new: updated.revisionNumber }],
    });
    await emit(HrOfferEvents.OfferRevised, this.payload(updated));
    if (reIssued) await this.notifyOffer(updated, HrOfferTemplates.Sent, true);
    return updated;
  }

  /**
   * RW2 step 5 — a reassignment moves the candidate, so a LIVE offer has to follow it. This is a
   * normal versioned revision, not a silent field edit: the prior package lands in `revisions[]`
   * with everything else the candidate was offered left exactly as it was.
   *
   * A `waiting` record has no terms yet and an accepted/closed offer is out of the editing window
   * (RW3) — both are no-ops, so a reassignment never fails because of the offer stage.
   */
  async followPlacement(
    ctx: AuthContext,
    applicantId: string,
    placement: {
      jobPositionId: Types.ObjectId | null;
      jobTitleId: Types.ObjectId | null;
      departmentId: Types.ObjectId | null;
      branchId: Types.ObjectId | null;
      sectionId: Types.ObjectId | null;
    },
    scope: ScopeSelector,
  ): Promise<JobOfferDoc | null> {
    const offers = await jobOfferRepository.findByApplicant(applicantId);
    const live = offers.find(
      (o) => o.supersededAt === null && (o.status === 'draft' || o.status === 'sent'),
    );
    if (live === undefined || live.terms === null) return null;
    // The placement decides the seat; everything else in the package is the candidate's offer.
    const terms = live.terms;
    return this.revise(
      ctx,
      String(live._id),
      {
        terms: {
          jobTitleId: String(placement.jobTitleId ?? terms.jobTitleId),
          departmentId: String(placement.departmentId ?? terms.departmentId),
          branchId: String(placement.branchId ?? terms.branchId),
          jobPositionId: placement.jobPositionId === null ? null : String(placement.jobPositionId),
          sectionId: placement.sectionId === null ? null : String(placement.sectionId),
          managerId: terms.managerId === null ? null : String(terms.managerId),
          employmentType: terms.employmentType,
          salary: terms.salary,
          allowances: terms.allowances,
          benefits: terms.benefits,
          probationMonths: terms.probationMonths,
          startDate: terms.startDate,
          validUntil: terms.validUntil,
          ...(terms.notes === null ? {} : { notes: terms.notes }),
        },
        version: live.__v,
      },
      scope,
    );
  }

  /** Issue a draft offer to the applicant. */
  async send(ctx: AuthContext, id: string, input: SendJobOffer, scope: ScopeSelector): Promise<JobOfferDoc> {
    const before = await jobOfferRepository.getById(id, scope);
    if (before.status !== 'draft') {
      throw new BusinessRuleError('only a draft offer can be sent');
    }
    if (before.terms === null) {
      throw new BusinessRuleError('the offer has no terms yet — draft it before sending');
    }
    if (before.terms.validUntil.getTime() <= Date.now()) {
      throw new BusinessRuleError('offer validity must be in the future to send');
    }
    const { record: updated } = (await recruitmentWorkflowEngine.transition({
      binding: BINDING,
      id,
      to: 'sent',
      actorUserId: ctx.userId,
      version: input.version,
      set: { sentAt: new Date(), sentBy: new Types.ObjectId(ctx.userId) },
    } as never)) as unknown as OfferTransition;
    await emit(HrOfferEvents.OfferSent, this.payload(updated));
    await this.notifyOffer(updated, HrOfferTemplates.Sent, true);
    return updated;
  }

  /** Record the applicant's acceptance. */
  async accept(ctx: AuthContext, id: string, input: AcceptJobOffer, scope: ScopeSelector): Promise<JobOfferDoc> {
    const before = await jobOfferRepository.getById(id, scope);
    this.assertRespondable(before);
    // Freeze the exact accepted terms — immutable, and what Employee Creation (Stage 5)
    // consumes, independent of any later change to the live offer.
    const acceptedSnapshot = {
      revisionNumber: before.revisionNumber,
      terms: before.terms,
      acceptedAt: new Date(),
    };
    const { record: updated } = (await recruitmentWorkflowEngine.transition({
      binding: BINDING,
      id,
      to: 'accepted',
      actorUserId: ctx.userId,
      version: input.version,
      set: {
        respondedAt: acceptedSnapshot.acceptedAt,
        responseNote: input.note ?? null,
        acceptedSnapshot,
      },
    } as never)) as unknown as OfferTransition;
    await emit(HrOfferEvents.OfferAccepted, this.payload(updated));
    await this.notifyOffer(updated, HrOfferTemplates.Accepted, false);
    return updated;
  }

  /** Record the applicant's rejection. */
  async reject(ctx: AuthContext, id: string, input: RejectJobOffer, scope: ScopeSelector): Promise<JobOfferDoc> {
    const before = await jobOfferRepository.getById(id, scope);
    this.assertRespondable(before);
    const { record: updated } = (await recruitmentWorkflowEngine.transition({
      binding: BINDING,
      id,
      to: 'rejected',
      actorUserId: ctx.userId,
      reason: input.reason,
      version: input.version,
      set: {
        respondedAt: new Date(),
        rejectionReason: input.reason,
        responseNote: input.note ?? null,
      },
    } as never)) as unknown as OfferTransition;
    await emit(HrOfferEvents.OfferRejected, this.payload(updated));
    await this.notifyOffer(updated, HrOfferTemplates.Rejected, false);
    return updated;
  }

  /** Retract an offer (draft or sent) — no applicant response was recorded. */
  async withdraw(ctx: AuthContext, id: string, input: WithdrawJobOffer, scope: ScopeSelector): Promise<JobOfferDoc> {
    const before = await jobOfferRepository.getById(id, scope);
    if (before.status !== 'draft' && before.status !== 'sent') {
      throw new BusinessRuleError('only a draft or sent offer can be withdrawn');
    }
    const { record: updated } = (await recruitmentWorkflowEngine.transition({
      binding: BINDING,
      id,
      to: 'withdrawn',
      actorUserId: ctx.userId,
      reason: input.reason,
      version: input.version,
      set: {
        withdrawnReason: input.reason,
        withdrawnBy: new Types.ObjectId(ctx.userId),
        withdrawnAt: new Date(),
      },
    } as never)) as unknown as OfferTransition;
    await emit(HrOfferEvents.OfferWithdrawn, this.payload(updated));
    return updated;
  }

  /**
   * Automatic-expiration sweep (scheduled). Flips every `sent` offer whose validity lapsed
   * as of `asOf` to `expired`, deactivates it, audits, emits, and notifies. System-driven —
   * no scope, no actor. Returns the number expired.
   */
  async expireOverdue(asOf: Date = new Date()): Promise<number> {
    const overdue = await jobOfferRepository.findOverdueSent(asOf);
    let expired = 0;
    for (const before of overdue) {
      try {
        const { record: updated } = (await recruitmentWorkflowEngine.transition({
          binding: BINDING,
          id: String(before._id),
          to: 'expired',
          actorUserId: null,
          version: before.__v,
          set: { expiredAt: asOf },
        } as never)) as unknown as OfferTransition;
        await emit(HrOfferEvents.OfferExpired, this.payload(updated));
        await this.notifyOffer(updated, HrOfferTemplates.Expired, false);
        expired += 1;
      } catch {
        // A concurrent transition (accept/reject/withdraw) won the race — skip, not an error.
      }
    }
    return expired;
  }

  /**
   * Record the Employee created from this accepted offer (I11). Not a workflow transition — the
   * offer stays `accepted`; this makes the Employees Ready queue readable from a fact on the
   * offer rather than from the absence of an Employee row.
   */
  async markHired(offerId: string, employeeId: string): Promise<void> {
    await JobOfferModel.updateOne(
      { _id: new Types.ObjectId(offerId) },
      { $set: { hiredEmployeeId: new Types.ObjectId(employeeId) } },
    ).exec();
  }

  private assertRespondable(offer: JobOfferDoc): void {
    if (offer.status !== 'sent') {
      throw new BusinessRuleError('only a sent offer can be accepted or rejected');
    }
    if (offer.terms !== null && offer.terms.validUntil.getTime() <= Date.now()) {
      throw new BusinessRuleError('offer has expired');
    }
  }

  private async recordStatus(before: JobOfferDoc, after: JobOfferDoc): Promise<void> {
    await auditService.record({
      entityRef: entityRef(String(after._id)),
      action: 'statusChange',
      changes: [{ field: 'status', old: before.status, new: after.status }],
    });
  }

  private payload(doc: JobOfferDoc): Record<string, unknown> {
    return {
      offerId: String(doc._id),
      applicantId: String(doc.applicantId),
      applicantCode: doc.applicantCode,
      status: doc.status,
    };
  }

  /** Bulk send/withdraw (RW17/I4) — each item in its own transaction, partial success. */
  async bulk(
    ctx: AuthContext,
    input: BulkJobOffers,
    scope: ScopeSelector,
  ): Promise<BulkActionResultDto> {
    return runBulk(
      input.ids,
      async (id) => {
        const current = await jobOfferRepository.getById(id, scope);
        if (input.action === 'send') {
          await this.send(ctx, id, { version: current.__v }, scope);
          return;
        }
        await this.withdraw(ctx, id, { reason: input.reason ?? '', version: current.__v }, scope);
      },
      {
        entityType: 'jobOffer',
        action: input.action,
        actorUserId: ctx.userId,
        reason: input.reason ?? null,
      },
    );
  }

  /** Offer counts per status over the LIVE attempts, for the stage counters (RW15/I3). */
  async statusCounts(branchId: string | undefined, scope: ScopeSelector): Promise<Record<string, number>> {
    return jobOfferRepository.countByStatus(
      {
        supersededAt: null,
        ...(branchId === undefined ? {} : { branchId: new Types.ObjectId(branchId) }),
      },
      scope,
    );
  }

  /**
   * The Employees Ready queue (A6): accepted offers not yet converted into an Employee. Readable
   * from a fact on the offer rather than from the absence of an Employee row (I11).
   */
  async countEmployeesReady(branchId: string | undefined, scope: ScopeSelector): Promise<number> {
    return jobOfferRepository.count(
      {
        status: 'accepted',
        hiredEmployeeId: null,
        ...(branchId === undefined ? {} : { branchId: new Types.ObjectId(branchId) }),
      },
      scope,
    );
  }

  /**
   * How the workflow engine addresses this stage (I13). Exposed so cross-stage orchestration —
   * a return to an earlier stage — drives this stage through the SAME engine, never by touching
   * the collection directly.
   */
  /**
   * RW2 step 3 — a reassignment moves the candidate, so their records must follow into the new
   * branch or a branch-scoped user would lose sight of their own history. This touches the
   * denormalized SCOPE FIELD only: no decision, no status, and never a `placementSnapshot`
   * (RW4 — what a record was created under is history and is never rewritten).
   */
  async syncApplicantBranch(applicantId: string, branchId: Types.ObjectId | null): Promise<void> {
    if (!Types.ObjectId.isValid(applicantId)) return;
    await JobOfferModel.updateMany(
      { applicantId: new Types.ObjectId(applicantId) },
      { $set: { branchId } },
    ).exec();
  }

  get workflowBinding(): StageBinding<never> {
    return BINDING;
  }

  /** Every offer an applicant has ever held, newest first — read by return-to-stage. */
  async listByApplicant(applicantId: string): Promise<JobOfferDoc[]> {
    return jobOfferRepository.findByApplicant(applicantId);
  }
}

export const jobOfferService = new JobOfferService();
