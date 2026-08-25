// The real validator behind the applicants' requisition seam (P-HR-REQ §6).
//
// The seam stayed rather than being deleted, and this file is why that matters: the applicants
// feature still does not import this one. It asks an interface a question, and the module wiring
// decides who answers — the permissive default until now, this from now on.
//
// TWO THINGS IT DOES, AND ONE IT DOES NOT.
//
//   ✓ Refuses a reference to a requisition that is not open — cancelled, filled, closed, rejected,
//     or still being approved. That constrains WHICH link is valid.
//   ✓ Returns the whole placement so the applicant can be prefilled from the request.
//   ✗ It never makes a link REQUIRED. A null reference never reaches a validator (the service only
//     calls one when a value was supplied), so ADR-016's Talent Pool rule is untouched.
import { Types } from 'mongoose';
import {
  type RequisitionReferenceValidator,
  type RequisitionResolution,
} from '../applicants/requisition-ref';
import { JobRequisitionModel, type JobRequisitionDoc } from './job-requisition.model';
import { linkProblem } from './job-requisition-rules';

const refused = (error: string): RequisitionResolution => ({
  ok: false,
  branchId: null,
  jobTitleId: null,
  departmentId: null,
  sectionId: null,
  error,
});

export const jobRequisitionReferenceValidator: RequisitionReferenceValidator = {
  id: 'jobRequisitions',
  resolve: async (ref) => {
    if (!Types.ObjectId.isValid(ref.jobRequisitionId)) return refused('malformed jobRequisitionId');
    const doc = await JobRequisitionModel.findOne({
      _id: new Types.ObjectId(ref.jobRequisitionId),
      isDeleted: false,
    })
      .lean<JobRequisitionDoc>()
      .exec();
    if (doc === null) return refused('unknown job requisition');

    const problem = linkProblem(doc.status);
    if (problem !== null) return refused(problem);

    return {
      ok: true,
      branchId: String(doc.branchId),
      jobTitleId: String(doc.jobTitleId),
      departmentId: String(doc.departmentId),
      sectionId: doc.sectionId === null ? null : String(doc.sectionId),
    };
  },
};
