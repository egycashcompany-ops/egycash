// Employee DTO mapping (Stage 5). Dates are ISO strings; the copied employment terms and the
// preserved references are surfaced as-is.
import { type EmployeeDto, type EmploymentDetailsDto } from '@ecms/contracts';
import { type EmployeeDoc, type EmploymentDetails } from './employee.model';

const employmentDto = (e: EmploymentDetails): EmploymentDetailsDto => ({
  jobTitleId: String(e.jobTitleId),
  departmentId: String(e.departmentId),
  branchId: String(e.branchId),
  managerId: String(e.managerId),
  employmentType: e.employmentType,
  salary: { amount: e.salary.amount, currency: e.salary.currency },
  allowances: e.allowances.map((a) => ({ name: a.name, amount: a.amount, currency: a.currency })),
  benefits: [...e.benefits],
  probationMonths: e.probationMonths,
  startDate: e.startDate.toISOString(),
});

export const toEmployeeDto = (doc: EmployeeDoc): EmployeeDto => ({
  id: String(doc._id),
  code: doc.code,
  status: doc.status,
  applicantId: String(doc.applicantId),
  applicantCode: doc.applicantCode,
  jobRequisitionId: doc.jobRequisitionId === null ? null : String(doc.jobRequisitionId),
  jobOfferId: String(doc.jobOfferId),
  offerCode: doc.offerCode,
  acceptedOfferRevision: doc.acceptedOfferRevision,
  employment: employmentDto(doc.employment),
  hiredAt: doc.hiredAt.toISOString(),
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});
