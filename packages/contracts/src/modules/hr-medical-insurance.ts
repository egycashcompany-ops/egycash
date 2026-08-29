// الشؤون الطبية — التأمين الطبي (P-HR-MED §3، القرارات D2، D4، D10).
//
// THE WORD «INSURANCE» MEANS TWO THINGS AND THIS FILE IS ONLY ONE OF THEM (D2).
//
//   • التأمينات الاجتماعية — social insurance. A statutory deduction, an employer contribution, a
//     government office, an insurance number on a form. It belongs to Payroll and is DEFERRED by a
//     recorded decision: `hr-payroll.ts` states that taxes and social insurance are out of Payroll
//     v1 entirely, pointing at P-HR-12 and P-HR-14. This module does not reopen it.
//   • التأمين الطبي — medical insurance. A benefit: a provider, a card, a tier, dependants, a
//     renewal date. That is what is here.
//
// The two are ONE WORD in the language everybody here speaks, so the confusion would arrive as a
// helpful addition — an «insurance number» field that a payroll deduction is later calculated from
// — rather than as a mistake anybody makes deliberately. `medical-absences.spec.ts` forbids the
// first by name.
//
// A BENEFIT RECORD, NOT A CLAIM SYSTEM (D10). No claims, no reimbursements, no balances, no
// pre-authorisations. That is an accounting boundary and the same one PY-12, P-HR-12 and P-HR-14
// are each deliberately stopped at — and a claims ledger is a different and much larger product
// that happens to share a noun with this one.
import { z } from 'zod';
import { objectId, PaginationQuerySchema } from '../common/index.js';

/**
 * Where a card stands.
 *
 * `expired` is NOT a status anything computes. A card whose window has passed keeps saying `active`
 * until somebody ends it, because «expired» is a conclusion drawn from a date and this module draws
 * none (D13). The two states are what a person set.
 */
export const INSURANCE_CARD_STATUSES = ['active', 'ended'] as const;
export const InsuranceCardStatusSchema = z.enum(INSURANCE_CARD_STATUSES);
export type InsuranceCardStatus = z.infer<typeof InsuranceCardStatusSchema>;

/**
 * Who else the card covers.
 *
 * NAMES AND RELATIONSHIPS, and nothing more (D10, §8 Q5). A dependant here is a line on a card, not
 * a person the system administers: no national id, no birth date, no record of their own. The
 * moment any of those existed, the company would be holding personal data about people who are not
 * its employees, under a duty nobody has scoped — and the card does not need them to say who it
 * covers.
 */
export const DependantSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    /** As written: «زوجة», «ابن», «والدة». Not a closed list — nobody has given one. */
    relationship: z.string().trim().min(2).max(60),
  })
  .strict();
export type Dependant = z.infer<typeof DependantSchema>;

export const IssueInsuranceCardSchema = z
  .object({
    employeeId: objectId(),
    /** The company, as written. Not a catalogue: nobody has asked for one to be maintained. */
    provider: z.string().trim().min(2).max(200),
    /**
     * The number on the card.
     *
     * DELIBERATELY NOT CALLED `insuranceNumber` — that name belongs to the social-insurance number
     * a payroll deduction is calculated from, which this module does not hold (D2). The guard bans
     * the other name outright; this one says what it actually is.
     */
    cardNumber: z.string().trim().min(1).max(60),
    /**
     * The tier AS WRITTEN, and never derived (§8 Q2).
     *
     * Whether a grade implies a tier is a business rule nobody has given. Recording it as text
     * means the answer is whatever the policy document says, and changing bands later is an
     * administrator's afternoon rather than a migration.
     */
    tier: z.string().trim().max(100).optional(),
    startsOn: z.coerce.date(),
    /** When the policy says cover ends. Stored, shown, and never swept (D13). */
    endsOn: z.coerce.date().optional(),
    dependants: z.array(DependantSchema).max(20).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.endsOn !== undefined && value.endsOn.getTime() < value.startsOn.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsOn'],
        message: 'cover cannot end before it starts',
      });
    }
  });
export type IssueInsuranceCard = z.infer<typeof IssueInsuranceCardSchema>;

/** Correcting a live card — a typo in a number, a dependant added, a tier changed at renewal. */
export const UpdateInsuranceCardSchema = z
  .object({
    provider: z.string().trim().min(2).max(200).optional(),
    cardNumber: z.string().trim().min(1).max(60).optional(),
    tier: z.string().trim().max(100).nullable().optional(),
    endsOn: z.coerce.date().nullable().optional(),
    dependants: z.array(DependantSchema).max(20).optional(),
    note: z.string().trim().max(1000).nullable().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateInsuranceCard = z.infer<typeof UpdateInsuranceCardSchema>;

/**
 * Ending cover — a person saying it ended, because nothing here concludes it from a date (D13).
 *
 * `endedOn` rather than «today»: a card is usually ended after the fact, when somebody notices the
 * policy lapsed or the employee left, and stamping the day of the paperwork would misdate every
 * one of them.
 */
export const EndInsuranceCardSchema = z
  .object({
    endedOn: z.coerce.date(),
    reason: z.string().trim().max(500).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type EndInsuranceCard = z.infer<typeof EndInsuranceCardSchema>;

export const ListInsuranceCardsQuerySchema = PaginationQuerySchema.extend({
  employeeId: objectId().optional(),
  status: InsuranceCardStatusSchema.optional(),
  provider: z.string().max(200).optional(),
  search: z.string().max(100).optional(),
}).strict();
export type ListInsuranceCardsQuery = z.infer<typeof ListInsuranceCardsQuerySchema>;

export interface InsuranceCardDto {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  provider: string;
  cardNumber: string;
  tier: string | null;
  status: InsuranceCardStatus;
  startsOn: string;
  endsOn: string | null;
  endedOn: string | null;
  endReason: string | null;
  dependants: Dependant[];
  note: string | null;
  branchId: string | null;
  departmentId: string | null;
  version: number;
}

// ── Events (ADR-008) ────────────────────────────────────────────────────────

export const HrMedicalInsuranceEvents = {
  Issued: 'hr.medicalInsurance.issued',
  Renewed: 'hr.medicalInsurance.renewed',
  Ended: 'hr.medicalInsurance.ended',
} as const;
export type HrMedicalInsuranceEventName =
  (typeof HrMedicalInsuranceEvents)[keyof typeof HrMedicalInsuranceEvents];

/**
 * The ids and the provider — no card number, no tier, no dependants.
 *
 * A card number is a credential: it is what somebody presents at a clinic, and an event is the one
 * place in this system that fans out to subscribers whose permissions nobody checked at publish
 * time. The provider is safe and is the half a consumer would actually need.
 */
export const MedicalInsuranceEventPayloadV1 = z.object({
  cardId: objectId(),
  employeeId: objectId(),
  provider: z.string(),
});
