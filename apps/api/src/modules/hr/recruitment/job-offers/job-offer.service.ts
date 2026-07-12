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
import { interviewService } from '../interviews';
import { jobOfferRepository, type JobOfferListFilter } from './job-offer.repository';
import { nextOfferNumber } from './offer-sequence';
import { type JobOfferDoc, type OfferTerms } from './job-offer.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'jobOffer', entityId: id });

const buildTerms = (t: OfferTermsInput): OfferTerms => ({
  jobTitleId: new Types.ObjectId(t.jobTitleId),
  departmentId: new Types.ObjectId(t.departmentId),
  branchId: new Types.ObjectId(t.branchId),
  managerId: new Types.ObjectId(t.managerId),
  employmentType: t.employmentType,
  salary: { amount: t.salary.amount, currency: t.salary.currency },
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
    const recipients = new Set<string>([String(doc.terms.managerId)]);
    if (doc.createdBy !== null && doc.createdBy !== undefined) recipients.add(String(doc.createdBy));
    const data: Record<string, string> = { applicantCode: doc.applicantCode };
    if (includeValidity) data.when = doc.terms.validUntil.toISOString();
    await notificationsService
      .notify({
        template,
        to: { userIds: [...recipients] },
        data,
        entityRef: entityRef(String(doc._id)),
      })
      .catch(() => undefined);
  }

  /** Draft a new offer for an applicant who has cleared every interview round. */
  async create(ctx: AuthContext, input: CreateJobOffer, scope: ScopeSelector): Promise<JobOfferDoc> {
    const applicant = await applicantService.getById(input.applicantId, scope);
    if (applicant.status !== 'new') {
      throw new BusinessRuleError('only an applicant in the active pipeline can receive an offer');
    }
    if (!(await interviewService.hasClearedAllInterviews(input.applicantId))) {
      throw new BusinessRuleError('applicant must complete all interview stages before an offer');
    }
    const existingActive = await jobOfferRepository.findActiveByApplicantId(input.applicantId);
    if (existingActive !== null) {
      throw new ConflictError('this applicant already has an active offer');
    }
    // An accepted offer is the end of this stage — no further offers (keeps the accepted
    // snapshot the single source of truth for Employee Creation).
    const alreadyAccepted = await jobOfferRepository.findAcceptedByApplicantId(input.applicantId);
    if (alreadyAccepted !== null) {
      throw new ConflictError('this applicant has already accepted an offer');
    }

    const terms = buildTerms(input.terms);
    const code = await nextOfferNumber(new Date().getUTCFullYear());
    const doc = await jobOfferRepository.create(
      {
        code,
        applicantId: new Types.ObjectId(input.applicantId),
        applicantCode: applicant.code,
        branchId: terms.branchId,
        status: 'draft',
        active: true,
        terms,
        revisionNumber: 1,
        revisions: [],
        acceptedSnapshot: null,
        sentAt: null,
        sentBy: null,
        respondedAt: null,
        responseNote: null,
        rejectionReason: null,
        withdrawnReason: null,
        withdrawnBy: null,
        withdrawnAt: null,
        expiredAt: null,
      },
      { by: ctx.userId },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: [{ field: 'status', old: null, new: 'draft' }],
    });
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
      active: query.active,
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
      { revisionNumber: before.revisionNumber, terms: before.terms, revisedBy: new Types.ObjectId(ctx.userId), revisedAt: new Date() },
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

  /** Issue a draft offer to the applicant. */
  async send(ctx: AuthContext, id: string, input: SendJobOffer, scope: ScopeSelector): Promise<JobOfferDoc> {
    const before = await jobOfferRepository.getById(id, scope);
    if (before.status !== 'draft') {
      throw new BusinessRuleError('only a draft offer can be sent');
    }
    if (before.terms.validUntil.getTime() <= Date.now()) {
      throw new BusinessRuleError('offer validity must be in the future to send');
    }
    const updated = await jobOfferRepository.updateById(
      id,
      { status: 'sent', active: true, sentAt: new Date(), sentBy: new Types.ObjectId(ctx.userId) },
      { by: ctx.userId, version: input.version, scope },
    );
    await this.recordStatus(before, updated);
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
    const updated = await jobOfferRepository.updateById(
      id,
      {
        status: 'accepted',
        active: false,
        respondedAt: acceptedSnapshot.acceptedAt,
        responseNote: input.note ?? null,
        acceptedSnapshot,
      },
      { by: ctx.userId, version: input.version, scope },
    );
    await this.recordStatus(before, updated);
    await emit(HrOfferEvents.OfferAccepted, this.payload(updated));
    await this.notifyOffer(updated, HrOfferTemplates.Accepted, false);
    return updated;
  }

  /** Record the applicant's rejection. */
  async reject(ctx: AuthContext, id: string, input: RejectJobOffer, scope: ScopeSelector): Promise<JobOfferDoc> {
    const before = await jobOfferRepository.getById(id, scope);
    this.assertRespondable(before);
    const updated = await jobOfferRepository.updateById(
      id,
      {
        status: 'rejected',
        active: false,
        respondedAt: new Date(),
        rejectionReason: input.reason,
        responseNote: input.note ?? null,
      },
      { by: ctx.userId, version: input.version, scope },
    );
    await this.recordStatus(before, updated);
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
    const updated = await jobOfferRepository.updateById(
      id,
      {
        status: 'withdrawn',
        active: false,
        withdrawnReason: input.reason,
        withdrawnBy: new Types.ObjectId(ctx.userId),
        withdrawnAt: new Date(),
      },
      { by: ctx.userId, version: input.version, scope },
    );
    await this.recordStatus(before, updated);
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
        const updated = await jobOfferRepository.updateById(
          String(before._id),
          { status: 'expired', active: false, expiredAt: asOf },
          { by: null, version: before.__v },
        );
        await auditService.record({
          entityRef: entityRef(String(before._id)),
          action: 'statusChange',
          changes: [{ field: 'status', old: 'sent', new: 'expired' }],
        });
        await emit(HrOfferEvents.OfferExpired, this.payload(updated));
        await this.notifyOffer(updated, HrOfferTemplates.Expired, false);
        expired += 1;
      } catch {
        // A concurrent transition (accept/reject/withdraw) won the race — skip, not an error.
      }
    }
    return expired;
  }

  private assertRespondable(offer: JobOfferDoc): void {
    if (offer.status !== 'sent') {
      throw new BusinessRuleError('only a sent offer can be accepted or rejected');
    }
    if (offer.terms.validUntil.getTime() <= Date.now()) {
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
}

export const jobOfferService = new JobOfferService();
