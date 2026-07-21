// Initial Screening lifecycle (Sprint 4.2, Stage 2). An applicant registered in Stage 1 is
// screened to a single terminal outcome — Accepted or Rejected (OQ-32). While `pending`,
// recruiters accumulate notes (the "needs more information" flow — not a separate state).
// A rejection transitions the applicant to the terminal `rejected` status; an acceptance
// leaves the applicant live for the later interview stage (not built this sprint).
//
// Cross-feature access to the Applicant aggregate goes through the applicants barrel only
// (ADR-003); this feature never reaches into applicant internals.
import { Types } from 'mongoose';
import {
  HrScreeningEvents,
  type AddScreeningNote,
  type AwaitingScreeningDto,
  type CreateScreening,
  type DecideScreening,
  type ListAwaitingScreeningsQuery,
  type ListScreeningsQuery,
  type Paginated,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { applicantService } from '../applicants';
import { screeningRepository, type ScreeningListFilter } from './screening.repository';
import { type ScreeningDoc, type ScreeningNote } from './screening.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'screening', entityId: id });

class ScreeningService {
  /** Open the (single) screening for a live applicant. */
  async create(ctx: AuthContext, input: CreateScreening, scope: ScopeSelector): Promise<ScreeningDoc> {
    const applicant = await applicantService.getById(input.applicantId, scope);
    if (applicant.status !== 'new') {
      throw new BusinessRuleError('only an applicant in the active pipeline can be screened');
    }
    const existing = await screeningRepository.findByApplicantId(input.applicantId);
    if (existing !== null) {
      throw new ConflictError('this applicant already has a screening');
    }

    const now = new Date();
    const notes: ScreeningNote[] =
      input.note === undefined ? [] : [{ text: input.note, by: new Types.ObjectId(ctx.userId), at: now }];

    const doc = await screeningRepository.create(
      {
        applicantId: new Types.ObjectId(input.applicantId),
        applicantCode: applicant.code,
        branchId: applicant.branchId,
        status: 'pending',
        notes,
        decisionReason: null,
        decidedBy: null,
        decidedAt: null,
      },
      { by: ctx.userId },
    );

    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: [{ field: 'applicantCode', old: null, new: applicant.code }],
    });
    await emit(HrScreeningEvents.ScreeningCreated, {
      screeningId: String(doc._id),
      applicantId: input.applicantId,
      applicantCode: applicant.code,
    });
    return doc;
  }

  async list(query: ListScreeningsQuery, scope: ScopeSelector): Promise<Paginated<ScreeningDoc>> {
    return screeningRepository.listScreenings({
      filter: this.toFilter(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      scope,
    });
  }

  private toFilter(query: ListScreeningsQuery): ScreeningListFilter {
    return {
      status: query.status,
      applicantId: query.applicantId,
      branchId: query.branchId,
      decidedFrom: query.decidedFrom,
      decidedTo: query.decidedTo,
      createdFrom: query.createdFrom,
      createdTo: query.createdTo,
    };
  }

  async getById(id: string, scope: ScopeSelector): Promise<ScreeningDoc> {
    return screeningRepository.getById(id, scope);
  }

  /** The applicant's screening, if any — used by later stages (Interviews) to gate entry. */
  async findByApplicantId(applicantId: string): Promise<ScreeningDoc | null> {
    return screeningRepository.findByApplicantId(applicantId);
  }

  /** Accepted screenings (capped, recent-first) — the Interviews "awaiting scheduling" source. */
  async listAcceptedForInterview(
    branchId: string | undefined,
    limit: number,
    scope: ScopeSelector,
  ): Promise<ScreeningDoc[]> {
    return screeningRepository.listAccepted(limit, branchId, scope);
  }

  /**
   * "Awaiting screening" — live applicants (status `new`) with no screening yet (the automatic
   * pipeline entry: they appear here the moment they are registered). A derived read model — no
   * screening is fabricated and the manual open-screening workflow + permissions are untouched.
   */
  async listAwaiting(
    query: ListAwaitingScreeningsQuery,
    scope: ScopeSelector,
  ): Promise<AwaitingScreeningDto[]> {
    const applicants = await applicantService.listActive(query.limit, query.branchId, scope);
    const withScreening = await screeningRepository.applicantIdsWithScreening(
      applicants.map((a) => String(a._id)),
    );
    return applicants
      .filter((a) => !withScreening.has(String(a._id)))
      .map((a) => ({
        applicantId: String(a._id),
        applicantCode: a.code,
        fullNameAr: a.fullNameAr,
        branchId: a.branchId === null ? null : String(a.branchId),
        registeredAt: a.createdAt.toISOString(),
      }));
  }

  /** Append a note while `pending` (OQ-32 "needs more information"). */
  async addNote(
    ctx: AuthContext,
    id: string,
    input: AddScreeningNote,
    scope: ScopeSelector,
  ): Promise<ScreeningDoc> {
    const before = await screeningRepository.getById(id, scope);
    if (before.status !== 'pending') {
      throw new BusinessRuleError('cannot add a note to a screening that is already decided');
    }
    const note: ScreeningNote = { text: input.note, by: new Types.ObjectId(ctx.userId), at: new Date() };
    const updated = await screeningRepository.updateById(
      id,
      { notes: [...before.notes, note] },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'notes', old: before.notes.length, new: updated.notes.length }],
    });
    return updated;
  }

  /**
   * Decide the screening (terminal). Rejection also transitions the applicant to the
   * terminal `rejected` status; acceptance leaves the applicant live.
   */
  async decide(
    ctx: AuthContext,
    id: string,
    input: DecideScreening,
    scope: ScopeSelector,
  ): Promise<ScreeningDoc> {
    const before = await screeningRepository.getById(id, scope);
    if (before.status !== 'pending') {
      throw new BusinessRuleError('screening has already been decided');
    }
    const reason = input.reason ?? null;
    const updated = await screeningRepository.updateById(
      id,
      { status: input.outcome, decisionReason: reason, decidedBy: new Types.ObjectId(ctx.userId), decidedAt: new Date() },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [{ field: 'status', old: before.status, new: input.outcome }],
    });

    if (input.outcome === 'rejected') {
      await applicantService.markRejectedByScreening(
        ctx,
        String(before.applicantId),
        { screeningId: id, reason: reason ?? 'rejected in initial screening' },
        scope,
      );
    }

    await emit(HrScreeningEvents.ScreeningDecided, {
      screeningId: id,
      applicantId: String(before.applicantId),
      applicantCode: before.applicantCode,
      outcome: input.outcome,
    });
    return updated;
  }
}

export const screeningService = new ScreeningService();
