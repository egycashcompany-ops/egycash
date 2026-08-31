// The queue on `/job-offers`: everybody an offer still has to be written for.
//
// WHY THIS IS A READ AND NOT A NEW STATE. The pipeline already knows everything needed to answer
// it — the offer rows, the evaluation rows, the phase catalogue. What it lacked was anywhere that
// ASKED, so somebody about to write an offer had to remember who was ready. Nothing here changes a
// state machine: I11 still holds, the offer stage is still opened only by HR's explicit move, and
// this list simply puts the people that move is FOR in front of the person who makes it.
//
// WHO IS IN IT — two ways in, and NEITHER asks where the candidate came from:
//
//   1. They are AT the Job Offer stage. Moving a candidate here materializes a `waiting` offer row
//      (I11), and that row is the whole of the answer. Screening, an interview, an evaluation, a
//      return to an earlier stage and a straight move all leave the same row, so the queue cannot
//      hold an opinion about which of them happened.
//   2. They have cleared every check that applies to them and nobody has moved them yet — the case
//      the "Move and write the offer" button on each row exists for.
//
// A candidate reachable both ways is one person and appears once.
//
// WHAT TAKES THEM OUT. An offer somebody has actually WRITTEN — `draft`, `sent`, or `accepted` —
// and leaving the active pipeline. A `waiting` row must NOT: it is the queue row itself, which is
// why `create` also refuses to read it as an existing offer (`existingActive.status !== 'waiting'`).
// Treating it as one is what used to empty this screen the instant HR moved somebody into it.
//
// IT ASKS THE EXISTING RULE. `hasClearedRequiredEvaluations` already answers "have they finished
// the checks", and a second copy here — however tempting, since this feature could phrase it its
// own way — would be a second answer to one question, disagreeing the first time somebody edited
// one of them. It gates route 2 only: route 1 is HR's own explicit decision to move the candidate,
// and re-deciding it here would put the source stage back into the answer by the side door.
import { type AwaitingOfferCandidateDto } from '@ecms/contracts';
import { type ScopeSelector } from '../../../../shared/types';
import { applicantService } from '../applicants';
import { evaluationService } from '../evaluations';
import { jobOfferRepository } from './job-offer.repository';

class AwaitingOfferService {
  /**
   * Everybody an offer still has to be written for — at the stage, or ready to be moved to it.
   *
   * Scoped through the same `getById` every applicant route uses, so a candidate the caller cannot
   * read is simply not in their queue — the scope rule is applied once, where it already lives,
   * rather than restated as a filter here.
   */
  async list(
    query: { page: number; pageSize: number; search?: string },
    scope: ScopeSelector,
  ): Promise<{ items: AwaitingOfferCandidateDto[]; total: number }> {
    const [waiting, approved] = await Promise.all([
      jobOfferRepository.applicantsWaitingForAnOffer(),
      evaluationService.applicantsWithApprovals(),
    ]);

    // One entry per person, whichever way they got here. `waitingSince` is set for those standing
    // at the stage, `latestApprovalAt` for those who finished their checks — a candidate who is
    // both keeps both, and is still one row.
    const merged = new Map<string, { waitingSince?: Date; latestApprovalAt?: Date }>();
    for (const row of waiting) {
      merged.set(row.applicantId, { waitingSince: row.since });
    }
    for (const row of approved) {
      const existing = merged.get(row.applicantId);
      if (existing === undefined) merged.set(row.applicantId, { latestApprovalAt: row.latestApprovalAt });
      else existing.latestApprovalAt = row.latestApprovalAt;
    }

    const rows: AwaitingOfferCandidateDto[] = [];

    for (const [applicantId, when] of merged) {
      const applicant = await applicantService.getById(applicantId, scope).catch(() => null);
      // Out of scope, deleted, or no longer in the active pipeline — a hired or refused candidate
      // is not waiting for an offer, whatever their checks say.
      if (applicant === null || applicant.status !== 'new') continue;

      // Route 2 only. Somebody standing at the stage was PUT there by HR, and asking their
      // evaluations again would be the source stage deciding the queue after all.
      if (
        when.waitingSince === undefined &&
        !(await evaluationService.hasClearedRequiredEvaluations(applicantId))
      ) {
        continue;
      }

      // An offer already WRITTEN — drafted, sent, or accepted — takes them out. The queue is
      // «somebody still has to write one»; the `waiting` row is what says nobody has.
      if ((await jobOfferRepository.findWrittenByApplicantId(applicantId)) !== null) continue;

      rows.push({
        applicantId,
        applicantCode: applicant.code,
        fullNameAr: applicant.fullNameAr,
        position: applicant.placementLabel?.position ?? null,
        movedToOffer: applicant.movedToOfferAt !== null,
        // Whichever came first is when this candidate started waiting on somebody. A moved
        // candidate with no approvals at all still has a real answer here.
        clearedAt: (when.latestApprovalAt ?? when.waitingSince ?? new Date()).toISOString(),
      });
    }

    const term = (query.search ?? '').trim().toLowerCase();
    const filtered =
      term === ''
        ? rows
        : rows.filter(
            (row) =>
              row.fullNameAr.toLowerCase().includes(term) ||
              row.applicantCode.toLowerCase().includes(term),
          );

    // Longest wait first: whoever's checks came back earliest has been waiting longest for somebody
    // to write their offer, and that is the order a queue is worked in.
    filtered.sort((a, b) => a.clearedAt.localeCompare(b.clearedAt));

    const start = (query.page - 1) * query.pageSize;
    return { items: filtered.slice(start, start + query.pageSize), total: filtered.length };
  }
}

export const awaitingOfferService = new AwaitingOfferService();
