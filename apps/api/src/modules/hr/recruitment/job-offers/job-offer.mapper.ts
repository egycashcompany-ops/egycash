// Job Offer DTO mapping (Stage 4). Terms and their prior versions are surfaced as-is; dates
// are ISO strings.
import { type JobOfferDto, type OfferTermsDto } from '@ecms/contracts';
import { type JobOfferDoc, type OfferTerms } from './job-offer.model';

const termsDto = (t: OfferTerms): OfferTermsDto => ({
  jobTitleId: String(t.jobTitleId),
  departmentId: String(t.departmentId),
  branchId: String(t.branchId),
  managerId: String(t.managerId),
  employmentType: t.employmentType,
  salary: { amount: t.salary.amount, currency: t.salary.currency },
  allowances: t.allowances.map((a) => ({ name: a.name, amount: a.amount, currency: a.currency })),
  benefits: [...t.benefits],
  probationMonths: t.probationMonths,
  startDate: t.startDate.toISOString(),
  validUntil: t.validUntil.toISOString(),
  notes: t.notes,
});

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

export const toJobOfferDto = (doc: JobOfferDoc): JobOfferDto => ({
  id: String(doc._id),
  code: doc.code,
  applicantId: String(doc.applicantId),
  applicantCode: doc.applicantCode,
  branchId: String(doc.branchId),
  status: doc.status,
  active: doc.active,
  terms: termsDto(doc.terms),
  revisionNumber: doc.revisionNumber,
  revisions: doc.revisions.map((r) => ({
    revisionNumber: r.revisionNumber,
    terms: termsDto(r.terms),
    revisedBy: r.revisedBy === null ? null : String(r.revisedBy),
    revisedAt: r.revisedAt.toISOString(),
  })),
  acceptedSnapshot:
    doc.acceptedSnapshot === null
      ? null
      : {
          revisionNumber: doc.acceptedSnapshot.revisionNumber,
          terms: termsDto(doc.acceptedSnapshot.terms),
          acceptedAt: doc.acceptedSnapshot.acceptedAt.toISOString(),
        },
  sentAt: iso(doc.sentAt),
  respondedAt: iso(doc.respondedAt),
  responseNote: doc.responseNote,
  rejectionReason: doc.rejectionReason,
  withdrawnReason: doc.withdrawnReason,
  expiredAt: iso(doc.expiredAt),
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});
