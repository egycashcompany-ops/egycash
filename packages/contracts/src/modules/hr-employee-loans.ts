// Employee loans and advances — the obligation and its schedule (P-HR-05, phase A).
//
// A bonus is a decision that ends when it is paid. A loan is a decision that BEGINS when it is
// paid: money leaves, and an obligation stays behind for months. That is why this is not P-HR-04
// with extra fields, and why `approved` is the middle of this state machine rather than its end.
//
// THREE CONCEPTS, KEPT APART, because mixing them is how a loan system starts lying about its own
// numbers:
//
//   • the OBLIGATION  — "this employee owes X". One document, one principal, forever.
//   • the INSTALLMENT — "this month is MEANT to take Y". An intention, editable while its month
//                       is still open.
//   • the DEDUCTION   — "this month TOOK Y". A fact on an issued payslip. PHASE B.
//
// Phase A ships the first two and therefore carries no vocabulary for the third: an installment is
// `planned` or `cancelled`, and nothing here says `deducted`, `remaining after payroll`, or names
// a compensation line. Those arrive in phase B with the code that produces them.
//
// The frozen decisions (D1–D10) are in docs/12-planning/employee-loans-design.md.
import { z } from 'zod';
import { PaginationQuerySchema, objectId } from '../common/index.js';
import { MoneyAmountSchema, MoneyCurrencySchema } from './hr-payroll-money.js';

/**
 * D1 — one entity, one type. An advance is a loan with `installmentCount: 1`.
 *
 * The type is for reporting and for the sentence a reader sees; it changes no arithmetic. Two
 * collections would have meant maintaining one schedule generator twice.
 */
export const EMPLOYEE_LOAN_TYPES = ['advance', 'loan'] as const;
export const EmployeeLoanTypeSchema = z.enum(EMPLOYEE_LOAN_TYPES);
export type EmployeeLoanType = z.infer<typeof EmployeeLoanTypeSchema>;

/**
 * D2 / D5 / D7 — the lifecycle.
 *
 *   draft → pendingApproval → approved → active → settled
 *
 * `reject` returns to `draft` (the Contracts precedent P-HR-04 also took), so a mistake is
 * corrected rather than retyped. `cancelled` is reachable only BEFORE disbursement: withdrawing a
 * proposal costs nothing, while "cancelling" money already handed over would mean forgiving a
 * debt — a financial decision this system has not been granted.
 *
 * `active` is where the obligation lives. It leaves only by being repaid: in phase A through
 * `externalSettlement` (D7-1), and in phase B through payroll.
 */
// `outstandingAtExit` (D8, P-HR-05-B) is a STATEMENT OF FACT rather than a decision: the employee
// left owing money. Nothing is deducted from a final salary and nothing is written off — the
// balance stays readable, and what happens to it is a decision outside this system.
export const EMPLOYEE_LOAN_STATUSES = [
  'draft',
  'pendingApproval',
  'approved',
  'active',
  'settled',
  'cancelled',
  'outstandingAtExit',
] as const;
export const EmployeeLoanStatusSchema = z.enum(EMPLOYEE_LOAN_STATUSES);
export type EmployeeLoanStatus = z.infer<typeof EmployeeLoanStatusSchema>;

/**
 * D3 — the states from which a loan WILL become active with nobody deciding anything further.
 *
 * A `draft` is deliberately absent: it is a proposal, and blocking on one would let a forgotten
 * draft lock an employee out of ever borrowing again.
 */
export const LIVE_EMPLOYEE_LOAN_STATUSES = ['pendingApproval', 'approved', 'active'] as const;

/**
 * What an instalment is, and what became of it.
 *
 *   • `planned`   — an INTENTION. Rewritable while its month is open.
 *   • `deducted`  — a FACT (P-HR-05-B). A payslip took it, and nothing may move it afterwards.
 *   • `cancelled` — an intention that was withdrawn: by a reschedule, an external settlement, or
 *                   an exit.
 *
 * The middle value arrived with the code that sets it, which is the whole reason phase A shipped
 * without it.
 */
export const LOAN_INSTALLMENT_STATUSES = ['planned', 'deducted', 'cancelled'] as const;
export const LoanInstallmentStatusSchema = z.enum(LOAN_INSTALLMENT_STATUSES);
export type LoanInstallmentStatus = z.infer<typeof LoanInstallmentStatusSchema>;

/** `YYYY-MM`, the Cairo month — the same period key every payroll phase uses. */
export const loanPeriod = (): z.ZodString =>
  z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'a period is YYYY-MM');

/**
 * A bound on how many rows one write may create, NOT a repayment policy.
 *
 * D4 froze that this system holds no ceiling of any kind; the business limit on a schedule's
 * length, if an organization has one, is a decision nobody has taken. This number exists so a
 * slipped keystroke cannot ask for a hundred thousand documents.
 */
export const LOAN_MAX_INSTALLMENTS = 120;

export const CreateEmployeeLoanSchema = z
  .object({
    type: EmployeeLoanTypeSchema,
    /** Always positive, and never reduced afterwards: the principal IS the obligation. */
    principal: MoneyAmountSchema.refine((value) => value > 0, {
      message: 'a principal must be positive',
    }),
    /** Must equal the employee's basic-salary currency — PY-3 refuses to total two currencies. */
    currency: MoneyCurrencySchema,
    /** D5 — the schedule's two inputs. An advance is simply `installmentCount: 1`. */
    installmentCount: z.number().int().min(1).max(LOAN_MAX_INSTALLMENTS),
    firstPeriod: loanPeriod(),
    /** Required: money handed over for a reason nobody wrote down is not a record. */
    reason: z.string().min(1).max(500),
    note: z.string().max(1000).optional(),
    /** Uploaded first through the loan attachment endpoint, as personnel actions do (ADR-023). */
    attachmentFileId: objectId().optional(),
  })
  .strict();
export type CreateEmployeeLoan = z.infer<typeof CreateEmployeeLoanSchema>;

/** Editing is a DRAFT-only act: every field of the request, restated. */
export const UpdateEmployeeLoanSchema = CreateEmployeeLoanSchema.partial()
  .extend({ version: z.number().int().min(0) })
  .strict();
export type UpdateEmployeeLoan = z.infer<typeof UpdateEmployeeLoanSchema>;

export const SubmitEmployeeLoanSchema = z.object({ version: z.number().int().min(0) }).strict();
export type SubmitEmployeeLoan = z.infer<typeof SubmitEmployeeLoanSchema>;

/** D2 — the second person's decision. Never the submitter's; the service enforces that. */
export const DecideEmployeeLoanSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    note: z.string().max(500).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type DecideEmployeeLoan = z.infer<typeof DecideEmployeeLoanSchema>;

/**
 * Recording that the money was handed over — ELSEWHERE.
 *
 * ECMS has no treasury and pays nobody; this is the note that a payment happened, and the moment
 * the obligation and its schedule come into existence (D5).
 */
export const DisburseEmployeeLoanSchema = z
  .object({
    /** The business date the money changed hands, as a date-only ISO string. */
    disbursedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date is YYYY-MM-DD'),
    note: z.string().max(500).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type DisburseEmployeeLoan = z.infer<typeof DisburseEmployeeLoanSchema>;

export const CancelEmployeeLoanSchema = z
  .object({ reason: z.string().min(1).max(500), version: z.number().int().min(0) })
  .strict();
export type CancelEmployeeLoan = z.infer<typeof CancelEmployeeLoanSchema>;

/**
 * D6 — spreading what is left over a different set of months.
 *
 * It takes the SAME two inputs the original schedule took, and for the same reason: the amount is
 * not one of them. Rescheduling changes WHEN money comes back, never HOW MUCH — so the server
 * re-splits exactly the sum of the rows it is replacing, through the one generator, and the
 * invariant holds by construction rather than by a client getting the rounding right.
 *
 * Only rows that are still `planned` AND whose month nobody has closed are replaced. An installment
 * sitting in a frozen period stays where it is: the past is not rewritten.
 */
export const RescheduleEmployeeLoanSchema = z
  .object({
    installmentCount: z.number().int().min(1).max(LOAN_MAX_INSTALLMENTS),
    firstPeriod: loanPeriod(),
    reason: z.string().min(1).max(500),
    version: z.number().int().min(0),
  })
  .strict();
export type RescheduleEmployeeLoan = z.infer<typeof RescheduleEmployeeLoanSchema>;

/**
 * D7-1 — money collected OUTSIDE ECMS.
 *
 * The amount must equal the remaining balance, because this decision closes the loan. It produces
 * no payroll deduction: a settlement that emitted one would be claiming a deduction that never
 * happened.
 */
export const SettleEmployeeLoanExternallySchema = z
  .object({
    amount: MoneyAmountSchema.refine((value) => value > 0, {
      message: 'a settlement must be positive',
    }),
    reason: z.string().min(1).max(500),
    /** The receipt, when there is one. Uploaded through the same attachment endpoint. */
    attachmentFileId: objectId().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type SettleEmployeeLoanExternally = z.infer<typeof SettleEmployeeLoanExternallySchema>;

/**
 * D7-2 — pay MORE through payroll in one named month (P-HR-05-B).
 *
 * The extra comes out of the LAST instalments, so the loan finishes earlier and the total does not
 * move: this is a decision to repay faster, not a decision to owe differently. It claims no cash
 * collection — that is `settleExternally`, and conflating the two would put a deduction on a
 * payslip for money that arrived in an envelope.
 */
export const AccelerateEmployeeLoanSchema = z
  .object({
    /** The month the extra is taken in. It must already carry a planned instalment. */
    period: loanPeriod(),
    extraAmount: MoneyAmountSchema.refine((value) => value > 0, {
      message: 'an acceleration must be positive',
    }),
    reason: z.string().min(1).max(500),
    version: z.number().int().min(0),
  })
  .strict();
export type AccelerateEmployeeLoan = z.infer<typeof AccelerateEmployeeLoanSchema>;

export const ListEmployeeLoansQuerySchema = PaginationQuerySchema.extend({
  type: EmployeeLoanTypeSchema.optional(),
  status: EmployeeLoanStatusSchema.optional(),
  employeeId: objectId().optional(),
}).strict();
export type ListEmployeeLoansQuery = z.infer<typeof ListEmployeeLoansQuerySchema>;

export interface LoanInstallmentDto {
  id: string;
  loanId: string;
  seq: number;
  period: string;
  amount: number;
  amountMinor: number;
  status: LoanInstallmentStatus;
}

/**
 * One repayment that ACTUALLY happened through payroll (P-HR-05-B).
 *
 * Append-only, and written at the moment a payslip is issued — the payslip is the receipt. It
 * cites the run and the payslip that took it rather than an identity of its own, so "which
 * document proves this?" has an answer that already existed.
 */
export interface LoanRepaymentDto {
  id: string;
  loanId: string;
  installmentId: string;
  period: string;
  runId: string;
  payslipId: string;
  amount: number;
  amountMinor: number;
  recordedAt: string;
}

export interface EmployeeLoanDto {
  id: string;
  employeeId: string;
  type: EmployeeLoanType;
  principal: number;
  principalMinor: number;
  currency: string;
  installmentCount: number;
  firstPeriod: string;
  reason: string;
  note: string | null;
  attachmentFileId: string | null;
  status: EmployeeLoanStatus;
  /**
   * What is still owed, in minor units.
   *
   * DERIVED, never stored: `principal − everything repaid`, where "everything repaid" is the sum
   * of the payroll repayment ledger plus an external settlement if one was recorded. Storing it as
   * a field would let it drift from the rows it summarizes.
   */
  remainingMinor: number;
  remaining: number;
  /** What payroll has actually taken so far, in minor units — the ledger's sum. */
  repaidMinor: number;
  repaid: number;
  submittedBy: string | null;
  submittedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  disbursedAt: string | null;
  disbursedBy: string | null;
  disbursementNote: string | null;
  externalSettlement: {
    amount: number;
    amountMinor: number;
    reason: string;
    at: string;
    by: string | null;
  } | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  /**
   * Display labels, enriched on the ORGANIZATION-WIDE list read (P-HR-06 / D7) — never stored.
   *
   * Optional, and absent rather than empty when nothing enriched them: the Loans tab reads one
   * employee's loans and already knows the name. Same shape as the adjustment DTO and the AT-6
   * attendance lists — a debt is a decision about a person who still exists, so the name is looked
   * up at read time instead of copied onto the row.
   */
  employeeCode?: string;
  employeeName?: string;
}

/** One loan with its schedule and what payroll has taken — what the Loans tab reads. */
export interface EmployeeLoanDetailDto extends EmployeeLoanDto {
  installments: LoanInstallmentDto[];
  repayments: LoanRepaymentDto[];
}
