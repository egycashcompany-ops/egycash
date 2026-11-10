// One row per printed company ID card (كارنيه الشركة): who printed it and when, numbered, and —
// once HR confirms the handover — which card received it was.
//
// The counters the list reads live on the employee instead (`idCard` in `employee.model.ts`): the
// list needs them on every row and filters and sorts on them across 1,760 people, so they sit on
// the document the list already reads. This collection answers the other question — the profile's
// history — and nothing else reads it.
import { Schema, Types, model } from 'mongoose';

export interface IdCardPrintDoc {
  _id: Types.ObjectId;
  employeeId: Types.ObjectId;
  /** 1 for the first card this person ever got, 2 for the second, … */
  printNumber: number;
  printedAt: Date;
  printedBy: Types.ObjectId | null;
  /** Whether the card carried a photo, or went out with an empty frame. */
  withPhoto: boolean;
  /** Set once HR confirms this print was handed over: its number among cards RECEIVED. */
  receivedNumber?: number | null;
  receivedAt?: Date | null;
  receivedBy?: Types.ObjectId | null;
}

const idCardPrintSchema = new Schema<IdCardPrintDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    printNumber: { type: Number, required: true },
    printedAt: { type: Date, required: true },
    printedBy: { type: Schema.Types.ObjectId, default: null },
    withPhoto: { type: Boolean, required: true },
    receivedNumber: { type: Number, default: null },
    receivedAt: { type: Date, default: null },
    receivedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { versionKey: false },
);
idCardPrintSchema.index({ employeeId: 1, printedAt: -1 }, { name: 'ix_employee_printedAt' });

export const EmployeeIdCardPrintModel = model<IdCardPrintDoc>(
  'EmployeeIdCardPrint',
  idCardPrintSchema,
  'hr_employee_id_card_prints',
);
