// الشؤون الطبية — الأحداث الطبية (P-HR-MED §3، القرارات D6، D7، D8، D9، D13).
//
// A PROFILE SAYS WHAT IS TRUE OF A PERSON; AN EVENT SAYS WHAT HAPPENED ON A DATE. Keeping them
// apart is the whole of D6, and the difference is not filing: a profile is CORRECTED when it turns
// out to be wrong, and an event is never edited at all (D9). What a doctor said on the fourteenth
// of March is not revised — a later opinion is a later event.
//
// THE VERDICT IS RECORDED AS GIVEN, NEVER DERIVED (D7). «Fit», «fit with restrictions», «unfit for
// this role» comes from whoever examined the person. Nothing computes it from conditions, from
// absences, or from age, and nothing recomputes it when any of those change.
//
// WHAT IS ABSENT ON PURPOSE:
//
//   • NO MACHINE-READABLE RESTRICTION (D8). «No night shifts for six months» is stored as that
//     sentence and a date. Parsing it into something a roster could enforce would mean the system
//     deciding who works nights, from a note it interpreted, with nobody in the loop.
//   • NO CONSEQUENCE (D11). An unfit verdict suspends nobody. That is a decision with legal weight
//     that a person makes and records as a personnel action, through the module that exists for it.
//   • NO EXPIRY SWEEP (D13). `validUntil` is stored because it is on the certificate. Nothing
//     counts it, nothing flags it, and nothing reports on who has lapsed — how long a certificate
//     is valid, for which roles, and what follows from a lapse are three unstated decisions.
import { z } from 'zod';
import { objectId, PaginationQuerySchema } from '../common/index.js';

/**
 * What kind of thing happened.
 *
 * A closed list because these are the KINDS of appointment an HR department arranges, not clinical
 * findings — and a reader scanning a person's history needs to know whether a row was a routine
 * check or the examination after an accident.
 */
export const MEDICAL_EVENT_TYPES = [
  'periodicCheck',
  'fitnessAssessment',
  'returnToWork',
  'workplaceInjury',
  'vaccination',
  'other',
] as const;
export const MedicalEventTypeSchema = z.enum(MEDICAL_EVENT_TYPES);
export type MedicalEventType = z.infer<typeof MedicalEventTypeSchema>;

/**
 * The verdict, when the examination produced one (D7).
 *
 * `null` is normal and not a gap: a vaccination has no verdict, and a periodic check often ends
 * with nothing to say. Requiring one would push whoever files the row into choosing a judgement
 * nobody made.
 *
 * `unfitForRole` and `unfitGenerally` are separate because they are different facts with different
 * consequences — and this module produces neither consequence (D11). The distinction exists so the
 * PERSON who acts on it knows which they are acting on.
 */
export const FITNESS_VERDICTS = [
  'fit',
  'fitWithRestrictions',
  'unfitForRole',
  'unfitGenerally',
] as const;
export const FitnessVerdictSchema = z.enum(FITNESS_VERDICTS);
export type FitnessVerdict = z.infer<typeof FitnessVerdictSchema>;

export const RecordMedicalEventSchema = z
  .object({
    employeeId: objectId(),
    type: MedicalEventTypeSchema,
    /** The day it happened, not the day somebody filed it. */
    occurredOn: z.coerce.date(),
    /** Who examined them, as written — most are not ECMS accounts. */
    provider: z.string().trim().max(200).optional(),
    verdict: FitnessVerdictSchema.optional(),
    /**
     * The restriction, AS A SENTENCE (D8).
     *
     * Required when the verdict is `fitWithRestrictions`, because «restricted» with no statement of
     * the restriction is a verdict nobody can act on — and the person who has to act on it is a
     * manager reading this row, not a machine.
     */
    restriction: z.string().trim().max(1000).optional(),
    /** What the certificate says, if it says a date. Nothing reads it (D13). */
    validUntil: z.coerce.date().optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.verdict === 'fitWithRestrictions' && (value.restriction ?? '').trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['restriction'],
        message:
          'say what the restriction is — «restricted» alone is not something anybody can act on',
      });
    }
  });
export type RecordMedicalEvent = z.infer<typeof RecordMedicalEventSchema>;

/**
 * THERE IS NO `UpdateMedicalEventSchema`, AND THERE WILL NOT BE ONE (D9).
 *
 * An event is what somebody said on a date. Editing it would let a record change after the fact
 * with nothing to show it had — and the repository refuses the write at the seam, so a schema for
 * it would be a shape describing an operation the server has no route for.
 *
 * A correction is a NEW event. That is more honest and it is also the only version of events that
 * survives somebody asking «what did we know, and when».
 */

export const ListMedicalEventsQuerySchema = PaginationQuerySchema.extend({
  employeeId: objectId().optional(),
  type: z.union([MedicalEventTypeSchema, z.array(MedicalEventTypeSchema)]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).strict();
export type ListMedicalEventsQuery = z.infer<typeof ListMedicalEventsQuerySchema>;

export interface MedicalEventDto {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  type: MedicalEventType;
  occurredOn: string;
  provider: string | null;
  verdict: FitnessVerdict | null;
  restriction: string | null;
  validUntil: string | null;
  note: string | null;
  /**
   * Read back from the file service by entity, never stored on the row.
   *
   * An event is never written after it is recorded (D9), so it cannot hold a link written after
   * the upload. The file points at the event instead, which is the direction the file service
   * already indexes.
   */
  documentFileId: string | null;
  documentFileName: string | null;
  recordedAt: string;
  version: number;
}

/**
 * Where a medical certificate lives.
 *
 * ITS OWN CATEGORY, not the training certificates' and not hiring documents'. Those are readable by
 * whoever may read a training record or a personnel file; this one is readable only by
 * `medicalRecord.view` (D3), and a shared category would have to say two different things about
 * who may reach a file.
 */
export const MEDICAL_DOCUMENT_FILE_CATEGORY = 'hr-medical-documents';

// ── Events (ADR-008) ────────────────────────────────────────────────────────

export const HrMedicalEvents = {
  Recorded: 'hr.medicalEvent.recorded',
} as const;
export type HrMedicalEventName = (typeof HrMedicalEvents)[keyof typeof HrMedicalEvents];

/**
 * THE PAYLOAD CARRIES NO VERDICT AND NO RESTRICTION, and that is D11 in the event layer.
 *
 * `hr.medicalEvent.recorded` is the most attractive event in this system to hang an automatic
 * consequence off — a roster change, a suspension, a notification to a manager. Publishing the
 * verdict would make that a five-line subscriber, written in good faith, implementing a rule with
 * legal weight that nobody has stated. A consumer that genuinely needs it reads the event through
 * the API, where `medicalRecord.view` still applies.
 */
export const MedicalEventPayloadV1 = z.object({
  eventId: objectId(),
  employeeId: objectId(),
});
