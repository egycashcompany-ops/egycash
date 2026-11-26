// «الوظيفة» on an OPEN batch follows the applicant's job.
//
// A batch item copies the applicant's job when they join, and that copy is usually empty: the job
// is chosen later (the first-interview default, or HR's «اقتراح وظيفة وفرع»). So when an
// applicant is reassigned, every draft or issued batch holding them takes the new job name. A
// closed or cancelled batch is history and keeps what it said.
import {
  HR_EVALUATION_MOTHER_NAME_SET,
  HrEvaluationBatchEvents,
  HrRecruitmentWorkflowEvents,
  type EventEnvelope,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { emit, subscribe } from '../../../../platform/kernel/event-bus';
import { applicantService } from '../applicants';
import { EvaluationBatchModel } from './evaluation-batch.model';

let motherRegistered = false;

/**
 * «اسم الأم» typed on the security-check QUEUE reaches the open batches holding that applicant at
 * that phase. A draft simply takes it; an issued batch also re-queues its package so the printed
 * list carries it (the earlier list stays in Files). Closed and cancelled batches keep what they said.
 */
export const registerBatchMotherNameFollow = (): void => {
  if (motherRegistered) return;
  motherRegistered = true;
  subscribe(HR_EVALUATION_MOTHER_NAME_SET, 'hr.evaluationBatch.mother-name-follow', async (envelope: EventEnvelope) => {
    const p = envelope.payload as { applicantId?: string; phaseId?: string; motherName?: string; actorUserId?: string };
    if (p.applicantId === undefined || p.phaseId === undefined || p.motherName === undefined) return;
    if (!Types.ObjectId.isValid(p.applicantId) || !Types.ObjectId.isValid(p.phaseId)) return;
    const applicantId = new Types.ObjectId(p.applicantId);
    const open = await EvaluationBatchModel.find(
      { status: { $in: ['draft', 'issued'] }, phaseId: new Types.ObjectId(p.phaseId), 'items.applicantId': applicantId },
      { _id: 1, code: 1, status: 1 },
    )
      .lean<{ _id: Types.ObjectId; code: string; status: string }[]>()
      .exec();
    for (const batch of open) {
      const issued = batch.status === 'issued';
      await EvaluationBatchModel.updateOne(
        { _id: batch._id },
        {
          $set: {
            'items.$[it].motherName': p.motherName,
            ...(issued ? { 'package.status': 'queued', 'package.error': null } : {}),
          },
        },
        { arrayFilters: [{ 'it.applicantId': applicantId, 'it.result': { $ne: 'voided' } }] },
      ).exec();
      if (issued) {
        await emit(
          HrEvaluationBatchEvents.BatchGenerated,
          { batchId: String(batch._id), code: batch.code },
          { reliable: true, ...(p.actorUserId === undefined ? {} : { actorId: p.actorUserId }) },
        );
      }
    }
  });
};

let registered = false;

export const registerBatchPositionFollow = (): void => {
  if (registered) return;
  registered = true;
  subscribe(
    HrRecruitmentWorkflowEvents.PlacementChanged,
    'hr.evaluationBatch.position-follow',
    async (envelope: EventEnvelope) => {
      const { applicantId } = envelope.payload as { applicantId?: string };
      if (applicantId === undefined || !Types.ObjectId.isValid(applicantId)) return;
      const position = (await applicantService.currentPositions([applicantId])).get(applicantId) ?? null;
      const oid = new Types.ObjectId(applicantId);
      await EvaluationBatchModel.updateMany(
        { status: { $in: ['draft', 'issued'] }, 'items.applicantId': oid },
        { $set: { 'items.$[it].placementSnapshotLabel.position': position } },
        { arrayFilters: [{ 'it.applicantId': oid }] },
      ).exec();
    },
  );
};
