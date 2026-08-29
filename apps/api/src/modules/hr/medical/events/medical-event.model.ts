// What happened on a date, and what was said about it (P-HR-MED D6, D7, D8, D9, D13).
//
// AN EVENT IS NEVER EDITED (D9). The repository refuses the write at the seam — a condition riding
// inside the same atomic update as the write, the shape P-HR-PRF P4 used for a finalized review —
// so this is not a convention services have to remember. A correction is a NEW event, which is the
// only version of history that survives «what did we know, and when».
//
// NO SCOPE AXES (D4), for the reason the profile's note gives: a scope WIDENS, and this is the one
// collection where a wider scope must not mean wider reading. The key gates; the axis does not.
//
// `restriction` IS A SENTENCE AND NOTHING PARSES IT (D8). `validUntil` is stored because it is on
// the certificate, and nothing counts it (D13).
import { Schema, model, type Types } from 'mongoose';
import {
  FITNESS_VERDICTS,
  MEDICAL_EVENT_TYPES,
  type FitnessVerdict,
  type MedicalEventType,
} from '@ecms/contracts';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';

export interface MedicalEventDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  /**
   * A SNAPSHOT, not a cache — the opposite of the profile's copy.
   *
   * The profile describes somebody who still exists, so a corrected name should correct there. An
   * event is a record of a day: it says who was examined, as they were named then, and a rename in
   * 2029 must not restate what a 2026 certificate was about.
   */
  employeeCode: string;
  employeeName: string;
  type: MedicalEventType;
  /** The day it happened. `createdAt` is the day somebody filed it; the two are often not close. */
  occurredOn: Date;
  provider: string | null;
  /** As given by whoever examined them (D7). Null is normal — a vaccination has no verdict. */
  verdict: FitnessVerdict | null;
  /** A sentence. Nothing reads it as a rule (D8). */
  restriction: string | null;
  /** On the certificate. Nothing sweeps it (D13). */
  validUntil: Date | null;
  note: string | null;
}

/**
 * THE EVENT STORES NO LINK TO ITS DOCUMENT, and that falls out of D9 rather than being a separate
 * choice.
 *
 * A row that can never be written cannot have a file id written onto it after the upload — and
 * making an exception for «just this one field» would be a hole in the seam sized exactly for the
 * next exception. So the FILE points at the EVENT (`entityType: 'hr.medicalEvent'`, `entityId`),
 * which is the direction the file service already indexes, and the DTO reads it back by entity.
 *
 * The event is therefore immutable in the strong sense: nothing about it changes after the moment
 * it is recorded, including its attachments.
 */

const medicalEventSchema = new Schema<MedicalEventDoc>(
  {
    ...baseFields,
    employeeId: { type: Schema.Types.ObjectId, required: true },
    employeeCode: { type: String, required: true },
    employeeName: { type: String, required: true },
    type: { type: String, enum: MEDICAL_EVENT_TYPES, required: true },
    occurredOn: { type: Date, required: true },
    provider: { type: String, default: null },
    verdict: { type: String, enum: [...FITNESS_VERDICTS, null], default: null },
    restriction: { type: String, default: null },
    validUntil: { type: Date, default: null },
    note: { type: String, default: null },
  },
  baseSchemaOptions,
);

// One person's history, newest first — the only query this collection serves.
medicalEventSchema.index({ employeeId: 1, occurredOn: -1 }, { name: 'ix_employee_occurredOn' });

// NO INDEX ON `verdict` OR `validUntil`, deliberately. An index is what a sweep is built on, and
// «who is unfit» and «whose certificate lapsed» are the two reports D11 and D13 refuse. Without the
// index the query is expensive as well as absent, which is a second line of defence rather than a
// performance oversight.

export const MedicalEventModel = model<MedicalEventDoc>(
  'HrMedicalEvent',
  medicalEventSchema,
  'hr_medical_events',
);
