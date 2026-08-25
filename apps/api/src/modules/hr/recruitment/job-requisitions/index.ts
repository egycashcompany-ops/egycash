// Job Requisitions (P-HR-REQ) — the feature's public surface. Nothing outside reaches past this.
export { buildJobRequisitionsRouter } from './job-requisition.routes';
export { jobRequisitionService } from './job-requisition.service';
export { jobRequisitionRepository } from './job-requisition.repository';
export { toJobRequisitionDto } from './job-requisition.mapper';
export { recordHireAgainstRequisition } from './job-requisition.fulfilment';
export { jobRequisitionReferenceValidator } from './job-requisition.reference';
export { type JobRequisitionDoc } from './job-requisition.model';
export { type JobRequisitionFillDoc } from './job-requisition-fill.model';
