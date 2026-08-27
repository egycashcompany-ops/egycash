// The queue on `/job-offers`: candidates who have finished every check that applies to them and do
// not have an offer yet.
//
// WHY THIS IS A READ AND NOT A NEW STATE. The pipeline already knows everything needed to answer
// it — the evaluation rows, the phase catalogue, the offers. What it lacked was anywhere that
// ASKED, so somebody about to write an offer had to remember who was ready. Nothing here changes a
// state machine: I11 still holds, the offer stage is still opened only by HR's explicit move, and
// this list simply puts the people that move is FOR in front of the person who makes it.
//
// IT ASKS THE EXISTING RULE. `hasClearedRequiredEvaluations` already answers "have they finished
// the checks", and a second copy here — however tempting, since this feature could phrase it its
// own way — would be a second answer to one question, disagreeing the first time somebody edited
// one of them.
import { type AwaitingOfferCandidateDto } from '@ecms/contracts';
import { type ScopeSelector } from '../../../../shared/types';
import { applicantService } from '../applicants';
import { evaluationService } from '../evaluations';
import { jobOfferRepository } from './job-offer.repository';

class AwaitingOfferService {
  /**
   * Everybody standing at the end of the checks with nothing written for them yet.
   *
   * Scoped through the same `getById` every applicant route uses, so a candidate the caller cannot
   * read is simply not in their queue — the scope rule is applied once, where it already lives,
   * rather than restated as a filter here.
   */
  async list(
    query: { page: number; pageSize: number; search?: string },
    scope: ScopeSelector,
  ): Promise<{ items: AwaitingOfferCandidateDto[]; total: number }> {
    const candidates = await evaluationService.applicantsWithApprovals();
    const rows: AwaitingOfferCandidateDto[] = [];

    for (const candidate of candidates) {
      const applicant = await applicantService
        .getById(candidate.applicantId, scope)
        .catch(() => null);
      // Out of scope, deleted, or no longer in the active pipeline — a hired or refused candidate
      // is not waiting for an offer, whatever their checks say.
      if (applicant === null || applicant.status !== 'new') continue;

      if (!(await evaluationService.hasClearedRequiredEvaluations(candidate.applicantId))) continue;

      // An offer already written — live or accepted — takes them out. The queue is «somebody still
      // has to write one», not «somebody has finished the checks».
      const [active, accepted] = await Promise.all([
        jobOfferRepository.findActiveByApplicantId(candidate.applicantId),
        jobOfferRepository.findAcceptedByApplicantId(candidate.applicantId),
      ]);
      if (active !== null || accepted !== null) continue;

      rows.push({
        applicantId: candidate.applicantId,
        applicantCode: applicant.code,
        fullNameAr: applicant.fullNameAr,
        position: applicant.placementLabel?.position ?? null,
        movedToOffer: applicant.movedToOfferAt !== null,
        clearedAt: candidate.latestApprovalAt.toISOString(),
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
