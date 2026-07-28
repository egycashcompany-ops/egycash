// Initial Screening lifecycle (Sprint 4.2, Stage 2). An applicant registered in Stage 1 is
// screened to a single terminal outcome — Accepted or Rejected (OQ-32). While `waiting`,
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
  type CreateScreening,
  type DecideScreening,
  type BulkActionResultDto,
  type BulkScreenings,
  type ListScreeningsQuery,
  type Paginated,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { applicantService } from '../applicants';
import { recruitmentWorkflowEngine, registerStageBinding, runBulk, type StageBinding } from '../workflow';
import { ScreeningModel } from './screening.model';
import { screeningRepository, type ScreeningListFilter } from './screening.repository';
import { type ScreeningDoc, type ScreeningNote } from './screening.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'screening', entityId: id });

/** How the engine addresses this stage (I13) — the screening is a singleton per attempt. */
const BINDING = {
  object: 'screening',
  model: ScreeningModel,
  entityType: 'screening',
} as unknown as StageBinding<never>;

// So the engine can close this collection's still-open records when the candidate leaves the
// pipeline (I14) — the stage never reaches into the lifecycle, only the engine does.
registerStageBinding(BINDING);

class ScreeningService {
  /**
   * Open the screening for a live applicant. The record is normally materialized the moment the
   * applicant is registered (I11), so this is a find-or-create against the LIVE attempt: it
   * returns the waiting record (adding the note, if given) rather than refusing. An already
   * DECIDED screening still conflicts — re-opening one is a return-to-stage, not a create.
   */
  async create(ctx: AuthContext, input: CreateScreening, scope: ScopeSelector): Promise<ScreeningDoc> {
    const applicant = await applicantService.getById(input.applicantId, scope);
    if (applicant.status !== 'new') {
      throw new BusinessRuleError('only an applicant in the active pipeline can be screened');
    }
    const existing = await screeningRepository.findByApplicantId(input.applicantId);
    if (existing !== null && existing.status !== 'waiting') {
      throw new ConflictError('this applicant already has a decided screening');
    }
    if (existing !== null) {
      return input.note === undefined
        ? existing
        : this.addNote(ctx, String(existing._id), { note: input.note, version: existing.__v }, scope);
    }

    const now = new Date();
    const notes: ScreeningNote[] =
      input.note === undefined ? [] : [{ text: input.note, by: new Types.ObjectId(ctx.userId), at: now }];

    const doc = await screeningRepository.create(
      {
        applicantId: new Types.ObjectId(input.applicantId),
        applicantCode: applicant.code,
        applicantName: applicant.fullNameAr,
        branchId: applicant.branchId,
        status: 'waiting',
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
      filter: await this.toFilter(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      scope,
    });
  }

  /**
   * Age and education are facts about the CANDIDATE, not about this screening — the record
   * denormalizes only what it displays (I1). So they are resolved against the applicant registry
   * first and arrive at the repository as the id set they matched: one extra indexed query per
   * request, never one per row (I3).
   */
  private async toFilter(query: ListScreeningsQuery): Promise<ScreeningListFilter> {
    const applicantIdIn = await applicantService.idsMatchingAttributesSystem({
      ageFrom: query.ageFrom,
      ageTo: query.ageTo,
      educationLevel: query.educationLevel,
    });
    return {
      status: query.status,
      applicantId: query.applicantId,
      branchId: query.branchId,
      decidedFrom: query.decidedFrom,
      decidedTo: query.decidedTo,
      createdFrom: query.createdFrom,
      createdTo: query.createdTo,
      search: query.search,
      // `null` means no candidate filter was asked for — leave the query unnarrowed. An empty
      // array is a real answer (nobody matched) and must narrow to nothing.
      ...(applicantIdIn === null ? {} : { applicantIdIn }),
    };
  }

  async getById(id: string, scope: ScopeSelector): Promise<ScreeningDoc> {
    return screeningRepository.getById(id, scope);
  }

  /** The applicant's screening, if any — used by later stages (Interviews) to gate entry. */
  async findByApplicantId(applicantId: string): Promise<ScreeningDoc | null> {
    return screeningRepository.findByApplicantId(applicantId);
  }

  /** Append a note while `waiting` (OQ-32 "needs more information"). */
  async addNote(
    ctx: AuthContext,
    id: string,
    input: AddScreeningNote,
    scope: ScopeSelector,
  ): Promise<ScreeningDoc> {
    const before = await screeningRepository.getById(id, scope);
    if (before.status !== 'waiting') {
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
    if (before.status !== 'waiting') {
      throw new BusinessRuleError('screening has already been decided');
    }
    const reason = input.reason ?? null;
    // The engine owns the status change and publishes the event (I13/I15).
    const { record: updated } = await recruitmentWorkflowEngine.transition({
      binding: BINDING,
      id,
      to: input.outcome,
      actorUserId: ctx.userId,
      reason,
      version: input.version,
      set: {
        decisionReason: reason,
        decidedBy: new Types.ObjectId(ctx.userId),
        decidedAt: new Date(),
      },
    } as never) as unknown as { record: ScreeningDoc };

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

  /**
   * Edit a screening that was ALREADY decided (the approved "a decision is not final" rule, D7):
   * HR may flip Accepted ↔ Rejected. The change is fully audited. Flipping to `rejected` removes
   * the applicant from the pipeline; flipping a `rejected` screening back to `accepted` reactivates
   * the applicant (rejected → new) so they re-enter at the appropriate stage.
   */
  async redecide(
    ctx: AuthContext,
    id: string,
    input: DecideScreening,
    scope: ScopeSelector,
  ): Promise<ScreeningDoc> {
    const before = await screeningRepository.getById(id, scope);
    if (before.status === 'waiting') {
      throw new BusinessRuleError('screening has not been decided yet');
    }
    if (before.status === input.outcome) {
      throw new BusinessRuleError('the screening already has this decision');
    }
    const reason = input.reason ?? null;
    const { record: updated } = await recruitmentWorkflowEngine.transition({
      binding: BINDING,
      id,
      to: input.outcome,
      actorUserId: ctx.userId,
      reason: reason ?? 'decision edited',
      version: input.version,
      set: {
        decisionReason: reason,
        decidedBy: new Types.ObjectId(ctx.userId),
        decidedAt: new Date(),
      },
    } as never) as unknown as { record: ScreeningDoc };

    const applicantId = String(before.applicantId);
    if (input.outcome === 'rejected') {
      await applicantService.markRejectedByScreening(
        ctx,
        applicantId,
        { screeningId: id, reason: reason ?? 'screening decision edited to rejected' },
        scope,
      );
    }

    await emit(HrScreeningEvents.ScreeningDecided, {
      screeningId: id,
      applicantId,
      applicantCode: before.applicantCode,
      outcome: input.outcome,
    });
    return updated;
  }

  /**
   * Bulk approve/reject a screening queue (RW17/I4). Each item runs the single-item `decide`
   * in its own transaction; failures are reported per id and never abort the rest.
   */
  async bulk(
    ctx: AuthContext,
    input: BulkScreenings,
    scope: ScopeSelector,
  ): Promise<BulkActionResultDto> {
    const outcome = input.action === 'approve' ? 'accepted' : 'rejected';
    return runBulk(
      input.ids,
      async (id) => {
        const current = await screeningRepository.getById(id, scope);
        await this.decide(
          ctx,
          id,
          {
            outcome,
            ...(input.reason === undefined ? {} : { reason: input.reason }),
            version: current.__v,
          },
          scope,
        );
      },
      {
        entityType: 'screening',
        action: input.action,
        actorUserId: ctx.userId,
        reason: input.reason ?? null,
      },
    );
  }

  /** Screening counts per status over the LIVE attempts, for the stage counters (RW15/I3). */
  async statusCounts(branchId: string | undefined, scope: ScopeSelector): Promise<Record<string, number>> {
    return screeningRepository.countByStatus(
      {
        supersededAt: null,
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
    await ScreeningModel.updateMany(
      { applicantId: new Types.ObjectId(applicantId) },
      { $set: { branchId } },
    ).exec();
  }

  get workflowBinding(): StageBinding<never> {
    return BINDING;
  }
}

export const screeningService = new ScreeningService();
