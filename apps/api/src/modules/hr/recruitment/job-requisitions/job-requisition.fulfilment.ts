// Fulfilment: the requisition listens to hiring, and never the other way round (D-REQ-13, I15).
//
// `hr.applicant.hired` is a FACT the recruitment workflow published. This consumer reads it and
// writes one row in its own collection; it does not call back into the workflow, does not move an
// applicant, and cannot fail a hire — a requisition is a request somebody raised, and a hire that
// happened is not undone because the request it belonged to had closed.
//
// WHERE THE LINK COMES FROM. The event carries the applicant; the employee the hire created carries
// both `applicantId` and the `jobRequisitionId` copied from that applicant, so one read answers
// both questions. The applicant is the fallback for the window where the employee is not readable
// yet. Either way, no requisition reference means one thing — a direct applicant (ADR-016) — and
// there is nothing to record.
import { Types } from 'mongoose';
import { logger } from '../../../../infrastructure/logging/logger';
import { employeeRepository } from '../../employee-management/employees';
import { applicantService } from '../applicants';
import { jobRequisitionService } from './job-requisition.service';

const asId = (value: unknown): string | null =>
  typeof value === 'string' && Types.ObjectId.isValid(value) ? value : null;

/**
 * Record the hire against its requisition, if it had one.
 *
 * Returns quietly on every "nothing to do" path — no requisition on the applicant, an unknown
 * applicant, a requisition since deleted — because each of those is a legitimate state of the world
 * rather than a failure of this handler.
 */
export const recordHireAgainstRequisition = async (payload: unknown): Promise<void> => {
  const applicantId = asId((payload as { applicantId?: unknown } | null)?.applicantId);
  if (applicantId === null) return;

  try {
    const employee = await employeeRepository.findByApplicantIdSystem(applicantId);
    const employeeId = employee === null ? null : String(employee._id);
    let requisitionId =
      employee === null || employee.jobRequisitionId === null
        ? null
        : String(employee.jobRequisitionId);

    if (requisitionId === null) {
      const applicant = await applicantService.findByIdSystem(applicantId);
      if (applicant === null || applicant.jobRequisitionId === null) return;
      requisitionId = String(applicant.jobRequisitionId);
    }

    await jobRequisitionService.recordFill({
      requisitionId,
      applicantId,
      employeeId,
      at: new Date(),
    });
  } catch (error) {
    // A courtesy on top of an event that already happened must not become a liability for it: the
    // hire stands, and the failure is logged rather than thrown back at the dispatcher.
    logger.error({ err: error, applicantId }, 'recording a requisition fill failed');
  }
};
