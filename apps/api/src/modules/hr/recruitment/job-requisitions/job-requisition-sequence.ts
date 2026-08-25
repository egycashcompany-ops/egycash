// Atomic requisition numbering — the applicant sequence's shape, on the same collection.
//
// `hr_sequences` already exists and already holds a yearly, gap-free counter allocated by one
// upserting `$inc` (`applicant-sequence.ts`). This registers a second mongoose model over that same
// collection under its own key rather than importing the applicants' model: the allocator is four
// lines, and reaching into another feature's model to save them would couple two features through
// mongoose instead of through an interface. When a platform-wide sequence service exists, both
// become thin adapters over it — the comment the applicant allocator already carries.
import { Schema, model, type ClientSession } from 'mongoose';

interface SequenceDoc {
  _id: string;
  value: number;
}

const sequenceSchema = new Schema<SequenceDoc>(
  {
    _id: { type: String, required: true },
    value: { type: Number, required: true, default: 0 },
  },
  { versionKey: false, collection: 'hr_sequences' },
);

const HrRequisitionSequenceModel = model<SequenceDoc>('HrRequisitionSequence', sequenceSchema);

export const requisitionSequenceKey = (year: number): string => `jobRequisition:${year}`;

/** `REQ-2026-000123` — the year is in the code because the counter resets with it. */
export const formatRequisitionCode = (year: number, value: number): string =>
  `REQ-${String(year)}-${String(value).padStart(6, '0')}`;

export const nextRequisitionCode = async (
  year: number = new Date().getUTCFullYear(),
  session?: ClientSession,
): Promise<string> => {
  const doc = await HrRequisitionSequenceModel.findOneAndUpdate(
    { _id: requisitionSequenceKey(year) },
    { $inc: { value: 1 } },
    { new: true, upsert: true, session: session ?? null },
  )
    .lean<SequenceDoc>()
    .exec();
  return formatRequisitionCode(year, doc.value);
};
